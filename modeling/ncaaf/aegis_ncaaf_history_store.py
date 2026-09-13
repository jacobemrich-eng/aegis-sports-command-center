from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any, Iterable, Mapping
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_ROOT = "https://api.collegefootballdata.com"
RAW_ROOT = Path("data/ncaaf_history/raw")
CLASSIFICATIONS = {"SAFE_PREGAME", "SAFE_WITH_CUTOFF", "RETROSPECTIVE_ONLY", "UNAVAILABLE"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256(value: object) -> str:
    return hashlib.sha256((value if isinstance(value, str) else canonical_json(value)).encode("utf-8")).hexdigest()


def slug(endpoint: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", endpoint.strip("/").lower()).strip("-") or "root"


@dataclass(frozen=True)
class FetchResult:
    payload: Any
    path: Path
    cache_hit: bool
    quota_remaining: int | None


class CFBDCache:
    def __init__(self, api_key: str | None = None, root: str | Path = RAW_ROOT):
        self.api_key = str(api_key or os.getenv("CFBD_API_KEY", "")).strip()
        if not self.api_key:
            raise ValueError("CFBD_API_KEY is required")
        self.root = Path(root)
        self.api_calls = 0

    def path_for(self, endpoint: str, params: Mapping[str, object]) -> Path:
        season = params.get("year") or params.get("season") or "global"
        week = params.get("week", "all")
        fingerprint = sha256({key: params[key] for key in sorted(params)})[:12]
        return self.root / slug(endpoint) / str(season) / f"week-{week}-{fingerprint}.json"

    def fetch(self, endpoint: str, params: Mapping[str, object], classification: str, *, season: int | None = None, week: int | None = None) -> FetchResult:
        if classification not in CLASSIFICATIONS:
            raise ValueError(f"Invalid source classification: {classification}")
        clean = {key: value for key, value in params.items() if value is not None}
        path = self.path_for(endpoint, clean)
        if path.exists():
            envelope = json.loads(path.read_text(encoding="utf-8"))
            if envelope.get("response_sha256") != sha256(envelope.get("payload")):
                raise ValueError(f"Cached CFBD response hash mismatch: {path}")
            return FetchResult(envelope["payload"], path, True, envelope.get("quota_remaining"))
        request = Request(f"{API_ROOT}{endpoint}?{urlencode(clean)}", headers={"Authorization": f"Bearer {self.api_key}", "Accept": "application/json", "User-Agent": "AEGIS-NCAAF-history/0.1"})
        try:
            with urlopen(request, timeout=120) as response:
                body = response.read()
                payload = json.loads(body)
                remaining = response.headers.get("X-CallLimit-Remaining")
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"CFBD {endpoint} failed ({error.code}): {detail[:400]}") from error
        self.api_calls += 1
        envelope = {
            "retrieved_at": utc_now(), "source": "CollegeFootballData", "source_endpoint": endpoint,
            "query_parameters": clean, "season": season if season is not None else clean.get("year"),
            "week": week if week is not None else clean.get("week"), "data_classification": classification,
            "response_sha256": sha256(payload), "quota_remaining": int(remaining) if remaining and remaining.isdigit() else None,
            "payload": payload,
        }
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(envelope, indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(path)
        return FetchResult(payload, path, False, envelope["quota_remaining"])


SOURCE_CATALOG = {
    "games": ("/games", "SAFE_WITH_CUTOFF", "Schedule metadata is pregame-safe; scores and postgame fields are targets only."),
    "plays": ("/plays", "SAFE_WITH_CUTOFF", "Target-game plays are excluded; only completed earlier games enter rolling state."),
    "drives": ("/drives", "SAFE_WITH_CUTOFF", "Target-game drives are excluded; only completed earlier games enter rolling state."),
    "team_box": ("/games/teams", "SAFE_WITH_CUTOFF", "Postgame source usable only after each source game completes."),
    "talent": ("/talent", "SAFE_PREGAME", "Annual roster talent composite is treated as preseason-static when available."),
    "returning": ("/player/returning", "SAFE_PREGAME", "Returning production is a preseason roster attribute."),
    "transfers": ("/player/portal", "SAFE_WITH_CUTOFF", "Only portal records dated before the season/game cutoff may be used."),
    "coaches": ("/coaches", "SAFE_PREGAME", "Season coaching assignment is preseason-static; career totals are excluded."),
    "elo": ("/ratings/elo", "RETROSPECTIVE_ONLY", "Standalone historical rating snapshots are not trusted; game pregame Elo is preferred."),
    "sp": ("/ratings/sp", "RETROSPECTIVE_ONLY", "No point-in-time publication archive is proven."),
    "srs": ("/ratings/srs", "RETROSPECTIVE_ONLY", "Season rating can incorporate later games."),
    "core": ("/ratings/core", "RETROSPECTIVE_ONLY", "CFBD documents historical CORE as retrospective methodology output."),
    "lines": ("/lines", "RETROSPECTIVE_ONLY", "Evaluation comparator only; never enters blind features."),
    "weather": ("/games/weather", "SAFE_WITH_CUTOFF", "Historical observed weather is not guaranteed to equal forecast-at-cutoff and is excluded initially."),
    "fbs_teams": ("/teams/fbs", "SAFE_PREGAME", "Season classification and conference identity."),
    "conferences": ("/conferences", "SAFE_PREGAME", "Conference metadata."),
}


def calendar_weeks(client: CFBDCache, year: int) -> list[int]:
    result = client.fetch("/calendar", {"year": year}, "SAFE_PREGAME", season=year)
    return sorted({int(row["week"]) for row in result.payload if row.get("seasonType") == "regular" and row.get("week") is not None})


def planned_requests(years: Iterable[int], weeks_by_year: Mapping[int, Iterable[int]]) -> dict[str, int]:
    years = list(years)
    weekly = sum(len(list(weeks_by_year.get(year, []))) for year in years)
    # Six regular season-level requests, portal only from its 2021 coverage,
    # and two first-year prior-context requests. Calendar requests are reported
    # separately because this function is called after discovering the weeks.
    season_level = len(years) * 6
    portal = sum(year >= 2021 for year in years)
    prior_context = 2
    total = season_level + portal + prior_context + weekly * 2
    return {"season_level": season_level, "portal": portal, "prior_context": prior_context,
            "weekly_plays": weekly, "weekly_drives": weekly,
            "calendar": len(years), "bulk_total": total, "including_calendar": total + len(years)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Content-addressed CFBD historical cache")
    parser.add_argument("--years", default="2019-2025")
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()
    start, end = (int(value) for value in args.years.split("-", 1)); years = list(range(start, end + 1))
    client = CFBDCache(); weeks = {year: calendar_weeks(client, year) for year in years}; plan = planned_requests(years, weeks)
    print(json.dumps({"years": years, "weeks": {str(k): v for k, v in weeks.items()}, "planned": plan, "calendar_api_calls_this_run": client.api_calls}, indent=2))
    return 0


if __name__ == "__main__": raise SystemExit(main())
