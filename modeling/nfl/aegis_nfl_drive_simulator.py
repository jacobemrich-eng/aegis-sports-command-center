
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Tuple
import math
import numpy as np


NFL_KEY_NUMBERS = (3, 6, 7, 10, 14, 17, 20, 21)


@dataclass
class AvailabilityDistribution:
    """
    Probabilistic player/unit availability.

    p_full + p_limited must be <= 1.0.
    Any remaining probability is treated as replacement-level availability.

    multiplier meanings:
      1.00 = baseline expectation
      <1.00 = unit is less effective than baseline
    """
    p_full: float = 1.0
    p_limited: float = 0.0
    limited_mult: float = 0.92
    replacement_mult: float = 0.78

    def validate(self) -> None:
        if not (0 <= self.p_full <= 1):
            raise ValueError("p_full must be in [0,1]")
        if not (0 <= self.p_limited <= 1):
            raise ValueError("p_limited must be in [0,1]")
        if self.p_full + self.p_limited > 1.000001:
            raise ValueError("p_full + p_limited cannot exceed 1")
        if self.limited_mult <= 0 or self.replacement_mult <= 0:
            raise ValueError("availability multipliers must be positive")

    def sample(self, rng: np.random.Generator) -> float:
        self.validate()
        u = rng.random()
        if u < self.p_full:
            return 1.0
        if u < self.p_full + self.p_limited:
            return self.limited_mult
        return self.replacement_mult


@dataclass
class NFLTeamProfile:
    name: str

    # Neutral-situation drive / pace profile
    expected_drives: float = 10.8
    plays_per_drive: float = 6.1
    seconds_per_play: float = 28.0
    neutral_pass_rate: float = 0.58
    pass_rate_over_expected: float = 0.0

    # Offensive drive-outcome priors
    scoring_opportunity_prob: float = 0.41
    td_given_scoring_opportunity: float = 0.55
    fg_attempt_given_non_td_so: float = 0.76
    explosive_td_prob_per_drive: float = 0.032
    turnover_prob_per_drive: float = 0.105
    defensive_td_allowed_on_turnover: float = 0.105
    safety_allowed_prob_per_drive: float = 0.0020

    # Special teams / field position
    avg_start_yardline: float = 29.0
    start_yardline_sd: float = 7.0
    kickoff_return_short_field_prob: float = 0.010

    # Kicking model
    fg_make_u40: float = 0.94
    fg_make_40_49: float = 0.84
    fg_make_50_59: float = 0.66
    fg_make_60_plus: float = 0.22
    xp_make_prob: float = 0.945
    two_point_attempt_rate_neutral: float = 0.018
    two_point_make_prob: float = 0.49

    # First-half / scripted-start parameters.
    # These are independent model hooks and should later be calibrated separately.
    first_half_efficiency_mult: float = 1.00
    first_half_tempo_mult: float = 1.00
    opening_script_efficiency_mult: float = 1.00

    # Game-state tempo elasticity
    trailing_tempo_mult: float = 0.86
    leading_tempo_mult: float = 1.15
    two_minute_tempo_mult: float = 0.78
    two_minute_efficiency_mult: float = 1.06

    # Coaching / decision layer
    fourth_down_aggressiveness: float = 1.00
    end_half_aggressiveness: float = 1.00
    late_game_backdoor_aggressiveness: float = 1.00

    # Preseason rotation support.
    # Regular season usually remains all 1.00.
    quarter_efficiency_mult: Tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0)
    quarter_tempo_mult: Tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0)

    # Player/unit availability distributions
    qb_availability: AvailabilityDistribution = field(default_factory=AvailabilityDistribution)
    ol_availability: AvailabilityDistribution = field(default_factory=AvailabilityDistribution)
    skill_availability: AvailabilityDistribution = field(default_factory=AvailabilityDistribution)
    defensive_front_availability: AvailabilityDistribution = field(default_factory=AvailabilityDistribution)
    secondary_availability: AvailabilityDistribution = field(default_factory=AvailabilityDistribution)
    kicker_availability: AvailabilityDistribution = field(default_factory=AvailabilityDistribution)

    # Overtime prior
    overtime_strength: float = 0.50

    def validate(self) -> None:
        for x in [
            self.scoring_opportunity_prob,
            self.td_given_scoring_opportunity,
            self.fg_attempt_given_non_td_so,
            self.explosive_td_prob_per_drive,
            self.turnover_prob_per_drive,
            self.defensive_td_allowed_on_turnover,
            self.safety_allowed_prob_per_drive,
            self.kickoff_return_short_field_prob,
            self.fg_make_u40,
            self.fg_make_40_49,
            self.fg_make_50_59,
            self.fg_make_60_plus,
            self.xp_make_prob,
            self.two_point_attempt_rate_neutral,
            self.two_point_make_prob,
            self.overtime_strength,
        ]:
            if not (0 <= x <= 1):
                raise ValueError(f"{self.name}: probability fields must be in [0,1]")

        if self.expected_drives <= 0 or self.plays_per_drive <= 0 or self.seconds_per_play <= 0:
            raise ValueError(f"{self.name}: drive/pace inputs must be positive")

        if len(self.quarter_efficiency_mult) != 4 or len(self.quarter_tempo_mult) != 4:
            raise ValueError("quarter multipliers must contain exactly four values")

        for d in [
            self.qb_availability, self.ol_availability, self.skill_availability,
            self.defensive_front_availability, self.secondary_availability,
            self.kicker_availability
        ]:
            d.validate()


