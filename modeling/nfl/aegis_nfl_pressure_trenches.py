
from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from typing import Dict, Optional, Tuple
import math
import numpy as np
import pandas as pd

from aegis_nfl_drive_simulator import NFLTeamProfile


LEAGUE_BASELINE_PRESSURE = 0.33
LEAGUE_BASELINE_PRESSURE_TO_SACK = 0.20
LEAGUE_BASELINE_EXPLOSIVE_PASS = 0.105
LEAGUE_BASELINE_TURNOVER_PER_DROPBACK = 0.025


def _clip(x: float, lo: float, hi: float) -> float:
    return float(np.clip(x, lo, hi))


def _logit(p: float) -> float:
    p = _clip(p, 0.001, 0.999)
    return math.log(p / (1.0 - p))


def _inv_logit(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


@dataclass
class QBPressureProfile:
    team: str
    qb_name: str = "QB"

    # Split efficiency
    clean_epa_per_dropback: float = 0.18
    pressured_epa_per_dropback: float = -0.27
    clean_success_rate: float = 0.49
    pressured_success_rate: float = 0.31

    # Pressure response
    pressure_to_sack_rate: float = 0.20
    scramble_rate_under_pressure: float = 0.13
    turnover_rate_under_pressure: float = 0.050

    # Explosiveness
    clean_explosive_pass_rate: float = 0.125
    pressured_explosive_pass_rate: float = 0.060

    # Optional blitz response
    blitz_epa_per_dropback: Optional[float] = None
    non_blitz_epa_per_dropback: Optional[float] = None

    # Reliability / sample support
    dropbacks: int = 0
    pressured_dropbacks: int = 0
    data_quality: float = 0.80

    def validate(self):
        for x in [
            self.clean_success_rate,
            self.pressured_success_rate,
            self.pressure_to_sack_rate,
            self.scramble_rate_under_pressure,
            self.turnover_rate_under_pressure,
            self.clean_explosive_pass_rate,
            self.pressured_explosive_pass_rate,
            self.data_quality,
        ]:
            if not 0 <= x <= 1:
                raise ValueError("QB pressure probability/rate fields must be in [0,1]")


@dataclass
class TrenchProfile:
    team: str

    # Offense / protection
    pressure_rate_allowed: float = LEAGUE_BASELINE_PRESSURE
    sack_rate_allowed: float = 0.067
    qb_hit_rate_allowed: float = 0.105
    stuff_rate_allowed: float = 0.175
    early_down_rush_epa: float = -0.01
    short_yardage_success: float = 0.67
    ol_continuity: float = 0.75

    # Defense / front
    pressure_rate_generated: float = LEAGUE_BASELINE_PRESSURE
    pressure_to_sack_generated: float = LEAGUE_BASELINE_PRESSURE_TO_SACK
    qb_hit_rate_generated: float = 0.105
    stuff_rate_generated: float = 0.175
    early_down_rush_epa_allowed: float = -0.01
    short_yardage_success_allowed: float = 0.67
    front_continuity: float = 0.75

    # Availability / reliability
    ol_availability: float = 1.0
    front_availability: float = 1.0
    games_sample: int = 0
    data_quality: float = 0.80

    def validate(self):
        rate_fields = [
            "pressure_rate_allowed", "sack_rate_allowed", "qb_hit_rate_allowed",
            "stuff_rate_allowed", "short_yardage_success", "ol_continuity",
            "pressure_rate_generated", "pressure_to_sack_generated",
            "qb_hit_rate_generated", "stuff_rate_generated",
            "short_yardage_success_allowed", "front_continuity",
            "ol_availability", "front_availability", "data_quality"
        ]
        for f in rate_fields:
            x = getattr(self, f)
            if not 0 <= x <= 1:
                raise ValueError(f"{f} must be in [0,1]")


@dataclass
class PressureMatchupProjection:
    offense: str
    defense: str

    expected_pressure_rate: float
    expected_pressure_to_sack: float
    expected_sack_per_dropback: float

    qb_expected_epa_per_dropback: float
    qb_expected_success_rate: float
    expected_explosive_pass_rate: float
    expected_turnover_rate_under_pressure_component: float

    scoring_opportunity_multiplier: float
    explosive_td_multiplier: float
    turnover_drive_multiplier: float
    drive_duration_multiplier: float

    uncertainty_multiplier: float
    notes: Tuple[str, ...]


def expected_pressure_rate(
    offense: TrenchProfile,
    defense: TrenchProfile,
    *,
    league_baseline: float = LEAGUE_BASELINE_PRESSURE,
) -> float:
    """
    Logit-scale interaction between protection and rush.

    The coefficients are intentionally shrunk until walk-forward calibration.
    """
    offense.validate()
    defense.validate()

    off_delta = _logit(offense.pressure_rate_allowed) - _logit(league_baseline)
    def_delta = _logit(defense.pressure_rate_generated) - _logit(league_baseline)

    # Availability and continuity alter the matchup modestly.
    ol_health = 0.70 * offense.ol_availability + 0.30 * offense.ol_continuity
    front_health = 0.70 * defense.front_availability + 0.30 * defense.front_continuity

    availability_term = (
        0.55 * (1.0 - ol_health)
        - 0.40 * (1.0 - front_health)
    )

    logit_pressure = (
        _logit(league_baseline)
        + 0.58 * off_delta
        + 0.58 * def_delta
        + availability_term
    )
    return _clip(_inv_logit(logit_pressure), 0.18, 0.55)


def project_pressure_matchup(
    qb: QBPressureProfile,
    offense_trenches: TrenchProfile,
    defense_trenches: TrenchProfile,
) -> PressureMatchupProjection:
    qb.validate()
    offense_trenches.validate()
    defense_trenches.validate()

    p_pressure = expected_pressure_rate(offense_trenches, defense_trenches)

    qb_sack = qb.pressure_to_sack_rate
    def_sack = defense_trenches.pressure_to_sack_generated
    expected_p2s = _clip(
        0.58 * qb_sack + 0.42 * def_sack,
        0.08, 0.38
    )
    sack_per_dropback = p_pressure * expected_p2s

    exp_epa = (
        (1.0 - p_pressure) * qb.clean_epa_per_dropback
        + p_pressure * qb.pressured_epa_per_dropback
    )

    exp_success = (
        (1.0 - p_pressure) * qb.clean_success_rate
        + p_pressure * qb.pressured_success_rate
    )

    exp_explosive = (
        (1.0 - p_pressure) * qb.clean_explosive_pass_rate
        + p_pressure * qb.pressured_explosive_pass_rate
    )

    turnover_component = p_pressure * qb.turnover_rate_under_pressure

    # Translation into drive-simulator knobs.
    # These are deliberately bounded and conservative until historical fitting.
    epa_delta = exp_epa - 0.03
    sack_delta = sack_per_dropback - 0.067
    pressure_delta = p_pressure - LEAGUE_BASELINE_PRESSURE

    so_mult = _clip(
        math.exp(0.55 * epa_delta - 0.70 * sack_delta),
        0.84, 1.18
    )

    explosive_mult = _clip(
        exp_explosive / LEAGUE_BASELINE_EXPLOSIVE_PASS,
        0.72, 1.28
    )

    turnover_mult = _clip(
        1.0
        + 4.0 * max(0.0, turnover_component - 0.015)
        + 1.6 * max(0.0, pressure_delta),
        0.82, 1.42
    )

    # Heavy pressure tends to shorten some drives via sacks/turnovers,
    # while low pressure allows longer sustained possessions.
    duration_mult = _clip(
        1.0 - 0.14 * pressure_delta,
        0.96, 1.04
    )

    notes = []
    if p_pressure >= 0.40:
        notes.append("high_projected_pressure")
    if expected_p2s >= 0.24:
        notes.append("elevated_pressure_to_sack")
    if qb.pressured_epa_per_dropback <= -0.35:
        notes.append("qb_pressure_efficiency_weakness")
    if qb.turnover_rate_under_pressure >= 0.06:
        notes.append("pressure_turnover_tail")
    if offense_trenches.ol_availability < 0.90:
        notes.append("ol_availability_risk")
    if defense_trenches.front_availability < 0.90:
        notes.append("pass_rush_availability_risk")

    # Reliability widening: low sample + low source quality.
    qb_sample_factor = min(1.0, qb.pressured_dropbacks / 120.0) if qb.pressured_dropbacks else 0.0
    trench_sample_factor = min(1.0, offense_trenches.games_sample / 8.0) if offense_trenches.games_sample else 0.0
    reliability = (
        0.42 * qb.data_quality
        + 0.28 * offense_trenches.data_quality
        + 0.20 * defense_trenches.data_quality
        + 0.10 * min(qb_sample_factor, trench_sample_factor)
    )
    uncertainty = _clip(1.0 + 0.22 * (1.0 - reliability), 1.0, 1.22)

    return PressureMatchupProjection(
        offense=offense_trenches.team,
        defense=defense_trenches.team,
        expected_pressure_rate=p_pressure,
        expected_pressure_to_sack=expected_p2s,
        expected_sack_per_dropback=sack_per_dropback,
        qb_expected_epa_per_dropback=exp_epa,
        qb_expected_success_rate=exp_success,
        expected_explosive_pass_rate=exp_explosive,
        expected_turnover_rate_under_pressure_component=turnover_component,
        scoring_opportunity_multiplier=so_mult,
        explosive_td_multiplier=explosive_mult,
        turnover_drive_multiplier=turnover_mult,
        drive_duration_multiplier=duration_mult,
        uncertainty_multiplier=uncertainty,
        notes=tuple(notes),
    )


def apply_pressure_projection(
    profile: NFLTeamProfile,
    projection: PressureMatchupProjection,
) -> NFLTeamProfile:
    """
    Apply the matchup projection to the offense's drive-level simulator profile.

    This keeps the pressure model modular: it does not replace the simulator,
    it changes the simulator inputs using a transparent matchup layer.
    """
    return replace(
        profile,
        scoring_opportunity_prob=_clip(
            profile.scoring_opportunity_prob * projection.scoring_opportunity_multiplier,
            0.12, 0.72
        ),
        explosive_td_prob_per_drive=_clip(
            profile.explosive_td_prob_per_drive * projection.explosive_td_multiplier,
            0.006, 0.10
        ),
        turnover_prob_per_drive=_clip(
            profile.turnover_prob_per_drive * projection.turnover_drive_multiplier,
            0.04, 0.20
        ),
        seconds_per_play=_clip(
            profile.seconds_per_play * projection.drive_duration_multiplier,
            20.0, 36.0
        ),
    )


def pressure_matchup_audit(projection: PressureMatchupProjection) -> Dict[str, object]:
    return {
        "offense": projection.offense,
        "defense": projection.defense,
        "projected_pressure_pct": round(100 * projection.expected_pressure_rate, 1),
        "projected_sack_per_dropback_pct": round(100 * projection.expected_sack_per_dropback, 1),
        "projected_qb_epa_per_dropback": round(projection.qb_expected_epa_per_dropback, 3),
        "projected_success_pct": round(100 * projection.qb_expected_success_rate, 1),
        "projected_explosive_pass_pct": round(100 * projection.expected_explosive_pass_rate, 1),
        "scoring_opportunity_multiplier": round(projection.scoring_opportunity_multiplier, 3),
        "turnover_drive_multiplier": round(projection.turnover_drive_multiplier, 3),
        "uncertainty_multiplier": round(projection.uncertainty_multiplier, 3),
        "notes": list(projection.notes),
    }
