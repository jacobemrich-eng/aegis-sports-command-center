from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
import math
import os
from pathlib import Path
from statistics import mean
from typing import Iterable, Mapping

try:
    from .aegis_ncaaf_engine import ENGINE_VERSION, SIMULATIONS, project, walk_keys
except ImportError:
    from aegis_ncaaf_engine import ENGINE_VERSION, SIMULATIONS, project, walk_keys

FORBIDDEN_HISTORICAL = {"targets", "market", "home_score", "away_score", "actual_margin", "actual_total", "final_score", "closing_line", "spread", "total_line", "sp_rating", "srs", "core", "postseason_rank", "postgame_elo"}
COMPONENT_FAMILIES = {
    "Power/Talent": ["power"], "Efficiency/EPA": ["efficiency_epa"], "Drive": ["drive_efficiency"],
    "Explosiveness/Havoc": ["explosiveness_havoc"], "Trenches": ["matchup_trenches"],
    "Personnel": ["personnel_situational"], "Tempo": ["special_teams_context"],
    "Special Teams": ["special_teams_context"], "Situational": ["personnel_situational", "special_teams_context"],
    "Structural Break / Uncertainty": [],
}

def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def digest(value): return hashlib.sha256(canonical(value).encode()).hexdigest()
def avg(values: Iterable[float | None]) -> float | None:
    rows=[float(v) for v in values if v is not None and math.isfinite(float(v))]; return mean(rows) if rows else None
def root_mean_square(errors):
    rows=[float(v) for v in errors if v is not None]; return math.sqrt(mean(v*v for v in rows)) if rows else None
def normal_cdf(value): return .5*(1+math.erf(value/math.sqrt(2)))
def log_loss(probability, outcome):
    probability=max(.001,min(.999,probability)); return -(outcome*math.log(probability)+(1-outcome)*math.log(1-probability))

def validate_dataset(rows):
    from datetime import datetime
    failures=[]
    parse=lambda value: datetime.fromisoformat(str(value).replace("Z","+00:00"))
    for index,row in enumerate(rows):
        blind=row.get("blind_input",{}); game_id=blind.get("game_id") or f"row-{index}"; leaking=sorted({key for key,_ in walk_keys(blind)} & FORBIDDEN_HISTORICAL)
        if leaking: failures.append({"game_id":game_id,"reason":"blind_contains_forbidden","fields":leaking})
        try:
            if not parse(blind["source_max_known_at"])<parse(blind["kickoff_at"]) or not parse(blind["prediction_cutoff_at"])<parse(blind["kickoff_at"]): failures.append({"game_id":game_id,"reason":"cutoff_not_before_kickoff"})
            if blind.get("leakage_check_passed") is not True: failures.append({"game_id":game_id,"reason":"builder_leakage_flag_false"})
        except Exception as error: failures.append({"game_id":game_id,"reason":"invalid_cutoff_metadata","error":str(error)})
        if row.get("market",{}).get("blind_feature_eligible") is not False: failures.append({"game_id":game_id,"reason":"market_not_separated"})
    if failures: raise ValueError(f"Historical leakage audit failed ({len(failures)}): {failures[:5]}")
    return {"rows":len(rows),"leakage_check_passed":True,"forbidden_fields":sorted(FORBIDDEN_HISTORICAL)}

def predict_one(item):
    row,simulations=item; blind=row["blind_input"]; output=project(blind,generated_at=blind["prediction_cutoff_at"],simulations=simulations); projection=output["projection"]
    return {"game_id":blind["game_id"],"input_sha256":digest(blind),"engine_version":ENGINE_VERSION,"season":blind["season"],"week":blind["week"],"home_team":blind["home_team"],"away_team":blind["away_team"],"home_class":blind["home"]["classification"],"away_class":blind["away"]["classification"],"margin":projection["margin"],"total":projection["total"],"home_win_probability":projection["moneyline_probabilities"]["home"],"margin_sd":projection["distribution"]["margin_standard_deviation"],"total_sd":projection["distribution"]["total_standard_deviation"],"first_half_margin":projection["period_probabilities"]["first_half"]["margin"],"first_half_total":projection["period_probabilities"]["first_half"]["total"],"dispersion":output["quality"]["model_dispersion"],"quality_grade":output["quality"]["data_quality_grade"],"structural_break":output["quality"]["structural_break"],"components":output["diagnostics"]["component_projections"]}