@dataclass
class NFLGameContext:
    mode: str = "regular"  # regular | preseason

    # Market lines from HOME perspective.
    # home_spread=-3 means home -3.
    home_spread: Optional[float] = None
    total_line: Optional[float] = None
    home_tt_line: Optional[float] = None
    away_tt_line: Optional[float] = None

    # Environment
    weather_scoring_mult: float = 1.00
    weather_explosive_mult: float = 1.00
    field_goal_mult: float = 1.00
    wind_mph: float = 0.0
    precipitation_mult: float = 1.00
    surface_efficiency_mult: float = 1.00

    # Stadium / HFA
    home_scoring_opportunity_boost: float = 0.010

    # Baseline uncertainty, before sampled availability
    uncertainty_mult: float = 1.00

    # Possession-count matchup shifts
    drive_count_shift_home: float = 0.0
    drive_count_shift_away: float = 0.0

    # Late-game settings
    garbage_time_margin: int = 17
    garbage_time_start_seconds: int = 480
    backdoor_window_seconds: int = 300

    def validate(self) -> None:
        if self.mode not in {"regular", "preseason"}:
            raise ValueError("mode must be 'regular' or 'preseason'")
        if self.uncertainty_mult < 1:
            raise ValueError("uncertainty_mult must be >= 1")


@dataclass
class MarketOffer:
    """
    market_type:
      home_ml, away_ml,
      home_spread, away_spread,
      over, under,
      home_tt_over, home_tt_under,
      away_tt_over, away_tt_under
    """
    name: str
    market_type: str
    odds: int
    line: Optional[float] = None


def american_profit_per_unit(odds: int) -> float:
    if odds > 0:
        return odds / 100.0
    return 100.0 / abs(odds)


def expected_value(win_prob: float, lose_prob: float, odds: int) -> float:
    return win_prob * american_profit_per_unit(odds) - lose_prob


def implied_probability(odds: int) -> float:
    if odds > 0:
        return 100.0 / (100.0 + odds)
    return abs(odds) / (100.0 + abs(odds))


