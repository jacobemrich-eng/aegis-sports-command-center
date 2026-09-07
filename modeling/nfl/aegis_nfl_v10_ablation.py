
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import argparse
import json
import math
import re

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from aegis_nfl_walkforward_v08 import (
    add_targets,
    eligible_features,
    feature_rejection_reason,
)


FEATURE_GROUP_RULES = {
    "efficiency_success": (
        "epa_per_play", "success_rate", "early_down_epa", "early_down_success",
    ),
    "qb_passing": (
        "qb_epa", "cpoe", "pass_epa_per_play", "air_yards_per_attempt",
        "yac_per_completion_proxy",
    ),
    "rushing": (
        "rush_epa_per_play",
    ),
    "drives_finishing": (
        "drives", "points_per_drive", "red_zone_epa",
    ),
    "explosiveness": (
        "explosive_pass_rate", "explosive_rush_rate",
    ),
    "pressure_sacks": (
        "pressure_proxy_rate", "qb_hit_rate", "sack_rate",
    ),
    "turnovers": (
        "turnover_play_rate",
    ),
    "pace_pass_tendency": (
        "neutral_pass_rate",
    ),
    "rest_context": (
        "rest", "div_game",
    ),
    "volume_sample": (
        "off_plays", "games_in_sample",
    ),
}


@dataclass
class V10Config:
    min_train_games: int = 500
    dev_seasons: Tuple[int, ...] = (2023, 2024)
    final_holdout_season: int = 2025

    ridge_grid: Tuple[float, ...] = (3, 7, 14, 25, 45, 80)
    logistic_c_grid: Tuple[float, ...] = (0.08, 0.15, 0.25, 0.35, 0.55, 0.85)

    # Conservative dev-selection guards.
    mae_material_regression: float = 0.12
    brier_material_regression: float = 0.0018
    min_composite_improvement: float = 0.0005

    # Untouched final promotion gate.
    final_min_mae_improvement: float = 0.10
    final_min_brier_improvement: float = 0.002
    final_max_mae_regression: float = 0.20
    final_max_brier_regression: float = 0.003


def _mae(y, p):
    y = np.asarray(y, float); p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    return float(np.mean(np.abs(y[m] - p[m])))


def _rmse(y, p):
    y = np.asarray(y, float); p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    e = y[m] - p[m]
    return float(np.sqrt(np.mean(e * e)))


def _brier(y, p):
    y = np.asarray(y, float); p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    y = y[m]; p = np.clip(p[m], 1e-6, 1-1e-6)
    return float(np.mean((y-p)**2))


def _logloss(y, p):
    y = np.asarray(y, float); p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    y = y[m]; p = np.clip(p[m], 1e-6, 1-1e-6)
    return float(-np.mean(y*np.log(p)+(1-y)*np.log(1-p)))


def classify_feature(feature: str) -> str:
    # Remove home/away and defensive-allowed wrappers for semantic grouping.
    f = feature
    f = re.sub(r"^(home|away)_", "", f)
    f = re.sub(r"^def_allowed_", "", f)

    # Specific football concepts must be checked before generic EPA tokens.
    priority = (
        "turnovers",
        "pressure_sacks",
        "explosiveness",
        "drives_finishing",
        "pace_pass_tendency",
        "rest_context",
        "volume_sample",
        "qb_passing",
        "rushing",
        "efficiency_success",
    )
    for group in priority:
        tokens = FEATURE_GROUP_RULES[group]
        if any(token in f for token in tokens):
            return group
    return "other"


def build_feature_groups(features: List[str]) -> Dict[str, List[str]]:
    groups: Dict[str, List[str]] = {}
    for f in features:
        groups.setdefault(classify_feature(f), []).append(f)
    return {k: sorted(v) for k, v in sorted(groups.items())}


@dataclass
class TargetConfig:
    margin_alpha: float = 14.0
    total_alpha: float = 14.0
    cover_c: float = 0.35
    over_c: float = 0.35