def predictions(rows, cache_path, simulations, workers):
    cache={}
    if cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                row=json.loads(line); cache[row["game_id"]]=row
    pending=[row for row in rows if cache.get(row["blind_input"]["game_id"],{}).get("input_sha256")!=digest(row["blind_input"]) or cache.get(row["blind_input"]["game_id"],{}).get("simulations")!=simulations]
    cache_path.parent.mkdir(parents=True,exist_ok=True)
    with cache_path.open("a",encoding="utf-8") as handle, ProcessPoolExecutor(max_workers=workers) as pool:
        for index,result in enumerate(pool.map(predict_one,((row,simulations) for row in pending),chunksize=2),1):
            result["simulations"]=simulations; cache[result["game_id"]]=result; handle.write(json.dumps(result,separators=(",",":"))+"\n"); handle.flush()
            if index%100==0: print(json.dumps({"predicted":index,"pending":len(pending),"simulations_per_game":simulations}),flush=True)
    return cache

def enrich(row, prediction):
    target=row["targets"]; market=row["market"]; actual_margin=float(target["actual_margin"]); actual_total=float(target["actual_total"]); market_margin=-float(market["home_spread"]) if market.get("home_spread") is not None else None; market_total=float(market["total"]) if market.get("total") is not None else None
    cover_probability=normal_cdf((prediction["margin"]-market_margin)/prediction["margin_sd"]) if market_margin is not None and prediction["margin_sd"] else None; over_probability=normal_cdf((prediction["total"]-market_total)/prediction["total_sd"]) if market_total is not None and prediction["total_sd"] else None
    home_cover=None if market_margin is None or actual_margin==market_margin else int(actual_margin>market_margin); over=None if market_total is None or actual_total==market_total else int(actual_total>market_total)
    selected_side="NO_MARKET" if market_margin is None else "HOME" if prediction["margin"]>market_margin else "AWAY"; ats="UNAVAILABLE" if home_cover is None else "WIN" if (home_cover==1)==(selected_side=="HOME") else "LOSS"
    selected_total="NO_MARKET" if market_total is None else "OVER" if prediction["total"]>market_total else "UNDER"; total_result="UNAVAILABLE" if over is None else "WIN" if (over==1)==(selected_total=="OVER") else "LOSS"
    first_home=target.get("home_first_half_score"); first_away=target.get("away_first_half_score"); actual_first_margin=first_home-first_away if first_home is not None and first_away is not None else None; actual_first_total=first_home+first_away if first_home is not None and first_away is not None else None
    return {**prediction,"actual_margin":actual_margin,"actual_total":actual_total,"margin_error":abs(actual_margin-prediction["margin"]),"total_error":abs(actual_total-prediction["total"]),"win_brier":(prediction["home_win_probability"]-int(actual_margin>0))**2,"win_log_loss":log_loss(prediction["home_win_probability"],int(actual_margin>0)),"market_margin":market_margin,"market_total":market_total,"market_margin_error":abs(actual_margin-market_margin) if market_margin is not None else None,"market_total_error":abs(actual_total-market_total) if market_total is not None else None,"disagreement":abs(prediction["margin"]-market_margin) if market_margin is not None else None,"cover_brier":(cover_probability-home_cover)**2 if cover_probability is not None and home_cover is not None else None,"total_brier":(over_probability-over)**2 if over_probability is not None and over is not None else None,"ats_result":ats,"total_result":total_result,"selected_side":selected_side,"selected_total":selected_total,"favorite_size":abs(market_margin) if market_margin is not None else None,"first_half_margin_error":abs(actual_first_margin-prediction["first_half_margin"]) if actual_first_margin is not None else None,"first_half_total_error":abs(actual_first_total-prediction["first_half_total"]) if actual_first_total is not None else None,"model_beat_market":abs(actual_margin-prediction["margin"])<abs(actual_margin-market_margin) if market_margin is not None else None,"market_timestamp_classification":market.get("timestamp_classification")}

