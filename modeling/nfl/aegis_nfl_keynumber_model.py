
from dataclasses import dataclass, field
from typing import Dict, Tuple
import math
import numpy as np
import pandas as pd

KEYS=(3,6,7,10,14,17,20,21)

@dataclass
class Bucket:
    name:str
    lo:float
    hi:float
    def contains(self,x): return self.lo <= abs(float(x)) < self.hi

BUCKETS=(Bucket("pick_to_2_5",0,2.75),Bucket("3_to_5_5",2.75,5.75),
         Bucket("6_to_8_5",5.75,8.75),Bucket("9_to_13_5",8.75,13.75),
         Bucket("14_plus",13.75,100))

@dataclass
class KeyNumberCalibration:
    keys:Tuple[int,...]=KEYS
    buckets:Tuple[Bucket,...]=BUCKETS
    mass:Dict[str,Dict[int,float]]=field(default_factory=dict)
    side_bias:Dict[str,float]=field(default_factory=dict)
    sample_size:Dict[str,int]=field(default_factory=dict)
    fitted:bool=False

    def bucket(self,spread):
        for b in self.buckets:
            if b.contains(spread): return b.name
        return self.buckets[-1].name

    def fit(self,df,spread_col="spread_line",home_score_col="home_score",away_score_col="away_score",prior_strength=120.0):
        x=df.dropna(subset=[spread_col,home_score_col,away_score_col]).copy()
        x["margin"]=pd.to_numeric(x[home_score_col])-pd.to_numeric(x[away_score_col])
        x["abs_margin"]=x["margin"].abs().round().astype(int)
        x["fav_home"]=pd.to_numeric(x[spread_col])<0
        x["fav_margin"]=np.where(x["fav_home"],x["margin"],-x["margin"])
        x["bucket"]=[self.bucket(s) for s in x[spread_col]]
        global_mass={k:float(x["abs_margin"].eq(k).mean()) for k in self.keys}
        keyx=x[x["abs_margin"].isin(self.keys)]
        global_side=float((keyx["fav_margin"]>0).mean()) if len(keyx) else .5

        for b in self.buckets:
            sub=x[x["bucket"].eq(b.name)]
            n=len(sub); self.sample_size[b.name]=int(n)
            self.mass[b.name]={}
            for k in self.keys:
                obs=int(sub["abs_margin"].eq(k).sum())
                self.mass[b.name][k]=float((obs+prior_strength*global_mass[k])/(n+prior_strength))
            ks=sub[sub["abs_margin"].isin(self.keys)]
            fav=int((ks["fav_margin"]>0).sum()); kn=len(ks)
            self.side_bias[b.name]=float((fav+prior_strength*.1*global_side)/(kn+prior_strength*.1))
        self.fitted=True
        return self

    def target_mass(self,spread): return dict(self.mass[self.bucket(spread)])
    def favorite_key_side_probability(self,spread): return self.side_bias[self.bucket(spread)]
    def audit(self,spread):
        b=self.bucket(spread)
        return {"bucket":b,"sample_size":self.sample_size.get(b,0),
                "exact_margin_mass":{str(k):round(v,5) for k,v in self.mass[b].items()},
                "favorite_share_on_key_margins":round(self.side_bias[b],4)}

def reweight_margin_distribution(margins,market_home_spread,calibration,strength=.55):
    m=np.asarray(margins,dtype=int); w=np.ones(len(m),dtype=float)
    target=calibration.target_mass(market_home_spread)
    fav_home=float(market_home_spread)<0
    fav_side=calibration.favorite_key_side_probability(market_home_spread)
    strength=float(np.clip(strength,0,1))
    for k,t in target.items():
        favmask=(m==k) if fav_home else (m==-k)
        dogmask=(m==-k) if fav_home else (m==k)
        sf=max(1e-9,float(favmask.mean())); sd=max(1e-9,float(dogmask.mean()))
        tf=t*fav_side; td=t*(1-fav_side)
        w[favmask]*=(1-strength)+strength*(tf/sf)
        w[dogmask]*=(1-strength)+strength*(td/sd)
    w=np.maximum(w,1e-8); w/=w.mean()
    return w

def weighted_probability(mask,weights):
    mask=np.asarray(mask,dtype=float); weights=np.asarray(weights,dtype=float)
    return float(np.sum(mask*weights)/np.sum(weights))

def key_crossing_penalty(line_a,line_b):
    lo,hi=sorted([abs(float(line_a)),abs(float(line_b))])
    crossed=[k for k in KEYS if lo < k <= hi]
    penalty=min(.12,.025*len(crossed)+.015*sum(k in (3,7) for k in crossed))
    return {"from":float(line_a),"to":float(line_b),"crossed_keys":crossed,
            "crossed_count":len(crossed),"fragility_penalty":round(penalty,4)}