class V10WalkForward:
    def __init__(self, min_train_games: int = 500):
        self.min_train_games = min_train_games

    def run(
        self,
        raw: pd.DataFrame,
        features: List[str],
        config: TargetConfig,
    ) -> Tuple[pd.DataFrame, Dict[str, float]]:
        df = add_targets(raw)
        invalid = {f: feature_rejection_reason(f) for f in features if feature_rejection_reason(f)}
        if invalid:
            raise ValueError(f"Unsafe feature(s): {invalid}")

        rows = []
        weeks = df[["season", "week"]].drop_duplicates().sort_values(["season", "week"])

        for season, week in weeks.to_numpy():
            train = df[
                (df["season"] < season)
                | ((df["season"] == season) & (df["week"] < week))
            ].dropna(subset=features + ["home_margin", "game_total"])

            test = df[
                (df["season"] == season) & (df["week"] == week)
            ].dropna(subset=features + ["home_margin", "game_total"])

            if len(train) < self.min_train_games or test.empty:
                continue

            trc = train.dropna(subset=["home_cover"])
            tro = train.dropna(subset=["over_result"])
            if trc["home_cover"].nunique() < 2 or tro["over_result"].nunique() < 2:
                continue

            margin = Pipeline([
                ("scale", StandardScaler()),
                ("model", Ridge(alpha=config.margin_alpha)),
            ])
            total = Pipeline([
                ("scale", StandardScaler()),
                ("model", Ridge(alpha=config.total_alpha)),
            ])
            cover = Pipeline([
                ("scale", StandardScaler()),
                ("model", LogisticRegression(C=config.cover_c, max_iter=500)),
            ])
            over = Pipeline([
                ("scale", StandardScaler()),
                ("model", LogisticRegression(C=config.over_c, max_iter=500)),
            ])

            margin.fit(train[features], train["home_margin"])
            total.fit(train[features], train["game_total"])
            cover.fit(trc[features], trc["home_cover"].astype(int))
            over.fit(tro[features], tro["over_result"].astype(int))

            mp = margin.predict(test[features])
            tp = total.predict(test[features])
            cp = cover.predict_proba(test[features])[:,1]
            op = over.predict_proba(test[features])[:,1]

            for i, (_, r) in enumerate(test.iterrows()):
                rows.append({
                    "game_id": r["game_id"],
                    "season": int(r["season"]),
                    "week": int(r["week"]),
                    "home_team": r["home_team"],
                    "away_team": r["away_team"],
                    "home_margin": float(r["home_margin"]),
                    "game_total": float(r["game_total"]),
                    "home_cover": float(r["home_cover"]) if pd.notna(r["home_cover"]) else np.nan,
                    "over_result": float(r["over_result"]) if pd.notna(r["over_result"]) else np.nan,
                    "challenger_margin_pred": float(mp[i]),
                    "challenger_total_pred": float(tp[i]),
                    "challenger_cover_prob": float(cp[i]),
                    "challenger_over_prob": float(op[i]),
                    "spread_line": float(r["spread_line"]),
                    "total_line": float(r["total_line"]),
                })

        pred = pd.DataFrame(rows)
        if pred.empty:
            raise ValueError("No v1.0 walk-forward predictions")

        return pred, score_predictions(pred)


def score_predictions(pred: pd.DataFrame) -> Dict[str, float]:
    return {
        "n": int(len(pred)),
        "margin_mae": _mae(pred["home_margin"], pred["challenger_margin_pred"]),
        "margin_rmse": _rmse(pred["home_margin"], pred["challenger_margin_pred"]),
        "total_mae": _mae(pred["game_total"], pred["challenger_total_pred"]),
        "total_rmse": _rmse(pred["game_total"], pred["challenger_total_pred"]),
        "cover_brier": _brier(pred["home_cover"], pred["challenger_cover_prob"]),
        "cover_logloss": _logloss(pred["home_cover"], pred["challenger_cover_prob"]),
        "over_brier": _brier(pred["over_result"], pred["challenger_over_prob"]),
        "over_logloss": _logloss(pred["over_result"], pred["challenger_over_prob"]),
    }


