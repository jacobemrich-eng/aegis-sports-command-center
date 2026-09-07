
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple
import argparse
import json
import math

import numpy as np
import pandas as pd


BUCKETS = [
    ("<=1", 0.0, 1.000001),
    ("1-2", 1.000001, 2.000001),
    ("2-3", 2.000001, 3.000001),
    ("3-5", 3.000001, 5.000001),
    ("5-7", 5.000001, 7.000001),
    ("7+", 7.000001, float("inf")),
]


@dataclass
class CalibrationConfig:
    min_prior_oos_games: int = 150
    min_bucket_games: int = 45
    shrinkage_games: float = 80.0
    weight_grid_step: float = 0.025

    # Governance based on the clean v0.8 residual audit.
    pass_disagreement_points: float = 7.0
    secondary_max_disagreement_points: float = 5.0
    core_block_disagreement_points: float = 3.0

    # A bucket with clearly poor historical reliability gets its internal-model
    # weight capped even before the hard disagreement firewall is applied.
    poor_bucket_beat_rate: float = 0.45
    poor_bucket_mae_delta: float = 1.0
    severe_bucket_beat_rate: float = 0.40
    severe_bucket_mae_delta: float = 2.0

    poor_bucket_weight_cap: float = 0.25
    severe_bucket_weight_cap: float = 0.10
    normal_weight_cap: float = 0.70


def _mae(y, p) -> float:
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    return float(np.mean(np.abs(y[m] - p[m])))


def _rmse(y, p) -> float:
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    e = y[m] - p[m]
    return float(np.sqrt(np.mean(e * e)))


def _brier(y, p) -> float:
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    y = y[m]
    p = np.clip(p[m], 1e-6, 1 - 1e-6)
    return float(np.mean((y - p) ** 2))


def _logloss(y, p) -> float:
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    y = y[m]
    p = np.clip(p[m], 1e-6, 1 - 1e-6)
    return float(-np.mean(y*np.log(p) + (1-y)*np.log(1-p)))


def bucket_name(x: float) -> str:
    a = abs(float(x))
    for name, lo, hi in BUCKETS:
        if lo <= a < hi:
            return name
    return "7+"


def _grid(config: CalibrationConfig) -> np.ndarray:
    n = int(round(1.0 / config.weight_grid_step))
    return np.linspace(0.0, 1.0, n + 1)


def optimal_mean_weight(
    df: pd.DataFrame,
    internal_col: str,
    market_col: str,
    target_col: str,
    config: CalibrationConfig,
) -> float:
    x = df[[internal_col, market_col, target_col]].dropna()
    if x.empty:
        return 0.0
    best_w, best = 0.0, float("inf")
    for w in _grid(config):
        p = w*x[internal_col].to_numpy(float) + (1-w)*x[market_col].to_numpy(float)
        score = _mae(x[target_col], p)
        if score < best - 1e-12:
            best, best_w = score, float(w)
    return best_w


def optimal_probability_weight(
    df: pd.DataFrame,
    internal_prob_col: str,
    target_col: str,
    config: CalibrationConfig,
) -> float:
    # Market probability at the consensus spread/total line is treated as 50%
    # in this historical schedule dataset. Book-specific de-vig probabilities
    # remain a live execution-layer input.
    x = df[[internal_prob_col, target_col]].dropna()
    if x.empty:
        return 0.0
    best_w, best = 0.0, float("inf")
    for w in _grid(config):
        p = 0.5 + w*(x[internal_prob_col].to_numpy(float) - 0.5)
        score = _brier(x[target_col], p)
        if score < best - 1e-12:
            best, best_w = score, float(w)
    return best_w


