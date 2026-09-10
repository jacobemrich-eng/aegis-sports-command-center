from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from typing import Dict, Iterable, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


SPORT_KEY = "americanfootball_nfl"
INTERNAL_CHAMPION = "NFL_v1.0_FEATURE_ABLATION"
MARKET_CHALLENGER = "NFL_v0.9_MARKET_CHALLENGER_CALIBRATION"
HISTORICAL_PREDECESSOR = "NFL_v0.8_FEATURE_HYGIENE"
PRODUCTION_HOST = "aegis-sports-command-center.onrender.com"
STAGING_ENVIRONMENT = "nfl-shadow-staging"

FORBIDDEN_BLIND_KEYS = {
    "sportsbook_spread",
    "sportsbook_total",
    "sportsbook_odds",
    "spread_line",
    "total_line",
    "closing_line",
    "market_price",
    "final_score",
    "postgame_overtime",
    "future_injury_status",
    "provider_id",
    "numeric_id",
}


def _read_json(path: str | Path) -> Dict[str, object]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def _parse_time(value: object, name: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} is required to prove pipeline order")
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _keys(value: object, prefix: str = "") -> Iterable[Tuple[str, str]]:
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            yield str(key).lower(), path
            yield from _keys(child, path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from _keys(child, f"{prefix}[{index}]")


def validate_blind_output(blind: Dict[str, object]) -> datetime:
    if str(blind.get("sport", "")).lower() not in {"nfl", SPORT_KEY}:
        raise ValueError("Blind output must declare NFL")
    if blind.get("engine_version") != INTERNAL_CHAMPION:
        raise ValueError(f"Blind output must come from current internal Champion {INTERNAL_CHAMPION}")
    if "market" in blind or "market_expressions" in blind:
        raise ValueError("Blind output must not contain Market Challenger data")
    decision = blind.get("decision")
    if isinstance(decision, dict) and ({"primary", "best_market_expression"} & set(decision)):
        raise ValueError("Blind output must not contain a market-expression decision")
    violations = [path for key, path in _keys(blind) if key in FORBIDDEN_BLIND_KEYS]
    if violations:
        raise ValueError(f"Blind feature hygiene failed: {', '.join(violations)}")
    projection = blind.get("projection")
    if not isinstance(projection, dict):
        raise ValueError("Blind output projection is required")
    if not ("margin" in projection or "mean_home_margin" in projection):
        raise ValueError("Blind margin projection is required")
    if not ("total" in projection or "mean_total" in projection):
        raise ValueError("Blind total projection is required")
    return _parse_time(blind.get("generated_at"), "blind generated_at")


def validate_market_input(market: Dict[str, object], blind_at: datetime) -> datetime:
    captured_at = _parse_time(market.get("captured_at"), "market captured_at")
    if captured_at <= blind_at:
        raise ValueError("Market Challenger capture must occur after the blind internal projection")
    challenger = market.get("challenger_projection")
    if not isinstance(challenger, dict) or challenger.get("margin") is None or challenger.get("total") is None:
        raise ValueError("Independent Market Challenger margin and total are required")
    return captured_at


def build_envelope(blind: Dict[str, object], market: Dict[str, object], blind_archive: Dict[str, object] | None = None) -> Dict[str, object]:
    blind_at = validate_blind_output(blind)
    market_at = validate_market_input(market, blind_at)
    return {
        "sport": SPORT_KEY,
        "engine_output": blind,
        "game": blind.get("game", {}),
        "market": market,
        "source": "aegis-nfl-v1.0-shadow-publisher",
        "blind_archive": blind_archive,
        "publisher": {
            "internal_champion": INTERNAL_CHAMPION,
            "historical_predecessor": HISTORICAL_PREDECESSOR,
            "post_model_challenger": MARKET_CHALLENGER,
            "blind_generated_at": blind_at.isoformat(),
            "market_captured_at": market_at.isoformat(),
            "pipeline_order": [
                "blind_internal_projection",
                "market_challenger",
                "post_model_calibration",
                "disagreement_firewall",
                "aegis_shadow_governance",
            ],
            "shadow_only": True,
            "production_release_allowed": False,
        },
    }


def validate_shadow_endpoint(endpoint: str, allowed_host: str | None = None) -> str:
    """Fail closed unless the target is localhost or an explicit NFL staging host."""
    endpoint = str(endpoint or "").strip()
    if not endpoint:
        raise ValueError("AEGIS_SHADOW_ENDPOINT is required for publish mode")
    parsed = urlparse(endpoint)
    host = str(parsed.hostname or "").lower()
    if host == PRODUCTION_HOST or host.endswith(f".{PRODUCTION_HOST}"):
        raise ValueError("Production AEGIS endpoint is forbidden for NFL shadow staging publish")
    local = host in {"127.0.0.1", "localhost", "::1"}
    if not local and parsed.scheme != "https":
        raise ValueError("Shadow endpoint must use HTTPS except for localhost testing")
    if parsed.path.rstrip("/") != "/api/shadow/games":
        raise ValueError("Shadow endpoint must end with /api/shadow/games")
    configured_host = str(allowed_host or os.getenv("AEGIS_NFL_SHADOW_ALLOWED_HOST", "")).strip().lower()
    if not local and "nfl-shadow-staging" not in host and host != configured_host:
        raise ValueError("Shadow endpoint host is not the NFL staging host")
    return endpoint


def verify_staging_readiness(endpoint: str, token: str, timeout: int = 30) -> Dict[str, object]:
    endpoint = validate_shadow_endpoint(endpoint)
    if not token:
        raise ValueError("Shadow ingest token is required")
    readiness_url = endpoint.rsplit("/games", 1)[0] + "/readiness"
    request = Request(
        readiness_url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "User-Agent": "AEGIS-NFL-shadow-readiness/1.0",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Shadow readiness rejected ({error.code}): {detail[:500]}") from error
    except URLError as error:
        raise RuntimeError(f"Shadow readiness unavailable: {error.reason}") from error

    flags = payload.get("sport_engine_flags") if isinstance(payload.get("sport_engine_flags"), dict) else {}
    persistence = payload.get("persistence") if isinstance(payload.get("persistence"), dict) else {}
    endpoints = payload.get("endpoints") if isinstance(payload.get("endpoints"), dict) else {}
    checks = {
        "ready": payload.get("ready") is True,
        "environment": payload.get("environment") == STAGING_ENVIRONMENT,
        "state_id": payload.get("state_id") == STAGING_ENVIRONMENT,
        "shadow_only": payload.get("shadow_only") is True,
        "production_release_allowed": payload.get("production_release_allowed") is False,
        "autopilot_disabled": payload.get("autopilot_enabled") is False,
        "nfl_enabled": flags.get("NFL_SIM_ENABLED") is True,
        "nfl_shadow_only": flags.get("NFL_SIM_SHADOW_ONLY") is True,
        "auto_release_disabled": flags.get("AEGIS_NEW_ENGINE_AUTO_RELEASE") is False,
        "persistence": persistence.get("ok") is True and persistence.get("persistent") is True,
        "ingest_endpoint": endpoints.get("ingest") is True,
        "grading_endpoint": endpoints.get("grading") is True,
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise RuntimeError(f"NFL staging readiness failed: {', '.join(failed)}")
    return payload


def publish(envelope: Dict[str, object], endpoint: str, token: str, timeout: int = 30) -> Dict[str, object]:
    endpoint = validate_shadow_endpoint(endpoint)
    if not token:
        raise ValueError("Shadow ingest token is required")
    request = Request(
        endpoint,
        data=json.dumps(envelope).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "AEGIS-NFL-v1.0-shadow-publisher/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Shadow ingest rejected ({error.code}): {detail[:500]}") from error
    except URLError as error:
        raise RuntimeError(f"Shadow ingest unavailable: {error.reason}") from error
    if not payload.get("ok") or payload.get("record", {}).get("release_status") != "SHADOW_ONLY":
        raise RuntimeError("Shadow endpoint did not confirm SHADOW_ONLY persistence")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish completed NFL v1.0 blind output to AEGIS shadow mode")
    parser.add_argument("--blind-output", required=True)
    parser.add_argument("--market-input", required=True)
    parser.add_argument("--endpoint", default=os.getenv("AEGIS_SHADOW_ENDPOINT", ""))
    parser.add_argument("--token-env", default="AEGIS_SHADOW_INGEST_SECRET")
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    try:
        envelope = build_envelope(_read_json(args.blind_output), _read_json(args.market_input))
        if args.dry_run:
            print(json.dumps(envelope, indent=2))
            return 0
        if not args.endpoint:
            raise ValueError("--endpoint or AEGIS_SHADOW_ENDPOINT is required")
        result = publish(envelope, args.endpoint, os.getenv(args.token_env, ""), args.timeout)
        record = result["record"]
        print(json.dumps({
            "ok": True,
            "game_id": record.get("game_id"),
            "engine_version": record.get("engine_version"),
            "release_status": record.get("release_status"),
            "decision_status": record.get("decision", {}).get("status"),
        }, indent=2))
        return 0
    except Exception as error:
        print(f"NFL shadow publish failed safely: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
