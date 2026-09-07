
from __future__ import annotations

from typing import Dict, Iterable, List, Optional
import numpy as np
import pandas as pd


def _col(df: pd.DataFrame, name: str, default=0.0) -> pd.Series:
    if name in df.columns:
        return pd.to_numeric(df[name], errors="coerce")
    return pd.Series(default, index=df.index, dtype=float)


def _boolcol(df: pd.DataFrame, name: str) -> pd.Series:
    if name in df.columns:
        x = df[name]
        if x.dtype == bool:
            return x
        return pd.to_numeric(x, errors="coerce").fillna(0).astype(float).ne(0)
    return pd.Series(False, index=df.index)


def _weighted_mean(values: pd.Series, weights: Optional[pd.Series] = None) -> float:
    x = pd.to_numeric(values, errors="coerce")
    m = x.notna()
    if not m.any():
        return np.nan
    if weights is None:
        return float(x[m].mean())
    w = pd.to_numeric(weights, errors="coerce").fillna(0)
    m = m & w.gt(0)
    if not m.any():
        return float(x.dropna().mean())
    return float(np.average(x[m], weights=w[m]))


def add_play_flags(pbp: pd.DataFrame) -> pd.DataFrame:
    df = pbp.copy()

    df["is_pass"] = _boolcol(df, "pass_attempt")
    df["is_rush"] = _boolcol(df, "rush_attempt")
    df["is_sack"] = _boolcol(df, "sack")
    df["is_turnover"] = _boolcol(df, "turnover")
    if "turnover" not in df.columns:
        df["is_turnover"] = _boolcol(df, "interception") | _boolcol(df, "fumble_lost")

    yds = _col(df, "yards_gained", 0)
    df["explosive_pass"] = df["is_pass"] & yds.ge(20)
    df["explosive_rush"] = df["is_rush"] & yds.ge(10)

    # nflfastR already supplies success in many seasons.
    if "success" in df.columns:
        df["aegis_success"] = _col(df, "success", np.nan)
    else:
        down = _col(df, "down", np.nan)
        ydstogo = _col(df, "ydstogo", np.nan)
        df["aegis_success"] = np.where(
            down.eq(1), yds >= 0.50 * ydstogo,
            np.where(down.eq(2), yds >= 0.70 * ydstogo,
                     np.where(down.isin([3,4]), yds >= ydstogo, np.nan))
        ).astype(float)

    # Neutral situation: 1st/2nd half before final 5 minutes, score within 8.
    q = _col(df, "qtr", np.nan)
    sec = _col(df, "game_seconds_remaining", np.nan)
    score_diff = _col(df, "score_differential", np.nan).abs()
    df["neutral_situation"] = (
        q.le(3)
        & sec.gt(300)
        & score_diff.le(8)
        & (df["is_pass"] | df["is_rush"])
    )

    # Early downs
    down = _col(df, "down", np.nan)
    df["early_down"] = down.isin([1,2]) & (df["is_pass"] | df["is_rush"])

    # Red zone and backed-up flags.
    yardline_100 = _col(df, "yardline_100", np.nan)
    df["red_zone"] = yardline_100.le(20)
    df["backed_up"] = yardline_100.ge(80)

    return df


