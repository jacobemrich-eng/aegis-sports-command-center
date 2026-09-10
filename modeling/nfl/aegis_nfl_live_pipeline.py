from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import statistics
import sys
from typing import Callable, Dict, Iterable, List, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from aegis_nfl_shadow_publisher import (
    INTERNAL_CHAMPION,
    SPORT_KEY,
    build_envelope,
    publish,
    validate_blind_output,
    validate_shadow_endpoint,
    verify_staging_readiness,
)
from aegis_nfl_blind_archive import backfill_files, file_payload, hydrate


REPO_ROOT = Path(__file__).resolve().parents[2]
V10_REPORT = REPO_ROOT / "public" / "data" / "nfl-v10-report.json"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "nfl_shadow_live"
ODDS_BASE = "https://api.the-odds-api.com/v4"
PRE_GAME_FORBIDDEN = {
    "spread_line", "total_line", "sportsbook_spread", "sportsbook_total",
    "sportsbook_odds", "closing_line", "market_price", "final_score",
    "home_score", "away_score", "result", "postgame_overtime",
    "future_injury_status",
}

TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills", "CAR": "Carolina Panthers", "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns", "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs", "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers",
    "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins", "MIN": "Minnesota Vikings",
    "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks", "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: object) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def walk_keys(value: object, prefix: str = "") -> Iterable[tuple[str, str]]:
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            yield str(key).lower(), path
            yield from walk_keys(child, path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_keys(child, f"{prefix}[{index}]")


def validate_pregame_game(game: Mapping[str, object], prediction_at: datetime) -> None:
    required = ["id", "home_team", "away_team", "start_time", "season", "week"]
    missing = [key for key in required if game.get(key) in (None, "")]
    if missing:
        raise ValueError(f"Pregame game is missing: {', '.join(missing)}")
    if parse_time(game["start_time"]) <= prediction_at:
        raise ValueError("Pregame prediction requires a future kickoff")
    violations = [path for key, path in walk_keys(game) if key in PRE_GAME_FORBIDDEN]
    if violations:
        raise ValueError(f"Future/postgame or market data rejected from pregame input: {', '.join(violations)}")


def validate_optional_context(context: Mapping[str, object], prediction_at: datetime) -> None:
    if not context:
        return
    known_at = context.get("known_at")
    if not known_at or parse_time(known_at) > prediction_at:
        raise ValueError("QB/injury context requires known_at at or before blind prediction time")
    violations = [path for key, path in walk_keys(context) if key in PRE_GAME_FORBIDDEN]
    if violations:
        raise ValueError(f"Unsafe pregame context rejected: {', '.join(violations)}")


def schedule_kickoff(row: Mapping[str, object]) -> datetime:
    for key in ("start_time", "commence_time", "datetime"):
        value = row.get(key)
        if value and str(value).lower() != "nan":
            return parse_time(value)
    day, clock = str(row.get("gameday", "")), str(row.get("gametime", "13:00"))
    local = datetime.fromisoformat(f"{day}T{clock}:00" if len(clock) == 5 else f"{day}T{clock}")
    return local.replace(tzinfo=ZoneInfo("America/New_York")).astimezone(timezone.utc)


def selected_v10() -> tuple[List[str], Dict[str, float]]:
    report = json.loads(V10_REPORT.read_text(encoding="utf-8"))
    if report.get("untouched_2025", {}).get("promotion_gate", {}).get("decision") != "PROMOTE_V10_INTERNAL_CHALLENGER":
        raise ValueError("Committed v1.0 promotion gate is not the expected internal shadow promotion")
    return list(report["selected_features"]), dict(report["selected_hyperparameters"])


def upcoming_schedule(season: int, lookahead_days: int, now: datetime) -> List[Dict[str, object]]:
    from aegis_nflverse_bootstrap import load_schedule

    schedule = load_schedule([season])
    if "game_type" in schedule.columns:
        schedule = schedule[schedule["game_type"].eq("REG")]
    games = []
    for row in schedule.to_dict("records"):
        kickoff = schedule_kickoff(row)
        if not (now < kickoff <= now + timedelta(days=lookahead_days)):
            continue
        games.append({
            "id": str(row["game_id"]), "home_team": str(row["home_team"]),
            "away_team": str(row["away_team"]), "start_time": iso(kickoff),
            "season": int(row["season"]), "week": int(row["week"]),
            "home_rest": None if row.get("home_rest") is None else float(row.get("home_rest")),
            "away_rest": None if row.get("away_rest") is None else float(row.get("away_rest")),
            "div_game": float(bool(row.get("div_game", False))),
        })
    return sorted(games, key=lambda game: game["start_time"])


class V10LiveModel:
    """Locked v1.0 features/hyperparameters refit only on games completed before the slate cutoff."""

    def __init__(self, start_season: int, season: int, cache_dir: str, cutoff: datetime):
        self.start_season, self.season, self.cache_dir, self.cutoff = start_season, season, cache_dir, cutoff
        self.features, self.hyper = selected_v10()
        self.training = None
        self.team_games = None
        self.margin_model = None
        self.total_model = None
        self.margin_sigma = None
        self.total_sigma = None
        self.medians = None

    def prepare(self) -> None:
        import numpy as np
        import pandas as pd
        from sklearn.linear_model import Ridge
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
        from aegis_nflverse_bootstrap import load, load_schedule
        from aegis_nfl_historical_features import aggregate_team_game, join_offense_defense
        from aegis_nfl_snapshot_builder import attach_schedule, build_weekly_snapshots, combine_game_rows

        schedule = load_schedule(range(self.start_season, self.season + 1))
        if "game_type" in schedule.columns:
            schedule = schedule[schedule["game_type"].eq("REG")].copy()
        frames, team_frames = [], []
        for year in range(self.start_season, self.season + 1):
            year_schedule = schedule[schedule["season"].eq(year)].copy()
            completed = year_schedule.get("home_score").notna() & year_schedule.get("away_score").notna()
            if not completed.any():
                continue
            try:
                pbp = load("pbp", year, self.cache_dir)
            except (FileNotFoundError, RuntimeError):
                if year == self.season:
                    continue
                raise
            if "season_type" in pbp.columns:
                pbp = pbp[pbp["season_type"].eq("REG")].copy()
            off = aggregate_team_game(pbp)
            team = join_offense_defense(off)
            team = attach_schedule(team, year_schedule)
            team_frames.append(team)
            snapshots = build_weekly_snapshots(team)
            games = combine_game_rows(year_schedule, snapshots)
            home = pd.to_numeric(games.get("home_score"), errors="coerce")
            away = pd.to_numeric(games.get("away_score"), errors="coerce")
            games["home_margin"] = home - away
            games["game_total"] = home + away
            kickoff = games.apply(lambda row: schedule_kickoff(row.to_dict()), axis=1)
            games = games[[value < self.cutoff for value in kickoff]]
            frames.append(games)
        if not frames or not team_frames:
            raise ValueError("No pre-cutoff NFL training data is available")
        training = pd.concat(frames, ignore_index=True)
        training = training.dropna(subset=self.features + ["home_margin", "game_total"])
        if len(training) < 500:
            raise ValueError(f"NFL v1.0 requires at least 500 clean training games; found {len(training)}")
        self.training = training
        self.team_games = pd.concat(team_frames, ignore_index=True)
        self.medians = training[self.features].median(numeric_only=True)
        self.margin_model = Pipeline([("scale", StandardScaler()), ("model", Ridge(alpha=float(self.hyper["margin_alpha"])))])
        self.total_model = Pipeline([("scale", StandardScaler()), ("model", Ridge(alpha=float(self.hyper["total_alpha"])))])
        self.margin_model.fit(training[self.features], training["home_margin"])
        self.total_model.fit(training[self.features], training["game_total"])
        self.margin_sigma = float(np.std(training["home_margin"] - self.margin_model.predict(training[self.features]), ddof=1))
        self.total_sigma = float(np.std(training["game_total"] - self.total_model.predict(training[self.features]), ddof=1))

    def _team_snapshot(self, team: str, season: int, week: int) -> tuple[Dict[str, float], int, bool]:
        import numpy as np
        import pandas as pd

        rows = self.team_games[(self.team_games["team"] == team) & ((self.team_games["season"] < season) | ((self.team_games["season"] == season) & (self.team_games["week"] < week)))].copy()
        rows = rows.sort_values(["season", "week", "game_id"]).tail(24)
        if rows.empty:
            raise ValueError(f"No pregame team history is available for {team}")
        ages = np.arange(len(rows) - 1, -1, -1)
        weights = 0.5 ** (ages / 4.0)
        values = {}
        base_features = {feature.removeprefix("home_").removeprefix("away_") for feature in self.features}
        for feature in base_features:
            if feature in {"rest", "div_game", "games_in_sample"} or feature not in rows.columns:
                continue
            series = pd.to_numeric(rows[feature], errors="coerce").to_numpy(float)
            valid = np.isfinite(series)
            if valid.any():
                values[feature] = float(np.average(series[valid], weights=weights[valid]))
        current_count = int(((rows["season"] == season) & (rows["week"] < week)).sum())
        carryover = current_count == 0
        support = current_count if current_count else int(min(17, (rows["season"] == rows["season"].max()).sum()))
        return values, support, carryover

    def feature_row(self, game: Mapping[str, object]) -> tuple[Dict[str, float], Dict[str, object]]:
        home, home_n, home_carry = self._team_snapshot(str(game["home_team"]), int(game["season"]), int(game["week"]))
        away, away_n, away_carry = self._team_snapshot(str(game["away_team"]), int(game["season"]), int(game["week"]))
        row = {"home_rest": game.get("home_rest"), "away_rest": game.get("away_rest"), "div_game": game.get("div_game", 0.0)}
        for feature in self.features:
            if feature.startswith("home_") and feature not in row:
                base = feature[5:]
                row[feature] = home_n if base == "games_in_sample" else home.get(base)
            elif feature.startswith("away_") and feature not in row:
                base = feature[5:]
                row[feature] = away_n if base == "games_in_sample" else away.get(base)
        missing = [feature for feature in self.features if row.get(feature) is None or not math.isfinite(float(row[feature]))]
        for feature in missing:
            row[feature] = float(self.medians[feature])
        quality = max(0.35, 1.0 - 0.025 * len(missing) - (0.12 if home_carry or away_carry else 0.0))
        return {feature: float(row[feature]) for feature in self.features}, {
            "missing_imputed_features": missing, "home_games_in_sample": home_n,
            "away_games_in_sample": away_n, "prior_season_carryover": home_carry or away_carry,
            "data_quality_score": quality,
        }

    def predict(self, game: Mapping[str, object], context: Optional[Mapping[str, object]] = None, generated_at: Optional[datetime] = None) -> Dict[str, object]:
        import pandas as pd

        if self.margin_model is None:
            self.prepare()
        generated_at = generated_at or utc_now()
        validate_pregame_game(game, generated_at)
        validate_optional_context(context or {}, generated_at)
        features, quality = self.feature_row(game)
        frame = pd.DataFrame([features], columns=self.features)
        margin = float(self.margin_model.predict(frame)[0])
        total = float(self.total_model.predict(frame)[0])
        home = max(0.0, (total + margin) / 2.0)
        away = max(0.0, (total - margin) / 2.0)
        home_win = 0.5 * (1.0 + math.erf(margin / (self.margin_sigma * math.sqrt(2.0))))
        grade = "A" if quality["data_quality_score"] >= 0.9 else "B" if quality["data_quality_score"] >= 0.75 else "C"
        z = 1.2815515655446004
        return {
            "schema_version": "AEGIS_STANDARD_GAME_OUTPUT_v1", "sport": "NFL",
            "engine_version": INTERNAL_CHAMPION, "generated_at": iso(generated_at),
            "game": {"id": game["id"], "home": game["home_team"], "away": game["away_team"], "start_time": game["start_time"], "season": game["season"], "week": game["week"]},
            "blind_features": self.features,
            "projection": {
                "mean_home": home, "mean_away": away, "mean_home_margin": margin, "mean_total": total,
                "home_ml": home_win, "away_ml": 1.0 - home_win,
                "distribution": {"margin_standard_deviation": self.margin_sigma, "total_standard_deviation": self.total_sigma},
                "percentiles": {
                    "margin": {"p10": margin - z * self.margin_sigma, "p50": margin, "p90": margin + z * self.margin_sigma},
                    "total": {"p10": total - z * self.total_sigma, "p50": total, "p90": total + z * self.total_sigma},
                },
            },
            "quality": {"data_quality_score": quality["data_quality_score"], "data_quality_grade": grade, "uncertainty": max(self.margin_sigma, self.total_sigma), "model_dispersion": None, "ensemble_agreement": "SINGLE_CHAMPION", "margin_standard_deviation": self.margin_sigma, "total_standard_deviation": self.total_sigma},
            "diagnostics": {
                "why_it_wins": ["Locked v1.0 rolling efficiency and success-rate profile supports the projected scoring margin."],
                "how_it_loses": ["Turnovers, explosive plays, or late personnel changes can overwhelm a pregame mean projection."],
                "tail_risks": ["Residual distribution remains wide; disagreement is handled only after the market snapshot."],
                "matchup_drivers": [],
                "sport_specific": {"nfl": {"season": game["season"], "week": game["week"], **quality, "optional_pregame_context": dict(context or {}), "training_games": int(len(self.training)), "training_cutoff": iso(self.cutoff)}},
            },
        }


def _api_json(url: str, timeout: int = 45) -> tuple[object, Mapping[str, str]]:
    request = Request(url, headers={"User-Agent": "AEGIS-NFL-shadow-validation/1.0"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8")), response.headers


def odds_snapshot(api_key: str, bookmakers: str = "") -> tuple[List[dict], Dict[str, object]]:
    if not api_key:
        raise ValueError("ODDS_API_KEY is required for the post-blind market phase")
    params = {"apiKey": api_key, "markets": "h2h,spreads,totals", "oddsFormat": "american", "dateFormat": "iso"}
    params["bookmakers" if bookmakers else "regions"] = bookmakers or "us"
    rows, headers = _api_json(f"{ODDS_BASE}/sports/{SPORT_KEY}/odds?{urlencode(params)}")
    return list(rows), {"remaining": headers.get("x-requests-remaining"), "used": headers.get("x-requests-used"), "last": headers.get("x-requests-last")}


def _normalized(value: object) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _event_for(game: Mapping[str, object], events: Iterable[dict]) -> dict:
    # Upcoming schedule rows use home_team/away_team, while immutable blind
    # snapshots intentionally expose the shared game schema as home/away.
    home_team = game.get("home_team", game.get("home"))
    away_team = game.get("away_team", game.get("away"))
    if not home_team or not away_team:
        raise ValueError("NFL market matching requires home and away teams")
    home = _normalized(TEAM_NAMES.get(str(home_team), home_team))
    away = _normalized(TEAM_NAMES.get(str(away_team), away_team))
    for event in events:
        if _normalized(event.get("home_team")) == home and _normalized(event.get("away_team")) == away:
            return event
    raise ValueError(f"No post-blind NFL market found for {away_team} at {home_team}")


def _market_outcomes(event: dict, key: str) -> List[dict]:
    rows = []
    for book in event.get("bookmakers", []):
        market = next((item for item in book.get("markets", []) if item.get("key") == key), None)
        if market:
            for outcome in market.get("outcomes", []):
                rows.append({**outcome, "book": book.get("key"), "last_update": book.get("last_update")})
    return rows


def _american_implied(price: object) -> Optional[float]:
    value = float(price) if price is not None else None
    if value is None or value == 0:
        return None
    return -value / (-value + 100.0) if value < 0 else 100.0 / (value + 100.0)


def _candidate(name: str, market_type: str, point: float, price: float, probability: float, book: str) -> dict:
    implied = _american_implied(price)
    decimal = 1.0 + (100.0 / -price if price < 0 else price / 100.0)
    ev = probability * decimal - 1.0
    return {"name": name, "selection": name, "market_type": market_type, "point": point, "odds": price, "book": book, "fair_probability": probability, "implied_probability": implied, "ev": ev}


def build_market_input(blind: Mapping[str, object], event: dict, captured_at: datetime, previous: Optional[Mapping[str, object]] = None, snapshot_target: Optional[str] = None) -> Dict[str, object]:
    game = blind["game"]
    home_name, away_name = event["home_team"], event["away_team"]
    spreads, totals, h2h = _market_outcomes(event, "spreads"), _market_outcomes(event, "totals"), _market_outcomes(event, "h2h")
    home_spreads = [row for row in spreads if _normalized(row.get("name")) == _normalized(home_name) and row.get("point") is not None]
    away_spreads = [row for row in spreads if _normalized(row.get("name")) == _normalized(away_name) and row.get("point") is not None]
    overs = [row for row in totals if str(row.get("name", "")).lower() == "over" and row.get("point") is not None]
    unders = [row for row in totals if str(row.get("name", "")).lower() == "under" and row.get("point") is not None]
    if not home_spreads or not overs:
        raise ValueError("NFL spread and total markets are both required")
    home_line = float(statistics.median(float(row["point"]) for row in home_spreads))
    total_line = float(statistics.median(float(row["point"]) for row in overs))
    home_offer = min(home_spreads, key=lambda row: abs(float(row["point"]) - home_line))
    away_offer = min(away_spreads, key=lambda row: abs(float(row["point"]) + home_line)) if away_spreads else None
    over_offer = min(overs, key=lambda row: abs(float(row["point"]) - total_line))
    under_offer = min(unders, key=lambda row: abs(float(row["point"]) - total_line)) if unders else None
    projection, distribution = blind["projection"], blind["projection"]["distribution"]
    margin, total_mean = float(projection["mean_home_margin"]), float(projection["mean_total"])
    margin_sigma, total_sigma = float(distribution["margin_standard_deviation"]), float(distribution["total_standard_deviation"])
    above = lambda mean, line, sigma: 0.5 * (1.0 + math.erf((mean - line) / (sigma * math.sqrt(2.0))))
    candidates = [_candidate(home_name, "spreads", home_line, float(home_offer["price"]), above(margin, -home_line, margin_sigma), home_offer["book"])]
    if away_offer:
        candidates.append(_candidate(away_name, "spreads", float(away_offer["point"]), float(away_offer["price"]), 1.0 - above(margin, -home_line, margin_sigma), away_offer["book"]))
    candidates.append(_candidate("Over", "totals", total_line, float(over_offer["price"]), above(total_mean, total_line, total_sigma), over_offer["book"]))
    if under_offer:
        candidates.append(_candidate("Under", "totals", float(under_offer["point"]), float(under_offer["price"]), 1.0 - above(total_mean, total_line, total_sigma), under_offer["book"]))
    best = max(candidates, key=lambda row: row["ev"])
    status = "CORE_CANDIDATE" if best["ev"] >= 0.04 else "SECONDARY" if best["ev"] >= 0.02 else "PASS"
    execution = "WAIT" if status != "PASS" else "PASS"
    current = {
        "event_id": event.get("id"),
        "spread": {"home": {"point": home_line, "price": home_offer.get("price"), "book": home_offer.get("book"), "last_update": home_offer.get("last_update")}, "away": None if not away_offer else {"point": away_offer.get("point"), "price": away_offer.get("price"), "book": away_offer.get("book"), "last_update": away_offer.get("last_update")}},
        "total": {"point": total_line, "over": {"price": over_offer.get("price"), "book": over_offer.get("book"), "last_update": over_offer.get("last_update")}, "under": None if not under_offer else {"price": under_offer.get("price"), "book": under_offer.get("book"), "last_update": under_offer.get("last_update")}},
        "moneyline": h2h[:10],
        "bookmaker_count": len(event.get("bookmakers", [])),
    }
    prior_current = (previous or {}).get("current_price", {})
    return {
        "captured_at": iso(captured_at), "snapshot_target": snapshot_target,
        "challenger_projection": {"margin": -home_line, "total": total_line},
        "current_price": current, "best_market_expression": best, "decision_status": status,
        "execution_status": execution, "implied_probability": best["implied_probability"],
        "fair_probability": best["fair_probability"], "ev": best["ev"], "play_to": best["point"],
        "line_sensitivity": {"previous_home_spread": prior_current.get("spread", {}).get("home", {}).get("point"), "previous_total": prior_current.get("total", {}).get("point")},
    }


def post_shadow_error(endpoint: str, token: str, row: Mapping[str, object]) -> None:
    if not endpoint or not token:
        return
    try:
        endpoint = validate_shadow_endpoint(endpoint)
    except ValueError:
        return
    url = endpoint.rsplit("/games", 1)[0] + "/errors"
    request = Request(url, data=json.dumps(row).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=20):
            pass
    except Exception:
        pass


def process_slate(
    games: Iterable[Mapping[str, object]], blind_factory: Callable[[Mapping[str, object]], Dict[str, object]],
    market_factory: Callable[[List[Dict[str, object]]], Mapping[str, Dict[str, object]]],
    publisher: Callable[[Dict[str, object]], object], output_dir: Path,
    error_recorder: Optional[Callable[[Dict[str, object]], None]] = None,
    blind_archiver: Optional[Callable[[List[Path]], object]] = None,
) -> Dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    blind_rows, failures, published = [], [], []

    def fail(stage: str, game_id: Optional[str], error: Exception) -> None:
        row = {"occurred_at": iso(utc_now()), "sport": SPORT_KEY, "stage": stage, "game_id": game_id, "error": f"{type(error).__name__}: {error}", "source": "nfl-shadow-live-pipeline"}
        failures.append(row)
        with (output_dir / "shadow-errors.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")
        if error_recorder:
            error_recorder(row)

    for game in games:
        game_id = str(game.get("id", "unknown"))
        path = output_dir / "blind" / f"{game_id}.json"
        try:
            if path.exists():
                blind = json.loads(path.read_text(encoding="utf-8"))
                validate_blind_output(blind)
            else:
                blind = blind_factory(game)
                validate_blind_output(blind)
                atomic_json(path, blind)
            blind_rows.append(blind)
        except Exception as error:
            fail("blind_prediction", game_id, error)

    if blind_archiver and blind_rows:
        try:
            blind_archiver([output_dir / "blind" / f"{blind['game']['id']}.json" for blind in blind_rows])
        except Exception as error:
            for blind in blind_rows:
                fail("blind_archive", str(blind["game"]["id"]), error)
            return {"blind_games": len(blind_rows), "published_games": 0, "failures": failures, "published": []}

    market_phase_failed = False
    try:
        markets = market_factory(blind_rows) if blind_rows else {}
    except Exception as error:
        market_phase_failed = True
        for blind in blind_rows:
            fail("market_capture", str(blind["game"]["id"]), error)
        markets = {}

    for blind in blind_rows:
        game_id = str(blind["game"]["id"])
        if market_phase_failed:
            continue
        market = markets.get(game_id)
        if not market:
            fail("market_capture", game_id, ValueError("Market snapshot unavailable after blind persistence"))
            continue
        try:
            atomic_json(output_dir / "market" / f"{game_id}.json", market)
            envelope = build_envelope(blind, market, file_payload(output_dir / "blind" / f"{game_id}.json"))
            response = publisher(envelope)
            published.append({"game_id": game_id, "response": response})
        except Exception as error:
            fail("shadow_publish", game_id, error)
    return {"blind_games": len(blind_rows), "published_games": len(published), "failures": failures, "published": published}


def settled_results(season: int) -> List[Dict[str, object]]:
    from aegis_nflverse_bootstrap import load_schedule

    rows = load_schedule([season])
    results = []
    for row in rows.to_dict("records"):
        try:
            home, away = float(row["home_score"]), float(row["away_score"])
            if not math.isfinite(home) or not math.isfinite(away):
                continue
            results.append({
                "game_id": str(row["game_id"]), "home_score": home, "away_score": away,
                # A stable provider representation keeps repeat grading idempotent.
                "completed_at": iso(schedule_kickoff(row) + timedelta(hours=6)),
                "closing_market": {
                    "home_spread": None if row.get("spread_line") is None else -float(row["spread_line"]),
                    "total": None if row.get("total_line") is None else float(row["total_line"]),
                },
                "source": "nflverse schedule results",
            })
        except (KeyError, TypeError, ValueError):
            continue
    return results


def publish_grades(endpoint: str, token: str, season: int) -> Dict[str, object]:
    endpoint = validate_shadow_endpoint(endpoint)
    url = endpoint.rsplit("/games", 1)[0] + "/grade"
    body = {"sport": SPORT_KEY, "source": "nflverse-settled-results", "results": settled_results(season)}
    request = Request(url, data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode())


def main() -> int:
    parser = argparse.ArgumentParser(description="Automated leakage-safe NFL v1.0 shadow validation")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--start-season", type=int, default=2021)
    parser.add_argument("--lookahead-days", type=int, default=10)
    parser.add_argument("--max-games", type=int, default=18)
    parser.add_argument("--cache-dir", default="data/nflverse")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--pregame-context", help="Optional JSON object keyed by game id; every entry requires a pre-prediction known_at")
    parser.add_argument("--mode", choices=["project", "grade", "all"], default="all")
    parser.add_argument("--selection-file", help="Scheduler preflight JSON; restricts project work and snapshot targets")
    parser.add_argument("--publish", action="store_true", help="POST to shadow endpoints; default is a local dry run")
    parser.add_argument("--endpoint", default=os.getenv("AEGIS_SHADOW_ENDPOINT", ""))
    parser.add_argument("--bookmakers", default=os.getenv("ODDS_BOOKMAKERS", ""))
    args = parser.parse_args()
    token = os.getenv("AEGIS_SHADOW_INGEST_SECRET", "")
    output_dir = Path(args.output_dir)
    report: Dict[str, object] = {"mode": args.mode, "publish": args.publish, "season": args.season, "shadow_only": True}
    try:
        selection = json.loads(Path(args.selection_file).read_text(encoding="utf-8")) if args.selection_file else {}
        selected_ids = set(map(str, selection.get("project_games", []))) if args.selection_file else None
        snapshot_targets = {str(key): str(value) for key, value in selection.get("snapshot_targets", {}).items()}
        if args.publish:
            readiness = verify_staging_readiness(args.endpoint, token)
            output_dir.mkdir(parents=True, exist_ok=True)
            atomic_json(output_dir / "staging-readiness.json", {
                "checked_at": iso(utc_now()),
                "ready": True,
                "environment": readiness.get("environment"),
                "state_id": readiness.get("state_id"),
                "shadow_only": readiness.get("shadow_only"),
                "production_release_allowed": readiness.get("production_release_allowed"),
                "persistence": readiness.get("persistence"),
                "endpoints": readiness.get("endpoints"),
            })
            report["staging_readiness"] = {"ready": True, "environment": readiness.get("environment"), "state_id": readiness.get("state_id")}
            report["blind_hydration"] = hydrate(output_dir / "blind", args.endpoint, token)
        if args.mode in {"project", "all"}:
            now = utc_now()
            games = upcoming_schedule(args.season, args.lookahead_days, now)
            if selected_ids is not None:
                games = [game for game in games if str(game["id"]) in selected_ids]
            games = games[:args.max_games]
            if games:
                contexts = json.loads(Path(args.pregame_context).read_text(encoding="utf-8")) if args.pregame_context else {}
                if not isinstance(contexts, dict):
                    raise ValueError("--pregame-context must contain a JSON object keyed by game id")
                missing_blinds = [game for game in games if not (output_dir / "blind" / f"{game['id']}.json").exists()]
                model = None
                if missing_blinds:
                    model = V10LiveModel(args.start_season, args.season, args.cache_dir, now)
                    model.prepare()

                def markets(blinds: List[Dict[str, object]]) -> Mapping[str, Dict[str, object]]:
                    events, quota = odds_snapshot(os.getenv("ODDS_API_KEY", ""), args.bookmakers)
                    captured = utc_now()
                    newest_blind = max(parse_time(blind["generated_at"]) for blind in blinds)
                    if captured <= newest_blind:
                        captured = newest_blind + timedelta(milliseconds=1)
                    out = {}
                    for blind in blinds:
                        game_id = str(blind["game"]["id"])
                        previous_path = output_dir / "market" / f"{game_id}.json"
                        previous = json.loads(previous_path.read_text()) if previous_path.exists() else None
                        out[game_id] = build_market_input(
                            blind, _event_for(blind["game"], events), captured, previous,
                            snapshot_target=snapshot_targets.get(game_id),
                        )
                        out[game_id]["quota"] = quota
                    return out

                result = process_slate(
                    games,
                    lambda game: model.predict(game, contexts.get(str(game["id"]), {})) if model else (_ for _ in ()).throw(RuntimeError("Archived blind unexpectedly missing")),
                    markets,
                    (lambda envelope: publish(envelope, args.endpoint, token)) if args.publish else (lambda envelope: {"dry_run": True, "release_status": "SHADOW_ONLY"}),
                    output_dir,
                    lambda row: post_shadow_error(args.endpoint, token, row) if args.publish else None,
                    (lambda paths: backfill_files(paths, args.endpoint, token)) if args.publish else None,
                )
            else:
                result = {"blind_games": 0, "published_games": 0, "failures": [], "published": [], "note": "No upcoming NFL regular-season games in window"}
            report["projection"] = result
        if args.mode in {"grade", "all"}:
            report["grading"] = publish_grades(args.endpoint, token, args.season) if args.publish else {"dry_run": True, "settled_results_found": len(settled_results(args.season))}
        print(json.dumps(report, indent=2))
        return 1 if report.get("projection", {}).get("failures") else 0
    except Exception as error:
        row = {"occurred_at": iso(utc_now()), "sport": SPORT_KEY, "stage": "pipeline", "game_id": None, "error": f"{type(error).__name__}: {error}", "source": "nfl-shadow-live-pipeline"}
        output_dir.mkdir(parents=True, exist_ok=True)
        with (output_dir / "shadow-errors.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row) + "\n")
        if args.publish:
            post_shadow_error(args.endpoint, token, row)
        print(f"NFL shadow pipeline failed safely: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
