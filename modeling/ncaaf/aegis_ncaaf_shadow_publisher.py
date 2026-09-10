from __future__ import annotations

import argparse, json, os, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

try:
    from .aegis_ncaaf_engine import ENGINE_VERSION, SPORT_KEY, FORBIDDEN, validate_blind_input, walk_keys
except ImportError:
    from aegis_ncaaf_engine import ENGINE_VERSION, SPORT_KEY, FORBIDDEN, validate_blind_input, walk_keys

MARKET_CHALLENGER = "NCAAF_v0.1_INDEPENDENT_MARKET_CHALLENGER"
PRODUCTION_HOST = "aegis-sports-command-center.onrender.com"
STAGING = "ncaaf-shadow-staging"


def parse_time(value: object) -> datetime:
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return (result if result.tzinfo else result.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def validate_endpoint(endpoint: str) -> str:
    parsed = urlparse(str(endpoint or "").strip()); host = str(parsed.hostname or "").lower()
    if not endpoint: raise ValueError("AEGIS_SHADOW_ENDPOINT is required")
    if host == PRODUCTION_HOST or host.endswith("." + PRODUCTION_HOST): raise ValueError("Production AEGIS endpoint is forbidden for NCAAF shadow publish")
    local = host in {"localhost", "127.0.0.1", "::1"}
    if not local and parsed.scheme != "https": raise ValueError("NCAAF shadow endpoint must use HTTPS")
    allowed = os.getenv("AEGIS_NCAAF_SHADOW_ALLOWED_HOST", "").strip().lower()
    if not local and "ncaaf-shadow-staging" not in host and host != allowed: raise ValueError("Endpoint is not the configured NCAAF staging host")
    if parsed.path.rstrip("/") != "/api/shadow/games": raise ValueError("Endpoint must end with /api/shadow/games")
    return endpoint


def build_envelope(blind: dict, market: dict, archive: dict | None = None) -> dict:
    if blind.get("engine_version") != ENGINE_VERSION or blind.get("sport") != SPORT_KEY: raise ValueError("Blind output is not the NCAAF Champion candidate")
    violations=[path for key,path in walk_keys(blind) if key in FORBIDDEN or key.startswith("sportsbook_") or key.startswith("postgame_")]
    if "market" in blind or "market_expressions" in blind or violations: raise ValueError("Blind NCAAF output contains market/postgame leakage")
    validate_blind_input({"game_id": blind.get("game_id"), "home_team": blind.get("game",{}).get("home"), "away_team": blind.get("game",{}).get("away"), "start_time": blind.get("game",{}).get("start_time"), "home": {"classification":"unknown"}, "away":{"classification":"unknown"}, "provenance": blind.get("provenance",[])})
    blind_at, market_at = parse_time(blind.get("generated_at")), parse_time(market.get("captured_at"))
    if market_at <= blind_at: raise ValueError("Market capture must occur after immutable NCAAF blind lock")
    challenge = market.get("challenger_projection", {})
    if challenge.get("margin") is None or challenge.get("total") is None: raise ValueError("Independent market margin and total are required")
    return {"sport": SPORT_KEY, "engine_output": blind, "game": blind.get("game",{}), "market": market, "blind_archive": archive, "source":"aegis-ncaaf-shadow-publisher", "publisher":{"internal_champion":ENGINE_VERSION,"post_model_challenger":MARKET_CHALLENGER,"pipeline_order":["blind_internal_projection","immutable_blind_archive","market_capture","market_challenger","research_disagreement_gate","aegis_shadow_governance"],"shadow_only":True,"production_release_allowed":False}}


def publish(envelope: dict, endpoint: str, token: str) -> dict:
    endpoint = validate_endpoint(endpoint)
    if not token: raise ValueError("AEGIS_SHADOW_INGEST_SECRET is required")
    request = Request(endpoint, data=json.dumps(envelope).encode(), headers={"Authorization":f"Bearer {token}","Content-Type":"application/json","User-Agent":"AEGIS-NCAAF-shadow/0.1"}, method="POST")
    try:
        with urlopen(request, timeout=30) as response: payload = json.loads(response.read())
    except HTTPError as error: raise RuntimeError(f"NCAAF shadow ingest rejected ({error.code}): {error.read().decode(errors='replace')[:500]}") from error
    except URLError as error: raise RuntimeError(f"NCAAF shadow ingest unavailable: {error.reason}") from error
    record = payload.get("record", {})
    if record.get("release_status") != "SHADOW_ONLY" or record.get("official_final_card_eligible") is not False or record.get("official_bankroll_eligible") is not False: raise RuntimeError("Staging did not prove permanent shadow isolation")
    return payload


def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("--blind-output",required=True); parser.add_argument("--market-input",required=True); parser.add_argument("--endpoint",default=os.getenv("AEGIS_SHADOW_ENDPOINT","")); parser.add_argument("--dry-run",action="store_true")
    args=parser.parse_args()
    try:
        envelope=build_envelope(json.loads(Path(args.blind_output).read_text()),json.loads(Path(args.market_input).read_text()))
        if args.dry_run: print(json.dumps(envelope,indent=2)); return 0
        result=publish(envelope,args.endpoint,os.getenv("AEGIS_SHADOW_INGEST_SECRET","")); print(json.dumps({"ok":True,"game_id":result.get("record",{}).get("game_id"),"release_status":"SHADOW_ONLY"},indent=2)); return 0
    except Exception as error: print(f"NCAAF shadow publish failed safely: {error}",file=sys.stderr); return 1


if __name__ == "__main__": raise SystemExit(main())