def subset_metrics(pred: pd.DataFrame, seasons: Tuple[int, ...]) -> Dict[str, float]:
    x = pred[pred["season"].isin(seasons)].copy()
    if x.empty:
        raise ValueError(f"No predictions for seasons={seasons}")
    return score_predictions(x)


def composite(metrics: Dict[str, float], reference: Dict[str, float]) -> float:
    # Relative error composite prevents raw MAE scale from overwhelming Brier.
    vals = []
    for key in ["margin_mae", "total_mae", "cover_brier", "over_brier"]:
        base = max(1e-9, reference[key])
        vals.append(metrics[key] / base)
    return float(np.mean(vals))


def safe_dev_improvement(
    candidate: Dict[str, float],
    baseline: Dict[str, float],
    config: V10Config,
) -> bool:
    regs = {
        "margin_mae": candidate["margin_mae"] - baseline["margin_mae"],
        "total_mae": candidate["total_mae"] - baseline["total_mae"],
        "cover_brier": candidate["cover_brier"] - baseline["cover_brier"],
        "over_brier": candidate["over_brier"] - baseline["over_brier"],
    }
    if regs["margin_mae"] > config.mae_material_regression:
        return False
    if regs["total_mae"] > config.mae_material_regression:
        return False
    if regs["cover_brier"] > config.brier_material_regression:
        return False
    if regs["over_brier"] > config.brier_material_regression:
        return False
    return composite(candidate, baseline) < (1.0 - config.min_composite_improvement)


def tune_one_target(
    lab: V10WalkForward,
    raw_dev: pd.DataFrame,
    features: List[str],
    base_cfg: TargetConfig,
    target: str,
    grid: Tuple[float, ...],
    dev_seasons: Tuple[int, ...],
) -> Tuple[float, List[Dict[str, float]]]:
    rows = []
    metric_key = {
        "margin_alpha": "margin_mae",
        "total_alpha": "total_mae",
        "cover_c": "cover_brier",
        "over_c": "over_brier",
    }[target]

    best_val = getattr(base_cfg, target)
    best_metric = float("inf")

    for value in grid:
        cfg = TargetConfig(**asdict(base_cfg))
        setattr(cfg, target, float(value))
        pred, _ = lab.run(raw_dev, features, cfg)
        m = subset_metrics(pred, dev_seasons)
        score = m[metric_key]
        rows.append({"value": float(value), metric_key: float(score)})
        if score < best_metric - 1e-12:
            best_metric = score
            best_val = float(value)

    return best_val, rows


def final_promotion(
    champion: Dict[str, float],
    challenger: Dict[str, float],
    config: V10Config,
) -> Dict[str, object]:
    imp = {
        "margin_mae": champion["margin_mae"] - challenger["margin_mae"],
        "total_mae": champion["total_mae"] - challenger["total_mae"],
        "cover_brier": champion["cover_brier"] - challenger["cover_brier"],
        "over_brier": champion["over_brier"] - challenger["over_brier"],
    }

    material = (
        imp["margin_mae"] >= config.final_min_mae_improvement
        or imp["total_mae"] >= config.final_min_mae_improvement
        or imp["cover_brier"] >= config.final_min_brier_improvement
        or imp["over_brier"] >= config.final_min_brier_improvement
    )
    no_regression = (
        imp["margin_mae"] >= -config.final_max_mae_regression
        and imp["total_mae"] >= -config.final_max_mae_regression
        and imp["cover_brier"] >= -config.final_max_brier_regression
        and imp["over_brier"] >= -config.final_max_brier_regression
    )

    return {
        "decision": "PROMOTE_V10_INTERNAL_CHALLENGER" if material and no_regression else "HOLD_V08_INTERNAL_CHAMPION",
        "improvement": imp,
        "material_improvement": material,
        "no_material_regression": no_regression,
    }