def metric(rows):
    ats=Counter(row["ats_result"] for row in rows if row["ats_result"]!="UNAVAILABLE")
    totals=Counter(row["total_result"] for row in rows if row["total_result"]!="UNAVAILABLE")
    return {"n":len(rows),"market_n":sum(row["market_margin"] is not None for row in rows),"margin_mae":avg(row["margin_error"] for row in rows),"margin_rmse":root_mean_square(row["margin_error"] for row in rows),"total_mae":avg(row["total_error"] for row in rows),"total_rmse":root_mean_square(row["total_error"] for row in rows),"win_brier":avg(row["win_brier"] for row in rows),"win_log_loss":avg(row["win_log_loss"] for row in rows),"ats_brier":avg(row["cover_brier"] for row in rows),"total_brier":avg(row["total_brier"] for row in rows),"market_margin_mae":avg(row["market_margin_error"] for row in rows),"market_total_mae":avg(row["market_total_error"] for row in rows),"model_beat_market_pct":avg(float(row["model_beat_market"]) for row in rows if row["model_beat_market"] is not None),"ats_diagnostic":dict(ats),"total_diagnostic":dict(totals),"first_half_margin_mae":avg(row["first_half_margin_error"] for row in rows),"first_half_total_mae":avg(row["first_half_total_error"] for row in rows)}

def group(rows, function):
    buckets=defaultdict(list)
    for row in rows: buckets[function(row)].append(row)
    return {name:metric(values) for name,values in sorted(buckets.items())}

def correlation(rows,x,y):
    pairs=[(row[x],row[y]) for row in rows if row.get(x) is not None and row.get(y) is not None]
    if len(pairs)<2:return None
    xs,ys=zip(*pairs); mx,my=mean(xs),mean(ys); denominator=math.sqrt(sum((a-mx)**2 for a in xs)*sum((b-my)**2 for b in ys)); return sum((a-mx)*(b-my) for a,b in pairs)/denominator if denominator else None

def ablation(rows):
    subsets={"development_2019_2022":[row for row in rows if row["season"]<=2022],"validation_2023":[row for row in rows if row["season"]==2023]}
    output={"scope":"2019-2023 development/validation only","untouched_holdout_used":False,"baselines":{name:avg(row["margin_error"] for row in subset) for name,subset in subsets.items()},"families":{}}
    for family,removed in COMPONENT_FAMILIES.items():
        if not removed: output["families"][family]={"status":"diagnostic_only_not_removed","reason":"Uncertainty is governance metadata, not a mean component"}; continue
        result={}
        for subset_name,subset in subsets.items():
            errors=[]
            for row in subset:
                kept=[value["margin"] for name,value in row["components"].items() if name not in removed]; errors.append(abs(row["actual_margin"]-mean(kept)))
            value=avg(errors); baseline=output["baselines"][subset_name]
            result[subset_name]={"ablated_margin_mae":value,"delta_vs_full":value-baseline if value is not None and baseline is not None else None}
        output["families"][family]={"results":result,"interpretation":"aggregate representation only; simulator concept retained"}
    return output

def split_name(season):
    season=int(season)
    if season <= 2022: return "development_2019_2022"
    if season == 2023: return "validation_2023"
    if season in {2024, 2025}: return "untouched_holdout_2024_2025"
    raise ValueError(f"Season {season} is outside the frozen 2019-2025 walk-forward design")

