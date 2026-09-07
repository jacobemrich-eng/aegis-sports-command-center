
from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Dict, List, Optional, Tuple
import json
import math
import numpy as np

from aegis_nfl_drive_simulator import (
    NFLTeamProfile,
    NFLGameContext,
    NFLDriveSimulator,
)
from aegis_nfl_pressure_trenches import (
    QBPressureProfile,
    TrenchProfile,
    project_pressure_matchup,
    apply_pressure_projection,
    pressure_matchup_audit,
)
from aegis_nfl_pace_coaching import (
    NFLPROEPaceProfile,
    NFLCoachingDecisionProfile,
    project_game_state_profile,
    apply_game_state_projection,
    coaching_policy_audit,
)
from aegis_nfl_period_model import (
    NFLPeriodProfile,
    project_period,
    apply_period_projection,
    period_audit,
)
from aegis_nfl_market_optimizer import (
    NFLMarketExpressionOptimizer,
    NFLMarketOffer,
    OptimizerConfig,
)
from aegis_nfl_keynumber_model import KeyNumberCalibration


@dataclass
class DataQualityInputs:
    injuries: float = 1.0
    qb_pressure: float = 1.0
    trenches: float = 1.0
    pace_coaching: float = 1.0
    period_model: float = 1.0
    market: float = 1.0
    weather: float = 1.0

    def score(self) -> float:
        vals = [
            self.injuries, self.qb_pressure, self.trenches,
            self.pace_coaching, self.period_model, self.market, self.weather
        ]
        weights = [0.17,0.18,0.16,0.14,0.10,0.17,0.08]
        return float(sum(v*w for v,w in zip(vals,weights)))

    def grade(self) -> str:
        s=self.score()
        if s>=0.92: return "A"
        if s>=0.85: return "B"
        if s>=0.76: return "C"
        return "D"


@dataclass
class EnsembleInputs:
    power_margin: float
    efficiency_margin: float
    drive_margin: float
    matchup_margin: float
    personnel_margin: float
    market_challenger_margin: float

    def values(self) -> List[float]:
        return [
            self.power_margin,self.efficiency_margin,self.drive_margin,
            self.matchup_margin,self.personnel_margin,self.market_challenger_margin
        ]

    def dispersion(self) -> float:
        return float(np.std(self.values(), ddof=1))

    def mean(self) -> float:
        return float(np.mean(self.values()))

    def agreement_grade(self) -> str:
        d=self.dispersion()
        if d<=2.0: return "HIGH"
        if d<=3.5: return "MODERATE"
        return "LOW"


@dataclass
class AEGISNFLGameInput:
    home_base: NFLTeamProfile
    away_base: NFLTeamProfile
    context: NFLGameContext

    home_qb: QBPressureProfile
    away_qb: QBPressureProfile
    home_trench: TrenchProfile
    away_trench: TrenchProfile

    home_pace: NFLPROEPaceProfile
    away_pace: NFLPROEPaceProfile
    home_coach: NFLCoachingDecisionProfile
    away_coach: NFLCoachingDecisionProfile

    home_period: NFLPeriodProfile
    away_period: NFLPeriodProfile

    offers: List[NFLMarketOffer]

    data_quality: DataQualityInputs
    ensemble: EnsembleInputs

    market_challenger_probs: Optional[Dict[str,float]] = None
    key_calibration: Optional[KeyNumberCalibration] = None


