from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from .aegis_ncaaf_history_store import CFBDCache, calendar_weeks
except ImportError:
    from aegis_ncaaf_history_store import CFBDCache, calendar_weeks


SEASON_REQUESTS = (
    ("/games", {"seasonType": "regular"}, "SAFE_WITH_CUTOFF"),
    ("/talent", {}, "SAFE_PREGAME"),
    ("/player/returning", {}, "SAFE_PREGAME"),
    ("/coaches", {}, "SAFE_PREGAME"),
    ("/lines", {"seasonType": "regular"}, "RETROSPECTIVE_ONLY"),
    ("/teams/fbs", {}, "SAFE_PREGAME"),
)


def fetch_history(client: CFBDCache, years: list[int]) -> dict:
    rows, failures = [], []
    weeks_by_year = {year: calendar_weeks(client, year) for year in years}
    requests = []
    # The first target season needs one prior season of completed games and
    # coaching assignments for preseason priors. These records are context,
    # never evaluation targets.
    prior_year = min(years) - 1
    requests.extend((
        ("/games", {"year": prior_year, "seasonType": "regular"}, "SAFE_WITH_CUTOFF", prior_year, None),
        ("/coaches", {"year": prior_year}, "SAFE_PREGAME", prior_year, None),
    ))
    for year in years:
        for endpoint, extra, classification in SEASON_REQUESTS:
            requests.append((endpoint, {"year": year, **extra}, classification, year, None))
        if year >= 2021:
            requests.append(("/player/portal", {"year": year}, "SAFE_WITH_CUTOFF", year, None))
        for week in weeks_by_year[year]:
            params = {"year": year, "week": week, "seasonType": "regular"}
            requests.append(("/plays", params, "SAFE_WITH_CUTOFF", year, week))
            requests.append(("/drives", params, "SAFE_WITH_CUTOFF", year, week))
    for index, (endpoint, params, classification, year, week) in enumerate(requests, 1):
        try:
            result = client.fetch(endpoint, params, classification, season=year, week=week)
            rows.append({"endpoint": endpoint, "year": year, "week": week, "records": len(result.payload) if isinstance(result.payload, list) else 1, "cache_hit": result.cache_hit, "path": str(result.path)})
        except Exception as error:
            failures.append({"endpoint": endpoint, "year": year, "week": week, "error": str(error)[:500]})
        if index % 25 == 0:
            print(json.dumps({"progress": index, "planned": len(requests), "api_calls": client.api_calls, "failures": len(failures)}), flush=True)
    return {"years": years, "planned_requests": len(requests), "api_calls_this_run": client.api_calls, "cache_hits": sum(row["cache_hit"] for row in rows), "successful": len(rows), "failures": failures, "responses": rows}


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--years", default="2019-2025"); parser.add_argument("--output", default="data/ncaaf_history/reports/fetch-report.json")
    args = parser.parse_args(); start, end = (int(x) for x in args.years.split("-", 1)); client = CFBDCache(); report = fetch_history(client, list(range(start, end + 1)))
    target = Path(args.output); target.parent.mkdir(parents=True, exist_ok=True); target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("years", "planned_requests", "api_calls_this_run", "cache_hits", "successful", "failures")}, indent=2)); return 1 if report["failures"] else 0


if __name__ == "__main__": raise SystemExit(main())
