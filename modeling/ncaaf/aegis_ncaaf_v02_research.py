from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import math
from pathlib import Path
from statistics import mean, pstdev
from typing import Any, Iterable, Mapping

import numpy as np

try:
    from .aegis_ncaaf_engine import component_projections
    from .aegis_ncaaf_v02_engine import (
        CALIBRATION_VERSION, ENGINE_VERSION, SIMULATOR_VERSION, STATISTICAL_VERSION,
        RidgeModel, adapt_blind_input, calibration_features, data_quality, fit_ridge,
        implied_margin_regime, research_firewall, statistical_features, total_features,
        validate_calibration_features,
    )
    from .aegis_ncaaf_v02_features import build_prior_profiles
    from .aegis_ncaaf_walkforward import enrich, metric, validate_dataset
except ImportError:
    from aegis_ncaaf_engine import component_projections
    from aegis_ncaaf_v02_engine import (
        CALIBRATION_VERSION, ENGINE_VERSION, SIMULATOR_VERSION, STATISTICAL_VERSION,
        RidgeModel, adapt_blind_input, calibration_features, data_quality, fit_ridge,
        implied_margin_regime, research_firewall, statistical_features, total_features,
        validate_calibration_features,
    )
    from aegis_ncaaf_v02_features import build_prior_profiles
    from aegis_ncaaf_walkforward import enrich, metric, validate_dataset


TRAIN_YEARS = {2019, 2020, 2021}
VALIDATION_A_YEAR = 2022
VALIDATION_B_YEAR = 2023
OBSERVED_AUDIT_YEARS = {2024, 2025}
PRIOR_GRID = (3.0, 5.0, 8.0, 12.0)
RIDGE_GRID = (1.0, 10.0, 50.0, 200.0)
BLEND_GRID = (0.0, .25, .5, .75, 1.0)
ABLATION_FAMILIES = {
    "Power/Talent": ("component_power","prior_schedule_diff","talent_diff","class_talent_gap"),
    "Efficiency/EPA": ("component_efficiency_epa","net_epa_diff","offense_epa_sum"),
    "Drive": ("component_drive_efficiency","drive_diff","points_per_drive_sum"),
    "Explosiveness/Havoc": ("component_explosiveness_havoc","explosiveness_diff","havoc_diff","explosiveness_sum"),
    "Trenches": ("component_matchup_trenches","trench_diff"),
    "Personnel": ("component_personnel_situational","returning_diff","qb_continuity_diff"),
    "Tempo/Special Teams": ("component_special_teams_context","pace_sum"),
    "Situational/Structural": ("home_field","minimum_effective_sample_size","structural_possible","structural_confirmed","cross_class","class_direction"),
}


def load_v01(path: str | Path) -> dict[str, dict[str, Any]]:
    output = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line); output[row["game_id"]] = row
    return output


def mae(actual: Iterable[float], predicted: Iterable[float]) -> float:
    return mean(abs(float(a) - float(p)) for a, p in zip(actual, predicted))


def logistic(value: float) -> float:
    return 1 / (1 + math.exp(-max(-30.0, min(30.0, value))))


def fit_logistic(margins: Iterable[float], outcomes: Iterable[int], regularization: float = 2.0) -> dict[str, float]:
    x = np.asarray(list(margins), dtype=float); y = np.asarray(list(outcomes), dtype=float)
    center = float(x.mean()); scale = float(x.std()) or 1.0; z = (x - center) / scale
    design = np.column_stack((np.ones(len(z)), z)); beta = np.asarray([0.0, 1.0])
    for _ in range(40):
        probability = 1 / (1 + np.exp(-np.clip(design @ beta, -30, 30)))
        weights = np.maximum(probability * (1 - probability), 1e-5)
        gradient = design.T @ (probability - y) + np.asarray([0.0, regularization * beta[1]])
        hessian = design.T @ (weights[:, None] * design) + np.diag([0.0, regularization])
        beta -= np.linalg.solve(hessian, gradient)
        beta[1] = max(0.0, beta[1])
    return {"intercept": float(beta[0]), "slope": float(beta[1]), "center": center, "scale": scale}