def aggregate_team_game(pbp: pd.DataFrame) -> pd.DataFrame:
    """
    Build one offense row per team-game using nflfastR play-level information.
    Current-game rows are OUTPUTS for rolling history; they must not be used as
    features for the same game.
    """
    df = add_play_flags(pbp)

    required = ["game_id", "posteam", "defteam"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"PBP missing required fields: {missing}")

    # Keep actual offensive plays and selected no-play-free attempts.
    df = df[(df["is_pass"] | df["is_rush"]) & df["posteam"].notna()].copy()

    rows = []
    for (game_id, team), g in df.groupby(["game_id","posteam"], dropna=True):
        opponent_vals = g["defteam"].dropna().astype(str)
        opponent = opponent_vals.mode().iloc[0] if len(opponent_vals) else None

        epa = _col(g, "epa", np.nan)
        success = _col(g, "aegis_success", np.nan)
        pass_epa = epa[g["is_pass"]]
        rush_epa = epa[g["is_rush"]]

        qb_epa = _col(g, "qb_epa", np.nan)
        cpoe = _col(g, "cpoe", np.nan)
        air = _col(g, "air_yards", np.nan)
        yac = _col(g, "yards_after_catch", np.nan)

        neutral = g[g["neutral_situation"]]
        early = g[g["early_down"]]
        rz = g[g["red_zone"]]

        # Pressure proxies available publicly in core PBP:
        # sacks + qb hits among dropbacks. True pressure can later be enriched
        # with charting/participation data.
        dropbacks = g[g["is_pass"] | g["is_sack"]]
        hits = _boolcol(dropbacks, "qb_hit")
        sacks = _boolcol(dropbacks, "sack")
        pressure_proxy = hits | sacks

        # Drive IDs allow real possession stats where present.
        drives = g["drive"].nunique() if "drive" in g.columns else np.nan
        points = _col(g, "posteam_score_post", np.nan)
        points_pre = _col(g, "posteam_score", np.nan)
        drive_points = np.nan
        if "drive" in g.columns and points.notna().any() and points_pre.notna().any():
            dpts = []
            for _, dg in g.groupby("drive"):
                a = _col(dg, "posteam_score", np.nan).dropna()
                b = _col(dg, "posteam_score_post", np.nan).dropna()
                if len(a) and len(b):
                    dpts.append(max(0.0, float(b.iloc[-1] - a.iloc[0])))
            if dpts:
                drive_points = float(np.mean(dpts))

        rows.append({
            "game_id": game_id,
            "team": team,
            "opponent": opponent,
            "off_plays": int(len(g)),
            "epa_per_play": float(epa.mean()) if epa.notna().any() else np.nan,
            "success_rate": float(success.mean()) if success.notna().any() else np.nan,
            "pass_epa_per_play": float(pass_epa.mean()) if pass_epa.notna().any() else np.nan,
            "rush_epa_per_play": float(rush_epa.mean()) if rush_epa.notna().any() else np.nan,
            "early_down_epa": float(_col(early, "epa", np.nan).mean()) if len(early) else np.nan,
            "early_down_success": float(_col(early, "aegis_success", np.nan).mean()) if len(early) else np.nan,
            "neutral_pass_rate": float(neutral["is_pass"].mean()) if len(neutral) else np.nan,
            "neutral_seconds_per_play": float(_col(neutral, "play_clock", np.nan).mean()) if "play_clock" in neutral.columns and len(neutral) else np.nan,
            "explosive_pass_rate": float(g["explosive_pass"].mean()),
            "explosive_rush_rate": float(g["explosive_rush"].mean()),
            "turnover_play_rate": float(g["is_turnover"].mean()),
            "sack_rate": float(sacks.mean()) if len(dropbacks) else np.nan,
            "qb_hit_rate": float(hits.mean()) if len(dropbacks) else np.nan,
            "pressure_proxy_rate": float(pressure_proxy.mean()) if len(dropbacks) else np.nan,
            "qb_epa": float(qb_epa.mean()) if qb_epa.notna().any() else np.nan,
            "cpoe": float(cpoe.mean()) if cpoe.notna().any() else np.nan,
            "air_yards_per_attempt": float(air[g["is_pass"]].mean()) if air.notna().any() else np.nan,
            "yac_per_completion_proxy": float(yac.mean()) if yac.notna().any() else np.nan,
            "red_zone_epa": float(_col(rz, "epa", np.nan).mean()) if len(rz) else np.nan,
            "drives": float(drives) if np.isfinite(drives) else np.nan,
            "points_per_drive": drive_points,
        })

    return pd.DataFrame(rows)


def build_defense_rows(off_rows: pd.DataFrame) -> pd.DataFrame:
    """
    Flip opponent offense performance into defensive allowance/creation features.
    """
    d = off_rows.copy()
    d = d.rename(columns={"team":"opponent_offense","opponent":"team"})
    rename = {}
    for c in d.columns:
        if c in {"game_id","team","opponent_offense"}:
            continue
        if pd.api.types.is_numeric_dtype(d[c]):
            rename[c] = f"def_allowed_{c}"
    return d.rename(columns=rename)


def join_offense_defense(off_rows: pd.DataFrame) -> pd.DataFrame:
    deff = build_defense_rows(off_rows)
    return off_rows.merge(
        deff.drop(columns=["opponent_offense"], errors="ignore"),
        on=["game_id","team"],
        how="left",
    )