def reliability_stats(
    df: pd.DataFrame,
    *,
    disagreement_col: str,
    internal_col: str,
    market_col: str,
    target_col: str,
) -> Dict[str, Dict[str, float]]:
    out = {}
    temp = df.copy()
    temp["_bucket"] = [bucket_name(x) for x in temp[disagreement_col]]
    for name, _, _ in BUCKETS:
        g = temp[temp["_bucket"].eq(name)]
        if g.empty:
            out[name] = {"n": 0}
            continue
        model_err = np.abs(g[target_col] - g[internal_col])
        market_err = np.abs(g[target_col] - g[market_col])
        out[name] = {
            "n": int(len(g)),
            "model_mae": float(model_err.mean()),
            "market_mae": float(market_err.mean()),
            "mae_delta_model_minus_market": float(model_err.mean() - market_err.mean()),
            "model_beat_rate": float((model_err < market_err).mean()),
        }
    return out


def _reliability_cap(stats: Dict[str, float], config: CalibrationConfig) -> float:
    if not stats or stats.get("n", 0) < config.min_bucket_games:
        return config.normal_weight_cap
    beat = stats.get("model_beat_rate", 0.5)
    delta = stats.get("mae_delta_model_minus_market", 0.0)
    if beat < config.severe_bucket_beat_rate or delta > config.severe_bucket_mae_delta:
        return config.severe_bucket_weight_cap
    if beat < config.poor_bucket_beat_rate or delta > config.poor_bucket_mae_delta:
        return config.poor_bucket_weight_cap
    return config.normal_weight_cap


def learned_weight(
    prior: pd.DataFrame,
    *,
    disagreement: float,
    disagreement_col: str,
    internal_col: str,
    market_col: str,
    target_col: str,
    config: CalibrationConfig,
) -> Tuple[float, Dict[str, float]]:
    global_w = optimal_mean_weight(prior, internal_col, market_col, target_col, config)
    b = bucket_name(disagreement)
    prior_b = prior[[bucket_name(x) == b for x in prior[disagreement_col]]]
    bucket_w = optimal_mean_weight(prior_b, internal_col, market_col, target_col, config) if len(prior_b) else global_w

    n = len(prior_b)
    shrink = n / (n + config.shrinkage_games)
    w = shrink*bucket_w + (1-shrink)*global_w

    stats = reliability_stats(
        prior,
        disagreement_col=disagreement_col,
        internal_col=internal_col,
        market_col=market_col,
        target_col=target_col,
    ).get(b, {"n": 0})
    cap = _reliability_cap(stats, config)
    w = min(w, cap)

    # Absolute disagreement safety cap grounded in the v0.8 audit.
    a = abs(float(disagreement))
    if a >= config.pass_disagreement_points:
        w = min(w, config.severe_bucket_weight_cap)
    elif a >= config.secondary_max_disagreement_points:
        w = min(w, config.poor_bucket_weight_cap)

    return float(w), {
        "bucket": b,
        "global_weight": float(global_w),
        "bucket_raw_weight": float(bucket_w),
        "bucket_games": int(n),
        "reliability_cap": float(cap),
        **stats,
    }


def learned_probability_weight(
    prior: pd.DataFrame,
    *,
    disagreement: float,
    disagreement_col: str,
    internal_prob_col: str,
    target_col: str,
    config: CalibrationConfig,
) -> float:
    global_w = optimal_probability_weight(prior, internal_prob_col, target_col, config)
    b = bucket_name(disagreement)
    mask = np.array([bucket_name(x) == b for x in prior[disagreement_col]], dtype=bool)
    prior_b = prior.loc[mask]
    bucket_w = optimal_probability_weight(prior_b, internal_prob_col, target_col, config) if len(prior_b) else global_w
    n = len(prior_b)
    shrink = n / (n + config.shrinkage_games)
    w = shrink*bucket_w + (1-shrink)*global_w

    a = abs(float(disagreement))
    if a >= config.pass_disagreement_points:
        w = min(w, 0.10)
    elif a >= config.secondary_max_disagreement_points:
        w = min(w, 0.25)
    return float(w)


