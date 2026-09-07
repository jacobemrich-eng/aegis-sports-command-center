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


def build_envelope(blind: Dict[str, object], market: Dict[str, object]) -> Dict[str, object]:
    blind_at = validate_blind_output(blind)
    market_at = validate_market_input(market, blind_at)
    return {
        "sport": SPORT_KEY,
        "engine_output": blind,
        "game": blind.get("game", {}),
        "market": market,
        "source": "aegis-nfl-v1.0-shadow-publisher",
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


def publish(envelope: Dict[str, object], endpoint: str, token: str, timeout: int = 30) -> Dict[str, object]:
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" and parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Shadow endpoint must use HTTPS except for localhost testing")
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
