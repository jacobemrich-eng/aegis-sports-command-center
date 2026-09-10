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
def evaluate(rows: list[dict], simulations: int = 5000) -> dict:
    ordered=sorted(rows,key=lambda row:(row["start_time"],row["game_id"])); n=len(ordered); train_end=int(n*.6); validation_end=int(n*.8)
    splits={"training":ordered[:train_end],"validation":ordered[train_end:validation_end],"untouched_holdout":ordered[validation_end:]}; report={"method":"time_ordered_walk_forward","weights_changed":False,"splits":{}}
    for name,games in splits.items():
        values=[]
        for row in games:
            blind=project({k:v for k,v in row.items() if k not in {"home_score","away_score","market_margin","market_total"}},generated_at=row["known_at"],simulations=simulations)
            actual_margin=row["home_score"]-row["away_score"]; actual_total=row["home_score"]+row["away_score"]
            values.append({"margin":abs(actual_margin-blind["projection"]["margin"]),"total":abs(actual_total-blind["projection"]["total"]),"log_loss":log_loss(blind["projection"]["moneyline_probabilities"]["home"],int(actual_margin>0)),"market_margin":abs(actual_margin-row["market_margin"]) if row.get("market_margin") is not None else None,"market_total":abs(actual_total-row["market_total"]) if row.get("market_total") is not None else None,"week":row.get("week"),"cross_class":row["home"].get("classification")!=row["away"].get("classification"),"favorite_size":abs(blind["projection"]["margin"])})
        report["splits"][name]={"games":len(values),"margin_mae":mae([x["margin"] for x in values]),"total_mae":mae([x["total"] for x in values]),"win_log_loss":mae([x["log_loss"] for x in values]),"market_margin_mae":mae([x["market_margin"] for x in values if x["market_margin"] is not None]),"market_total_mae":mae([x["market_total"] for x in values if x["market_total"] is not None]),"early_season_margin_mae":mae([x["margin"] for x in values if int(x["week"] or 0)<=4]),"cross_class_margin_mae":mae([x["margin"] for x in values if x["cross_class"]]),"favorite_21_plus_margin_mae":mae([x["margin"] for x in values if x["favorite_size"]>=21])}
    report["promotion_allowed"]=False; report["monitoring_state"]="INSUFFICIENT_SAMPLE"; return report


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--input",required=True); parser.add_argument("--output",required=True); parser.add_argument("--simulations",type=int,default=5000); args=parser.parse_args()
    rows=json.loads(Path(args.input).read_text()); result=evaluate(rows,args.simulations); Path(args.output).write_text(json.dumps(result,indent=2)); print(json.dumps(result,indent=2))


if __name__ == "__main__": main()