def logistic_predict(model: Mapping[str, float], margin: float) -> float:
    return logistic(model["intercept"] + model["slope"] * (margin - model["center"]) / model["scale"])


def prepare(source_rows: list[dict], prior_profiles: Mapping[int, Mapping[str, Mapping[str, Any]]],
            v01: Mapping[str, Mapping[str, Any]], prior_games: float) -> list[dict[str, Any]]:
    prepared = []
    for source in source_rows:
        blind = source["blind_input"]; year = int(blind["season"]); old = v01[blind["game_id"]]
        context = adapt_blind_input(blind, prior_profiles.get(year, {}), prior_games)
        components = component_projections(context)
        simulator_margin = mean(value["margin"] for value in components.values())
        simulator_total = mean(value["total"] for value in components.values())
        # Smooth blind-implied garbage-time expectation. This is not a cap and
        # does not use the sportsbook favorite; distribution tails remain in
        # the possession simulator.
        compression = .12 * logistic((abs(simulator_margin) - 22) / 4.5)
        simulator_margin *= 1 - compression
        if context["v02_context"]["cross_class"]:
            simulator_total -= 2.0 * logistic((abs(simulator_margin) - 18) / 5)
        margins = [value["margin"] for value in components.values()]
        dispersion = pstdev(margins)
        quality_score, quality_grade = data_quality(context, dispersion)
        target = source["targets"]
        first_margin = target.get("home_first_half_score") - target.get("away_first_half_score") if target.get("home_first_half_score") is not None and target.get("away_first_half_score") is not None else None
        first_total = target.get("home_first_half_score") + target.get("away_first_half_score") if target.get("home_first_half_score") is not None and target.get("away_first_half_score") is not None else None
        prepared.append({
            "source": source, "context": context, "v01": old, "season": year,
            "margin_features": statistical_features(context, old),
            "total_features": total_features(context, old),
            "simulator_margin": simulator_margin, "simulator_total": simulator_total,
            "dispersion": dispersion, "quality_score": quality_score, "quality_grade": quality_grade,
            "actual_margin": float(target["actual_margin"]), "actual_total": float(target["actual_total"]),
            "actual_first_margin": first_margin, "actual_first_total": first_total,
        })
    return prepared


def first_half_margin_features(record: Mapping[str, Any]) -> dict[str, float]:
    row = record["context"]
    base = dict(record["margin_features"])
    base.update({
        "early_down_epa_diff": float(row["home"].get("early_down_epa") or 0) - float(row["away"].get("early_down_epa") or 0),
        "qb_continuity_diff_1h": float(row["home"].get("qb_continuity") or .5) - float(row["away"].get("qb_continuity") or .5),
        "first_half_pace_sum": float(row["home"].get("plays_per_game") or 70) + float(row["away"].get("plays_per_game") or 70),
    })
    return base


def first_half_total_features(record: Mapping[str, Any]) -> dict[str, float]:
    row = record["context"]
    base = dict(record["total_features"])
    base.update({
        "early_down_epa_sum": float(row["home"].get("early_down_epa") or 0) + float(row["away"].get("early_down_epa") or 0),
        "qb_continuity_sum_1h": float(row["home"].get("qb_continuity") or .5) + float(row["away"].get("qb_continuity") or .5),
    })
    return base


def fit_baselines(records: list[dict], years: set[int], alpha: float) -> dict[str, RidgeModel]:
    rows = [record for record in records if record["season"] in years]
    return {
        "margin": fit_ridge((row["margin_features"] for row in rows), (row["actual_margin"] for row in rows), alpha),
        "total": fit_ridge((row["total_features"] for row in rows), (row["actual_total"] for row in rows), alpha),
        "first_margin": fit_ridge((first_half_margin_features(row) for row in rows), (row["actual_first_margin"] for row in rows), alpha),
        "first_total": fit_ridge((first_half_total_features(row) for row in rows), (row["actual_first_total"] for row in rows), alpha),
    }


