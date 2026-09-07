
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, Optional
import json
import numpy as np


@dataclass
class ModelMetrics:
    margin_mae: float
    total_mae: float
    cover_brier: float
    over_brier: float
    margin_rmse: Optional[float] = None
    total_rmse: Optional[float] = None
    cover_logloss: Optional[float] = None
    over_logloss: Optional[float] = None
    holdout_games: int = 0


@dataclass
class PromotionPolicy:
    min_holdout_games: int = 400
    min_margin_mae_improvement: float = 0.10
    min_total_mae_improvement: float = 0.10
    min_brier_improvement: float = 0.0015

    max_mae_regression: float = 0.18
    max_brier_regression: float = 0.0025

    require_no_material_regression: bool = True


def compare_models(
    champion: ModelMetrics,
    challenger: ModelMetrics,
    policy: Optional[PromotionPolicy]=None,
) -> Dict[str,object]:
    p=policy or PromotionPolicy()

    if challenger.holdout_games < p.min_holdout_games:
        return {
            "decision":"HOLD_CHAMPION",
            "reason":"insufficient_holdout_games",
            "holdout_games":challenger.holdout_games,
        }

    imp={
        "margin_mae":champion.margin_mae-challenger.margin_mae,
        "total_mae":champion.total_mae-challenger.total_mae,
        "cover_brier":champion.cover_brier-challenger.cover_brier,
        "over_brier":champion.over_brier-challenger.over_brier,
    }

    material_improvement=(
        imp["margin_mae"] >= p.min_margin_mae_improvement
        or imp["total_mae"] >= p.min_total_mae_improvement
        or imp["cover_brier"] >= p.min_brier_improvement
        or imp["over_brier"] >= p.min_brier_improvement
    )

    no_material_regression=(
        imp["margin_mae"] >= -p.max_mae_regression
        and imp["total_mae"] >= -p.max_mae_regression
        and imp["cover_brier"] >= -p.max_brier_regression
        and imp["over_brier"] >= -p.max_brier_regression
    )

    if material_improvement and (no_material_regression or not p.require_no_material_regression):
        decision="PROMOTE_CHALLENGER"
        reason="out_of_sample_improvement"
    else:
        decision="HOLD_CHAMPION"
        reason="challenger_not_materially_better"

    return {
        "decision":decision,
        "reason":reason,
        "improvement":imp,
        "champion":asdict(champion),
        "challenger":asdict(challenger),
        "policy":asdict(p),
    }
