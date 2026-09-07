from __future__ import annotations

import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd

from aegis_nflverse_bootstrap import load, load_schedule
from aegis_nfl_historical_features import (
    aggregate_team_game,
    join_offense_defense,
)
from aegis_nfl_snapshot_builder import (
    attach_schedule,
    build_weekly_snapshots,
    combine_game_rows,
)
from aegis_nfl_walkforward_v08 import (
    NFLWalkForwardLabV08,
    NFLWalkForwardConfig,
)
from aegis_nfl_v08_audit import write_outputs


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

    # nflverse schedule convention: positive spread means HOME favored.
    # AEGIS convention: home favorite is negative.
    out["market_spread_line_nflverse"] = pd.to_numeric(
        out["spread_line"], errors="coerce"
    )
    out["spread_line"] = -out["market_spread_line_nflverse"]

    return out


def build_season(
    season: int,
    cache_dir: str = "data/nflverse",
) -> pd.DataFrame:
    pbp = load("pbp", season, cache_dir)
    schedule = normalize_schedule(load_schedule([season]))

    if "game_type" in schedule.columns:
        schedule = schedule[
            schedule["game_type"].eq("REG")
        ].copy()

    if "season_type" in pbp.columns:
        pbp = pbp[
            pbp["season_type"].eq("REG")
        ].copy()

    offense = aggregate_team_game(pbp)
    team_game = join_offense_defense(offense)
    team_game = attach_schedule(team_game, schedule)

    snapshots = build_weekly_snapshots(team_game)
    games = combine_game_rows(schedule, snapshots)

    return games.dropna(subset=[
        "home_games_in_sample",
        "away_games_in_sample",
        "spread_line",
        "total_line",
        "home_score",
        "away_score",
    ]).copy()


def shadow_readiness(report: dict) -> dict:
    n = int(report.get("holdout_games", 0))
    c = report.get("challenger", {})
    m = report.get("market_challenger", {})
    guard = report.get("leakage_guard", {})

    enough = n >= 400
    hygiene_ok = all([
        guard.get("market_lines_in_internal_features") is False,
        guard.get("market_prices_in_internal_features") is False,
        guard.get("postgame_outcomes_in_internal_features") is False,
        guard.get("numeric_identifiers_in_internal_features") is False,
    ])

    both_market_beaten = (
        c.get("margin_mae", 999) < m.get("margin_mae", -999)
        and c.get("total_mae", 999) < m.get("total_mae", -999)
    )

    if not enough or not hygiene_ok:
        status = "BLOCKED"
    elif both_market_beaten:
        status = "SHADOW_READY_HIGH_INTEREST"
    else:
        status = "SHADOW_RECALIBRATION_REQUIRED"

    return {
        "status": status,
        "real_betting_release_allowed": False,
        "manual_verification_required": True,
        "holdout_sufficient": enough,
        "feature_hygiene_passed": hygiene_ok,
        "beats_market_on_margin_and_total_mae": both_market_beaten,
        "note": (
            "No production promotion until Champion/Challenger "
            "criteria are satisfied on untouched history."
        ),
    }


def run(
    start: int = 2021,
    end: int = 2025,
    cache_dir: str = "data/nflverse",
    out_dir: str = "data/nfl_walkforward_v08",
):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    frames = []
    season_counts = {}

    for season in range(start, end + 1):
        x = build_season(season, cache_dir)
        x.to_parquet(
            out / f"nfl_pregame_rows_{season}.parquet",
            index=False,
        )
        frames.append(x)
        season_counts[str(season)] = int(len(x))

    all_rows = pd.concat(frames, ignore_index=True)

    lab = NFLWalkForwardLabV08(
        NFLWalkForwardConfig(min_train_games=500)
    )
    predictions, report = lab.run(all_rows)

    report["seasons"] = [start, end]
    report["season_row_counts"] = season_counts
    report["shadow_readiness"] = shadow_readiness(report)

    pred_path = out / f"nfl_v08_predictions_{start}_{end}.csv"
    report_path = out / f"nfl_v08_report_{start}_{end}.json"

    predictions.to_csv(pred_path, index=False)
    report_path.write_text(json.dumps(report, indent=2))

    audit = write_outputs(
        str(pred_path),
        str(report_path),
        str(out / "audit"),
    )

    status = {
        "sport": "NFL",
        "engine_version": "NFL_v0.8_FEATURE_HYGIENE",
        "mode": "SHADOW",
        "historical_report": report,
        "residual_audit": audit,
    }

    (out / "nfl_v08_shadow_status.json").write_text(
        json.dumps(status, indent=2)
    )

    return status


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--start", type=int, default=2021)
    p.add_argument("--end", type=int, default=2025)
    p.add_argument(
        "--cache-dir",
        default="data/nflverse",
    )
    p.add_argument(
        "--out-dir",
        default="data/nfl_walkforward_v08",
    )
    a = p.parse_args()

    result = run(
        a.start,
        a.end,
        a.cache_dir,
        a.out_dir,
    )

    print(json.dumps({
        "engine_version": result["engine_version"],
        "shadow_status": result["historical_report"][
            "shadow_readiness"
        ]["status"],
        "holdout_games": result["historical_report"][
            "holdout_games"
        ],
        "feature_count": result["historical_report"][
            "feature_count"
        ],
    }, indent=2))