def baseline_prediction(record: Mapping[str, Any], models: Mapping[str, RidgeModel]) -> dict[str, float]:
    return {
        "stat_margin": models["margin"].predict(record["margin_features"]),
        "stat_total": models["total"].predict(record["total_features"]),
        "first_margin": models["first_margin"].predict(first_half_margin_features(record)),
        "first_total": models["first_total"].predict(first_half_total_features(record)),
    }


def choose_foundation(source_rows, prior_profiles, v01):
    trials = []
    best = None
    for prior_games in PRIOR_GRID:
        records = prepare([row for row in source_rows if row["blind_input"]["season"] <= VALIDATION_A_YEAR], prior_profiles, v01, prior_games)
        train = [row for row in records if row["season"] in TRAIN_YEARS]
        validation = [row for row in records if row["season"] == VALIDATION_A_YEAR]
        for alpha in RIDGE_GRID:
            models = fit_baselines(train, TRAIN_YEARS, alpha)
            predictions = [baseline_prediction(row, models) for row in validation]
            margin_error = mae((row["actual_margin"] for row in validation), (item["stat_margin"] for item in predictions))
            total_error = mae((row["actual_total"] for row in validation), (item["stat_total"] for item in predictions))
            first_error = mae((row["actual_first_margin"] for row in validation), (item["first_margin"] for item in predictions))
            score = margin_error + .35 * total_error + .20 * first_error
            trial = {"prior_equivalent_games": prior_games, "alpha": alpha, "margin_mae": margin_error,
                     "total_mae": total_error, "first_half_margin_mae": first_error, "selection_score": score}
            trials.append(trial)
            if best is None or score < best[0]: best = (score, prior_games, alpha)
    return {"prior_equivalent_games": best[1], "alpha": best[2], "trials": trials}


def choose_blends(train, validation, models):
    train_predictions = {id(row): baseline_prediction(row, models) for row in train}
    validation_predictions = {id(row): baseline_prediction(row, models) for row in validation}
    choices = {}
    for target, stat_key, sim_key in (("margin", "stat_margin", "simulator_margin"), ("total", "stat_total", "simulator_total")):
        actual_key = f"actual_{target}"; trials = []
        for weight in BLEND_GRID:
            error = mae((row[actual_key] for row in validation),
                        (weight * validation_predictions[id(row)][stat_key] + (1-weight) * row[sim_key] for row in validation))
            trials.append({"statistical_weight": weight, "mae": error})
        choices[target] = min(trials, key=lambda row: row["mae"])["statistical_weight"]
        choices[f"{target}_trials"] = trials
    return choices, train_predictions, validation_predictions


def raw_prediction(record, baseline, blends):
    return {
        "margin": blends["margin"] * baseline["stat_margin"] + (1-blends["margin"]) * record["simulator_margin"],
        "total": blends["total"] * baseline["stat_total"] + (1-blends["total"]) * record["simulator_total"],
        "first_margin": baseline["first_margin"], "first_total": baseline["first_total"],
    }


def fit_calibrators(train, baselines, blends, alpha):
    raw = [raw_prediction(row, baselines[id(row)], blends) for row in train]
    features = [calibration_features(item["margin"], item["total"], row["context"], row["dispersion"], row["quality_score"]) for row, item in zip(train, raw)]
    for feature in features: validate_calibration_features(feature)
    margin = fit_ridge(features, (row["actual_margin"] for row in train), alpha, nonnegative_feature="raw_margin")
    total = fit_ridge(features, (row["actual_total"] for row in train), alpha, nonnegative_feature="raw_total")
    return margin, total


