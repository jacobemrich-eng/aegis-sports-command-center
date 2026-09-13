from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from .aegis_ncaaf_history_store import CFBDCache, SOURCE_CATALOG
except ImportError:
    from aegis_ncaaf_history_store import CFBDCache, SOURCE_CATALOG


PROBES = {
    "games": ("/games", {"year": 2024, "seasonType": "regular"}),
    "plays": ("/plays", {"year": 2024, "week": 1, "seasonType": "regular"}),
    "drives": ("/drives", {"year": 2024, "week": 1, "seasonType": "regular"}),
    "team_box": ("/games/teams", {"year": 2024, "week": 1, "seasonType": "regular"}),
    "talent": ("/talent", {"year": 2024}),
    "returning": ("/player/returning", {"year": 2024}),
    "transfers": ("/player/portal", {"year": 2024}),
    "coaches": ("/coaches", {"year": 2024}),
    "lines": ("/lines", {"year": 2024, "seasonType": "regular"}),
    "fbs_teams": ("/teams/fbs", {"year": 2024}),
    "conferences": ("/conferences", {}),
}


def audit(client: CFBDCache) -> dict:
    rows = []
    for name, (endpoint, params) in PROBES.items():
        classification = SOURCE_CATALOG[name][1]
        try:
            result = client.fetch(endpoint, params, classification, season=params.get("year"), week=params.get("week"))
            payload = result.payload
            rows.append({"name": name, "endpoint": endpoint, "classification": classification, "status": "AVAILABLE", "records": len(payload) if isinstance(payload, list) else 1, "cache_hit": result.cache_hit, "response_path": str(result.path), "quota_remaining": result.quota_remaining, "note": SOURCE_CATALOG[name][2]})
        except Exception as error:
            rows.append({"name": name, "endpoint": endpoint, "classification": "UNAVAILABLE", "status": "UNAVAILABLE", "records": 0, "error": str(error)[:500], "note": SOURCE_CATALOG[name][2]})
    for name in ("elo", "sp", "srs", "core", "weather"):
        endpoint, classification, note = SOURCE_CATALOG[name]
        rows.append({"name": name, "endpoint": endpoint, "classification": classification, "status": "DOCUMENTED_NOT_PROBED", "records": None, "note": note})
    return {"probe_year": 2024, "api_calls_this_run": client.api_calls, "coverage": rows}


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--output", default="data/ncaaf_history/reports/coverage-audit.json")
    args = parser.parse_args(); client = CFBDCache(); report = audit(client)
    target = Path(args.output); target.parent.mkdir(parents=True, exist_ok=True); target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2)); return 0


if __name__ == "__main__": raise SystemExit(main())
