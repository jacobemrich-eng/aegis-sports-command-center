from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, Iterable, List
import numpy as np
import pandas as pd


UNSAFE_FEATURES = {
    "home_spread_odds",
    "away_spread_odds",
    "over_odds",
    "under_odds",
    "home_moneyline",
    "away_moneyline",
    "overtime",
    "espn",
    "gsis",
    "old_game_id",
}


def _safe_float(x):
    if x is None:
        return None
    x = float(x)
    if not np.isfinite(x):
        return None
    return x


def _brier(y, p):
    y = pd.to_numeric(y, errors="coerce")
    p = pd.to_numeric(p, errors="coerce")
    m = y.notna() & p.notna()
    return float(np.mean((y[m] - p[m]) ** 2))


def _logloss(y, p):
    y = pd.to_numeric(y, errors="coerce")
    p = pd.to_numeric(p, errors="coerce")
    m = y.notna() & p.notna()
    yy = y[m].astype(float)
    pp = p[m].clip(1e-6, 1 - 1e-6)
    return float(-np.mean(yy * np.log(pp) + (1 - yy) * np.log(1 - pp)))


def _prepare(pred: pd.DataFrame) -> pd.DataFrame:
    p = pred.copy()

    p["market_margin_pred"] = -p["spread_line"]
    p["model_margin_err"] = (
        p["home_margin"] - p["challenger_margin_pred"]
    ).abs()
    p["market_margin_err"] = (
        p["home_margin"] - p["market_margin_pred"]
    ).abs()

    p["model_total_err"] = (
        p["game_total"] - p["challenger_total_pred"]
    ).abs()
    p["market_total_err"] = (
        p["game_total"] - p["total_line"]
    ).abs()

    p["margin_model_beats_market"] = (
        p["model_margin_err"] < p["market_margin_err"]
    )
    p["total_model_beats_market"] = (
        p["model_total_err"] < p["market_total_err"]
    )

    p["margin_edge_pts"] = (
        p["challenger_margin_pred"] - p["market_margin_pred"]
    )
    p["total_edge_pts"] = (
        p["challenger_total_pred"] - p["total_line"]
    )

    p["abs_margin_edge"] = p["margin_edge_pts"].abs()
    p["abs_total_edge"] = p["total_edge_pts"].abs()

    p["spread_bucket"] = pd.cut(
        p["spread_line"].abs(),
        [-0.01, 2.5, 5.5, 8.5, 13.5, 100],
        labels=["PK-2.5", "3-5.5", "6-8.5", "9-13.5", "14+"],
    )

    p["total_bucket"] = pd.cut(
        p["total_line"],
        [0, 41.5, 44.5, 47.5, 50.5, 100],
        labels=["<=41.5", "42-44.5", "45-47.5", "48-50.5", "51+"],
    )

    p["margin_disagreement_bucket"] = pd.cut(
        p["abs_margin_edge"],
        [-0.001, 1, 2, 3, 5, 7, 100],
        labels=["<=1", "1-2", "2-3", "3-5", "5-7", "7+"],
    )

    p["total_disagreement_bucket"] = pd.cut(
        p["abs_total_edge"],
        [-0.001, 1, 2, 3, 5, 7, 100],
        labels=["<=1", "1-2", "2-3", "3-5", "5-7", "7+"],
    )

    return p


def _segment(p: pd.DataFrame, key: str) -> List[Dict[str, object]]:
    rows = []
    for value, g in p.groupby(key, dropna=False, observed=True):
        rows.append({
            key: str(value),
            "n": int(len(g)),
            "margin_mae_model": _safe_float(g["model_margin_err"].mean()),
            "margin_mae_market": _safe_float(g["market_margin_err"].mean()),
            "margin_delta_model_minus_market": _safe_float(
                g["model_margin_err"].mean()
                - g["market_margin_err"].mean()
            ),
            "margin_model_beat_rate": _safe_float(
                g["margin_model_beats_market"].mean()
            ),
            "total_mae_model": _safe_float(g["model_total_err"].mean()),
            "total_mae_market": _safe_float(g["market_total_err"].mean()),
            "total_delta_model_minus_market": _safe_float(
                g["model_total_err"].mean()
                - g["market_total_err"].mean()
            ),
            "total_model_beat_rate": _safe_float(
                g["total_model_beats_market"].mean()
            ),
        })
    return rows