def firewall_status(
    disagreement: float,
    reliability: Dict[str, float],
    config: CalibrationConfig,
) -> Tuple[str, List[str]]:
    a = abs(float(disagreement))
    reasons: List[str] = []

    if a >= config.pass_disagreement_points:
        return "PASS", ["extreme_model_market_disagreement"]

    if a >= config.secondary_max_disagreement_points:
        return "SECONDARY_MAX", ["large_model_market_disagreement"]

    if a >= config.core_block_disagreement_points:
        reasons.append("moderate_model_market_disagreement")

    if reliability.get("n", 0) >= config.min_bucket_games:
        if reliability.get("model_beat_rate", 0.5) < config.severe_bucket_beat_rate:
            return "PASS", reasons + ["historically_unreliable_disagreement_bucket"]
        if reliability.get("mae_delta_model_minus_market", 0.0) > config.severe_bucket_mae_delta:
            return "PASS", reasons + ["bucket_model_mae_materially_worse_than_market"]
        if (
            reliability.get("model_beat_rate", 0.5) < config.poor_bucket_beat_rate
            or reliability.get("mae_delta_model_minus_market", 0.0) > config.poor_bucket_mae_delta
        ):
            return "SECONDARY_MAX", reasons + ["bucket_reliability_blocks_core"]

    if reasons:
        return "CORE_BLOCK", reasons
    return "NORMAL", []


