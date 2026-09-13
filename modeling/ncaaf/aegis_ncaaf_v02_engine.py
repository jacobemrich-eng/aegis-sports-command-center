from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from statistics import mean, pstdev
from typing import Any, Iterable, Mapping

import numpy as np

try:
    from .aegis_ncaaf_engine import component_projections, finite, project as project_v01, validate_blind_input, walk_keys
except ImportError:
    from aegis_ncaaf_engine import component_projections, finite, project as project_v01, validate_blind_input, walk_keys


ENGINE_VERSION = "NCAAF_v0.2_RESEARCH_CANDIDATE"
STATISTICAL_VERSION = "NCAAF_v0.2_STATISTICAL_BASELINE"
SIMULATOR_VERSION = "NCAAF_v0.2_POSSESSION_SIMULATOR"
CALIBRATION_VERSION = "NCAAF_v0.2_BLIND_MONOTONIC_CALIBRATION"
FORBIDDEN_CALIBRATION = {
    "spread", "home_spread", "total_line", "moneyline", "odds", "sportsbook_spread",
    "sportsbook_total", "market", "market_consensus", "closing_line", "closing_total",
}

BLEND_FIELDS = (
    "offense_epa_per_play", "defense_epa_allowed_per_play", "net_epa_per_play",
    "early_down_epa", "success_rate", "points_per_drive", "plays_per_drive",
    "three_and_out_rate", "scoring_opportunity_rate", "finishing_drives",
    "explosive_drive_rate", "turnover_rate", "starting_field_position",
    "explosive_play_rate", "havoc_rate", "pressure_allowed_rate", "pressure_rate",
    "coverage_grade", "line_yards_rate", "rushing_efficiency", "plays_per_game",
    "drives_per_game", "special_teams_rating", "penalty_rate",
)


def canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def stable_seed(*values: object) -> int:
    return int(hashlib.sha256("|".join(str(value) for value in values).encode()).hexdigest()[:16], 16)


def value_or_none(value: object) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def validate_calibration_features(features: Mapping[str, Any]) -> None:
    leaking = sorted({path for key, path in walk_keys(features)
                      if key in FORBIDDEN_CALIBRATION or key.startswith("sportsbook_") or key.startswith("market_")})
    if leaking:
        raise ValueError(f"NCAAF v0.2 blind calibration leakage: {', '.join(leaking)}")


def effective_sample_size(profile: Mapping[str, Any]) -> float:
    games = max(0.0, finite(profile.get("sample_games")))
    play_games = max(0.0, finite(profile.get("sample_plays")) / 65.0)
    if games == 0 or play_games == 0:
        return 0.0
    return min(games, play_games)


def evidence_label(current_weight: float) -> str:
    if current_weight < 1 / 3:
        return "PRESEASON_HEAVY"
    if current_weight < 2 / 3:
        return "TRANSITION"
    return "CURRENT_SEASON_STABLE"


def bayesian_profile(current: Mapping[str, Any], prior: Mapping[str, Any] | None,
                     prior_equivalent_games: float) -> dict[str, Any]:
    prior = prior or {}
    ess = effective_sample_size(current)
    prior_support = max(0.25, float(prior_equivalent_games)) if prior else 0.0
    weight = ess / (ess + prior_support) if prior_support else (1.0 if ess else 0.0)
    result = dict(current)
    for key in BLEND_FIELDS:
        now, before = value_or_none(current.get(key)), value_or_none(prior.get(key))
        if now is not None and before is not None:
            result[key] = weight * now + (1.0 - weight) * before
        elif before is not None:
            result[key] = before
        else:
            result[key] = now
    # Pregame Elo is point-in-time and remains the primary live power state. The
    # prior schedule rating is a separate, completed-prior-season feature.
    result["prior_opponent_adjusted_strength"] = value_or_none(prior.get("schedule_strength"))
    result["prior_drive_efficiency"] = value_or_none(prior.get("points_per_drive"))
    result["prior_explosiveness"] = value_or_none(prior.get("explosive_play_rate"))
    result["prior_havoc"] = value_or_none(prior.get("havoc_rate"))
    result["effective_sample_size"] = ess
    result["current_evidence_weight"] = weight
    result["evidence_state"] = evidence_label(weight)
    result["qb_continuity"] = clamp(finite(current.get("qb_continuity"), .5), 0.0, 1.0)
    result["returning_production"] = clamp(finite(current.get("returning_production"), .5), 0.0, 1.0)
    return result