def calibrated_prediction(record, baseline, blends, calibrators):
    raw = raw_prediction(record, baseline, blends)
    features = calibration_features(raw["margin"], raw["total"], record["context"], record["dispersion"], record["quality_score"])
    return {**raw, "margin": calibrators["margin"].predict(features), "total": calibrators["total"].predict(features)}


def choose_calibration(train, validation, models, blends, train_baselines, validation_baselines):
    trials=[]; best=None
    for alpha in RIDGE_GRID:
        margin, total = fit_calibrators(train, train_baselines, blends, alpha)
        predictions = [calibrated_prediction(row, validation_baselines[id(row)], blends, {"margin":margin,"total":total}) for row in validation]
        margin_error=mae((row["actual_margin"] for row in validation),(item["margin"] for item in predictions))
        total_error=mae((row["actual_total"] for row in validation),(item["total"] for item in predictions))
        score=margin_error+.35*total_error; trial={"alpha":alpha,"margin_mae":margin_error,"total_mae":total_error,"selection_score":score}; trials.append(trial)
        if best is None or score<best[0]:best=(score,alpha)
    return {"alpha":best[1],"trials":trials}


def regularized_ablation(train, validation, alpha):
    baseline_models=fit_baselines(train,TRAIN_YEARS,alpha)
    baseline_predictions=[baseline_prediction(row,baseline_models) for row in validation]
    baseline={"margin_mae":mae((row["actual_margin"] for row in validation),(item["stat_margin"] for item in baseline_predictions)),"total_mae":mae((row["actual_total"] for row in validation),(item["stat_total"] for item in baseline_predictions))}
    families={}
    for family,names in ABLATION_FAMILIES.items():
        def strip(features):return {key:value for key,value in features.items() if key not in names}
        margin_model=fit_ridge((strip(row["margin_features"]) for row in train),(row["actual_margin"] for row in train),alpha)
        total_model=fit_ridge((strip(row["total_features"]) for row in train),(row["actual_total"] for row in train),alpha)
        margin_error=mae((row["actual_margin"] for row in validation),(margin_model.predict(strip(row["margin_features"])) for row in validation))
        total_error=mae((row["actual_total"] for row in validation),(total_model.predict(strip(row["total_features"])) for row in validation))
        families[family]={"removed_features":list(names),"margin_mae":margin_error,"margin_delta_vs_full":margin_error-baseline["margin_mae"],"total_mae":total_error,"total_delta_vs_full":total_error-baseline["total_mae"],"interpretation":"aggregate statistical representation only; possession/matchup concept retained"}
    return {"fit_years":[2019,2020,2021],"evaluation_year":[2022],"observed_audit_used":False,"baseline":baseline,"families":families}


def fit_bundle(records, fit_years, alpha, blends, calibration_alpha):
    if set(fit_years) & OBSERVED_AUDIT_YEARS or not set(fit_years) <= {2019,2020,2021,2022,2023}:
        raise ValueError("2024-2025 OBSERVED_AUDIT rows are prohibited from v0.2 fitting")
    fit_rows=[row for row in records if row["season"] in fit_years]
    models=fit_baselines(fit_rows,set(fit_years),alpha)
    baselines={id(row):baseline_prediction(row,models) for row in fit_rows}
    margin_cal,total_cal=fit_calibrators(fit_rows,baselines,blends,calibration_alpha)
    provisional=[calibrated_prediction(row,baselines[id(row)],blends,{"margin":margin_cal,"total":total_cal}) for row in fit_rows]
    logistic_model=fit_logistic((item["margin"] for item in provisional),(int(row["actual_margin"]>0) for row in fit_rows))
    margin_sd=float(np.std([row["actual_margin"]-item["margin"] for row,item in zip(fit_rows,provisional)]))
    total_sd=float(np.std([row["actual_total"]-item["total"] for row,item in zip(fit_rows,provisional)]))
    dispersions=[row["dispersion"] for row in fit_rows]
    return {"models":models,"margin_calibrator":margin_cal,"total_calibrator":total_cal,"logistic":logistic_model,
            "margin_sd":margin_sd,"total_sd":total_sd,"dispersion_p75":float(np.quantile(dispersions,.75)),"dispersion_p90":float(np.quantile(dispersions,.90))}