def market_metrics(pred: pd.DataFrame) -> Dict[str, float]:
    market_margin = -pred["spread_line"]
    market_total = pred["total_line"]
    return {
        "n": int(len(pred)),
        "margin_mae": _mae(pred["home_margin"], market_margin),
        "margin_rmse": _rmse(pred["home_margin"], market_margin),
        "total_mae": _mae(pred["game_total"], market_total),
        "total_rmse": _rmse(pred["game_total"], market_total),
    }


def run(
    rows: pd.DataFrame,
    config: Optional[V10Config] = None,
) -> Tuple[pd.DataFrame, Dict[str, object]]:
    config = config or V10Config()
    all_features = eligible_features(add_targets(rows))
    groups = build_feature_groups(all_features)

    lab = V10WalkForward(config.min_train_games)
    baseline_cfg = TargetConfig()

    # DEVELOPMENT-ONLY data: never use 2025 to select features/hyperparameters.
    dev_raw = rows[rows["season"] <= max(config.dev_seasons)].copy()
    baseline_dev_pred, _ = lab.run(dev_raw, all_features, baseline_cfg)
    baseline_dev = subset_metrics(baseline_dev_pred, config.dev_seasons)

    family_diag = {}
    harmful_candidates = []

    for group, gfeatures in groups.items():
        keep = [f for f in all_features if f not in set(gfeatures)]
        if not keep:
            continue
        pred, _ = lab.run(dev_raw, keep, baseline_cfg)
        m = subset_metrics(pred, config.dev_seasons)
        family_diag[group] = {
            "feature_count": len(gfeatures),
            "features": gfeatures,
            "leave_one_group_out": m,
            "delta_vs_all_features": {
                k: m[k] - baseline_dev[k]
                for k in ["margin_mae","total_mae","cover_brier","over_brier"]
            },
            "safe_removal_candidate": safe_dev_improvement(m, baseline_dev, config),
        }
        if family_diag[group]["safe_removal_candidate"]:
            harmful_candidates.append(group)

    # Conservative sequential removal. A group is removed only if it still
    # improves the current development champion after earlier accepted removals.
    selected = list(all_features)
    selected_dev_metrics = dict(baseline_dev)
    removals = []

    # strongest leave-one-out composite improvement first
    harmful_candidates.sort(
        key=lambda g: composite(family_diag[g]["leave_one_group_out"], baseline_dev)
    )

    for group in harmful_candidates:
        candidate_features = [f for f in selected if f not in set(groups[group])]
        pred, _ = lab.run(dev_raw, candidate_features, baseline_cfg)
        m = subset_metrics(pred, config.dev_seasons)
        if safe_dev_improvement(m, selected_dev_metrics, config):
            removals.append(group)
            selected = candidate_features
            selected_dev_metrics = m

    # Hyperparameter tuning remains development-only.
    tuned = TargetConfig()
    hyper = {}

    tuned.margin_alpha, hyper["margin_alpha"] = tune_one_target(
        lab, dev_raw, selected, tuned, "margin_alpha", config.ridge_grid, config.dev_seasons
    )
    tuned.total_alpha, hyper["total_alpha"] = tune_one_target(
        lab, dev_raw, selected, tuned, "total_alpha", config.ridge_grid, config.dev_seasons
    )
    tuned.cover_c, hyper["cover_c"] = tune_one_target(
        lab, dev_raw, selected, tuned, "cover_c", config.logistic_c_grid, config.dev_seasons
    )
    tuned.over_c, hyper["over_c"] = tune_one_target(
        lab, dev_raw, selected, tuned, "over_c", config.logistic_c_grid, config.dev_seasons
    )

    tuned_dev_pred, _ = lab.run(dev_raw, selected, tuned)
    tuned_dev = subset_metrics(tuned_dev_pred, config.dev_seasons)

    # UNTOUCHED FINAL EVALUATION: 2025 was not used above.
    baseline_full_pred, _ = lab.run(rows, all_features, baseline_cfg)
    challenger_full_pred, _ = lab.run(rows, selected, tuned)

    baseline_final = subset_metrics(baseline_full_pred, (config.final_holdout_season,))
    challenger_final = subset_metrics(challenger_full_pred, (config.final_holdout_season,))
    final_market = market_metrics(
        challenger_full_pred[challenger_full_pred["season"].eq(config.final_holdout_season)]
    )

    promotion = final_promotion(baseline_final, challenger_final, config)

    report = {
        "engine_version": "NFL_v1.0_FEATURE_ABLATION",
        "mode": "SHADOW",
        "config": asdict(config),
        "integrity": {
            "development_seasons": list(config.dev_seasons),
            "untouched_final_holdout_season": config.final_holdout_season,
            "market_used_in_blind_feature_selection": False,
            "2025_used_for_feature_selection": False,
            "2025_used_for_hyperparameter_tuning": False,
            "production_release_allowed": False,
        },
        "feature_groups": groups,
        "baseline_feature_count": len(all_features),
        "selected_feature_count": len(selected),
        "selected_features": selected,
        "removed_groups": removals,
        "family_ablation": family_diag,
        "hyperparameter_search": hyper,
        "selected_hyperparameters": asdict(tuned),
        "development": {
            "baseline_all_features": baseline_dev,
            "post_removal_pre_tuning": selected_dev_metrics,
            "tuned_challenger": tuned_dev,
        },
        "untouched_2025": {
            "v08_internal_champion": baseline_final,
            "v10_internal_challenger": challenger_final,
            "market_challenger": final_market,
            "promotion_gate": promotion,
        },
        "shadow_readiness": {
            "status": (
                "V10_INTERNAL_CHALLENGER_PROMOTABLE"
                if promotion["decision"] == "PROMOTE_V10_INTERNAL_CHALLENGER"
                else "HOLD_V08_INTERNAL_CHAMPION"
            ),
            "production_release_allowed": False,
            "manual_verification_required": True,
        },
    }

    return challenger_full_pred, report