def _directional(
    p: pd.DataFrame,
    direction: str,
    threshold: float,
) -> Dict[str, object]:
    if direction == "home":
        g = p[
            (p["margin_edge_pts"] >= threshold)
            & p["home_cover"].notna()
        ]
        wins = int((g["home_cover"] == 1).sum())
        losses = int((g["home_cover"] == 0).sum())

    elif direction == "away":
        g = p[
            (p["margin_edge_pts"] <= -threshold)
            & p["home_cover"].notna()
        ]
        wins = int((g["home_cover"] == 0).sum())
        losses = int((g["home_cover"] == 1).sum())

    elif direction == "over":
        g = p[
            (p["total_edge_pts"] >= threshold)
            & p["over_result"].notna()
        ]
        wins = int((g["over_result"] == 1).sum())
        losses = int((g["over_result"] == 0).sum())

    elif direction == "under":
        g = p[
            (p["total_edge_pts"] <= -threshold)
            & p["over_result"].notna()
        ]
        wins = int((g["over_result"] == 0).sum())
        losses = int((g["over_result"] == 1).sum())

    else:
        raise ValueError(direction)

    n = wins + losses
    win_rate = wins / n if n else None

    # Diagnostic only: assumes all decisions were priced -110.
    roi = (
        (wins * (100 / 110) - losses) / n
        if n
        else None
    )

    return {
        "direction": direction,
        "threshold_points": threshold,
        "n": n,
        "wins": wins,
        "losses": losses,
        "win_rate": win_rate,
        "flat_minus110_roi": roi,
    }


def build_audit(
    predictions: pd.DataFrame,
    report: Dict[str, object],
) -> Dict[str, object]:
    p = _prepare(predictions)

    feature_list = set(report.get("features", []))
    unsafe = sorted(feature_list & UNSAFE_FEATURES)

    by_margin_disagreement = _segment(
        p, "margin_disagreement_bucket"
    )
    by_total_disagreement = _segment(
        p, "total_disagreement_bucket"
    )

    margin_7 = next(
        (r for r in by_margin_disagreement
         if r["margin_disagreement_bucket"] == "7+"),
        None,
    )
    total_7 = next(
        (r for r in by_total_disagreement
         if r["total_disagreement_bucket"] == "7+"),
        None,
    )

    flags = []

    if unsafe:
        flags.append({
            "severity": "CRITICAL",
            "code": "FEATURE_HYGIENE",
            "message": (
                "Blind-model feature set contains market, postgame, "
                "or identifier columns."
            ),
            "columns": unsafe,
        })

    if margin_7 and (
        margin_7["margin_delta_model_minus_market"] is not None
        and margin_7["margin_delta_model_minus_market"] > 1.0
    ):
        flags.append({
            "severity": "HIGH",
            "code": "LARGE_MARGIN_DISAGREEMENT",
            "message": (
                "When internal margin disagrees with market by 7+ points, "
                "the model is materially less accurate than the market."
            ),
            "segment": margin_7,
        })

    if total_7 and (
        total_7["total_delta_model_minus_market"] is not None
        and total_7["total_delta_model_minus_market"] > 1.0
    ):
        flags.append({
            "severity": "HIGH",
            "code": "LARGE_TOTAL_DISAGREEMENT",
            "message": (
                "When internal total disagrees with market by 7+ points, "
                "the model is materially less accurate than the market."
            ),
            "segment": total_7,
        })

    if (
        report.get("challenger", {}).get("cover_brier") is None
        or not np.isfinite(
            float(
                report.get("challenger", {}).get(
                    "cover_brier", np.nan
                )
            )
        )
    ):
        flags.append({
            "severity": "HIGH",
            "code": "PUSH_METRIC_BUG",
            "message": (
                "Stored cover calibration metric is invalid because pushes "
                "were not removed before probability scoring."
            ),
        })

    audit = {
        "audit_version": "NFL_v0.8_RESIDUAL_AUDIT",
        "source_engine": report.get("engine_version", "NFL_v0.7"),
        "holdout_games": int(len(p)),
        "seasons": sorted(
            int(x) for x in p["season"].dropna().unique()
        ),
        "feature_hygiene": {
            "unsafe_features_found": unsafe,
            "unsafe_count": len(unsafe),
        },
        "corrected_probability_metrics": {
            "cover_brier": _brier(
                p["home_cover"], p["challenger_cover_prob"]
            ),
            "cover_logloss": _logloss(
                p["home_cover"], p["challenger_cover_prob"]
            ),
            "over_brier": _brier(
                p["over_result"], p["challenger_over_prob"]
            ),
            "over_logloss": _logloss(
                p["over_result"], p["challenger_over_prob"]
            ),
            "cover_push_rate": float(
                p["home_cover"].isna().mean()
            ),
            "total_push_rate": float(
                p["over_result"].isna().mean()
            ),
        },
        "overall": {
            "margin_mae_model": float(
                p["model_margin_err"].mean()
            ),
            "margin_mae_market": float(
                p["market_margin_err"].mean()
            ),
            "margin_model_beat_rate": float(
                p["margin_model_beats_market"].mean()
            ),
            "total_mae_model": float(
                p["model_total_err"].mean()
            ),
            "total_mae_market": float(
                p["market_total_err"].mean()
            ),
            "total_model_beat_rate": float(
                p["total_model_beats_market"].mean()
            ),
            "model_home_margin_bias_pred_minus_actual": float(
                (
                    p["challenger_margin_pred"]
                    - p["home_margin"]
                ).mean()
            ),
            "model_total_bias_pred_minus_actual": float(
                (
                    p["challenger_total_pred"]
                    - p["game_total"]
                ).mean()
            ),
            "mean_model_vs_market_margin_edge": float(
                p["margin_edge_pts"].mean()
            ),
            "mean_model_vs_market_total_edge": float(
                p["total_edge_pts"].mean()
            ),
        },
        "segments": {
            "season": _segment(p, "season"),
            "spread_bucket": _segment(p, "spread_bucket"),
            "total_bucket": _segment(p, "total_bucket"),
            "margin_disagreement": by_margin_disagreement,
            "total_disagreement": by_total_disagreement,
        },
        "directional_edge_diagnostic_flat_minus110": [
            _directional(p, direction, threshold)
            for threshold in [1, 2, 3, 4, 5, 7]
            for direction in ["home", "away", "over", "under"]
        ],
        "flags": flags,
        "governance": {
            "production_promotion_allowed": False,
            "recommended_status": "SHADOW_RECALIBRATION_REQUIRED",
            "required_actions": [
                "Remove sportsbook prices from blind-model features.",
                "Remove postgame overtime outcome from features.",
                "Remove numeric identifiers from features.",
                "Score Brier/log-loss after excluding pushes.",
                "Rerun 2021-2025 walk-forward after feature hygiene.",
                (
                    "Apply a Core block or uncertainty penalty when blind "
                    "margin/total disagreement exceeds 7 points until "
                    "out-of-sample evidence supports otherwise."
                ),
            ],
        },
    }
    return audit