def structural_break_state(home: Mapping[str, Any], away: Mapping[str, Any]) -> str:
    side_flags=[]
    for side in (home,away):
        coaching=bool(side.get("coaching_change"));low_qb=finite(side.get("qb_continuity"),.5)<.30;low_roster=finite(side.get("returning_production"),.5)<.38
        side_flags.append((coaching,low_qb,low_roster))
    # Confirmation requires multiple indicators on one program or simultaneous
    # coaching changes. Two merely low roster-return values are only POSSIBLE.
    if any(sum(flags)>=2 for flags in side_flags) or all(flags[0] for flags in side_flags):
        return "CONFIRMED"
    if any(any(flags) for flags in side_flags):
        return "POSSIBLE"
    return "STABLE"


def adapt_blind_input(row: Mapping[str, Any], priors: Mapping[str, Mapping[str, Any]],
                      prior_equivalent_games: float) -> dict[str, Any]:
    validate_blind_input(row)
    result = dict(row)
    home = bayesian_profile(row["home"], priors.get(str(row["home_team"])), prior_equivalent_games)
    away = bayesian_profile(row["away"], priors.get(str(row["away_team"])), prior_equivalent_games)
    result["home"], result["away"] = home, away
    result["v02_context"] = {
        "home_effective_sample_size": home["effective_sample_size"],
        "away_effective_sample_size": away["effective_sample_size"],
        "minimum_effective_sample_size": min(home["effective_sample_size"], away["effective_sample_size"]),
        "home_evidence_state": home["evidence_state"],
        "away_evidence_state": away["evidence_state"],
        "structural_break_state": structural_break_state(home, away),
        "cross_class": home.get("classification") != away.get("classification"),
    }
    return result


def class_direction(row: Mapping[str, Any]) -> float:
    home = str(row["home"].get("classification", "unknown")); away = str(row["away"].get("classification", "unknown"))
    if home == away:
        return 0.0
    if home == "fbs" and away == "fcs":
        return 1.0
    if home == "fcs" and away == "fbs":
        return -1.0
    return 0.0


def diff(row: Mapping[str, Any], key: str, fallback: float = 0.0) -> float:
    return finite(row["home"].get(key), fallback) - finite(row["away"].get(key), fallback)


def statistical_features(row: Mapping[str, Any], v01: Mapping[str, Any]) -> dict[str, float]:
    components = v01["components"]
    context = row["v02_context"]
    class_sign = class_direction(row)
    talent_gap = diff(row, "talent_rating")
    return {
        "v01_margin": finite(v01.get("margin")),
        **{f"component_{name}": finite(value.get("margin")) for name, value in components.items()},
        "home_field": finite(row.get("home_field_advantage")),
        "prior_schedule_diff": diff(row, "prior_opponent_adjusted_strength"),
        "talent_diff": talent_gap,
        "returning_diff": diff(row, "returning_production"),
        "qb_continuity_diff": diff(row, "qb_continuity"),
        "net_epa_diff": diff(row, "net_epa_per_play"),
        "drive_diff": diff(row, "points_per_drive"),
        "explosiveness_diff": diff(row, "explosive_play_rate"),
        "havoc_diff": diff(row, "havoc_rate"),
        "trench_diff": diff(row, "line_yards_rate") + diff(row, "pressure_rate") - diff(row, "pressure_allowed_rate"),
        "class_direction": class_sign,
        "class_talent_gap": class_sign * abs(talent_gap),
        "minimum_effective_sample_size": finite(context["minimum_effective_sample_size"]),
        "structural_possible": float(context["structural_break_state"] == "POSSIBLE"),
        "structural_confirmed": float(context["structural_break_state"] == "CONFIRMED"),
    }