def load_rows(input_dir: str, start: int, end: int) -> pd.DataFrame:
    d = Path(input_dir)
    frames = []
    for season in range(start, end+1):
        p = d / f"nfl_pregame_rows_{season}.parquet"
        if not p.exists():
            raise FileNotFoundError(p)
        frames.append(pd.read_parquet(p))
    return pd.concat(frames, ignore_index=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", default="data/nfl_walkforward_v08")
    p.add_argument("--start", type=int, default=2021)
    p.add_argument("--end", type=int, default=2025)
    p.add_argument("--out-dir", default="data/nfl_walkforward_v10")
    a = p.parse_args()

    rows = load_rows(a.input_dir, a.start, a.end)
    pred, report = run(rows)

    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    pred.to_csv(out / "nfl_v10_predictions.csv", index=False)
    (out / "nfl_v10_report.json").write_text(json.dumps(report, indent=2))

    # Compact family table.
    family_rows = []
    for group, x in report["family_ablation"].items():
        row = {
            "group": group,
            "feature_count": x["feature_count"],
            "safe_removal_candidate": x["safe_removal_candidate"],
            **{f"delta_{k}": v for k,v in x["delta_vs_all_features"].items()},
        }
        family_rows.append(row)
    pd.DataFrame(family_rows).to_csv(out / "nfl_v10_family_ablation.csv", index=False)

    status = {
        "sport": "NFL",
        "engine_version": report["engine_version"],
        "mode": "SHADOW",
        "report": report,
    }
    (out / "nfl_v10_shadow_status.json").write_text(json.dumps(status, indent=2))

    print(json.dumps({
        "status": report["shadow_readiness"]["status"],
        "baseline_features": report["baseline_feature_count"],
        "selected_features": report["selected_feature_count"],
        "removed_groups": report["removed_groups"],
        "selected_hyperparameters": report["selected_hyperparameters"],
        "untouched_2025": report["untouched_2025"],
    }, indent=2))


if __name__ == "__main__":
    main()