class NFLDriveSimulator:
    """
    SB101 AEGIS NFL Drive-Level Distribution Simulator v0.1

    Architecture goals:
    - Possession-by-possession scoring distribution.
    - Regular-season and preseason modes.
    - Probabilistic QB/unit availability.
    - NFL key-number and margin-clustering outputs.
    - Game-state tempo, two-minute behavior and late backdoor tracking.
    - Field-goal distance model.
    - Market probability / price comparison hooks.

    This is an ENGINE. It still requires calibrated upstream NFL inputs.
    """

    def __init__(
        self,
        home: NFLTeamProfile,
        away: NFLTeamProfile,
        context: Optional[NFLGameContext] = None,
        seed: Optional[int] = None,
    ):
        home.validate()
        away.validate()
        self.home = home
        self.away = away
        self.context = context or NFLGameContext()
        self.context.validate()
        self.rng = np.random.default_rng(seed)

    @staticmethod
    def _clip_prob(x: float, lo: float = 0.001, hi: float = 0.995) -> float:
        return float(np.clip(x, lo, hi))

    @staticmethod
    def _quarter(clock: float) -> int:
        # regulation clock counts down from 3600 to 0
        if clock > 2700:
            return 1
        if clock > 1800:
            return 2
        if clock > 900:
            return 3
        return 4

    @staticmethod
    def _two_minute(clock: float) -> bool:
        # Last 2 minutes of either half.
        return (1800 < clock <= 1920) or (0 < clock <= 120)

    def _sample_availability(self, team: NFLTeamProfile) -> Dict[str, float]:
        qb = team.qb_availability.sample(self.rng)
        ol = team.ol_availability.sample(self.rng)
        skill = team.skill_availability.sample(self.rng)
        front = team.defensive_front_availability.sample(self.rng)
        secondary = team.secondary_availability.sample(self.rng)
        kicker = team.kicker_availability.sample(self.rng)

        # v0.1 architectural blend; to be historically calibrated later.
        offense = 0.46 * qb + 0.25 * ol + 0.20 * skill + 0.09
        defense = 0.56 * front + 0.44 * secondary

        return {
            "qb": qb,
            "ol": ol,
            "skill": skill,
            "front": front,
            "secondary": secondary,
            "kicker": kicker,
            "offense_mult": float(np.clip(offense, 0.60, 1.03)),
            "defense_mult": float(np.clip(defense, 0.65, 1.03)),
        }

    def _drive_duration(
        self,
        team: NFLTeamProfile,
        *,
        score_diff: int,
        clock: float,
        quarter: int,
        is_garbage: bool,
        drive_shift: float,
        game_pace_shock: float,
    ) -> float:
        expected = max(7.5, team.expected_drives + drive_shift)
        base = 3600.0 / (2.0 * expected)

        structural = (
            (team.seconds_per_play / 28.0) ** 0.42
            * (team.plays_per_drive / 6.1) ** 0.18
        )

        mult = structural * game_pace_shock * team.quarter_tempo_mult[quarter - 1]

        if clock > 1800:
            mult *= team.first_half_tempo_mult

        if score_diff <= -8:
            mult *= team.trailing_tempo_mult
        elif score_diff >= 8:
            mult *= team.leading_tempo_mult

        if self._two_minute(clock):
            mult *= team.two_minute_tempo_mult

        if is_garbage:
            # Leading team drains clock more; trailing team remains aggressive.
            if score_diff > 0:
                mult *= 1.10
            else:
                mult *= 0.92

        if self.context.mode == "preseason":
            # Preseason rotations add pace variance.
            mult *= float(self.rng.lognormal(0.0, 0.035))

        mean = max(50.0, base * mult)
        shape = 8.0
        duration = self.rng.gamma(shape, mean / shape)
        return float(np.clip(duration, 35.0, 420.0))

    def _start_yardline(self, team: NFLTeamProfile, short_field_bonus: float = 0.0) -> float:
        y = self.rng.normal(team.avg_start_yardline + short_field_bonus, team.start_yardline_sd)
        if self.rng.random() < team.kickoff_return_short_field_prob:
            y += self.rng.uniform(8, 22)
        return float(np.clip(y, 5.0, 70.0))

    def _fg_make_probability(
        self,
        team: NFLTeamProfile,
        distance: float,
        kicker_mult: float,
    ) -> float:
        if distance < 40:
            p = team.fg_make_u40
        elif distance < 50:
            p = team.fg_make_40_49
        elif distance < 60:
            p = team.fg_make_50_59
        else:
            p = team.fg_make_60_plus

        # Wind effect is intentionally nonlinear and stronger on long attempts.
        wind = max(0.0, self.context.wind_mph)
        if wind > 8:
            distance_factor = max(0.35, (distance - 30) / 30)
            p *= max(0.55, 1.0 - 0.009 * (wind - 8) * distance_factor)

        p *= self.context.field_goal_mult
        p *= kicker_mult
        return self._clip_prob(p, 0.02, 0.99)

    def _touchdown_points(
        self,
        team: NFLTeamProfile,
        *,
        score_diff_after_td: int,
        clock: float,
        kicker_mult: float,
    ) -> int:
        # Approximate situational 2-point logic.
        go_for_two = False
        if clock <= 900:
            # Common chase states where 2-point attempts become more likely.
            mod = abs(score_diff_after_td) % 8
            if mod in {1, 2, 5}:
                go_for_two = self.rng.random() < 0.45
        if not go_for_two:
            go_for_two = self.rng.random() < team.two_point_attempt_rate_neutral

        if go_for_two:
            return 8 if self.rng.random() < team.two_point_make_prob else 6

        xp_prob = self._clip_prob(team.xp_make_prob * kicker_mult, 0.70, 0.995)
        return 7 if self.rng.random() < xp_prob else 6

    def _simulate_drive(
        self,
        offense: NFLTeamProfile,
        defense: NFLTeamProfile,
        offense_avail: Dict[str, float],
        defense_avail: Dict[str, float],
        *,
        is_home: bool,
        start_yardline: float,
        score_diff: int,
        clock: float,
        quarter: int,
        garbage: bool,
    ) -> Dict[str, object]:
        ctx = self.context

        off_mult = offense_avail["offense_mult"]
        def_mult = defense_avail["defense_mult"]

        eff = off_mult
        # Stronger opponent defense suppresses offense.
        eff *= float(np.clip(2.0 - def_mult, 0.86, 1.30))

        if clock > 1800:
            eff *= offense.first_half_efficiency_mult
        if quarter == 1:
            eff *= offense.opening_script_efficiency_mult
        eff *= offense.quarter_efficiency_mult[quarter - 1]

        if self._two_minute(clock):
            eff *= offense.two_minute_efficiency_mult * offense.end_half_aggressiveness

        if garbage:
            if score_diff < 0:
                eff *= min(1.12, offense.late_game_backdoor_aggressiveness)
            else:
                eff *= 0.94

        eff *= ctx.weather_scoring_mult
        eff *= ctx.precipitation_mult
        eff *= ctx.surface_efficiency_mult

        field_pos_adj = 0.0040 * (start_yardline - 25.0)
        so_prob = offense.scoring_opportunity_prob * eff + field_pos_adj
        if is_home:
            so_prob += ctx.home_scoring_opportunity_boost
        so_prob = self._clip_prob(so_prob, 0.08, 0.80)

        turnover_prob = offense.turnover_prob_per_drive
        # Availability/protection problems increase turnover tail.
        protection_penalty = max(0.0, 1.0 - offense_avail["qb"]) + max(0.0, 1.0 - offense_avail["ol"])
        turnover_prob *= 1.0 + 0.45 * protection_penalty
        turnover_prob *= ctx.uncertainty_mult
        turnover_prob = self._clip_prob(turnover_prob, 0.025, 0.24)

        explosive_prob = offense.explosive_td_prob_per_drive
        explosive_prob *= max(0.70, offense_avail["qb"] * 0.55 + offense_avail["skill"] * 0.45)
        explosive_prob *= ctx.weather_explosive_mult
        explosive_prob *= ctx.uncertainty_mult
        explosive_prob = self._clip_prob(explosive_prob, 0.004, 0.12)

        # Safety tail first.
        if self.rng.random() < offense.safety_allowed_prob_per_drive * ctx.uncertainty_mult:
            return {
                "offense_points": 0,
                "defense_points": 2,
                "turnover": False,
                "short_field_bonus": 0.0,
                "event": "safety",
            }

        # Turnover branch.
        if self.rng.random() < turnover_prob:
            defensive_td = (
                self.rng.random()
                < offense.defensive_td_allowed_on_turnover
                * ctx.uncertainty_mult
                * max(0.80, defense_avail["secondary"])
            )
            return {
                "offense_points": 0,
                "defense_points": 7 if defensive_td else 0,
                "turnover": True,
                "short_field_bonus": 0.0 if defensive_td else float(self.rng.uniform(5.0, 19.0)),
                "event": "def_td" if defensive_td else "turnover",
            }

        # Explosive TD branch.
        if self.rng.random() < explosive_prob:
            pts = self._touchdown_points(
                offense,
                score_diff_after_td=score_diff + 6,
                clock=clock,
                kicker_mult=offense_avail["kicker"],
            )
            return {
                "offense_points": pts,
                "defense_points": 0,
                "turnover": False,
                "short_field_bonus": 0.0,
                "event": "explosive_td",
            }

        if self.rng.random() < so_prob:
            td_prob = offense.td_given_scoring_opportunity
            td_prob *= float(np.clip(0.90 + 0.10 * off_mult, 0.82, 1.04))
            td_prob = self._clip_prob(td_prob, 0.30, 0.82)

            if self.rng.random() < td_prob:
                pts = self._touchdown_points(
                    offense,
                    score_diff_after_td=score_diff + 6,
                    clock=clock,
                    kicker_mult=offense_avail["kicker"],
                )
                return {
                    "offense_points": pts,
                    "defense_points": 0,
                    "turnover": False,
                    "short_field_bonus": 0.0,
                    "event": "td",
                }

            # Approximate end of non-TD scoring opportunity:
            # opponent 40 to opponent 8 -> FG distances ~25-57 yards.
            yards_to_goal = float(np.clip(self.rng.normal(25.0, 10.5), 8.0, 43.0))
            fg_distance = yards_to_goal + 17.0

            go_prob = offense.fg_attempt_given_non_td_so
            # Fourth-down aggressiveness reduces FG attempts at shorter distances.
            if fg_distance <= 48:
                go_prob /= max(0.65, offense.fourth_down_aggressiveness)
            go_prob = self._clip_prob(go_prob, 0.25, 0.97)

            if self.rng.random() < go_prob:
                make = self.rng.random() < self._fg_make_probability(
                    offense, fg_distance, offense_avail["kicker"]
                )
                return {
                    "offense_points": 3 if make else 0,
                    "defense_points": 0,
                    "turnover": False,
                    "short_field_bonus": 0.0,
                    "event": "fg_make" if make else "fg_miss",
                    "fg_distance": fg_distance,
                }

            # Failed fourth down / stalled drive in scoring territory.
            return {
                "offense_points": 0,
                "defense_points": 0,
                "turnover": False,
                "short_field_bonus": 4.0,
                "event": "failed_fourth_or_stall",
            }

        return {
            "offense_points": 0,
            "defense_points": 0,
            "turnover": False,
            "short_field_bonus": 0.0,
            "event": "punt_or_stall",
        }

    def _resolve_overtime(self, h: int, a: int) -> Tuple[int, int, bool]:
        if h != a:
            return h, a, False

        # v0.1 simplified NFL OT resolution. Preserve a small tie tail in regular season.
        if self.context.mode == "regular" and self.rng.random() < 0.045:
            return h, a, True

        hs = max(0.01, self.home.overtime_strength)
        aws = max(0.01, self.away.overtime_strength)
        p_home = hs / (hs + aws)

        # OT scoring margin approximation.
        if self.rng.random() < p_home:
            return h + (6 if self.rng.random() < 0.45 else 3), a, False
        return h, a + (6 if self.rng.random() < 0.45 else 3), False

    def simulate_one(self) -> Dict[str, object]:
        hs = aws = 0
        h1 = a1 = 0
        hq1 = aq1 = 0
        clock = 3600.0
        possession_home = bool(self.rng.integers(0, 2))

        hav = self._sample_availability(self.home)
        aav = self._sample_availability(self.away)

        # Preseason receives wider game-level pace uncertainty by default.
        mode_unc = 1.15 if self.context.mode == "preseason" else 1.0
        pace_sd = 0.045 * self.context.uncertainty_mult * mode_unc
        game_pace_shock = float(np.clip(self.rng.lognormal(0.0, pace_sd), 0.84, 1.20))

        short_home = 0.0
        short_away = 0.0
        hd = ad = 0

        margin_5m = None
        max_home_lead = 0
        max_away_lead = 0

        event_counts = {
            "turnovers_home": 0,
            "turnovers_away": 0,
            "def_td_home": 0,
            "def_td_away": 0,
            "fg_miss_home": 0,
            "fg_miss_away": 0,
        }

        while clock > 0:
            q = self._quarter(clock)
            late = clock <= self.context.garbage_time_start_seconds
            margin = hs - aws

            if margin_5m is None and clock <= self.context.backdoor_window_seconds:
                margin_5m = margin

            max_home_lead = max(max_home_lead, margin)
            max_away_lead = max(max_away_lead, -margin)

            if possession_home:
                score_diff = margin
                garbage = late and abs(margin) >= self.context.garbage_time_margin
                start = self._start_yardline(self.home, short_home)
                short_home = 0.0

                r = self._simulate_drive(
                    self.home, self.away, hav, aav,
                    is_home=True,
                    start_yardline=start,
                    score_diff=score_diff,
                    clock=clock,
                    quarter=q,
                    garbage=garbage,
                )
                hs += int(r["offense_points"])
                aws += int(r["defense_points"])
                if q <= 2:
                    h1 += int(r["offense_points"])
                    a1 += int(r["defense_points"])
                if q == 1:
                    hq1 += int(r["offense_points"])
                    aq1 += int(r["defense_points"])

                if r["turnover"]:
                    event_counts["turnovers_home"] += 1
                    short_away = float(r["short_field_bonus"])
                if r["event"] == "def_td":
                    event_counts["def_td_away"] += 1
                if r["event"] == "fg_miss":
                    event_counts["fg_miss_home"] += 1

                duration = self._drive_duration(
                    self.home,
                    score_diff=score_diff,
                    clock=clock,
                    quarter=q,
                    is_garbage=garbage,
                    drive_shift=self.context.drive_count_shift_home,
                    game_pace_shock=game_pace_shock,
                )
                hd += 1

            else:
                score_diff = -margin
                garbage = late and abs(margin) >= self.context.garbage_time_margin
                start = self._start_yardline(self.away, short_away)
                short_away = 0.0

                r = self._simulate_drive(
                    self.away, self.home, aav, hav,
                    is_home=False,
                    start_yardline=start,
                    score_diff=score_diff,
                    clock=clock,
                    quarter=q,
                    garbage=garbage,
                )
                aws += int(r["offense_points"])
                hs += int(r["defense_points"])
                if q <= 2:
                    a1 += int(r["offense_points"])
                    h1 += int(r["defense_points"])
                if q == 1:
                    aq1 += int(r["offense_points"])
                    hq1 += int(r["defense_points"])

                if r["turnover"]:
                    event_counts["turnovers_away"] += 1
                    short_home = float(r["short_field_bonus"])
                if r["event"] == "def_td":
                    event_counts["def_td_home"] += 1
                if r["event"] == "fg_miss":
                    event_counts["fg_miss_away"] += 1

                duration = self._drive_duration(
                    self.away,
                    score_diff=score_diff,
                    clock=clock,
                    quarter=q,
                    is_garbage=garbage,
                    drive_shift=self.context.drive_count_shift_away,
                    game_pace_shock=game_pace_shock,
                )
                ad += 1

            clock -= duration
            possession_home = not possession_home

        if margin_5m is None:
            margin_5m = hs - aws

        reg_h, reg_a = hs, aws
        ml_h, ml_a, tie = self._resolve_overtime(hs, aws)

        return {
            "home_score_reg": reg_h,
            "away_score_reg": reg_a,
            "home_score_ml": ml_h,
            "away_score_ml": ml_a,
            "reg_tie": int(reg_h == reg_a),
            "post_ot_tie": int(tie),
            "home_1h": h1,
            "away_1h": a1,
            "home_1q": hq1,
            "away_1q": aq1,
            "home_drives": hd,
            "away_drives": ad,
            "home_margin_5m": int(margin_5m),
            "max_home_lead": int(max_home_lead),
            "max_away_lead": int(max_away_lead),
            **event_counts,
        }

    def simulate(self, n: int = 50000) -> Dict[str, object]:
        if n < 1000:
            raise ValueError("Use at least 1,000 simulations.")

        rows = [self.simulate_one() for _ in range(n)]

        hs = np.array([r["home_score_reg"] for r in rows])
        aws = np.array([r["away_score_reg"] for r in rows])
        hml = np.array([r["home_score_ml"] for r in rows])
        aml = np.array([r["away_score_ml"] for r in rows])
        tie = np.array([r["post_ot_tie"] for r in rows], dtype=bool)
        h1 = np.array([r["home_1h"] for r in rows])
        a1 = np.array([r["away_1h"] for r in rows])
        hq1 = np.array([r["home_1q"] for r in rows])
        aq1 = np.array([r["away_1q"] for r in rows])
        hd = np.array([r["home_drives"] for r in rows])
        ad = np.array([r["away_drives"] for r in rows])
        m5 = np.array([r["home_margin_5m"] for r in rows])

        margin = hs - aws
        total = hs + aws
        total_1h = h1 + a1
        margin_1h = h1 - a1
        total_1q = hq1 + aq1
        margin_1q = hq1 - aq1

        out: Dict[str, object] = {
            "engine": "SB101 AEGIS NFL Drive-Level Simulator v0.1",
            "mode": self.context.mode,
            "simulations": n,
            "teams": {"home": self.home.name, "away": self.away.name},
            "score_distribution": {
                "mean_home": float(hs.mean()),
                "mean_away": float(aws.mean()),
                "median_home": float(np.median(hs)),
                "median_away": float(np.median(aws)),
                "mean_total": float(total.mean()),
                "median_total": float(np.median(total)),
                "mean_margin_home": float(margin.mean()),
                "median_margin_home": float(np.median(margin)),
                "p10_total": float(np.percentile(total, 10)),
                "p25_total": float(np.percentile(total, 25)),
                "p75_total": float(np.percentile(total, 75)),
                "p90_total": float(np.percentile(total, 90)),
                "p10_margin": float(np.percentile(margin, 10)),
                "p25_margin": float(np.percentile(margin, 25)),
                "p75_margin": float(np.percentile(margin, 75)),
                "p90_margin": float(np.percentile(margin, 90)),
                "std_total": float(total.std(ddof=1)),
                "std_margin": float(margin.std(ddof=1)),
            },
            "first_half_distribution": {
                "mean_home": float(h1.mean()),
                "mean_away": float(a1.mean()),
                "mean_total": float(total_1h.mean()),
                "mean_margin_home": float(margin_1h.mean()),
                "median_total": float(np.median(total_1h)),
            },
            "first_quarter_distribution": {
                "mean_home": float(hq1.mean()),
                "mean_away": float(aq1.mean()),
                "mean_total": float(total_1q.mean()),
                "mean_margin_home": float(margin_1q.mean()),
            },
            "drive_distribution": {
                "mean_home_drives": float(hd.mean()),
                "mean_away_drives": float(ad.mean()),
                "p90_combined_drives": float(np.percentile(hd + ad, 90)),
            },
            "market_probabilities": {
                "home_ml": float(np.mean((hml > aml) & ~tie)),
                "away_ml": float(np.mean((aml > hml) & ~tie)),
                "post_ot_tie": float(np.mean(tie)),
                "regulation_tie": float(np.mean(hs == aws)),
            },
            "key_number_distribution": {
                str(k): {
                    "home_wins_by_exact": float(np.mean(margin == k)),
                    "away_wins_by_exact": float(np.mean(margin == -k)),
                    "either_exact": float(np.mean(np.abs(margin) == k)),
                }
                for k in NFL_KEY_NUMBERS
            },
            "tail_risk": {
                "p_total_50_plus": float(np.mean(total >= 50)),
                "p_total_60_plus": float(np.mean(total >= 60)),
                "p_margin_14_plus_home": float(np.mean(margin >= 14)),
                "p_margin_14_plus_away": float(np.mean(margin <= -14)),
                "p_margin_21_plus_home": float(np.mean(margin >= 21)),
                "p_margin_21_plus_away": float(np.mean(margin <= -21)),
            },
            "event_rates": {
                "mean_home_turnovers": float(np.mean([r["turnovers_home"] for r in rows])),
                "mean_away_turnovers": float(np.mean([r["turnovers_away"] for r in rows])),
                "p_any_defensive_td": float(np.mean([
                    (r["def_td_home"] + r["def_td_away"]) > 0 for r in rows
                ])),
                "mean_home_fg_misses": float(np.mean([r["fg_miss_home"] for r in rows])),
                "mean_away_fg_misses": float(np.mean([r["fg_miss_away"] for r in rows])),
            }
        }

        mp = out["market_probabilities"]
        ctx = self.context

        if ctx.home_spread is not None:
            adj = margin + ctx.home_spread
            mp["home_spread_cover"] = float(np.mean(adj > 0))
            mp["home_spread_push"] = float(np.mean(adj == 0))
            mp["away_spread_cover"] = float(np.mean(adj < 0))

            # Backdoor: home was covering with 5 minutes left but fails to cover final.
            was_covering = (m5 + ctx.home_spread) > 0
            final_not_cover = adj <= 0
            mp["home_backdoor_cover_loss"] = float(np.mean(was_covering & final_not_cover))

            # Reverse backdoor for away.
            was_away_covering = (m5 + ctx.home_spread) < 0
            final_away_not_cover = adj >= 0
            mp["away_backdoor_cover_loss"] = float(np.mean(was_away_covering & final_away_not_cover))

        if ctx.total_line is not None:
            mp["over"] = float(np.mean(total > ctx.total_line))
            mp["total_push"] = float(np.mean(total == ctx.total_line))
            mp["under"] = float(np.mean(total < ctx.total_line))

        if ctx.home_tt_line is not None:
            mp["home_tt_over"] = float(np.mean(hs > ctx.home_tt_line))
            mp["home_tt_push"] = float(np.mean(hs == ctx.home_tt_line))
            mp["home_tt_under"] = float(np.mean(hs < ctx.home_tt_line))

        if ctx.away_tt_line is not None:
            mp["away_tt_over"] = float(np.mean(aws > ctx.away_tt_line))
            mp["away_tt_push"] = float(np.mean(aws == ctx.away_tt_line))
            mp["away_tt_under"] = float(np.mean(aws < ctx.away_tt_line))

        return out

    def simulate_arrays(self, n: int = 50000) -> Dict[str, np.ndarray]:
        rows = [self.simulate_one() for _ in range(n)]
        hs = np.array([r["home_score_reg"] for r in rows])
        aws = np.array([r["away_score_reg"] for r in rows])
        hml = np.array([r["home_score_ml"] for r in rows])
        aml = np.array([r["away_score_ml"] for r in rows])
        tie = np.array([r["post_ot_tie"] for r in rows], dtype=bool)
        return {
            "home_score": hs,
            "away_score": aws,
            "margin": hs - aws,
            "total": hs + aws,
            "home_ml_score": hml,
            "away_ml_score": aml,
            "post_ot_tie": tie,
        }