def total_features(row: Mapping[str, Any], v01: Mapping[str, Any]) -> dict[str, float]:
    components = v01["components"]
    context = row["v02_context"]
    return {
        "v01_total": finite(v01.get("total")),
        **{f"component_{name}": finite(value.get("total")) for name, value in components.items()},
        "offense_epa_sum": finite(row["home"].get("offense_epa_per_play")) + finite(row["away"].get("offense_epa_per_play")),
        "points_per_drive_sum": finite(row["home"].get("points_per_drive"), 2.1) + finite(row["away"].get("points_per_drive"), 2.1),
        "pace_sum": finite(row["home"].get("plays_per_game"), 70) + finite(row["away"].get("plays_per_game"), 70),
        "explosiveness_sum": finite(row["home"].get("explosive_play_rate"), .1) + finite(row["away"].get("explosive_play_rate"), .1),
        "cross_class": float(context["cross_class"]),
        "minimum_effective_sample_size": finite(context["minimum_effective_sample_size"]),
        "structural_confirmed": float(context["structural_break_state"] == "CONFIRMED"),
    }


@dataclass
class RidgeModel:
    names: list[str]
    center: list[float]
    scale: list[float]
    coefficients: list[float]
    intercept: float
    alpha: float

    def predict(self, features: Mapping[str, Any]) -> float:
        standardized = [(finite(features.get(name)) - center) / scale
                        for name, center, scale in zip(self.names, self.center, self.scale)]
        return self.intercept + sum(coef * value for coef, value in zip(self.coefficients, standardized))

    def to_dict(self) -> dict[str, Any]:
        return {"names": self.names, "center": self.center, "scale": self.scale,
                "coefficients": self.coefficients, "intercept": self.intercept, "alpha": self.alpha}

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "RidgeModel":
        return cls(list(value["names"]), list(value["center"]), list(value["scale"]),
                   list(value["coefficients"]), float(value["intercept"]), float(value["alpha"]))


def fit_ridge(feature_rows: Iterable[Mapping[str, Any]], targets: Iterable[float], alpha: float,
              *, nonnegative_feature: str | None = None) -> RidgeModel:
    rows = list(feature_rows); y = np.asarray(list(targets), dtype=float)
    names = sorted({key for row in rows for key in row})
    matrix = np.asarray([[finite(row.get(name)) for name in names] for row in rows], dtype=float)
    center = matrix.mean(axis=0); scale = matrix.std(axis=0); scale[scale < 1e-8] = 1.0
    x = (matrix - center) / scale
    design = np.column_stack((np.ones(len(x)), x))
    penalty = np.eye(design.shape[1]) * float(alpha); penalty[0, 0] = 0.0
    beta = np.linalg.solve(design.T @ design + penalty, design.T @ y)
    if nonnegative_feature and nonnegative_feature in names:
        index = names.index(nonnegative_feature) + 1
        if beta[index] < 0:
            keep = [column for column in range(design.shape[1]) if column != index]
            reduced = design[:, keep]; reduced_penalty = penalty[np.ix_(keep, keep)]
            fitted = np.linalg.solve(reduced.T @ reduced + reduced_penalty, reduced.T @ y)
            beta = np.zeros(design.shape[1]); beta[keep] = fitted
    return RidgeModel(names, center.tolist(), scale.tolist(), beta[1:].tolist(), float(beta[0]), float(alpha))


def calibration_features(raw_margin: float, raw_total: float, row: Mapping[str, Any],
                         dispersion: float, quality_score: float) -> dict[str, float]:
    context = row["v02_context"]
    features = {
        "raw_margin": raw_margin, "raw_total": raw_total, "dispersion": dispersion,
        "data_quality_score": quality_score,
        "minimum_effective_sample_size": finite(context["minimum_effective_sample_size"]),
        "cross_class": float(context["cross_class"]),
        "structural_possible": float(context["structural_break_state"] == "POSSIBLE"),
        "structural_confirmed": float(context["structural_break_state"] == "CONFIRMED"),
        "preseason_heavy": float("PRESEASON_HEAVY" in (context["home_evidence_state"], context["away_evidence_state"])),
        "transition": float("TRANSITION" in (context["home_evidence_state"], context["away_evidence_state"])),
    }
    validate_calibration_features(features)
    return features