def make_prediction(record, bundle, blends):
    baseline=baseline_prediction(record,bundle["models"])
    calibrated=calibrated_prediction(record,baseline,blends,{"margin":bundle["margin_calibrator"],"total":bundle["total_calibrator"]})
    margin=calibrated["margin"]; total=calibrated["total"]
    firewall=research_firewall(record["context"],margin,record["dispersion"],record["quality_grade"],bundle["dispersion_p75"],bundle["dispersion_p90"])
    return {"game_id":record["context"]["game_id"],"season":record["season"],"week":record["context"]["week"],
            "home_team":record["context"]["home_team"],"away_team":record["context"]["away_team"],
            "home_class":record["context"]["home"]["classification"],"away_class":record["context"]["away"]["classification"],
            "margin":margin,"total":total,"home_win_probability":logistic_predict(bundle["logistic"],margin),
            "margin_sd":bundle["margin_sd"],"total_sd":bundle["total_sd"],
            "first_half_margin":calibrated["first_margin"],"first_half_total":calibrated["first_total"],
            "dispersion":record["dispersion"],"quality_grade":record["quality_grade"],
            "structural_break":record["context"]["v02_context"]["structural_break_state"]!="STABLE",
            "structural_break_state":record["context"]["v02_context"]["structural_break_state"],
            "evidence_state":min((record["context"]["v02_context"]["home_evidence_state"],record["context"]["v02_context"]["away_evidence_state"]),key=("PRESEASON_HEAVY","TRANSITION","CURRENT_SEASON_STABLE").index),
            "effective_sample_size":record["context"]["v02_context"]["minimum_effective_sample_size"],
            "blind_implied_margin_regime":implied_margin_regime(margin),"research_firewall":firewall,
            "components":record["v01"]["components"],"statistical_margin":baseline["stat_margin"],"simulator_margin":record["simulator_margin"],
            "engine_version":ENGINE_VERSION}


def enrich_all(records, predictions):
    return [enrich(record["source"],prediction) | {key:prediction[key] for key in ("structural_break_state","evidence_state","effective_sample_size","blind_implied_margin_regime","research_firewall")}
            for record,prediction in zip(records,predictions)]


def grouped_metrics(rows, key):
    groups=defaultdict(list)
    for row in rows:groups[str(row[key])].append(row)
    return {name:metric(values) for name,values in sorted(groups.items())}


def quantile_group(values, value):
    p50,p75,p90=values
    if value<=p50:return "le_p50"
    if value<=p75:return "p50_p75"
    if value<=p90:return "p75_p90"
    return "gt_p90"


def disagreement_metrics(rows):
    groups=defaultdict(list)
    for row in rows:
        value=row.get("disagreement")
        bucket="unavailable" if value is None else "le_1" if value<=1 else "1_3" if value<3 else "3_5" if value<5 else "5_7" if value<7 else "7_plus"
        groups[bucket].append(row)
    return {key:metric(value) for key,value in groups.items()}


def dispersion_metrics(rows, training_dispersions):
    quantiles=(float(np.quantile(training_dispersions,.50)),float(np.quantile(training_dispersions,.75)),float(np.quantile(training_dispersions,.90)))
    groups=defaultdict(list)
    for row in rows:groups[quantile_group(quantiles,row["dispersion"])].append(row)
    return {"cutoffs":quantiles,"buckets":{key:metric(value) for key,value in groups.items()}}


