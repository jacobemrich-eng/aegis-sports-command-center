from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import glob
import hashlib
import json
import math
from pathlib import Path
from statistics import mean, pstdev
from typing import Any, Iterable, Mapping

RAW_ROOT = Path("data/ncaaf_history/raw")
DERIVED_ROOT = Path("data/ncaaf_history/derived")
FEATURE_SCHEMA_VERSION = "AEGIS_NCAAF_PREGAME_FEATURES_v1"


def parse_time(value: object) -> datetime:
    result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return (result if result.tzinfo else result.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def number(value: object) -> float | None:
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def safe_div(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def read_envelope(path: str | Path) -> tuple[list[dict], dict]:
    envelope = json.loads(Path(path).read_text(encoding="utf-8"))
    return envelope.get("payload", []), envelope


def files(kind: str, year: int | None = None) -> list[str]:
    segment = str(year) if year is not None else "*"
    return sorted(glob.glob(str(RAW_ROOT / kind / segment / "*.json")))


def season_payload(kind: str, year: int) -> list[dict]:
    paths = files(kind, year)
    if not paths:
        return []
    # Season-level sources have one query per season. Coverage probes can create the same query path.
    payload, _ = read_envelope(paths[0])
    return payload


def classification(value: object) -> str:
    text = str(value or "unknown").lower()
    return text if text in {"fbs", "fcs"} else "unknown"


def fresh_play() -> dict[str, float]:
    return defaultdict(float)


def summarize_plays(years: Iterable[int]) -> dict[int, dict[str, dict[str, float]]]:
    games: dict[int, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(fresh_play))
    for year in years:
        for path in files("plays", year):
            payload, _ = read_envelope(path)
            for play in payload:
                game_id = int(play.get("gameId")); offense = str(play.get("offense") or "").strip(); defense = str(play.get("defense") or "").strip()
                if not offense or not defense:
                    continue
                play_type = str(play.get("playType") or "").lower(); text = str(play.get("playText") or "").lower()
                if any(token in play_type for token in ("kickoff", "timeout", "end period", "end of game", "coin toss")):
                    continue
                yards = number(play.get("yardsGained")) or 0.0; ppa = number(play.get("ppa")); down = int(number(play.get("down")) or 0)
                offense_row, defense_row = games[game_id][offense], games[game_id][defense]
                offense_row["plays"] += 1; defense_row["def_plays"] += 1
                if ppa is not None:
                    offense_row["ppa_sum"] += ppa; offense_row["ppa_n"] += 1; defense_row["def_ppa_sum"] += ppa; defense_row["def_ppa_n"] += 1
                    offense_row["success"] += ppa > 0
                    if down in (1, 2): offense_row["early_ppa_sum"] += ppa; offense_row["early_ppa_n"] += 1
                if yards >= 20: offense_row["explosive"] += 1
                rush = "rush" in play_type and "pass" not in play_type
                passing = any(token in play_type for token in ("pass", "sack"))
                if rush: offense_row["rushes"] += 1; offense_row["rush_yards"] += yards; offense_row["rush_success"] += yards >= max(1, (number(play.get("distance")) or 10) * (.5 if down == 1 else .7 if down == 2 else 1))
                if passing: offense_row["pass_plays"] += 1; defense_row["def_pass_plays"] += 1
                sack = "sack" in play_type
                turnover = any(token in play_type for token in ("interception", "fumble recovery"))
                tackle_loss = yards < 0 and rush
                if sack: offense_row["sacks_allowed"] += 1; defense_row["sacks"] += 1
                if turnover: offense_row["turnovers"] += 1; defense_row["takeaways"] += 1
                if sack or turnover or tackle_loss: defense_row["havoc"] += 1
                if "field goal good" in text: offense_row["fg_made"] += 1; offense_row["fg_attempts"] += 1
                elif "field goal" in play_type or "field goal" in text: offense_row["fg_attempts"] += 1
                if "penalty" in text: offense_row["penalties"] += 1
    return games


def summarize_drives(years: Iterable[int]) -> dict[int, dict[str, dict[str, float]]]:
    games: dict[int, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(fresh_play))
    for year in years:
        for path in files("drives", year):
            payload, _ = read_envelope(path)
            for drive in payload:
                game_id = int(drive.get("gameId")); team = str(drive.get("offense") or "").strip()
                if not team: continue
                row = games[game_id][team]; result = str(drive.get("driveResult") or "").lower(); plays = number(drive.get("plays")) or 0
                points = max(0.0, (number(drive.get("endOffenseScore")) or 0) - (number(drive.get("startOffenseScore")) or 0))
                row["drives"] += 1; row["drive_plays"] += plays; row["drive_points"] += points
                start_goal = number(drive.get("startYardsToGoal")); end_goal = number(drive.get("endYardsToGoal"))
                opportunity = (start_goal is not None and start_goal <= 40) or (end_goal is not None and end_goal <= 40) or points > 0
                if opportunity: row["opportunities"] += 1; row["opportunity_points"] += points
                if plays <= 3 and "punt" in result: row["three_outs"] += 1
                if any(token in result for token in ("interception", "fumble")): row["turnover_drives"] += 1
                if (number(drive.get("yards")) or 0) >= 40 or points >= 6: row["explosive_drives"] += 1
                if start_goal is not None: row["start_position_sum"] += 100 - start_goal; row["start_position_n"] += 1
    return games


def normalized_static(year: int) -> dict[str, dict[str, Any]]:
    talent_rows = season_payload("talent", year); returning_rows = season_payload("player-returning", year); portal_rows = season_payload("player-portal", year); coaches = season_payload("coaches", year)
    values = [number(row.get("talent")) for row in talent_rows]; values = [x for x in values if x is not None]; center = mean(values) if values else 0; scale = pstdev(values) if len(values) > 1 else 1
    out: dict[str, dict[str, Any]] = defaultdict(dict)
    for row in talent_rows:
        value = number(row.get("talent")); out[str(row.get("team"))]["talent_rating"] = (value - center) / scale if value is not None and scale else None
    for row in returning_rows:
        team = str(row.get("team")); out[team]["returning_production"] = number(row.get("percentPPA")); out[team]["qb_continuity"] = number(row.get("percentPassingPPA"))
    cutoff = datetime(year, 8, 1, tzinfo=timezone.utc); movement = defaultdict(lambda: {"in": 0.0, "out": 0.0})
    for row in portal_rows:
        try: moved = parse_time(row.get("transferDate"))
        except Exception: continue
        if moved >= cutoff: continue
        weight = (number(row.get("rating")) or 0) + (number(row.get("stars")) or 0) / 5
        if row.get("destination"): movement[str(row["destination"])]["in"] += weight
        if row.get("origin"): movement[str(row["origin"])]["out"] += weight
    for team, values in movement.items(): out[team]["transfer_translation"] = max(-1.0, min(1.0, (values["in"] - values["out"]) / 20))
    assignments = defaultdict(set)
    for coach in coaches:
        if coach.get("hireDate"):
            try:
                if parse_time(coach["hireDate"]) >= cutoff: continue
            except Exception: continue
        for season in coach.get("seasons", []):
            if int(season.get("year") or 0) == year: assignments[str(season.get("school"))].add(f"{coach.get('firstName')} {coach.get('lastName')}")
    prior_assignments = defaultdict(set)
    for coach in season_payload("coaches", year - 1):
        for season in coach.get("seasons", []):
            if int(season.get("year") or 0) == year - 1: prior_assignments[str(season.get("school"))].add(f"{coach.get('firstName')} {coach.get('lastName')}")
    for team, names in assignments.items():
        continuity = bool(names & prior_assignments.get(team, set())); out[team]["coaching_continuity"] = 1.0 if continuity else 0.0; out[team]["coaching_change"] = not continuity
    return out


def previous_strength(games_by_year: Mapping[int, list[dict]], year: int) -> dict[str, float]:
    margins = defaultdict(list)
    for game in games_by_year.get(year - 1, []):
        home, away = number(game.get("homePoints")), number(game.get("awayPoints"))
        if home is None or away is None: continue
        margins[str(game.get("homeTeam"))].append(home-away); margins[str(game.get("awayTeam"))].append(away-home)
    return {team: mean(values) for team, values in margins.items() if values}


def aggregate_history(history: list[dict], static: Mapping[str, Any], pregame_elo: float | None, previous_margin: float | None, team_class: str) -> dict[str, Any]:
    sums = defaultdict(float)
    for game in history:
        for key, value in game.items():
            if isinstance(value, (int, float)): sums[key] += value
    games = len(history); plays = sums["plays"]; def_plays = sums["def_plays"]; drives = sums["drives"]
    profile = {
        "classification": team_class,
        "power_rating": (pregame_elo - 1500) / 25 if pregame_elo is not None else (previous_margin * .45 if previous_margin is not None else None),
        "opponent_adjusted_efficiency": previous_margin / 14 if previous_margin is not None else None,
        "talent_rating": static.get("talent_rating"), "returning_production": static.get("returning_production"), "transfer_translation": static.get("transfer_translation"),
        "qb_continuity": static.get("qb_continuity"), "ol_continuity": None, "coaching_continuity": static.get("coaching_continuity"), "coaching_change": static.get("coaching_change", False),
        "availability_probability": None,
        "offense_epa_per_play": safe_div(sums["ppa_sum"], sums["ppa_n"]), "defense_epa_allowed_per_play": safe_div(sums["def_ppa_sum"], sums["def_ppa_n"]),
        "net_epa_per_play": (safe_div(sums["ppa_sum"], sums["ppa_n"]) or 0) - (safe_div(sums["def_ppa_sum"], sums["def_ppa_n"]) or 0) if plays and def_plays else None,
        "early_down_epa": safe_div(sums["early_ppa_sum"], sums["early_ppa_n"]), "success_rate": safe_div(sums["success"], sums["ppa_n"]),
        "points_per_drive": safe_div(sums["drive_points"], drives), "plays_per_drive": safe_div(sums["drive_plays"], drives), "three_and_out_rate": safe_div(sums["three_outs"], drives),
        "scoring_opportunity_rate": safe_div(sums["opportunities"], drives), "finishing_drives": safe_div(sums["opportunity_points"], sums["opportunities"]), "explosive_drive_rate": safe_div(sums["explosive_drives"], drives), "turnover_rate": safe_div(sums["turnover_drives"], drives), "starting_field_position": safe_div(sums["start_position_sum"], sums["start_position_n"]),
        "explosive_play_rate": safe_div(sums["explosive"], plays), "havoc_rate": safe_div(sums["havoc"], def_plays), "pressure_allowed_rate": safe_div(sums["sacks_allowed"], sums["pass_plays"]), "pressure_rate": safe_div(sums["sacks"], sums["def_pass_plays"]), "coverage_grade": -(safe_div(sums["def_ppa_sum"], sums["def_ppa_n"]) or 0) if def_plays else None,
        "line_yards_rate": safe_div(sums["rush_success"], sums["rushes"]), "rushing_efficiency": safe_div(sums["rush_yards"], sums["rushes"]), "plays_per_game": safe_div(plays, games), "drives_per_game": safe_div(drives, games),
        "special_teams_rating": safe_div(sums["fg_made"], sums["fg_attempts"]), "penalty_rate": safe_div(sums["penalties"], plays), "sample_games": games, "sample_plays": int(plays), "prior_season_margin": previous_margin,
    }
    return profile


def line_map(year: int) -> dict[int, dict[str, Any]]:
    out = {}
    for row in season_payload("lines", year):
        lines = row.get("lines") or []; spreads = [number(x.get("spread")) for x in lines]; totals = [number(x.get("overUnder")) for x in lines]; opens = [number(x.get("spreadOpen")) for x in lines]; total_opens = [number(x.get("overUnderOpen")) for x in lines]
        spreads=[x for x in spreads if x is not None]; totals=[x for x in totals if x is not None]; opens=[x for x in opens if x is not None]; total_opens=[x for x in total_opens if x is not None]
        out[int(row["id"])] = {"home_spread": mean(spreads) if spreads else None, "total": mean(totals) if totals else None, "opening_home_spread": mean(opens) if opens else None, "opening_total": mean(total_opens) if total_opens else None, "provider_count": len(lines), "timestamp_classification": "closing_or_latest_unknown_timestamp", "blind_feature_eligible": False}
    return out


def game_team_summary(game_id: int, team: str, plays: Mapping, drives: Mapping) -> dict[str, float]:
    row = defaultdict(float); row.update(plays.get(game_id, {}).get(team, {}));
    for key, value in drives.get(game_id, {}).get(team, {}).items(): row[key] += value
    return dict(row)


def build(years: list[int]) -> tuple[list[dict], dict]:
    # Load one prior season strictly as a preseason prior for the first target
    # year. Its games never become target rows.
    context_years = [min(years) - 1, *years]
    games_by_year = {year: season_payload("games", year) for year in context_years}; plays = summarize_plays(years); drives = summarize_drives(years)
    dataset, rejected = [], defaultdict(int)
    for year in years:
        static = normalized_static(year); prior = previous_strength(games_by_year, year); markets = line_map(year); history = defaultdict(list); last_known: dict[str, datetime] = {}
        games = sorted(games_by_year[year], key=lambda game: (str(game.get("startDate")), int(game.get("id") or 0)))
        for game in games:
            if not game.get("completed") or game.get("homePoints") is None or game.get("awayPoints") is None: rejected["incomplete"] += 1; continue
            home_class, away_class = classification(game.get("homeClassification")), classification(game.get("awayClassification"))
            if "fbs" not in {home_class, away_class}: rejected["no_fbs_team"] += 1; continue
            kickoff = parse_time(game["startDate"]); cutoff = kickoff - timedelta(minutes=5); home, away = str(game["homeTeam"]), str(game["awayTeam"])
            known_times = [datetime(year, 8, 1, tzinfo=timezone.utc)] + [value for value in (last_known.get(home), last_known.get(away)) if value]
            source_max = max(known_times)
            if source_max >= kickoff: rejected["source_after_kickoff"] += 1; continue
            home_profile = aggregate_history(history[home], static.get(home, {}), number(game.get("homePregameElo")), prior.get(home), home_class)
            away_profile = aggregate_history(history[away], static.get(away, {}), number(game.get("awayPregameElo")), prior.get(away), away_class)
            provenance = [{"name":"CFBD preseason talent/returning/coaching/eligible transfers","known_at":iso(datetime(year,8,1,tzinfo=timezone.utc)),"classification":"SAFE_PREGAME"}]
            if last_known.get(home) or last_known.get(away): provenance.append({"name":"CFBD prior-game plays and drives only","known_at":iso(max(value for value in (last_known.get(home),last_known.get(away)) if value)),"classification":"SAFE_WITH_CUTOFF"})
            blind = {"feature_schema_version":FEATURE_SCHEMA_VERSION,"game_id":f"cfbd-{game['id']}","home_team":home,"away_team":away,"start_time":iso(kickoff),"kickoff_at":iso(kickoff),"prediction_cutoff_at":iso(cutoff),"source_max_known_at":iso(source_max),"leakage_check_passed":True,"season":year,"week":int(game.get("week") or 0),"home_field_advantage":0.0 if game.get("neutralSite") else 2.5,"neutral_site":bool(game.get("neutralSite")),"conference_game":bool(game.get("conferenceGame")),"cross_class":home_class!=away_class,"home_rest_days":None if not last_known.get(home) else (kickoff-last_known[home]).total_seconds()/86400,"away_rest_days":None if not last_known.get(away) else (kickoff-last_known[away]).total_seconds()/86400,"weather_severity":None,"tempo_elasticity":None,"altitude_adjustment":None,"home":home_profile,"away":away_profile,"provenance":provenance}
            home_score, away_score = int(game["homePoints"]), int(game["awayPoints"]); home_lines=game.get("homeLineScores") or []; away_lines=game.get("awayLineScores") or []
            targets={"home_score":home_score,"away_score":away_score,"actual_margin":home_score-away_score,"actual_total":home_score+away_score,"home_win":int(home_score>away_score),"home_first_half_score":sum(home_lines[:2]) if len(home_lines)>=2 else None,"away_first_half_score":sum(away_lines[:2]) if len(away_lines)>=2 else None,"target_source":"CFBD final result; attached only after blind freeze"}
            dataset.append({"blind_input":blind,"targets":targets,"market":markets.get(int(game["id"]),{"home_spread":None,"total":None,"timestamp_classification":"unavailable","blind_feature_eligible":False})})
            ready = kickoff + timedelta(hours=5)
            history[home].append(game_team_summary(int(game["id"]), home, plays, drives)); history[away].append(game_team_summary(int(game["id"]), away, plays, drives)); last_known[home]=ready; last_known[away]=ready
    report={"feature_schema_version":FEATURE_SCHEMA_VERSION,"seasons":years,"games":len(dataset),"rejected":dict(rejected),"feature_count":len({key for row in dataset for side in ("home","away") for key in row["blind_input"][side]}),"market_rows":sum(row["market"].get("home_spread") is not None for row in dataset),"first_half_targets":sum(row["targets"].get("home_first_half_score") is not None for row in dataset)}
    return dataset, report


def main() -> int:
    parser=argparse.ArgumentParser(); parser.add_argument("--years",default="2019-2025"); parser.add_argument("--output",default=str(DERIVED_ROOT/"ncaaf-pregame-2019-2025.json")); parser.add_argument("--report",default="data/ncaaf_history/reports/snapshot-report.json")
    args=parser.parse_args(); start,end=(int(x) for x in args.years.split("-",1)); dataset,report=build(list(range(start,end+1)))
    target=Path(args.output); target.parent.mkdir(parents=True,exist_ok=True); target.write_text(json.dumps(dataset,separators=(",",":")),encoding="utf-8"); report_path=Path(args.report); report_path.parent.mkdir(parents=True,exist_ok=True); report_path.write_text(json.dumps(report,indent=2),encoding="utf-8"); print(json.dumps(report,indent=2)); return 0


if __name__=="__main__": raise SystemExit(main())