def implied_margin_regime(margin: float) -> str:
    size = abs(float(margin))
    if size < 13: return "0_13"
    if size < 21: return "13_21"
    if size < 28: return "21_28"
    if size < 35: return "28_35"
    return "35_PLUS"


def research_firewall(row: Mapping[str, Any], margin: float, dispersion: float,
                      quality_grade: str, dispersion_p75: float, dispersion_p90: float) -> str:
    context = row["v02_context"]; regime = implied_margin_regime(margin)
    minimum_ess = finite(context["minimum_effective_sample_size"])
    if quality_grade == "D" or context["structural_break_state"] == "CONFIRMED" or minimum_ess < .75:
        return "PASS"
    if context["cross_class"] and minimum_ess < 4:
        return "PASS"
    if regime == "35_PLUS" or dispersion >= dispersion_p90:
        return "PASS"
    if regime == "28_35" or dispersion >= dispersion_p75 or quality_grade == "C":
        return "SECONDARY_MAX"
    if regime == "21_28" or "PRESEASON_HEAVY" in (context["home_evidence_state"], context["away_evidence_state"]):
        return "CORE_BLOCK"
    return "NORMAL"


def data_quality(row: Mapping[str, Any], dispersion: float) -> tuple[float, str]:
    context = row["v02_context"]
    minimum_ess = finite(context["minimum_effective_sample_size"])
    score = .95 - .12 * float(context["cross_class"]) - .12 * float(context["structural_break_state"] == "CONFIRMED")
    score -= .06 * float(context["structural_break_state"] == "POSSIBLE")
    score -= .15 * float(minimum_ess < 1) + .08 * float(1 <= minimum_ess < 3)
    score -= min(.15, dispersion / 80)
    score = clamp(score, 0.0, 1.0)
    grade = "A" if score >= .86 else "B" if score >= .74 else "C" if score >= .58 else "D"
    return score, grade


