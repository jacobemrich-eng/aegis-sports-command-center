
from dataclasses import dataclass
from typing import Optional,List,Dict
import math
import numpy as np
from aegis_nfl_drive_simulator import american_profit_per_unit,implied_probability
from aegis_nfl_keynumber_model import reweight_margin_distribution,weighted_probability,key_crossing_penalty

@dataclass
class NFLMarketOffer:
    name:str
    market_type:str
    odds:int
    line:Optional[float]=None

@dataclass
class OptimizerConfig:
    min_raw_edge:float=.025
    min_secondary_edge:float=.035
    min_core_edge:float=.055
    max_secondary_fragility:float=.18
    max_core_fragility:float=.13
    max_secondary_uncertainty:float=1.20
    max_core_uncertainty:float=1.12
    market_challenger_weight:float=.25
    key_reweight_strength:float=.55
    fragility_penalty_weight:float=.18

def masks(arr,o):
    hs,aws,m,t=arr["home_score"],arr["away_score"],arr["margin"],arr["total"]
    hml,aml,tie=arr["home_ml_score"],arr["away_ml_score"],arr["post_ot_tie"]
    if o.market_type=="home_ml":
        return (hml>aml)&~tie,(hml<aml)&~tie,tie,np.zeros(len(m))
    if o.market_type=="away_ml":
        return (aml>hml)&~tie,(aml<hml)&~tie,tie,np.zeros(len(m))
    if o.line is None: raise ValueError("line required")
    if o.market_type=="home_spread": adj=m+o.line
    elif o.market_type=="away_spread": adj=-m+o.line
    elif o.market_type=="over": adj=t-o.line
    elif o.market_type=="under": adj=o.line-t
    elif o.market_type=="home_tt_over": adj=hs-o.line
    elif o.market_type=="home_tt_under": adj=o.line-hs
    elif o.market_type=="away_tt_over": adj=aws-o.line
    elif o.market_type=="away_tt_under": adj=o.line-aws
    else: raise ValueError(o.market_type)
    return adj>0,adj<0,adj==0,np.abs(adj)

class NFLMarketExpressionOptimizer:
    def __init__(self,config=None,key_calibration=None):
        self.config=config or OptimizerConfig()
        self.key_calibration=key_calibration

    def evaluate(self,arr,offers,market_home_spread=None,model_uncertainty=1.0,market_challenger_probs=None):
        c=self.config
        w=np.ones(len(arr["margin"]),float)
        if self.key_calibration is not None and market_home_spread is not None:
            w=reweight_margin_distribution(arr["margin"],market_home_spread,self.key_calibration,c.key_reweight_strength)
        out=[]
        for o in offers:
            win,lose,push,dist=masks(arr,o)
            pw=weighted_probability(win,w); pl=weighted_probability(lose,w); pp=weighted_probability(push,w)
            simfair=pw/max(1e-9,pw+pl)
            challenger=(market_challenger_probs or {}).get(o.name)
            fair=simfair if challenger is None else (1-c.market_challenger_weight)*simfair+c.market_challenger_weight*float(challenger)
            implied=implied_probability(o.odds); edge=fair-implied
            ev=pw*american_profit_per_unit(o.odds)-pl
            frag=weighted_probability(dist<=1,w)
            keyctx=None; keypen=0
            if o.market_type in {"home_spread","away_spread"}:
                toward=math.copysign(max(0,abs(o.line)-1),o.line)
                keyctx=key_crossing_penalty(toward,o.line); keypen=keyctx["fragility_penalty"]
            score=edge-c.fragility_penalty_weight*frag-keypen-max(0,model_uncertainty-1)*.22

            status="PASS"; reasons=[]
            if edge<c.min_raw_edge: reasons.append("edge_below_release_floor")
            elif model_uncertainty>c.max_secondary_uncertainty: reasons.append("uncertainty_too_high")
            elif frag>c.max_secondary_fragility: reasons.append("line_fragility_too_high")
            else:
                status="SECONDARY"
                if edge>=c.min_core_edge and frag<=c.max_core_fragility and model_uncertainty<=c.max_core_uncertainty:
                    status="CORE_CANDIDATE"
            if keyctx and keyctx["crossed_keys"]: reasons.append("crosses_key_"+("_".join(map(str,keyctx["crossed_keys"]))))
            out.append({"name":o.name,"market_type":o.market_type,"line":o.line,"odds":o.odds,
                        "win_probability":pw,"lose_probability":pl,"push_probability":pp,
                        "simulation_fair_probability":simfair,"market_challenger_probability":challenger,
                        "blended_fair_probability":fair,"book_implied_probability":implied,
                        "raw_probability_edge":edge,"raw_ev_per_unit":ev,
                        "fragility_mass_within_1pt":frag,"key_number_context":keyctx,
                        "model_uncertainty":model_uncertainty,"adjusted_selection_score":score,
                        "release_status":status,"reasons":reasons})
        out.sort(key=lambda r:r["adjusted_selection_score"],reverse=True)
        for i,r in enumerate(out,1): r["rank"]=i
        return out

    def choose_primary_expression(self,rows):
        eligible=[r for r in rows if r["release_status"]!="PASS"]
        if not eligible: return {"decision":"PASS","primary":None,"blocked_duplicates":[]}
        return {"decision":eligible[0]["release_status"],"primary":eligible[0],
                "blocked_duplicates":[r["name"] for r in eligible[1:]]}