def diagnostics(enriched_rows, training_dispersions):
    dispersion=dispersion_metrics(enriched_rows,training_dispersions)
    return {"by_week":grouped_metrics(enriched_rows,"week_group"),"by_class":grouped_metrics(enriched_rows,"class_group"),
            "by_blind_implied_margin":grouped_metrics(enriched_rows,"blind_implied_margin_regime"),
            "by_quality":grouped_metrics(enriched_rows,"quality_grade"),"by_structural_break":grouped_metrics(enriched_rows,"structural_break_state"),
            "by_evidence_state":grouped_metrics(enriched_rows,"evidence_state"),"by_dispersion":dispersion["buckets"],
            "by_market_disagreement":disagreement_metrics(enriched_rows),
            "firewall":{key:metric([row for row in enriched_rows if row["research_firewall"]==key]) for key in ("NORMAL","CORE_BLOCK","SECONDARY_MAX","PASS")},
            "firewall_counts":dict(Counter(row["research_firewall"] for row in enriched_rows)),"dispersion_cutoffs":dispersion["cutoffs"]}


def add_groups(rows):
    for row in rows:
        row["week_group"]="week_0_1" if row["week"]<=1 else "weeks_2_4" if row["week"]<=4 else "weeks_5_plus"
        row["class_group"]="FBS_vs_FBS" if row["home_class"]==row["away_class"]=="fbs" else "FBS_vs_FCS" if {row["home_class"],row["away_class"]}=={"fbs","fcs"} else "other"
    return rows


def compare_metrics(v01_rows,v02_rows):return {"v01":metric(v01_rows),"v02":metric(v02_rows)}


def serialize_bundle(bundle, foundation, blends, calibration_choice, fit_years):
    return {"engine_version":ENGINE_VERSION,"statistical_version":STATISTICAL_VERSION,"simulator_version":SIMULATOR_VERSION,"calibration_version":CALIBRATION_VERSION,
            "fit_years":sorted(fit_years),"prior_equivalent_games":foundation["prior_equivalent_games"],"ridge_alpha":foundation["alpha"],"calibration_alpha":calibration_choice["alpha"],"blend_weights":{"margin":blends["margin"],"total":blends["total"]},
            "models":{key:model.to_dict() for key,model in bundle["models"].items()},"margin_calibrator":bundle["margin_calibrator"].to_dict(),"total_calibrator":bundle["total_calibrator"].to_dict(),"logistic":bundle["logistic"],"margin_sd":bundle["margin_sd"],"total_sd":bundle["total_sd"],"dispersion_p75":bundle["dispersion_p75"],"dispersion_p90":bundle["dispersion_p90"],"market_features_used":False,"production_promotion_allowed":False}


