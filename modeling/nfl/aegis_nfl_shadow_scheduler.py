from __future__ import annotations

import argparse
import csv
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import sys
from typing import Dict, Iterable, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from aegis_nfl_shadow_publisher import SPORT_KEY, validate_shadow_endpoint, verify_staging_readiness


SCHEDULE_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
EASTERN = ZoneInfo("America/New_York")
WINDOWS = (
    ("EARLY_BASELINE", timedelta(hours=48), timedelta(hours=96)),
    ("DAY_BEFORE", timedelta(hours=18), timedelta(hours=30)),
    ("PREGAME", timedelta(minutes=90), timedelta(minutes=180)),
    ("FINAL_PRE_KICK", timedelta(minutes=20), timedelta(minutes=75)),
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: object) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def schedule_kickoff(row: Mapping[str, object]) -> datetime:
    value = row.get("start_time") or row.get("commence_time") or row.get("datetime")
    if value and str(value).lower() != "nan":
        return parse_time(value)
    day, clock = str(row.get("gameday", "")), str(row.get("gametime", "13:00"))
    local = datetime.fromisoformat(f"{day}T{clock}:00" if len(clock) == 5 else f"{day}T{clock}")
    return local.replace(tzinfo=EASTERN).astimezone(timezone.utc)


def fetch_schedule(season: int) -> list[dict]:
    request = Request(SCHEDULE_URL, headers={"User-Agent": "AEGIS-NFL-shadow-scheduler/1.0"})
    try:
        with urlopen(request, timeout=30) as response:
            rows = list(csv.DictReader(io.StringIO(response.read().decode("utf-8-sig"))))
    except HTTPError as error:
        raise RuntimeError(f"NFL schedule preflight rejected ({error.code})") from error
    except URLError as error:
        raise RuntimeError(f"NFL schedule preflight unavailable: {error.reason}") from error
    return [row for row in rows if str(row.get("season")) == str(season) and row.get("game_type") == "REG"]


def fetch_state(endpoint: str, token: str) -> dict:
    if not token:
        raise ValueError("AEGIS_SHADOW_INGEST_SECRET is required for scheduler preflight")
    endpoint = validate_shadow_endpoint(endpoint)
    url = endpoint.rsplit("/games", 1)[0] + "/scheduler-state"
    request = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"}, method="GET")
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"NFL scheduler state rejected ({error.code}): {detail[:300]}") from error
    except URLError as error:
        raise RuntimeError(f"NFL scheduler state unavailable: {error.reason}") from error


def target_for(kickoff: datetime, now: datetime) -> Optional[str]:
    until = kickoff - now
    if until <= timedelta(0):
        return None
    for name, minimum, maximum in WINDOWS:
        if minimum <= until <= maximum:
            return name
    return None


def infer_existing_targets(kickoff: datetime, snapshots: Iterable[Mapping[str, object]]) -> set[str]:
    targets = set()
    for snapshot in snapshots:
        explicit = snapshot.get("snapshot_target")
        if explicit:
            targets.add(str(explicit))
            continue
        try:
            inferred = target_for(kickoff, parse_time(snapshot.get("captured_at")))
            if inferred:
                targets.add(inferred)
        except (TypeError, ValueError):
            continue
    return targets


def preflight(schedule: Iterable[Mapping[str, object]], state: Mapping[str, object], now: datetime) -> dict:
    persisted = {str(row.get("game_id")): row for row in state.get("games", [])}
    due: Dict[str, str] = {}
    grade_due = []
    upcoming = []
    for row in schedule:
        game_id = str(row.get("game_id") or row.get("id") or "")
        if not game_id:
            continue
        kickoff = schedule_kickoff(row)
        saved = persisted.get(game_id, {})
        if kickoff <= now:
            if saved and not saved.get("graded") and now >= kickoff + timedelta(hours=4):
                grade_due.append(game_id)
            continue
        upcoming.append(game_id)
        target = target_for(kickoff, now)
        if target and target not in infer_existing_targets(kickoff, saved.get("market_snapshots", [])):
            due[game_id] = target
    action = "PROJECT_AND_PUBLISH" if due else "GRADE_ONLY" if grade_due else "NO_ACTION"
    return {
        "action": action,
        "checked_at": now.isoformat().replace("+00:00", "Z"),
        "sport": SPORT_KEY,
        "shadow_only": True,
        "odds_api_calls_planned": 1 if due else 0,
        "project_games": sorted(due),
        "snapshot_targets": due,
        "grade_games": sorted(grade_due),
        "upcoming_games_seen": len(upcoming),
    }


def write_github_output(path: str, report: Mapping[str, object]) -> None:
    if not path:
        return
    with Path(path).open("a", encoding="utf-8") as handle:
        handle.write(f"action={report['action']}\n")
        handle.write(f"odds_api_calls_planned={report['odds_api_calls_planned']}\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Quota-conscious NFL shadow scheduler preflight")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--endpoint", default=os.getenv("AEGIS_SHADOW_ENDPOINT", ""))
    parser.add_argument("--output")
    parser.add_argument("--github-output", default=os.getenv("GITHUB_OUTPUT", ""))
    parser.add_argument("--now", help="Test/operator override; ISO-8601 UTC instant")
    args = parser.parse_args()
    token = os.getenv("AEGIS_SHADOW_INGEST_SECRET", "")
    try:
        verify_staging_readiness(args.endpoint, token)
        report = preflight(fetch_schedule(args.season), fetch_state(args.endpoint, token), parse_time(args.now) if args.now else utc_now())
        if args.output:
            Path(args.output).parent.mkdir(parents=True, exist_ok=True)
            Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
        write_github_output(args.github_output, report)
        print(json.dumps(report, indent=2))
        return 0
    except Exception as error:
        print(f"NFL shadow scheduler stopped safely: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
