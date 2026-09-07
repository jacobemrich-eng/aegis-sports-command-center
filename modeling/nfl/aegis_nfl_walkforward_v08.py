from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


# AEGIS NFL v0.8 Feature Hygiene
#
# The blind internal sports model must remain independent of the sportsbook
# market and must not use postgame outcomes or arbitrary numeric identifiers.
FORBIDDEN_EXACT = {
    # Targets / results
    "home_score", "away_score", "home_points", "away_points",
    "home_margin", "game_total", "home_cover", "over_result",
    "result", "total", "overtime",

    # Market lines / prices
    "spread_line", "total_line", "market_spread_line_nflverse",
    "closing_spread_line", "closing_total_line",
    "home_moneyline", "away_moneyline",
    "home_spread_odds", "away_spread_odds",
    "over_odds", "under_odds",

    # Provider / game identifiers
    "espn", "gsis", "old_game_id",
}

MARKET_TOKENS = (
    "moneyline",
    "spread_odds",
    "over_odds",
    "under_odds",
    "closing_",
)

POSTGAME_TOKENS = (
    "final_score",
    "final_margin",
    "final_total",
)

ID_EXACT = {"espn", "gsis", "old_game_id"}


@dataclass
class NFLWalkForwardConfig:
    min_train_games: int = 500
    ridge_alpha_margin: float = 14.0
    ridge_alpha_total: float = 14.0
    logistic_c: float = 0.35


def _mae(y, p):
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    return float(np.mean(np.abs(y[m] - p[m])))


def _rmse(y, p):
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    x = y[m] - p[m]
    return float(np.sqrt(np.mean(x * x)))


def _brier(y, p):
    # Pushes are NaN targets and must be removed from calibration scoring.
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    y = y[m]
    p = np.clip(p[m], 1e-6, 1 - 1e-6)
    return float(np.mean((y - p) ** 2))


