
from __future__ import annotations

from typing import List, Optional
import numpy as np
import pandas as pd


RESULT_COLUMNS = {
    "home_score","away_score","result","total","margin",
    "home_points","away_points"
}


def attach_schedule(team_game: pd.DataFrame, schedule: pd.DataFrame) -> pd.DataFrame:
    keys = ["game_id","season","week","game_type","home_team","away_team"]
    available = [c for c in keys if c in schedule.columns]
    return team_game.merge(schedule[available].drop_duplicates("game_id"), on="game_id", how="left")


def build_weekly_snapshots(
    team_game: pd.DataFrame,
    *,
    half_life_games: float = 4.0,
) -> pd.DataFrame:
    """
    Strictly leakage-free: Week W snapshot uses only prior games.
    """
    df = team_game.copy().sort_values(["season","team","week","game_id"])

    numeric = [
        c for c in df.columns
        if pd.api.types.is_numeric_dtype(df[c])
        and c not in {"season","week"}
        and c not in RESULT_COLUMNS
    ]

    rows = []
    for season in sorted(df["season"].dropna().unique()):
        sdf = df[df["season"] == season]
        weeks = sorted(sdf["week"].dropna().unique())

        for week in weeks:
            prior = sdf[sdf["week"] < week]
            for team, t in prior.groupby("team"):
                t = t.sort_values(["week","game_id"])
                if len(t) == 0:
                    continue

                ages = np.arange(len(t)-1, -1, -1)
                w = 0.5 ** (ages / max(0.5, half_life_games))
                w /= w.sum()

                row = {
                    "season": int(season),
                    "week": int(week),
                    "team": team,
                    "games_in_sample": int(len(t)),
                }

                for c in numeric:
                    vals = pd.to_numeric(t[c], errors="coerce").to_numpy(float)
                    m = np.isfinite(vals)
                    if not m.any():
                        row[c] = np.nan
                        continue
                    ww = w[m]
                    ww /= ww.sum()
                    row[c] = float(np.sum(vals[m] * ww))
                rows.append(row)

    return pd.DataFrame(rows)


def combine_game_rows(schedule: pd.DataFrame, snapshots: pd.DataFrame) -> pd.DataFrame:
    h = snapshots.add_prefix("home_").rename(columns={
        "home_season":"season",
        "home_week":"week",
        "home_team":"home_team",
    })
    a = snapshots.add_prefix("away_").rename(columns={
        "away_season":"season",
        "away_week":"week",
        "away_team":"away_team",
    })

    g = schedule.copy()
    out = g.merge(h, on=["season","week","home_team"], how="left")
    out = out.merge(a, on=["season","week","away_team"], how="left")
    return out
