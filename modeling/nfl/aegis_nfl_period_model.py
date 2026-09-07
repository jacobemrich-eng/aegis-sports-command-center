
from __future__ import annotations
from dataclasses import dataclass, replace
from typing import Tuple
import numpy as np
from aegis_nfl_drive_simulator import NFLTeamProfile

def _clip(x, lo, hi): return float(np.clip(x, lo, hi))

@dataclass
class NFLPeriodProfile:
    team: str
    q1_expected_drives: float = 2.55
    q1_points_per_drive: float = 1.85
    q1_scoring_drive_rate: float = 0.36
    q1_turnover_drive_rate: float = 0.085
    q1_explosive_td_rate: float = 0.030
    q1_seconds_per_play: float = 27.0
    h1_expected_drives: float = 5.35
    h1_points_per_drive: float = 1.95
    h1_scoring_drive_rate: float = 0.38
    h1_turnover_drive_rate: float = 0.090
    h1_explosive_td_rate: float = 0.032
    h1_seconds_per_play: float = 26.8
    final_2m_1h_points_per_drive: float = 2.05
    final_2m_1h_aggression: float = 1.00
    games_sample: int = 0
    data_quality: float = 0.80

@dataclass
class NFLPeriodProjection:
    team: str
    q1_efficiency_mult: float
    q1_tempo_mult: float
    h1_efficiency_mult: float
    h1_tempo_mult: float
    end_half_efficiency_mult: float
    uncertainty_multiplier: float
    notes: Tuple[str, ...]

def project_period(p: NFLPeriodProfile) -> NFLPeriodProjection:
    q1e=_clip(p.q1_points_per_drive/1.85,.82,1.20)
    h1e=_clip(p.h1_points_per_drive/1.95,.84,1.18)
    q1t=_clip(p.q1_seconds_per_play/27.0,.84,1.16)
    h1t=_clip(p.h1_seconds_per_play/26.8,.84,1.16)
    e2=_clip((p.final_2m_1h_points_per_drive/2.05)*p.final_2m_1h_aggression,.84,1.20)
    notes=[]
    if q1e>=1.08: notes.append("strong_opening_script")
    if q1e<=.92: notes.append("weak_opening_script")
    if q1t<=.94: notes.append("fast_q1_pace")
    if h1t>=1.08: notes.append("slow_first_half_pace")
    if e2>=1.08: notes.append("strong_end_half_offense")
    if p.h1_turnover_drive_rate>=.12: notes.append("first_half_turnover_tail")
    sample=min(1,p.games_sample/12) if p.games_sample else 0
    reliability=.75*p.data_quality+.25*sample
    unc=_clip(1+.17*(1-reliability),1,1.17)
    return NFLPeriodProjection(p.team,q1e,q1t,h1e,h1t,e2,unc,tuple(notes))

def apply_period_projection(base: NFLTeamProfile, proj: NFLPeriodProjection) -> NFLTeamProfile:
    return replace(
        base,
        opening_script_efficiency_mult=_clip(base.opening_script_efficiency_mult*proj.q1_efficiency_mult,.82,1.22),
        first_half_efficiency_mult=_clip(base.first_half_efficiency_mult*proj.h1_efficiency_mult,.84,1.20),
        first_half_tempo_mult=_clip(base.first_half_tempo_mult*proj.h1_tempo_mult,.84,1.18),
        end_half_aggressiveness=_clip(base.end_half_aggressiveness*proj.end_half_efficiency_mult,.84,1.20),
    )

def period_audit(p, proj):
    return {
        "team":p.team,
        "q1_expected_drives":round(p.q1_expected_drives,2),
        "q1_points_per_drive":round(p.q1_points_per_drive,3),
        "h1_expected_drives":round(p.h1_expected_drives,2),
        "h1_points_per_drive":round(p.h1_points_per_drive,3),
        "q1_efficiency_mult":round(proj.q1_efficiency_mult,3),
        "h1_efficiency_mult":round(proj.h1_efficiency_mult,3),
        "end_half_efficiency_mult":round(proj.end_half_efficiency_mult,3),
        "uncertainty_multiplier":round(proj.uncertainty_multiplier,3),
        "notes":list(proj.notes),
    }
