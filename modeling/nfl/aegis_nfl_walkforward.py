from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

# The internal sports model must remain blind to the sportsbook market.
FORBIDDEN = {
    "home_score", "away_score", "home_points", "away_points",
    "home_margin", "game_total", "home_cover", "over_result",
    "spread_line", "total_line", "market_spread_line_nflverse",
    "closing_spread_line", "closing_total_line",
    "home_moneyline", "away_moneyline",
    "result", "total",
}

@dataclass
class NFLWalkForwardConfig:
    min_train_games: int = 500
    ridge_alpha_margin: float = 14.0
    ridge_alpha_total: float = 14.0
    logistic_c: float = 0.35


def _mae(y, p): return float(np.mean(np.abs(np.asarray(y) - np.asarray(p))))
def _rmse(y, p):
    x = np.asarray(y) - np.asarray(p)
    return float(np.sqrt(np.mean(x * x)))
def _brier(y, p):
    y = np.asarray(y, float); p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return float(np.mean((y - p) ** 2))
def _logloss(y, p):
    y = np.asarray(y, float); p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def eligible_features(df: pd.DataFrame) -> List[str]:
    out = []
    for c in df.columns:
        if c in FORBIDDEN or c.startswith("closing_") or c.startswith("champion_"):
            continue
        if c in {"season", "week", "game_id"}:
            continue
        if pd.api.types.is_numeric_dtype(df[c]) and df[c].notna().mean() >= 0.90 and df[c].nunique() > 1:
            out.append(c)
    return sorted(out)


def add_targets(df: pd.DataFrame) -> pd.DataFrame:
    x = df.copy()
    x["home_margin"] = x["home_score"] - x["away_score"]
    x["game_total"] = x["home_score"] + x["away_score"]
    # AEGIS convention: home favorite is negative (e.g. -3). The real pipeline
    # normalizes nflverse's opposite sign into this convention first.
    adj = x["home_margin"] + x["spread_line"]
    x["home_cover"] = np.where(adj > 0, 1, np.where(adj < 0, 0, np.nan))
    tadj = x["game_total"] - x["total_line"]
    x["over_result"] = np.where(tadj > 0, 1, np.where(tadj < 0, 0, np.nan))
    return x


class NFLWalkForwardLab:
    def __init__(self, config: Optional[NFLWalkForwardConfig] = None):
        self.config = config or NFLWalkForwardConfig()

    def _models(self):
        margin = Pipeline([("s", StandardScaler()), ("m", Ridge(alpha=self.config.ridge_alpha_margin))])
        total = Pipeline([("s", StandardScaler()), ("m", Ridge(alpha=self.config.ridge_alpha_total))])
        cover = Pipeline([("s", StandardScaler()), ("m", LogisticRegression(C=self.config.logistic_c, max_iter=500))])
        over = Pipeline([("s", StandardScaler()), ("m", LogisticRegression(C=self.config.logistic_c, max_iter=500))])
        return margin, total, cover, over

    def run(self, raw: pd.DataFrame, features: Optional[List[str]] = None):
        df = add_targets(raw)
        features = features or eligible_features(df)
        if not features:
            raise ValueError("No eligible blind-model features")

        # Hard leakage assertion: sportsbook lines must not enter internal feature set.
        bad = [x for x in features if x in FORBIDDEN or "spread_line" in x or "total_line" in x]
        if bad:
            raise ValueError(f"Market leakage detected in features: {bad}")

        rows = []
        weeks = df[["season", "week"]].drop_duplicates().sort_values(["season", "week"])
        for season, week in weeks.to_numpy():
            train = df[(df["season"] < season) | ((df["season"] == season) & (df["week"] < week))].dropna(subset=features + ["home_margin", "game_total"])
            test = df[(df["season"] == season) & (df["week"] == week)].dropna(subset=features + ["home_margin", "game_total"])
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

            mp = mm.predict(test[features]); tp = tm.predict(test[features])
            cp = cm.predict_proba(test[features])[:, 1]; op = om.predict_proba(test[features])[:, 1]
            for i, (_, r) in enumerate(test.iterrows()):
                rows.append({
                    "game_id": r["game_id"], "season": int(r["season"]), "week": int(r["week"]),
                    "home_team": r["home_team"], "away_team": r["away_team"],
                    "home_margin": float(r["home_margin"]), "game_total": float(r["game_total"]),
                    "home_cover": float(r["home_cover"]) if pd.notna(r["home_cover"]) else np.nan,
                    "over_result": float(r["over_result"]) if pd.notna(r["over_result"]) else np.nan,
                    "challenger_margin_pred": float(mp[i]), "challenger_total_pred": float(tp[i]),
                    "challenger_cover_prob": float(cp[i]), "challenger_over_prob": float(op[i]),
                    "spread_line": float(r["spread_line"]), "total_line": float(r["total_line"]),
                })

        pred = pd.DataFrame(rows)
        if pred.empty:
            raise ValueError("No holdout predictions produced")

        market_margin_pred = -pred["spread_line"]
        market_total_pred = pred["total_line"]
        report = {
            "holdout_games": int(len(pred)),
            "feature_count": len(features),
            "features": features,
            "leakage_guard": {"market_lines_in_internal_features": False},
            "challenger": {
                "margin_mae": _mae(pred["home_margin"], pred["challenger_margin_pred"]),
                "margin_rmse": _rmse(pred["home_margin"], pred["challenger_margin_pred"]),
                "total_mae": _mae(pred["game_total"], pred["challenger_total_pred"]),
                "total_rmse": _rmse(pred["game_total"], pred["challenger_total_pred"]),
                "cover_brier": _brier(pred["home_cover"], pred["challenger_cover_prob"]),
                "cover_logloss": _logloss(pred["home_cover"], pred["challenger_cover_prob"]),
                "over_brier": _brier(pred["over_result"], pred["challenger_over_prob"]),
                "over_logloss": _logloss(pred["over_result"], pred["challenger_over_prob"]),
            },
            "market_challenger": {
                "margin_mae": _mae(pred["home_margin"], market_margin_pred),
                "margin_rmse": _rmse(pred["home_margin"], market_margin_pred),
                "total_mae": _mae(pred["game_total"], market_total_pred),
                "total_rmse": _rmse(pred["game_total"], market_total_pred),
                "note": "Consensus line is evaluated independently and is never an internal feature.",
            },
        }
        report["internal_vs_market"] = {
            "margin_mae_delta": report["market_challenger"]["margin_mae"] - report["challenger"]["margin_mae"],
            "total_mae_delta": report["market_challenger"]["total_mae"] - report["challenger"]["total_mae"],
        }
        return pred, report