def key_number_sensitivity(
    simulator: NFLDriveSimulator,
    *,
    spread_lines: List[float],
    total_lines: Optional[List[float]] = None,
    n: int = 50000,
) -> Dict[str, object]:
    arr = simulator.simulate_arrays(n)
    margin = arr["margin"]
    total = arr["total"]

    spreads = {}
    for line in spread_lines:
        adj = margin + line
        spreads[str(line)] = {
            "home_cover": float(np.mean(adj > 0)),
            "push": float(np.mean(adj == 0)),
            "away_cover": float(np.mean(adj < 0)),
            "fragility_mass_within_1pt": float(np.mean(np.abs(adj) <= 1)),
        }

    totals = {}
    for line in total_lines or []:
        totals[str(line)] = {
            "over": float(np.mean(total > line)),
            "push": float(np.mean(total == line)),
            "under": float(np.mean(total < line)),
            "fragility_mass_within_1pt": float(np.mean(np.abs(total - line) <= 1)),
        }

    return {"spreads": spreads, "totals": totals}


def evaluate_market_offers(
    simulator: NFLDriveSimulator,
    offers: List[MarketOffer],
    *,
    n: int = 50000,
) -> List[Dict[str, object]]:
    """
    Standardized NFL Market Expression Optimizer hook.

    v0.1 ranks by raw simulated EV, while explicitly exposing fragility.
    Production AEGIS should later apply calibrated uncertainty, market-challenger,
    data-quality and ensemble-disagreement gates before release.
    """
    arr = simulator.simulate_arrays(n)
    hs = arr["home_score"]
    aws = arr["away_score"]
    margin = arr["margin"]
    total = arr["total"]
    hml = arr["home_ml_score"]
    aml = arr["away_ml_score"]
    tie = arr["post_ot_tie"]

    rows = []
    for offer in offers:
        typ = offer.market_type
        line = offer.line

        if typ == "home_ml":
            win = (hml > aml) & ~tie
            lose = (hml < aml) & ~tie
            push = tie
            frag = float(np.mean(tie))
        elif typ == "away_ml":
            win = (aml > hml) & ~tie
            lose = (aml < hml) & ~tie
            push = tie
            frag = float(np.mean(tie))
        elif typ == "home_spread":
            if line is None: raise ValueError("spread offer requires line")
            adj = margin + line
            win, lose, push = adj > 0, adj < 0, adj == 0
            frag = float(np.mean(np.abs(adj) <= 1))
        elif typ == "away_spread":
            if line is None: raise ValueError("spread offer requires line")
            # line is away spread, e.g. +3.5
            adj = -margin + line
            win, lose, push = adj > 0, adj < 0, adj == 0
            frag = float(np.mean(np.abs(adj) <= 1))
        elif typ == "over":
            if line is None: raise ValueError("total offer requires line")
            win, lose, push = total > line, total < line, total == line
            frag = float(np.mean(np.abs(total - line) <= 1))
        elif typ == "under":
            if line is None: raise ValueError("total offer requires line")
            win, lose, push = total < line, total > line, total == line
            frag = float(np.mean(np.abs(total - line) <= 1))
        elif typ == "home_tt_over":
            if line is None: raise ValueError("team total requires line")
            win, lose, push = hs > line, hs < line, hs == line
            frag = float(np.mean(np.abs(hs - line) <= 1))
        elif typ == "home_tt_under":
            if line is None: raise ValueError("team total requires line")
            win, lose, push = hs < line, hs > line, hs == line
            frag = float(np.mean(np.abs(hs - line) <= 1))
        elif typ == "away_tt_over":
            if line is None: raise ValueError("team total requires line")
            win, lose, push = aws > line, aws < line, aws == line
            frag = float(np.mean(np.abs(aws - line) <= 1))
        elif typ == "away_tt_under":
            if line is None: raise ValueError("team total requires line")
            win, lose, push = aws < line, aws > line, aws == line
            frag = float(np.mean(np.abs(aws - line) <= 1))
        else:
            raise ValueError(f"Unsupported market_type: {typ}")

        pw = float(np.mean(win))
        pl = float(np.mean(lose))
        pp = float(np.mean(push))
        ev = expected_value(pw, pl, offer.odds)

        rows.append({
            "name": offer.name,
            "market_type": typ,
            "line": line,
            "odds": offer.odds,
            "win_probability": pw,
            "lose_probability": pl,
            "push_probability": pp,
            "book_implied_probability": implied_probability(offer.odds),
            "raw_ev_per_unit": float(ev),
            "fragility_mass": frag,
        })

    rows.sort(key=lambda x: (x["raw_ev_per_unit"], -x["fragility_mass"]), reverse=True)
    for i, r in enumerate(rows, 1):
        r["raw_rank"] = i
    return rows