def simulate_possessions(row: Mapping[str, Any], margin: float, total: float, simulations: int = 20_000) -> dict[str, Any]:
    """Blind drive simulation with independent halves and conditional garbage time."""
    rng = np.random.default_rng(stable_seed(row["game_id"], ENGINE_VERSION, simulations))
    h, a = row["home"], row["away"]
    base_drives = clamp(mean((finite(h.get("drives_per_game"), 12), finite(a.get("drives_per_game"), 12))), 9, 16)
    first_drives = max(4.5, base_drives * .53)
    second_drives = max(4.0, base_drives - first_drives)
    home_ppd = clamp((total + margin) / (2 * base_drives), .25, 5.5)
    away_ppd = clamp((total - margin) / (2 * base_drives), .25, 5.5)

    def half_scores(drives_mean: float, home_rate: float, away_rate: float):
        hd = np.maximum(4, rng.poisson(drives_mean, simulations)); ad = np.maximum(4, rng.poisson(drives_mean, simulations))
        def score(drives, rate, profile):
            turnover = clamp(finite(profile.get("turnover_rate"), .11), .03, .24)
            explosive = clamp(finite(profile.get("explosive_play_rate"), .10), .02, .24)
            td = clamp(rate / 7 * .74 + explosive * .18 - turnover * .15, .04, .55)
            fg = clamp(rate / 3 * .18, .03, .22)
            touchdowns = rng.binomial(drives, td)
            remaining = np.maximum(0, drives - touchdowns)
            field_goals = rng.binomial(remaining, fg / max(1e-6, 1 - td))
            return touchdowns * 7 + field_goals * 3
        return score(hd, home_rate, h), score(ad, away_rate, a), hd, ad

    home_first, away_first, _, _ = half_scores(first_drives, home_ppd, away_ppd)
    halftime_margin = home_first - away_first
    implied_size = abs(margin)
    removal_base = 1 / (1 + np.exp(-(np.abs(halftime_margin) - 17) / 4.5))
    removal_base *= clamp((implied_size - 13) / 22, 0, 1)
    removal = rng.random(simulations) < removal_base
    home_leads = halftime_margin > 0
    away_leads = halftime_margin < 0
    home_rate = np.full(simulations, home_ppd); away_rate = np.full(simulations, away_ppd)
    # Starter removal, clock compression, reduced aggression, and trailing-team
    # garbage scoring are conditional on simulated halftime state—not market size.
    home_rate[removal & home_leads] *= .72; away_rate[removal & away_leads] *= .72
    home_rate[removal & away_leads] *= 1.08; away_rate[removal & home_leads] *= 1.08
    home_second_drives = np.full(simulations, second_drives); away_second_drives = np.full(simulations, second_drives)
    home_second_drives[removal & home_leads] *= .78; away_second_drives[removal & away_leads] *= .78
    home_second_drives[removal & away_leads] *= 1.08; away_second_drives[removal & home_leads] *= 1.08

    def variable_scores(drives_mean, rate, profile):
        drives = np.maximum(3, rng.poisson(drives_mean))
        turnover = clamp(finite(profile.get("turnover_rate"), .11), .03, .24)
        explosive = clamp(finite(profile.get("explosive_play_rate"), .10), .02, .24)
        td = np.clip(rate / 7 * .74 + explosive * .18 - turnover * .15, .035, .55)
        fg = np.clip(rate / 3 * .18, .025, .22)
        touchdowns = rng.binomial(drives, td)
        field_goals = rng.binomial(np.maximum(0, drives - touchdowns), np.clip(fg / np.maximum(1e-6, 1 - td), 0, 1))
        return touchdowns * 7 + field_goals * 3

    home_second = variable_scores(home_second_drives, home_rate, h); away_second = variable_scores(away_second_drives, away_rate, a)
    home_score = home_first + home_second; away_score = away_first + away_second
    margins = home_score - away_score; totals = home_score + away_score
    first_margins = home_first - away_first; first_totals = home_first + away_first
    second_margins = home_second - away_second; second_totals = home_second + away_second
    q = lambda values, percentile: float(np.quantile(values, percentile))
    return {
        "simulations": simulations,
        "margin": float(margins.mean()), "total": float(totals.mean()),
        "home_win_probability": float(np.mean(margins > 0)),
        "margin_sd": float(margins.std()), "total_sd": float(totals.std()),
        "margin_percentiles": {"p10": q(margins, .1), "p50": q(margins, .5), "p90": q(margins, .9)},
        "total_percentiles": {"p10": q(totals, .1), "p50": q(totals, .5), "p90": q(totals, .9)},
        "first_half": {"margin": float(first_margins.mean()), "total": float(first_totals.mean()), "margin_sd": float(first_margins.std()), "independent": True},
        "second_half_conditional": {"margin": float(second_margins.mean()), "total": float(second_totals.mean()), "margin_sd": float(second_margins.std()),
                                    "margin_percentiles": {"p10": q(second_margins,.1),"p50":q(second_margins,.5),"p90":q(second_margins,.9)},
                                    "conditioned_on_simulated_halftime": True},
        "starter_removal_probability": float(removal.mean()),
        "clock_compression_probability": float(removal.mean()),
        "blowout_regime": implied_margin_regime(margin),
    }