def run(source_rows,v01,prior_profiles):
    validate_dataset(source_rows)
    foundation=choose_foundation(source_rows,prior_profiles,v01)
    records=prepare(source_rows,prior_profiles,v01,foundation["prior_equivalent_games"])
    train=[row for row in records if row["season"] in TRAIN_YEARS]; val_a=[row for row in records if row["season"]==VALIDATION_A_YEAR]; val_b=[row for row in records if row["season"]==VALIDATION_B_YEAR]; audit=[row for row in records if row["season"] in OBSERVED_AUDIT_YEARS]
    initial_models=fit_baselines(train,TRAIN_YEARS,foundation["alpha"])
    blends,train_base,val_a_base=choose_blends(train,val_a,initial_models)
    calibration_choice=choose_calibration(train,val_a,initial_models,blends,train_base,val_a_base)
    ablation=regularized_ablation(train,val_a,foundation["alpha"])
    val_b_bundle=fit_bundle(records,TRAIN_YEARS|{VALIDATION_A_YEAR},foundation["alpha"],blends,calibration_choice["alpha"])
    val_b_predictions=[make_prediction(row,val_b_bundle,blends) for row in val_b]
    final_bundle=fit_bundle(records,TRAIN_YEARS|{VALIDATION_A_YEAR,VALIDATION_B_YEAR},foundation["alpha"],blends,calibration_choice["alpha"])
    audit_predictions=[make_prediction(row,final_bundle,blends) for row in audit]
    val_a_bundle=fit_bundle(records,TRAIN_YEARS,foundation["alpha"],blends,calibration_choice["alpha"])
    val_a_predictions=[make_prediction(row,val_a_bundle,blends) for row in val_a]

    def old_predictions(selected):return [v01[row["context"]["game_id"]] for row in selected]
    val_a_v02=add_groups(enrich_all(val_a,val_a_predictions));val_a_v01=add_groups([enrich(row["source"],old) for row,old in zip(val_a,old_predictions(val_a))])
    val_b_v02=add_groups(enrich_all(val_b,val_b_predictions));val_b_v01=add_groups([enrich(row["source"],old) for row,old in zip(val_b,old_predictions(val_b))])
    audit_v02=add_groups(enrich_all(audit,audit_predictions));audit_v01=add_groups([enrich(row["source"],old) for row,old in zip(audit,old_predictions(audit))])
    # Enriched v0.1 rows need comparison-only grouping keys.
    for rows in (val_a_v01,val_b_v01,audit_v01):
        for row in rows:row["blind_implied_margin_regime"]=implied_margin_regime(row["margin"])

    audit_meta={row["game_id"]:row for row in audit_v02}
    for row in audit_v01:
        row["structural_break_state"]=audit_meta[row["game_id"]]["structural_break_state"]
        row["evidence_state"]=audit_meta[row["game_id"]]["evidence_state"]

    train_disp=[row["dispersion"] for row in records if row["season"]<=2023]
    audit_diag=diagnostics(audit_v02,train_disp)
    v01_training_dispersions=[v01[row["blind_input"]["game_id"]]["dispersion"] for row in source_rows if row["blind_input"]["season"]<=2023]
    v01_dispersion=dispersion_metrics(audit_v01,v01_training_dispersions)
    v01_audit_diag={"by_week":grouped_metrics(audit_v01,"week_group"),"by_class":grouped_metrics(audit_v01,"class_group"),"by_blind_implied_margin":grouped_metrics(audit_v01,"blind_implied_margin_regime"),"by_quality":grouped_metrics(audit_v01,"quality_grade"),"by_structural_break":grouped_metrics(audit_v01,"structural_break_state"),"by_dispersion":v01_dispersion["buckets"],"dispersion_cutoffs":v01_dispersion["cutoffs"],"by_market_disagreement":disagreement_metrics(audit_v01)}
    audit_v1=metric(audit_v01);audit_v2=metric(audit_v02)
    early1=metric([row for row in audit_v01 if row["week"]<=4]);early2=metric([row for row in audit_v02 if row["week"]<=4])
    cross1=metric([row for row in audit_v01 if row["class_group"]=="FBS_vs_FCS"]);cross2=metric([row for row in audit_v02 if row["class_group"]=="FBS_vs_FCS"])
    large1=metric([row for row in audit_v01 if abs(row["margin"])>=21]);large2=metric([row for row in audit_v02 if abs(row["margin"])>=21])
    stable_ids={row["game_id"] for row in audit_v02 if row["class_group"]=="FBS_vs_FBS" and row["week"]>=5 and row["structural_break_state"]=="STABLE"}
    stable1=metric([row for row in audit_v01 if row["game_id"] in stable_ids]);stable2=metric([row for row in audit_v02 if row["game_id"] in stable_ids])
    cross_pass=sum(row["research_firewall"]=="PASS" for row in audit_v02 if row["class_group"]=="FBS_vs_FCS")/max(1,cross2["n"])
    large_pass=sum(row["research_firewall"]=="PASS" for row in audit_v02 if abs(row["margin"])>=21)/max(1,large2["n"])
    disagreement=audit_diag["by_market_disagreement"];quality=audit_diag["by_quality"]
    uncertainty_sensible=bool(disagreement.get("7_plus",{}).get("margin_mae",0)>disagreement.get("le_1",{}).get("margin_mae",0) and quality.get("D",{}).get("margin_mae",0)>quality.get("B",{}).get("margin_mae",0))
    criteria={"meaningful_margin_improvement":audit_v2["margin_mae"]<=audit_v1["margin_mae"]*.92,"no_material_total_regression":audit_v2["total_mae"]<=audit_v1["total_mae"]*1.02,
              "early_improvement":early2["margin_mae"]<early1["margin_mae"],"cross_class_improvement_or_pass":cross2["margin_mae"]<cross1["margin_mae"]*.90 or cross_pass>=.75,
              "large_favorite_improvement_or_pass":large2["margin_mae"]<large1["margin_mae"]*.90 or large_pass>=.75,"stable_fbs_no_material_regression":stable2["margin_mae"]<=stable1["margin_mae"]*1.02,"uncertainty_and_disagreement_sensible":uncertainty_sensible}
    if all(criteria.values()):status="NCAAF_V02_LIVE_SHADOW_READY"
    elif audit_v2["margin_mae"]>audit_v1["margin_mae"]*1.05 or audit_v2["total_mae"]>audit_v1["total_mae"]*1.05:status="NCAAF_V02_REJECT"
    else:status="NCAAF_V02_RESEARCH_CONTINUE"
    return {"engine_version":ENGINE_VERSION,"research_chronology":{"training_foundation":[2019,2020,2021],"validation_a":[2022],"validation_b":[2023],"observed_audit":[2024,2025],"next_untouched":[2026]},
            "selection":{"foundation":foundation,"blends":blends,"calibration":calibration_choice},"regularized_ablation":ablation,"validation_a":compare_metrics(val_a_v01,val_a_v02),"validation_b":compare_metrics(val_b_v01,val_b_v02),
            "observed_audit":{"label":"OBSERVED_AUDIT_NOT_UNTOUCHED","comparison":compare_metrics(audit_v01,audit_v02),"v01_diagnostics":v01_audit_diag,"v02_diagnostics":audit_diag,"early_comparison":{"v01":early1,"v02":early2},"cross_class_comparison":{"v01":cross1,"v02":cross2,"pass_rate":cross_pass},"blind_large_favorite_comparison":{"v01":large1,"v02":large2,"pass_rate":large_pass},"stable_fbs_comparison":{"v01":stable1,"v02":stable2}},
            "promotion_criteria":criteria,"artifact":serialize_bundle(final_bundle,foundation,blends,calibration_choice,TRAIN_YEARS|{2022,2023}),"leakage":{"market_features_used":False,"calibration_features_validated":True,"observed_audit_used_for_tuning":False},"automatic_promotion_allowed":False,"deployment_performed":False,"final_status":status}


def main():
    parser=argparse.ArgumentParser();parser.add_argument("--input",default="data/ncaaf_history/derived/ncaaf-pregame-2019-2025.json");parser.add_argument("--v01-predictions",default="data/ncaaf_history/derived/v01-predictions.jsonl");parser.add_argument("--output",default="data/ncaaf_history/reports/v02-research.json");parser.add_argument("--artifact",default="data/ncaaf_history/derived/ncaaf-v02-artifact.json");args=parser.parse_args()
    source=json.loads(Path(args.input).read_text(encoding="utf-8"));v01=load_v01(args.v01_predictions);priors=build_prior_profiles(range(2019,2026));report=run(source,v01,priors)
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(report,indent=2),encoding="utf-8")
    artifact=Path(args.artifact);artifact.parent.mkdir(parents=True,exist_ok=True);artifact.write_text(json.dumps(report["artifact"],indent=2),encoding="utf-8")
    print(json.dumps({"final_status":report["final_status"],"validation_a":report["validation_a"],"validation_b":report["validation_b"],"observed_audit":report["observed_audit"]["comparison"],"promotion_criteria":report["promotion_criteria"]},indent=2))


if __name__=="__main__":main()
