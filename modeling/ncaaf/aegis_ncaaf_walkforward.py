from __future__ import annotations

import argparse, json, math
from pathlib import Path
from statistics import mean

try:
    from .aegis_ncaaf_engine import project
except ImportError:
    from aegis_ncaaf_engine import project


def mae(rows): return mean(rows) if rows else None
def log_loss(p, y): p=max(.001,min(.999,p)); return -(y*math.log(p)+(1-y)*math.log(1-p))
def normal_cdf(value): return .5*(1+math.erf(value/math.sqrt(2)))
def evaluate(rows: list[dict], simulations: int = 5000) -> dict:
    ordered=sorted(rows,key=lambda row:(row["start_time"],row["game_id"])); n=len(ordered); train_end=int(n*.6); validation_end=int(n*.8)
    splits={"training":ordered[:train_end],"validation":ordered[train_end:validation_end],"untouched_holdout":ordered[validation_end:]}; report={"method":"time_ordered_walk_forward","weights_changed":False,"splits":{}}
    for name,games in splits.items():
        values=[]
        for row in games:
            blind=project({k:v for k,v in row.items() if k not in {"home_score","away_score","market_margin","market_total"}},generated_at=row["known_at"],simulations=simulations)
            actual_margin=row["home_score"]-row["away_score"]; actual_total=row["home_score"]+row["away_score"]
            market_margin=row.get("market_margin"); market_total=row.get("market_total"); projection=blind["projection"]; margin_sd=projection["distribution"]["margin_standard_deviation"]; total_sd=projection["distribution"]["total_standard_deviation"]
            cover_p=normal_cdf((projection["margin"]-market_margin)/margin_sd) if market_margin is not None else None; over_p=normal_cdf((projection["total"]-market_total)/total_sd) if market_total is not None else None
            first_half_actual=(row.get("home_first_half_score")-row.get("away_first_half_score")) if row.get("home_first_half_score") is not None and row.get("away_first_half_score") is not None else None
            disagreement=abs(projection["margin"]-market_margin) if market_margin is not None else None
            values.append({"margin":abs(actual_margin-projection["margin"]),"total":abs(actual_total-projection["total"]),"log_loss":log_loss(projection["moneyline_probabilities"]["home"],int(actual_margin>0)),"cover_brier":(cover_p-int(actual_margin>market_margin))**2 if cover_p is not None and actual_margin!=market_margin else None,"over_brier":(over_p-int(actual_total>market_total))**2 if over_p is not None and actual_total!=market_total else None,"market_margin":abs(actual_margin-market_margin) if market_margin is not None else None,"market_total":abs(actual_total-market_total) if market_total is not None else None,"week":row.get("week"),"cross_class":row["home"].get("classification")!=row["away"].get("classification"),"favorite_size":abs(projection["margin"]),"first_half_margin_error":abs(first_half_actual-projection["period_probabilities"]["first_half"]["margin"]) if first_half_actual is not None else None,"disagreement":disagreement})
        report["splits"][name]={"games":len(values),"margin_mae":mae([x["margin"] for x in values]),"total_mae":mae([x["total"] for x in values]),"win_log_loss":mae([x["log_loss"] for x in values]),"ats_brier":mae([x["cover_brier"] for x in values if x["cover_brier"] is not None]),"total_brier":mae([x["over_brier"] for x in values if x["over_brier"] is not None]),"market_margin_mae":mae([x["market_margin"] for x in values if x["market_margin"] is not None]),"market_total_mae":mae([x["market_total"] for x in values if x["market_total"] is not None]),"early_season_margin_mae":mae([x["margin"] for x in values if int(x["week"] or 0)<=4]),"cross_class_margin_mae":mae([x["margin"] for x in values if x["cross_class"]]),"first_half_margin_mae":mae([x["first_half_margin_error"] for x in values if x["first_half_margin_error"] is not None]),"favorite_size_buckets":{"21_plus":mae([x["margin"] for x in values if x["favorite_size"]>=21]),"28_plus":mae([x["margin"] for x in values if x["favorite_size"]>=28]),"35_plus":mae([x["margin"] for x in values if x["favorite_size"]>=35])},"disagreement_buckets":{"lt_3":mae([x["margin"] for x in values if x["disagreement"] is not None and x["disagreement"]<3]),"3_7":mae([x["margin"] for x in values if x["disagreement"] is not None and 3<=x["disagreement"]<7]),"7_plus":mae([x["margin"] for x in values if x["disagreement"] is not None and x["disagreement"]>=7])}}
    report["promotion_allowed"]=False; report["monitoring_state"]="INSUFFICIENT_SAMPLE"; return report


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--input",required=True); parser.add_argument("--output",required=True); parser.add_argument("--simulations",type=int,default=5000); args=parser.parse_args()
    rows=json.loads(Path(args.input).read_text()); result=evaluate(rows,args.simulations); Path(args.output).write_text(json.dumps(result,indent=2)); print(json.dumps(result,indent=2))


if __name__ == "__main__": main()