class MarketChallengerCalibratorV09:
    def __init__(self, config: Optional[CalibrationConfig] = None):
        self.config = config or CalibrationConfig()

    def run(self, raw_predictions: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, object]]:
        df = raw_predictions.copy().sort_values(["season", "week", "game_id"]).reset_index(drop=True)

        required = [
            "season","week","game_id","home_margin","game_total",
            "challenger_margin_pred","challenger_total_pred",
            "challenger_cover_prob","challenger_over_prob",
            "home_cover","over_result","spread_line","total_line",
        ]
        missing = [c for c in required if c not in df.columns]
        if missing:
            raise ValueError(f"Missing v0.8 prediction columns: {missing}")

        df["market_margin_pred"] = -pd.to_numeric(df["spread_line"], errors="coerce")
        df["market_total_pred"] = pd.to_numeric(df["total_line"], errors="coerce")
        df["margin_disagreement"] = df["challenger_margin_pred"] - df["market_margin_pred"]
        df["total_disagreement"] = df["challenger_total_pred"] - df["market_total_pred"]

        rows = []
        weeks = df[["season","week"]].drop_duplicates().sort_values(["season","week"])

        for season, week in weeks.to_numpy():
            prior = df[
                (df["season"] < season)
                | ((df["season"] == season) & (df["week"] < week))
            ].copy()
            current = df[(df["season"] == season) & (df["week"] == week)].copy()

            if len(prior) < self.config.min_prior_oos_games:
                continue

            for _, r in current.iterrows():
                mw, mrel = learned_weight(
                    prior,
                    disagreement=float(r["margin_disagreement"]),
                    disagreement_col="margin_disagreement",
                    internal_col="challenger_margin_pred",
                    market_col="market_margin_pred",
                    target_col="home_margin",
                    config=self.config,
                )
                tw, trel = learned_weight(
                    prior,
                    disagreement=float(r["total_disagreement"]),
                    disagreement_col="total_disagreement",
                    internal_col="challenger_total_pred",
                    market_col="market_total_pred",
                    target_col="game_total",
                    config=self.config,
                )

                cpw = learned_probability_weight(
                    prior,
                    disagreement=float(r["margin_disagreement"]),
                    disagreement_col="margin_disagreement",
                    internal_prob_col="challenger_cover_prob",
                    target_col="home_cover",
                    config=self.config,
                )
                opw = learned_probability_weight(
                    prior,
                    disagreement=float(r["total_disagreement"]),
                    disagreement_col="total_disagreement",
                    internal_prob_col="challenger_over_prob",
                    target_col="over_result",
                    config=self.config,
                )

                margin_pred = mw*r["challenger_margin_pred"] + (1-mw)*r["market_margin_pred"]
                total_pred = tw*r["challenger_total_pred"] + (1-tw)*r["market_total_pred"]
                cover_prob = 0.5 + cpw*(r["challenger_cover_prob"] - 0.5)
                over_prob = 0.5 + opw*(r["challenger_over_prob"] - 0.5)

                mfire, mreasons = firewall_status(float(r["margin_disagreement"]), mrel, self.config)
                tfire, treasons = firewall_status(float(r["total_disagreement"]), trel, self.config)

                row = r.to_dict()
                row.update({
                    "v09_margin_pred": float(margin_pred),
                    "v09_total_pred": float(total_pred),
                    "v09_cover_prob": float(np.clip(cover_prob, 0.01, 0.99)),
                    "v09_over_prob": float(np.clip(over_prob, 0.01, 0.99)),
                    "v09_internal_weight_margin": mw,
                    "v09_internal_weight_total": tw,
                    "v09_internal_weight_cover_prob": cpw,
                    "v09_internal_weight_over_prob": opw,
                    "margin_firewall": mfire,
                    "total_firewall": tfire,
                    "margin_firewall_reasons": "|".join(mreasons),
                    "total_firewall_reasons": "|".join(treasons),
                    "margin_bucket": mrel.get("bucket"),
                    "total_bucket": trel.get("bucket"),
                    "margin_bucket_model_beat_rate_prior": mrel.get("model_beat_rate"),
                    "total_bucket_model_beat_rate_prior": trel.get("model_beat_rate"),
                    "margin_bucket_mae_delta_prior": mrel.get("mae_delta_model_minus_market"),
                    "total_bucket_mae_delta_prior": trel.get("mae_delta_model_minus_market"),
                })
                rows.append(row)

        out = pd.DataFrame(rows)
        if out.empty:
            raise ValueError("No v0.9 post-model calibration holdout rows produced")

        metrics = {
            "holdout_games": int(len(out)),
            "v08_internal": {
                "margin_mae": _mae(out["home_margin"], out["challenger_margin_pred"]),
                "margin_rmse": _rmse(out["home_margin"], out["challenger_margin_pred"]),
                "total_mae": _mae(out["game_total"], out["challenger_total_pred"]),
                "total_rmse": _rmse(out["game_total"], out["challenger_total_pred"]),
                "cover_brier": _brier(out["home_cover"], out["challenger_cover_prob"]),
                "cover_logloss": _logloss(out["home_cover"], out["challenger_cover_prob"]),
                "over_brier": _brier(out["over_result"], out["challenger_over_prob"]),
                "over_logloss": _logloss(out["over_result"], out["challenger_over_prob"]),
            },
            "market": {
                "margin_mae": _mae(out["home_margin"], out["market_margin_pred"]),
                "margin_rmse": _rmse(out["home_margin"], out["market_margin_pred"]),
                "total_mae": _mae(out["game_total"], out["market_total_pred"]),
                "total_rmse": _rmse(out["game_total"], out["market_total_pred"]),
            },
            "v09_calibrated": {
                "margin_mae": _mae(out["home_margin"], out["v09_margin_pred"]),
                "margin_rmse": _rmse(out["home_margin"], out["v09_margin_pred"]),
                "total_mae": _mae(out["game_total"], out["v09_total_pred"]),
                "total_rmse": _rmse(out["game_total"], out["v09_total_pred"]),
                "cover_brier": _brier(out["home_cover"], out["v09_cover_prob"]),
                "cover_logloss": _logloss(out["home_cover"], out["v09_cover_prob"]),
                "over_brier": _brier(out["over_result"], out["v09_over_prob"]),
                "over_logloss": _logloss(out["over_result"], out["v09_over_prob"]),
            },
        }

        metrics["improvement_v09_vs_v08"] = {
            "margin_mae": metrics["v08_internal"]["margin_mae"] - metrics["v09_calibrated"]["margin_mae"],
            "total_mae": metrics["v08_internal"]["total_mae"] - metrics["v09_calibrated"]["total_mae"],
            "cover_brier": metrics["v08_internal"]["cover_brier"] - metrics["v09_calibrated"]["cover_brier"],
            "over_brier": metrics["v08_internal"]["over_brier"] - metrics["v09_calibrated"]["over_brier"],
        }
        metrics["improvement_v09_vs_market"] = {
            "margin_mae": metrics["market"]["margin_mae"] - metrics["v09_calibrated"]["margin_mae"],
            "total_mae": metrics["market"]["total_mae"] - metrics["v09_calibrated"]["total_mae"],
        }

        firewall_counts = {
            "margin": out["margin_firewall"].value_counts().to_dict(),
            "total": out["total_firewall"].value_counts().to_dict(),
        }

        weights = {}
        for b, _, _ in BUCKETS:
            mg = out[out["margin_bucket"].eq(b)]
            tg = out[out["total_bucket"].eq(b)]
            weights[b] = {
                "margin_n": int(len(mg)),
                "mean_internal_margin_weight": float(mg["v09_internal_weight_margin"].mean()) if len(mg) else None,
                "mean_internal_cover_probability_weight": float(mg["v09_internal_weight_cover_prob"].mean()) if len(mg) else None,
                "total_n": int(len(tg)),
                "mean_internal_total_weight": float(tg["v09_internal_weight_total"].mean()) if len(tg) else None,
                "mean_internal_over_probability_weight": float(tg["v09_internal_weight_over_prob"].mean()) if len(tg) else None,
            }

        v09 = metrics["v09_calibrated"]
        market = metrics["market"]
        v08 = metrics["v08_internal"]

        if (
            v09["margin_mae"] < market["margin_mae"]
            and v09["total_mae"] < market["total_mae"]
            and v09["cover_brier"] <= v08["cover_brier"]
            and v09["over_brier"] <= v08["over_brier"]
        ):
            status = "SHADOW_CHALLENGER_HIGH_INTEREST"
        elif (
            v09["margin_mae"] < v08["margin_mae"]
            or v09["total_mae"] < v08["total_mae"]
            or v09["cover_brier"] < v08["cover_brier"]
            or v09["over_brier"] < v08["over_brier"]
        ):
            status = "SHADOW_CHALLENGER_IMPROVED"
        else:
            status = "HOLD_V08_RECALIBRATE"

        report = {
            "engine_version": "NFL_v0.9_MARKET_CHALLENGER_CALIBRATION",
            "mode": "SHADOW",
            "config": asdict(self.config),
            "metrics": metrics,
            "firewall_counts": firewall_counts,
            "learned_weight_summary": weights,
            "shadow_readiness": {
                "status": status,
                "production_release_allowed": False,
                "manual_verification_required": True,
                "market_remains_independent_challenger": True,
                "large_disagreement_is_not_treated_as_automatic_edge": True,
            },
        }
        return out, report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--predictions", required=True)
    p.add_argument("--v08-report", required=False)
    p.add_argument("--out-dir", default="data/nfl_walkforward_v09")
    args = p.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    pred = pd.read_csv(args.predictions)
    calibrated, report = MarketChallengerCalibratorV09().run(pred)

    calibrated.to_csv(out_dir / "nfl_v09_predictions.csv", index=False)
    (out_dir / "nfl_v09_report.json").write_text(json.dumps(report, indent=2))

    summary_rows = []
    for bucket, x in report["learned_weight_summary"].items():
        summary_rows.append({"bucket": bucket, **x})
    pd.DataFrame(summary_rows).to_csv(out_dir / "nfl_v09_weights.csv", index=False)

    status = {
        "sport": "NFL",
        "engine_version": report["engine_version"],
        "mode": "SHADOW",
        "report": report,
    }
    (out_dir / "nfl_v09_shadow_status.json").write_text(json.dumps(status, indent=2))

    print(json.dumps({
        "engine_version": report["engine_version"],
        "holdout_games": report["metrics"]["holdout_games"],
        "status": report["shadow_readiness"]["status"],
        "v09_margin_mae": report["metrics"]["v09_calibrated"]["margin_mae"],
        "market_margin_mae": report["metrics"]["market"]["margin_mae"],
        "v09_total_mae": report["metrics"]["v09_calibrated"]["total_mae"],
        "market_total_mae": report["metrics"]["market"]["total_mae"],
    }, indent=2))


if __name__ == "__main__":
    main()