def project(row: Mapping[str, Any], priors: Mapping[str, Mapping[str, Any]], artifact: Mapping[str, Any],
            *, generated_at: str, simulations: int = 20_000) -> dict[str, Any]:
    """Run the frozen research candidate without consulting a market."""
    validate_blind_input(row)
    if artifact.get("market_features_used") is not False:
        raise ValueError("NCAAF v0.2 artifact is not blind-safe")
    old_output = project_v01(row, generated_at=generated_at, simulations=simulations)
    old_projection = old_output["projection"]
    old = {"margin":old_projection["margin"],"total":old_projection["total"],"components":old_output["diagnostics"]["component_projections"]}
    context = adapt_blind_input(row, priors, float(artifact["prior_equivalent_games"]))
    components = component_projections(context); component_margins = [value["margin"] for value in components.values()]
    simulator_margin = mean(component_margins); compression = .12 * (1/(1+math.exp(-(abs(simulator_margin)-22)/4.5)))
    simulator_margin *= 1-compression
    simulator_total = mean(value["total"] for value in components.values())
    if context["v02_context"]["cross_class"]: simulator_total -= 2/(1+math.exp(-(abs(simulator_margin)-18)/5))
    record = {"margin_features":statistical_features(context,old),"total_features":total_features(context,old),"context":context,
              "simulator_margin":simulator_margin,"simulator_total":simulator_total,"dispersion":pstdev(component_margins)}
    models={name:RidgeModel.from_dict(value) for name,value in artifact["models"].items()}
    stat_margin=models["margin"].predict(record["margin_features"]);stat_total=models["total"].predict(record["total_features"])
    blend=artifact["blend_weights"];raw_margin=blend["margin"]*stat_margin+(1-blend["margin"])*simulator_margin;raw_total=blend["total"]*stat_total+(1-blend["total"])*simulator_total
    quality_score,quality_grade=data_quality(context,record["dispersion"])
    cal_features=calibration_features(raw_margin,raw_total,context,record["dispersion"],quality_score)
    margin=RidgeModel.from_dict(artifact["margin_calibrator"]).predict(cal_features);total=RidgeModel.from_dict(artifact["total_calibrator"]).predict(cal_features)
    first_margin=models["first_margin"].predict(record["margin_features"] | {"early_down_epa_diff":diff(context,"early_down_epa"),"qb_continuity_diff_1h":diff(context,"qb_continuity"),"first_half_pace_sum":finite(context["home"].get("plays_per_game"),70)+finite(context["away"].get("plays_per_game"),70)})
    first_total=models["first_total"].predict(record["total_features"] | {"early_down_epa_sum":finite(context["home"].get("early_down_epa"))+finite(context["away"].get("early_down_epa")),"qb_continuity_sum_1h":finite(context["home"].get("qb_continuity"),.5)+finite(context["away"].get("qb_continuity"),.5)})
    distribution=simulate_possessions(context,margin,total,simulations)
    firewall=research_firewall(context,margin,record["dispersion"],quality_grade,float(artifact["dispersion_p75"]),float(artifact["dispersion_p90"]))
    return {"schema_version":"AEGIS_NCAAF_BLIND_v2_RESEARCH","sport":"americanfootball_ncaaf","engine_version":ENGINE_VERSION,"game_id":row["game_id"],"generated_at":generated_at,
            "projection":{"margin":margin,"total":total,"projected_score":{"home":(total+margin)/2,"away":(total-margin)/2},"moneyline_probabilities":{"home":distribution["home_win_probability"],"away":1-distribution["home_win_probability"]},"period_probabilities":{"first_half":{"margin":first_margin,"total":first_total,"independent_model":True},"second_half_conditional":distribution["second_half_conditional"]},"percentiles":{"margin":distribution["margin_percentiles"],"total":distribution["total_percentiles"]},"distribution":{"simulations":simulations,"drive_level":True,"margin_standard_deviation":distribution["margin_sd"],"total_standard_deviation":distribution["total_sd"],"starter_removal_probability":distribution["starter_removal_probability"],"clock_compression_probability":distribution["clock_compression_probability"]}},
            "quality":{"data_quality_score":quality_score,"data_quality_grade":quality_grade,"model_dispersion":record["dispersion"],"effective_sample_size":context["v02_context"]["minimum_effective_sample_size"],"structural_break_state":context["v02_context"]["structural_break_state"],"evidence_state":{"home":context["v02_context"]["home_evidence_state"],"away":context["v02_context"]["away_evidence_state"]}},
            "diagnostics":{"statistical_baseline":{"margin":stat_margin,"total":stat_total},"possession_simulator":{"structural_margin":simulator_margin,"structural_total":simulator_total,"mean_weight_selected_on_2022":1-blend["margin"]},"blind_calibration":{"version":CALIBRATION_VERSION,"market_features_used":False},"blind_implied_blowout_regime":implied_margin_regime(margin),"research_firewall":firewall,"market_expression":"LOCKED_UNTIL_AFTER_BLIND"},
            "release_status":"SHADOW_ONLY","official_final_card_eligible":False,"official_bankroll_eligible":False,"auto_release_allowed":False}