def write_outputs(
    predictions_path: str,
    report_path: str,
    out_dir: str,
) -> Dict[str, object]:
    pred = pd.read_csv(predictions_path)
    report = json.loads(Path(report_path).read_text())

    audit = build_audit(pred, report)

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    json_path = out / "nfl_v08_audit.json"
    json_path.write_text(json.dumps(audit, indent=2))

    # Flatten major segment tables for easy inspection/download.
    segment_rows = []
    for segment_name, rows in audit["segments"].items():
        for row in rows:
            r = {"segment_type": segment_name, **row}
            segment_rows.append(r)
    pd.DataFrame(segment_rows).to_csv(
        out / "nfl_v08_segment_audit.csv",
        index=False,
    )

    directional = pd.DataFrame(
        audit["directional_edge_diagnostic_flat_minus110"]
    )
    directional.to_csv(
        out / "nfl_v08_directional_diagnostic.csv",
        index=False,
    )

    md = []
    md.append("# AEGIS NFL v0.8 Residual Audit")
    md.append("")
    md.append(
        f"Holdout games: **{audit['holdout_games']}**"
    )
    md.append("")
    md.append("## Feature hygiene")
    md.append("")
    md.append(
        "Unsafe features found: "
        + (
            ", ".join(audit["feature_hygiene"]["unsafe_features_found"])
            if audit["feature_hygiene"]["unsafe_features_found"]
            else "none"
        )
    )
    md.append("")
    md.append("## Overall")
    md.append("")
    ov = audit["overall"]
    md.append(
        f"- Margin MAE — model {ov['margin_mae_model']:.3f}, "
        f"market {ov['margin_mae_market']:.3f}"
    )
    md.append(
        f"- Total MAE — model {ov['total_mae_model']:.3f}, "
        f"market {ov['total_mae_market']:.3f}"
    )
    md.append(
        f"- Model beat market on margin error in "
        f"{ov['margin_model_beat_rate']:.1%} of holdout games."
    )
    md.append(
        f"- Model beat market on total error in "
        f"{ov['total_model_beat_rate']:.1%} of holdout games."
    )
    md.append("")
    md.append("## Governance")
    md.append("")
    md.append(
        "**SHADOW_RECALIBRATION_REQUIRED — no production promotion.**"
    )
    md.append("")
    for action in audit["governance"]["required_actions"]:
        md.append(f"- {action}")

    (out / "nfl_v08_audit.md").write_text(
        "\n".join(md) + "\n"
    )

    return audit


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--predictions", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--out-dir", required=True)
    args = p.parse_args()

    result = write_outputs(
        args.predictions,
        args.report,
        args.out_dir,
    )
    print(json.dumps({
        "status": "PASS",
        "holdout_games": result["holdout_games"],
        "recommended_status": (
            result["governance"]["recommended_status"]
        ),
        "flags": len(result["flags"]),
    }, indent=2))