def evaluate(source_rows, prediction_map, simulations):
    rows=[enrich(row,prediction_map[row["blind_input"]["game_id"]]) for row in source_rows]; splits={name:[] for name in ("development_2019_2022","validation_2023","untouched_holdout_2024_2025")}
    for row in rows: splits[split_name(row["season"])].append(row)
    holdout=splits["untouched_holdout_2024_2025"]
    week=lambda r:"week_0_1" if r["week"]<=1 else "weeks_2_4" if r["week"]<=4 else "weeks_5_plus"
    favorite=lambda r:"unavailable" if r["favorite_size"] is None else "pickem_6_5" if r["favorite_size"]<=6.5 else "7_13_5" if r["favorite_size"]<=13.5 else "14_20_5" if r["favorite_size"]<=20.5 else "21_27_5" if r["favorite_size"]<=27.5 else "28_34_5" if r["favorite_size"]<=34.5 else "35_plus"
    classes=lambda r:"FBS_vs_FBS" if r["home_class"]==r["away_class"]=="fbs" else "FBS_vs_FCS" if {r["home_class"],r["away_class"]}=={"fbs","fcs"} else "other_cross_class"
    disagreement=lambda r:"unavailable" if r["disagreement"] is None else "le_1" if r["disagreement"]<=1 else "1_3" if r["disagreement"]<3 else "3_5" if r["disagreement"]<5 else "5_7" if r["disagreement"]<7 else "7_plus"
    holdout_metric=metric(holdout); catastrophic=bool(holdout_metric["market_margin_mae"] and holdout_metric["margin_mae"]>holdout_metric["market_margin_mae"]*1.30 and holdout_metric["market_total_mae"] and holdout_metric["total_mae"]>holdout_metric["market_total_mae"]*1.30); beats=bool(holdout_metric["market_margin_mae"] and holdout_metric["margin_mae"]<holdout_metric["market_margin_mae"] and holdout_metric["market_total_mae"] and holdout_metric["total_mae"]<holdout_metric["market_total_mae"])
    status="NCAAF_V01_SHADOW_READY" if beats and len(holdout)>=1000 else "NCAAF_V01_REJECT" if catastrophic else "NCAAF_V01_RESEARCH_CONTINUE"
    return {"engine_version":ENGINE_VERSION,"simulations_per_game":simulations,"method":"season_aware_chronological_2019_2022__2023__2024_2025","weights_changed":False,"holdout_used_for_selection":False,"market_role":"post_blind_evaluation_comparator_only","first_half_market_lines_reliable":False,"overall":metric(rows),"splits":{name:metric(values) for name,values in splits.items()},"holdout_diagnostics":{"by_week":group(holdout,week),"by_favorite_size":group(holdout,favorite),"by_class":group(holdout,classes),"by_disagreement":group(holdout,disagreement),"large_favorite":metric([r for r in holdout if r["favorite_size"] is not None and r["favorite_size"]>=21]),"underdog_tail":{"n":sum(abs(r["actual_margin"]-r["margin"])>=21 for r in holdout),"rate":avg(float(abs(r["actual_margin"]-r["margin"])>=21) for r in holdout)},"ensemble_dispersion_error_correlation":correlation(holdout,"dispersion","margin_error"),"structural_break":metric([r for r in holdout if r["structural_break"]]),"low_data_quality":metric([r for r in holdout if r["quality_grade"] in {"C","D","F"}]),"data_quality_distribution":dict(Counter(r["quality_grade"] for r in holdout))},"ablation":ablation(rows),"automatic_promotion_allowed":False,"final_status":status}

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--input",required=True); parser.add_argument("--output",required=True); parser.add_argument("--prediction-cache",default="data/ncaaf_history/derived/v01-predictions.jsonl"); parser.add_argument("--simulations",type=int,default=SIMULATIONS); parser.add_argument("--workers",type=int,default=max(1,min(12,(os.cpu_count() or 4)-1))); args=parser.parse_args()
    rows=json.loads(Path(args.input).read_text(encoding="utf-8")); leakage=validate_dataset(rows); predicted=predictions(rows,Path(args.prediction_cache),args.simulations,args.workers); report=evaluate(rows,predicted,args.simulations); report["leakage_audit"]=leakage; report["dataset_sha256"]=digest(rows); target=Path(args.output); target.parent.mkdir(parents=True,exist_ok=True); target.write_text(json.dumps(report,indent=2),encoding="utf-8"); print(json.dumps(report,indent=2))

if __name__=="__main__": main()