class AEGISNFLv07:
    """
    Full NFL decision stack.

    Predictive layers:
      base drive model
      -> pressure/trenches
      -> PROE/pace/coaching
      -> independent Q1/H1
      -> Monte Carlo distribution

    Decision layers:
      -> key-number calibration
      -> market-expression optimizer
      -> data quality
      -> ensemble disagreement
      -> release governance
      -> standardized Command Center payload
    """

    def __init__(
        self,
        optimizer_config: Optional[OptimizerConfig] = None,
        *,
        core_capable_data_quality: float = 0.88,
        secondary_data_quality: float = 0.78,
        max_core_dispersion: float = 3.0,
        max_secondary_dispersion: float = 5.0,
    ):
        self.optimizer_config = optimizer_config or OptimizerConfig()
        self.core_capable_data_quality = core_capable_data_quality
        self.secondary_data_quality = secondary_data_quality
        self.max_core_dispersion = max_core_dispersion
        self.max_secondary_dispersion = max_secondary_dispersion

    def _build_adjusted_profiles(self, x: AEGISNFLGameInput):
        hp = project_pressure_matchup(x.home_qb, x.home_trench, x.away_trench)
        ap = project_pressure_matchup(x.away_qb, x.away_trench, x.home_trench)
        home = apply_pressure_projection(x.home_base, hp)
        away = apply_pressure_projection(x.away_base, ap)

        hs = project_game_state_profile(
            x.home_pace, x.home_coach,
            opponent_expected_drives=away.expected_drives
        )
        aps = project_game_state_profile(
            x.away_pace, x.away_coach,
            opponent_expected_drives=home.expected_drives
        )
        home = apply_game_state_projection(home, hs)
        away = apply_game_state_projection(away, aps)

        hper = project_period(x.home_period)
        aper = project_period(x.away_period)
        home = apply_period_projection(home, hper)
        away = apply_period_projection(away, aper)

        matchup_unc = (
            hp.uncertainty_multiplier
            * ap.uncertainty_multiplier
            * hs.uncertainty_multiplier
            * aps.uncertainty_multiplier
            * hper.uncertainty_multiplier
            * aper.uncertainty_multiplier
        ) ** (1/6)

        dq=x.data_quality.score()
        data_unc = 1.0 + max(0.0, 0.90-dq)*0.40

        ctx=replace(
            x.context,
            uncertainty_mult=min(
                1.50,
                x.context.uncertainty_mult * matchup_unc * data_unc
            )
        )
        return home,away,ctx,hp,ap,hs,aps,hper,aper

    def _govern_release(
        self,
        row: Dict[str,object],
        *,
        data_quality: float,
        dispersion: float,
    ) -> Dict[str,object]:
        r=dict(row)
        status=r["release_status"]
        blocks=[]

        if data_quality < self.secondary_data_quality:
            status="PASS"
            blocks.append("data_quality_below_secondary_floor")

        if dispersion > self.max_secondary_dispersion:
            status="PASS"
            blocks.append("ensemble_disagreement_too_high")

        if status=="CORE_CANDIDATE":
            if data_quality < self.core_capable_data_quality:
                status="SECONDARY"
                blocks.append("data_quality_blocks_core")
            if dispersion > self.max_core_dispersion:
                status="SECONDARY"
                blocks.append("ensemble_dispersion_blocks_core")

        r["aegis_release_status"]=status
        r["governance_blocks"]=blocks
        return r

    def run(
        self,
        x: AEGISNFLGameInput,
        *,
        simulations: int = 10000,
        seed: int = 5701,
    ) -> Dict[str,object]:

        home,away,ctx,hp,ap,hs,aps,hper,aper = self._build_adjusted_profiles(x)

        sim=NFLDriveSimulator(home,away,ctx,seed=seed)
        distribution=sim.simulate(simulations)

        # Re-run same RNG seed for arrays to keep deterministic auditability.
        arr=NFLDriveSimulator(home,away,ctx,seed=seed+1).simulate_arrays(simulations)

        optimizer=NFLMarketExpressionOptimizer(
            config=self.optimizer_config,
            key_calibration=x.key_calibration,
        )
        market_rows=optimizer.evaluate(
            arr,
            x.offers,
            market_home_spread=x.context.home_spread,
            model_uncertainty=ctx.uncertainty_mult,
            market_challenger_probs=x.market_challenger_probs,
        )

        dq=x.data_quality.score()
        disp=x.ensemble.dispersion()
        governed=[
            self._govern_release(r,data_quality=dq,dispersion=disp)
            for r in market_rows
        ]
        governed.sort(key=lambda r:r["adjusted_selection_score"],reverse=True)

        eligible=[r for r in governed if r["aegis_release_status"]!="PASS"]
        primary=eligible[0] if eligible else None

        # One thesis = one expression.
        blocked_duplicates=[r["name"] for r in eligible[1:]]

        standardized={
            "schema_version":"AEGIS_STANDARD_GAME_OUTPUT_v1",
            "sport":"NFL",
            "engine_version":"NFL_v0.7",
            "game":{
                "home":x.home_base.name,
                "away":x.away_base.name,
                "mode":x.context.mode,
            },
            "projection":{
                "mean_home":distribution["score_distribution"]["mean_home"],
                "mean_away":distribution["score_distribution"]["mean_away"],
                "median_home":distribution["score_distribution"]["median_home"],
                "median_away":distribution["score_distribution"]["median_away"],
                "mean_total":distribution["score_distribution"]["mean_total"],
                "mean_home_margin":distribution["score_distribution"]["mean_margin_home"],
                "home_ml":distribution["market_probabilities"]["home_ml"],
                "away_ml":distribution["market_probabilities"]["away_ml"],
                "first_quarter":distribution["first_quarter_distribution"],
                "first_half":distribution["first_half_distribution"],
            },
            "quality":{
                "data_quality_score":dq,
                "data_quality_grade":x.data_quality.grade(),
                "ensemble_mean_margin":x.ensemble.mean(),
                "ensemble_dispersion":disp,
                "ensemble_agreement":x.ensemble.agreement_grade(),
                "simulation_uncertainty_multiplier":ctx.uncertainty_mult,
            },
            "matchup":{
                "pressure":{
                    "home_offense":pressure_matchup_audit(hp),
                    "away_offense":pressure_matchup_audit(ap),
                },
                "pace_coaching":{
                    "home":coaching_policy_audit(x.home_pace,x.home_coach,hs),
                    "away":coaching_policy_audit(x.away_pace,x.away_coach,aps),
                },
                "period":{
                    "home":period_audit(x.home_period,hper),
                    "away":period_audit(x.away_period,aper),
                },
            },
            "market_expressions":governed,
            "decision":{
                "primary":primary,
                "blocked_same_thesis_expressions":blocked_duplicates,
                "release_status":primary["aegis_release_status"] if primary else "PASS",
                "bet_now_wait_pass":"BET_NOW" if primary else "PASS",
            },
            "governance":{
                "one_thesis_one_expression":True,
                "core_cap_applies_downstream":True,
                "top3_scarcity_applies_downstream":True,
                "parlay_firewall_applies_downstream":True,
                "global_exposure_ledger_applies_downstream":True,
            },
        }
        return standardized
