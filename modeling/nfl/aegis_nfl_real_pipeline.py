from __future__ import annotations

import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd

from aegis_nflverse_bootstrap import load, load_schedule
from aegis_nfl_historical_features import aggregate_team_game, join_offense_defense
from aegis_nfl_snapshot_builder import attach_schedule, build_weekly_snapshots, combine_game_rows
from aegis_nfl_walkforward import NFLWalkForwardLab, NFLWalkForwardConfig


def normalize_schedule(s: pd.DataFrame) -> pd.DataFrame:
    out = s.copy()
    if "spread_line" not in out.columns:
        out["spread_line"] = np.nan
    if "total_line" not in out.columns:
        out["total_line"] = np.nan
    if "home_score" not in out.columns and "home_points" in out.columns:
        out["home_score"] = out["home_points"]
    if "away_score" not in out.columns and "away_points" in out.columns:
        out["away_score"] = out["away_points"]

    # nflverse schedule convention: positive spread_line means the HOME team is favored.
    # AEGIS convention: home favorite is negative (home -3 -> -3.0).
    out["market_spread_line_nflverse"] = pd.to_numeric(out["spread_line"], errors="coerce")
    out["spread_line"] = -out["market_spread_line_nflverse"]
    return out


def build_season(season: int, cache_dir="data/nflverse") -> pd.DataFrame:
    pbp = load("pbp", season, cache_dir)
    schedule = normalize_schedule(load_schedule([season]))
    if "game_type" in schedule.columns:
        schedule = schedule[schedule["game_type"].eq("REG")].copy()
    if "season_type" in pbp.columns:
        pbp = pbp[pbp["season_type"].eq("REG")].copy()

    off = aggregate_team_game(pbp)
    team_game = join_offense_defense(off)
    team_game = attach_schedule(team_game, schedule)
    snapshots = build_weekly_snapshots(team_game)
    games = combine_game_rows(schedule, snapshots)
    games = games.dropna(subset=[
        "home_games_in_sample", "away_games_in_sample",
        "spread_line", "total_line", "home_score", "away_score"
    ]).copy()
    return games


def shadow_readiness(report: dict) -> dict:
    n = int(report.get("holdout_games", 0))
    c = report.get("challenger", {})
    m = report.get("market_challenger", {})
    enough = n >= 400
    leakage_ok = report.get("leakage_guard", {}).get("market_lines_in_internal_features") is False
    both_market_beaten = (
        c.get("margin_mae", 999) < m.get("margin_mae", -999)
        and c.get("total_mae", 999) < m.get("total_mae", -999)
    )
    if not enough or not leakage_ok:
        status = "BLOCKED"
    elif both_market_beaten:
        status = "SHADOW_READY_HIGH_INTEREST"
    else:
        status = "SHADOW_READY_RESEARCH"
    return {
        "status": status,
        "real_betting_release_allowed": False,
        "manual_verification_required": True,
        "holdout_sufficient": enough,
        "leakage_guard_passed": leakage_ok,
        "beats_market_on_margin_and_total_mae": both_market_beaten,
        "note": "Shadow readiness is not production promotion. Champion/Challenger promotion still requires a comparable prior AEGIS champion history.",
    }


def run(start=2021, end=2025, cache_dir="data/nflverse", out_dir="data/nfl_walkforward"):
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    frames = []
    season_counts = {}
    for season in range(start, end + 1):
        x = build_season(season, cache_dir)
        x.to_parquet(out / f"nfl_pregame_rows_{season}.parquet", index=False)
        frames.append(x); season_counts[str(season)] = int(len(x))

    all_rows = pd.concat(frames, ignore_index=True)
    lab = NFLWalkForwardLab(NFLWalkForwardConfig(min_train_games=500))
    preds, report = lab.run(all_rows)
    report["seasons"] = [start, end]
    report["season_row_counts"] = season_counts
    report["shadow_readiness"] = shadow_readiness(report)

    preds.to_csv(out / f"nfl_real_predictions_{start}_{end}.csv", index=False)
    (out / f"nfl_real_report_{start}_{end}.json").write_text(json.dumps(report, indent=2))
    (out / "nfl_shadow_status.json").write_text(json.dumps({
        "sport": "NFL",
        "engine_version": "NFL_v0.7",
        "mode": "SHADOW",
        "historical_report": report,
    }, indent=2))
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--start", type=int, default=2021)
    p.add_argument("--end", type=int, default=2025)
    p.add_argument("--cache-dir", default="data/nflverse")
    p.add_argument("--out-dir", default="data/nfl_walkforward")
    a = p.parse_args()
    print(json.dumps(run(a.start, a.end, a.cache_dir, a.out_dir), indent=2))
