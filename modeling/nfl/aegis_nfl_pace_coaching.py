
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Dict, List, Optional, Tuple
import math
import numpy as np

from aegis_nfl_drive_simulator import NFLTeamProfile


def _clip(x: float, lo: float, hi: float) -> float:
    return float(np.clip(x, lo, hi))


def _logit(p: float) -> float:
    p = _clip(p, 0.001, 0.999)
    return math.log(p / (1.0 - p))


def _inv_logit(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


@dataclass
class NFLPROEPaceProfile:
    team: str

    # Neutral-situation passing identity
    neutral_pass_rate: float = 0.58
    expected_neutral_pass_rate: float = 0.58
    proe: float = 0.00

    # Pace
    neutral_seconds_per_play: float = 28.0
    trailing_seconds_per_play: float = 24.8
    leading_seconds_per_play: float = 31.0
    two_minute_seconds_per_play: float = 20.5

    # State-dependent pass rates
    trailing_pass_rate: float = 0.68
    leading_pass_rate: float = 0.49
    two_minute_pass_rate: float = 0.74

    # Efficiency by state
    neutral_epa_per_play: float = 0.02
    trailing_epa_per_play: float = 0.00
    leading_epa_per_play: float = 0.01
    two_minute_epa_per_play: float = 0.05

    # Reliability
    neutral_plays: int = 0
    state_plays: int = 0
    data_quality: float = 0.80

    def validate(self) -> None:
        for f in [
            "neutral_pass_rate","expected_neutral_pass_rate",
            "trailing_pass_rate","leading_pass_rate","two_minute_pass_rate",
            "data_quality"
        ]:
            x = getattr(self, f)
            if not 0 <= x <= 1:
                raise ValueError(f"{f} must be in [0,1]")
        for f in [
            "neutral_seconds_per_play","trailing_seconds_per_play",
            "leading_seconds_per_play","two_minute_seconds_per_play"
        ]:
            if getattr(self, f) <= 0:
                raise ValueError(f"{f} must be positive")


@dataclass
class NFLCoachingDecisionProfile:
    team: str

    # Fourth-down behavior
    fourth_down_aggressiveness: float = 1.00
    fourth_down_go_rate_neutral: float = 0.19
    fourth_down_go_rate_short: float = 0.62
    fourth_down_go_rate_midfield: float = 0.30

    # Field-goal / red-zone behavior
    fg_preference: float = 1.00
    red_zone_fourth_down_aggressiveness: float = 1.00
    two_point_aggressiveness: float = 1.00

    # End-half / clock
    end_half_aggressiveness: float = 1.00
    timeout_aggressiveness: float = 1.00
    late_game_backdoor_aggressiveness: float = 1.00
    victory_formation_clock_bleed: float = 1.00

    # Script / sequencing
    opening_script_aggressiveness: float = 1.00
    early_down_pass_aggressiveness: float = 1.00

    # Reliability
    games_sample: int = 0
    data_quality: float = 0.80

    def validate(self) -> None:
        rate_fields = [
            "fourth_down_go_rate_neutral",
            "fourth_down_go_rate_short",
            "fourth_down_go_rate_midfield",
            "data_quality"
        ]
        for f in rate_fields:
            x = getattr(self, f)
            if not 0 <= x <= 1:
                raise ValueError(f"{f} must be in [0,1]")
        mult_fields = [
            "fourth_down_aggressiveness","fg_preference",
            "red_zone_fourth_down_aggressiveness","two_point_aggressiveness",
            "end_half_aggressiveness","timeout_aggressiveness",
            "late_game_backdoor_aggressiveness","victory_formation_clock_bleed",
            "opening_script_aggressiveness","early_down_pass_aggressiveness"
        ]
        for f in mult_fields:
            if getattr(self, f) <= 0:
                raise ValueError(f"{f} must be positive")


@dataclass
class GameStateProjection:
    team: str

    projected_neutral_pass_rate: float
    projected_proe: float
    projected_expected_drives: float

    neutral_tempo_mult: float
    trailing_tempo_mult: float
    leading_tempo_mult: float
    two_minute_tempo_mult: float

    neutral_efficiency_mult: float
    trailing_efficiency_mult: float
    leading_efficiency_mult: float
    two_minute_efficiency_mult: float

    fourth_down_aggressiveness: float
    end_half_aggressiveness: float
    late_game_backdoor_aggressiveness: float
    opening_script_efficiency_mult: float

    total_environment_mult: float
    variance_mult: float
    uncertainty_multiplier: float
    notes: Tuple[str, ...]


def project_game_state_profile(
    pace: NFLPROEPaceProfile,
    coaching: NFLCoachingDecisionProfile,
    *,
    opponent_expected_drives: float = 10.8,
    league_neutral_pass_rate: float = 0.58,
    league_seconds_per_play: float = 28.0,
) -> GameStateProjection:
    pace.validate()
    coaching.validate()

    # Recompute PROE from rates when the provided value is inconsistent.
    rate_proe = pace.neutral_pass_rate - pace.expected_neutral_pass_rate
    proe = 0.65 * pace.proe + 0.35 * rate_proe

    pass_rate = _clip(
        pace.expected_neutral_pass_rate
        + proe
        + 0.010 * (coaching.early_down_pass_aggressiveness - 1.0),
        0.42, 0.72
    )

    # Tempo multipliers are duration multipliers:
    # <1 faster, >1 slower.
    neutral_tempo = _clip(pace.neutral_seconds_per_play / league_seconds_per_play, 0.82, 1.18)
    trailing_tempo = _clip(pace.trailing_seconds_per_play / league_seconds_per_play, 0.76, 1.12)
    leading_tempo = _clip(
        (pace.leading_seconds_per_play / league_seconds_per_play)
        * coaching.victory_formation_clock_bleed,
        0.92, 1.28
    )
    two_min_tempo = _clip(pace.two_minute_seconds_per_play / league_seconds_per_play, 0.62, 0.98)

    # Translate EPA/state identity into bounded scoring multipliers.
    neutral_eff = _clip(math.exp(0.65 * (pace.neutral_epa_per_play - 0.01)), 0.90, 1.12)
    trailing_eff = _clip(math.exp(0.55 * (pace.trailing_epa_per_play - 0.00)), 0.90, 1.12)
    leading_eff = _clip(math.exp(0.45 * (pace.leading_epa_per_play - 0.00)), 0.91, 1.10)
    two_min_eff = _clip(
        math.exp(0.60 * (pace.two_minute_epa_per_play - 0.02))
        * coaching.end_half_aggressiveness,
        0.90, 1.18
    )

    # Pass-heavier neutral offenses tend to add variance/explosiveness.
    pass_delta = pass_rate - league_neutral_pass_rate
    variance_mult = _clip(1.0 + 0.45 * abs(pass_delta) + 0.25 * max(0.0, proe), 1.0, 1.12)

    # Project expected drives from pace, with opponent blending.
    pace_drives = 10.8 * (league_seconds_per_play / pace.neutral_seconds_per_play)
    expected_drives = _clip(
        0.62 * pace_drives + 0.38 * opponent_expected_drives,
        8.8, 13.2
    )

    # Total environment: fast + pass-heavy + aggressive decision-making can raise total variance/mean.
    total_env = _clip(
        (league_seconds_per_play / pace.neutral_seconds_per_play) ** 0.35
        * math.exp(0.30 * max(-0.08, min(0.08, proe)))
        * (coaching.fourth_down_aggressiveness ** 0.05)
        * (coaching.end_half_aggressiveness ** 0.04),
        0.92, 1.10
    )

    notes: List[str] = []
    if proe >= 0.04:
        notes.append("pass_heavy_over_expectation")
    elif proe <= -0.04:
        notes.append("run_heavy_under_expectation")
    if pace.neutral_seconds_per_play <= 25.5:
        notes.append("fast_neutral_pace")
    if pace.neutral_seconds_per_play >= 30.5:
        notes.append("slow_neutral_pace")
    if coaching.fourth_down_aggressiveness >= 1.15:
        notes.append("aggressive_fourth_down_coach")
    if coaching.end_half_aggressiveness >= 1.10:
        notes.append("aggressive_end_half")
    if coaching.victory_formation_clock_bleed >= 1.08:
        notes.append("lead_clock_bleed_risk")

    sample_support = min(1.0, pace.neutral_plays / 300.0) if pace.neutral_plays else 0.0
    coach_support = min(1.0, coaching.games_sample / 12.0) if coaching.games_sample else 0.0
    reliability = (
        0.45 * pace.data_quality
        + 0.35 * coaching.data_quality
        + 0.12 * sample_support
        + 0.08 * coach_support
    )
    uncertainty = _clip(1.0 + 0.18 * (1.0 - reliability), 1.0, 1.18)

    return GameStateProjection(
        team=pace.team,
        projected_neutral_pass_rate=pass_rate,
        projected_proe=proe,
        projected_expected_drives=expected_drives,
        neutral_tempo_mult=neutral_tempo,
        trailing_tempo_mult=trailing_tempo,
        leading_tempo_mult=leading_tempo,
        two_minute_tempo_mult=two_min_tempo,
        neutral_efficiency_mult=neutral_eff,
        trailing_efficiency_mult=trailing_eff,
        leading_efficiency_mult=leading_eff,
        two_minute_efficiency_mult=two_min_eff,
        fourth_down_aggressiveness=coaching.fourth_down_aggressiveness,
        end_half_aggressiveness=coaching.end_half_aggressiveness,
        late_game_backdoor_aggressiveness=coaching.late_game_backdoor_aggressiveness,
        opening_script_efficiency_mult=_clip(
            1.0 + 0.06 * (coaching.opening_script_aggressiveness - 1.0),
            0.94, 1.08
        ),
        total_environment_mult=total_env,
        variance_mult=variance_mult,
        uncertainty_multiplier=uncertainty,
        notes=tuple(notes),
    )


def apply_game_state_projection(
    profile: NFLTeamProfile,
    projection: GameStateProjection,
) -> NFLTeamProfile:
    """
    Convert pace/coaching projection into drive-simulator inputs.
    """
    base_so = profile.scoring_opportunity_prob
    so = _clip(
        base_so * projection.neutral_efficiency_mult * projection.total_environment_mult,
        0.12, 0.72
    )

    # Pass-heavier profiles carry more explosive and turnover variance.
    pass_delta = projection.projected_neutral_pass_rate - 0.58
    explosive_mult = _clip(1.0 + 1.6 * max(0.0, pass_delta), 0.90, 1.18)
    turnover_mult = _clip(1.0 + 0.9 * max(0.0, pass_delta), 0.94, 1.12)

    return replace(
        profile,
        expected_drives=projection.projected_expected_drives,
        neutral_pass_rate=projection.projected_neutral_pass_rate,
        pass_rate_over_expected=projection.projected_proe,
        scoring_opportunity_prob=so,
        explosive_td_prob_per_drive=_clip(
            profile.explosive_td_prob_per_drive * explosive_mult,
            0.006, 0.10
        ),
        turnover_prob_per_drive=_clip(
            profile.turnover_prob_per_drive * turnover_mult,
            0.04, 0.20
        ),
        trailing_tempo_mult=projection.trailing_tempo_mult,
        leading_tempo_mult=projection.leading_tempo_mult,
        two_minute_tempo_mult=projection.two_minute_tempo_mult,
        two_minute_efficiency_mult=projection.two_minute_efficiency_mult,
        fourth_down_aggressiveness=projection.fourth_down_aggressiveness,
        end_half_aggressiveness=projection.end_half_aggressiveness,
        late_game_backdoor_aggressiveness=projection.late_game_backdoor_aggressiveness,
        opening_script_efficiency_mult=projection.opening_script_efficiency_mult,
    )


def fourth_down_go_probability(
    coaching: NFLCoachingDecisionProfile,
    *,
    yardline_100: float,
    ydstogo: float,
    score_diff: int,
    seconds_remaining: int,
) -> float:
    """
    Transparent fourth-down decision approximation.

    Higher output = more likely to go for it.
    This is an architectural policy model, not yet historically fitted.
    """
    coaching.validate()

    # Base from field position.
    if yardline_100 <= 10:
        base = 0.56
    elif yardline_100 <= 35:
        base = 0.38
    elif yardline_100 <= 55:
        base = coaching.fourth_down_go_rate_midfield
    else:
        base = 0.12

    # Distance.
    if ydstogo <= 1:
        base += 0.27
    elif ydstogo <= 3:
        base += 0.13
    elif ydstogo >= 8:
        base -= 0.15

    # Late-game urgency.
    if seconds_remaining <= 900:
        if score_diff <= -4:
            base += 0.18
        elif score_diff >= 10:
            base -= 0.10

    # End-half aggression.
    if 1800 < seconds_remaining <= 1920 or seconds_remaining <= 120:
        base += 0.08 * (coaching.end_half_aggressiveness - 1.0)

    base *= coaching.fourth_down_aggressiveness
    if yardline_100 <= 20:
        base *= coaching.red_zone_fourth_down_aggressiveness

    return _clip(base, 0.02, 0.94)


def coaching_policy_audit(
    pace: NFLPROEPaceProfile,
    coaching: NFLCoachingDecisionProfile,
    projection: GameStateProjection,
) -> Dict[str, object]:
    examples = {
        "4th_and_1_midfield": fourth_down_go_probability(
            coaching, yardline_100=50, ydstogo=1, score_diff=0, seconds_remaining=2400
        ),
        "4th_and_3_opponent_35": fourth_down_go_probability(
            coaching, yardline_100=35, ydstogo=3, score_diff=0, seconds_remaining=2400
        ),
        "4th_and_4_trailing_late": fourth_down_go_probability(
            coaching, yardline_100=45, ydstogo=4, score_diff=-7, seconds_remaining=420
        ),
    }
    return {
        "team": pace.team,
        "projected_neutral_pass_rate": round(projection.projected_neutral_pass_rate, 3),
        "projected_proe": round(projection.projected_proe, 3),
        "projected_expected_drives": round(projection.projected_expected_drives, 2),
        "tempo": {
            "neutral": round(projection.neutral_tempo_mult, 3),
            "trailing": round(projection.trailing_tempo_mult, 3),
            "leading": round(projection.leading_tempo_mult, 3),
            "two_minute": round(projection.two_minute_tempo_mult, 3),
        },
        "fourth_down_example_probabilities": {
            k: round(v, 3) for k,v in examples.items()
        },
        "total_environment_mult": round(projection.total_environment_mult, 3),
        "variance_mult": round(projection.variance_mult, 3),
        "uncertainty_multiplier": round(projection.uncertainty_multiplier, 3),
        "notes": list(projection.notes),
    }