def _logloss(y, p):
    # Pushes are NaN targets and must be removed from probability scoring.
    y = np.asarray(y, float)
    p = np.asarray(p, float)
    m = np.isfinite(y) & np.isfinite(p)
    y = y[m]
    p = np.clip(p[m], 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def feature_rejection_reason(column: str) -> Optional[str]:
    c = str(column)
    lc = c.lower()

    if c in FORBIDDEN_EXACT:
        if c in ID_EXACT:
            return "identifier"
        if c == "overtime":
            return "postgame_outcome"
        if (
            "odds" in lc
            or "moneyline" in lc
            or "spread_line" in lc
            or "total_line" in lc
        ):
            return "sportsbook_market"
        return "target_or_result"

    if any(token in lc for token in MARKET_TOKENS):
        return "sportsbook_market"

    if any(token in lc for token in POSTGAME_TOKENS):
        return "postgame_outcome"

    if lc.endswith("_id") or lc.startswith("id_"):
        return "identifier"

    if c in {"season", "week", "game_id"}:
        return "metadata"

    return None


def feature_hygiene(df: pd.DataFrame) -> Dict[str, object]:
    accepted: List[str] = []
    rejected: Dict[str, str] = {}

    for c in df.columns:
        reason = feature_rejection_reason(c)
        if reason is not None:
            rejected[c] = reason
            continue

        if not pd.api.types.is_numeric_dtype(df[c]):
            rejected[c] = "non_numeric"
            continue

        if df[c].notna().mean() < 0.90:
            rejected[c] = "insufficient_coverage"
            continue

        if df[c].nunique(dropna=True) <= 1:
            rejected[c] = "constant_or_single_value"
            continue

        accepted.append(c)

    return {
        "accepted": sorted(accepted),
        "rejected": dict(sorted(rejected.items())),
        "accepted_count": len(accepted),
        "rejected_count": len(rejected),
    }


def eligible_features(df: pd.DataFrame) -> List[str]:
    return feature_hygiene(df)["accepted"]


def add_targets(df: pd.DataFrame) -> pd.DataFrame:
    x = df.copy()
    x["home_margin"] = x["home_score"] - x["away_score"]
    x["game_total"] = x["home_score"] + x["away_score"]

    # AEGIS convention: home favorite is negative, e.g. home -3 = -3.
    adj = x["home_margin"] + x["spread_line"]
    x["home_cover"] = np.where(adj > 0, 1, np.where(adj < 0, 0, np.nan))

    tadj = x["game_total"] - x["total_line"]
    x["over_result"] = np.where(tadj > 0, 1, np.where(tadj < 0, 0, np.nan))
    return x


class NFLWalkForwardLabV08:
    def __init__(self, config: Optional[NFLWalkForwardConfig] = None):
        self.config = config or NFLWalkForwardConfig()

    def _models(self):
        margin = Pipeline([
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=self.config.ridge_alpha_margin)),
        ])
        total = Pipeline([
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=self.config.ridge_alpha_total)),
        ])
        cover = Pipeline([
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=self.config.logistic_c, max_iter=500)),
        ])
        over = Pipeline([
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=self.config.logistic_c, max_iter=500)),
        ])
        return margin, total, cover, over

    def run(self, raw: pd.DataFrame, features: Optional[List[str]] = None):
        df = add_targets(raw)

        hygiene = feature_hygiene(df)
        features = features or hygiene["accepted"]
        if not features:
            raise ValueError("No eligible blind-model features")

        # Explicit hard gate even when a custom feature list is passed.
        invalid = {
            c: feature_rejection_reason(c)
            for c in features
            if feature_rejection_reason(c) is not None
        }
        if invalid:
            raise ValueError(f"Feature hygiene violation: {invalid}")

        rows = []
        weeks = (
            df[["season", "week"]]
            .drop_duplicates()
            .sort_values(["season", "week"])
        )

        for season, week in weeks.to_numpy():
            train = df[
                (df["season"] < season)
                | ((df["season"] == season) & (df["week"] < week))
            ].dropna(subset=features + ["home_margin", "game_total"])

            test = df[
                (df["season"] == season) & (df["week"] == week)
            ].dropna(subset=features + ["home_margin", "game_total"])

            if len(train) < self.config.min_train_games or test.empty:
                continue

            trc = train.dropna(subset=["home_cover"])
            tro = train.dropna(subset=["over_result"])
            if trc["home_cover"].nunique() < 2 or tro["over_result"].nunique() < 2:
                continue

            mm, tm, cm, om = self._models()
            mm.fit(train[features], train["home_margin"])
            tm.fit(train[features], train["game_total"])
            cm.fit(trc[features], trc["home_cover"].astype(int))
            om.fit(tro[features], tro["over_result"].astype(int))

            mp = mm.predict(test[features])
            tp = tm.predict(test[features])
            cp = cm.predict_proba(test[features])[:, 1]
            op = om.predict_proba(test[features])[:, 1]

            for i, (_, r) in enumerate(test.iterrows()):
                rows.append({
                    "game_id": r["game_id"],
                    "season": int(r["season"]),
                    "week": int(r["week"]),
                    "home_team": r["home_team"],
                    "away_team": r["away_team"],
                    "home_margin": float(r["home_margin"]),
                    "game_total": float(r["game_total"]),
                    "home_cover": (
                        float(r["home_cover"])
                        if pd.notna(r["home_cover"])
                        else np.nan
                    ),
                    "over_result": (
                        float(r["over_result"])
                        if pd.notna(r["over_result"])
                        else np.nan
                    ),
                    "challenger_margin_pred": float(mp[i]),
                    "challenger_total_pred": float(tp[i]),
                    "challenger_cover_prob": float(cp[i]),
                    "challenger_over_prob": float(op[i]),
                    "spread_line": float(r["spread_line"]),
                    "total_line": float(r["total_line"]),
                })

        pred = pd.DataFrame(rows)
        if pred.empty:
            raise ValueError("No holdout predictions produced")

        market_margin_pred = -pred["spread_line"]
        market_total_pred = pred["total_line"]

        report = {
            "engine_version": "NFL_v0.8_FEATURE_HYGIENE",
            "holdout_games": int(len(pred)),
            "feature_count": len(features),
            "features": features,
            "feature_hygiene": hygiene,
            "leakage_guard": {
                "market_lines_in_internal_features": False,
                "market_prices_in_internal_features": False,
                "postgame_outcomes_in_internal_features": False,
                "numeric_identifiers_in_internal_features": False,
            },
            "challenger": {
                "margin_mae": _mae(
                    pred["home_margin"], pred["challenger_margin_pred"]
                ),
                "margin_rmse": _rmse(
                    pred["home_margin"], pred["challenger_margin_pred"]
                ),
                "total_mae": _mae(
                    pred["game_total"], pred["challenger_total_pred"]
                ),
                "total_rmse": _rmse(
                    pred["game_total"], pred["challenger_total_pred"]
                ),
                "cover_brier": _brier(
                    pred["home_cover"], pred["challenger_cover_prob"]
                ),
                "cover_logloss": _logloss(
                    pred["home_cover"], pred["challenger_cover_prob"]
                ),
                "over_brier": _brier(
                    pred["over_result"], pred["challenger_over_prob"]
                ),
                "over_logloss": _logloss(
                    pred["over_result"], pred["challenger_over_prob"]
                ),
                "cover_push_rate": float(pred["home_cover"].isna().mean()),
                "total_push_rate": float(pred["over_result"].isna().mean()),
            },
            "market_challenger": {
                "margin_mae": _mae(pred["home_margin"], market_margin_pred),
                "margin_rmse": _rmse(pred["home_margin"], market_margin_pred),
                "total_mae": _mae(pred["game_total"], market_total_pred),
                "total_rmse": _rmse(pred["game_total"], market_total_pred),
                "note": (
                    "Consensus market is evaluated independently and is not "
                    "an internal predictive feature."
                ),
            },
        }

        report["internal_vs_market"] = {
            "margin_mae_delta_market_minus_model": (
                report["market_challenger"]["margin_mae"]
                - report["challenger"]["margin_mae"]
            ),
            "total_mae_delta_market_minus_model": (
                report["market_challenger"]["total_mae"]
                - report["challenger"]["total_mae"]
            ),
        }

        return pred, report