if __name__ == "__main__":
    # Synthetic demonstration only. Not a real-game recommendation.
    home = NFLTeamProfile(
        name="Home Demo",
        expected_drives=10.9,
        scoring_opportunity_prob=0.445,
        td_given_scoring_opportunity=0.575,
        explosive_td_prob_per_drive=0.035,
        turnover_prob_per_drive=0.095,
        avg_start_yardline=29.5,
        first_half_efficiency_mult=1.02,
        opening_script_efficiency_mult=1.03,
        overtime_strength=0.56,
    )

    away = NFLTeamProfile(
        name="Away Demo",
        expected_drives=10.6,
        scoring_opportunity_prob=0.385,
        td_given_scoring_opportunity=0.53,
        explosive_td_prob_per_drive=0.029,
        turnover_prob_per_drive=0.112,
        avg_start_yardline=28.0,
        overtime_strength=0.44,
        qb_availability=AvailabilityDistribution(
            p_full=0.78, p_limited=0.15, limited_mult=0.91, replacement_mult=0.72
        ),
    )

    ctx = NFLGameContext(
        mode="regular",
        home_spread=-3.0,
        total_line=45.5,
        home_tt_line=24.5,
        away_tt_line=21.5,
        uncertainty_mult=1.05,
        wind_mph=6.0,
    )

    sim = NFLDriveSimulator(home, away, ctx, seed=5601)
    out = sim.simulate(50000)

    import json
    print(json.dumps(out, indent=2))
