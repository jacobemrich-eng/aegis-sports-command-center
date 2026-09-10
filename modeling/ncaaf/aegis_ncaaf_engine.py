from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import random
from statistics import mean, pstdev
from typing import Any, Mapping

SPORT_KEY = "americanfootball_ncaaf"
ENGINE_VERSION = "NCAAF_v0.1_POSSESSION_ENSEMBLE_CANDIDATE"
SIMULATIONS = 20_000
FORBIDDEN = {"spread", "total_line", "moneyline", "odds", "sportsbook_spread", "sportsbook_total", "market_consensus", "closing_line", "final_score", "postgame_statistics", "future_injury_status", "provider_id", "numeric_id"}


def parse_time(value: object, name: str) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{name} is required")
    result = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def finite(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def walk_keys(value: object, prefix: str = ""):
    if isinstance(value, Mapping):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            yield str(key).lower(), path
            yield from walk_keys(child, path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_keys(child, f"{prefix}[{index}]")


def validate_blind_input(row: Mapping[str, Any]) -> None:
    violations = [path for key, path in walk_keys(row) if key in FORBIDDEN or key.startswith("sportsbook_") or key.startswith("postgame_")]
    if violations:
        raise ValueError(f"NCAAF blind input leakage: {', '.join(sorted(set(violations)))}")
    kickoff = parse_time(row.get("start_time"), "start_time")
    if not row.get("game_id") or not row.get("home_team") or not row.get("away_team"):
        raise ValueError("game_id, home_team, and away_team are required")
    for source in row.get("provenance", []):
        known = parse_time(source.get("known_at"), "provenance.known_at")
        if known >= kickoff:
            raise ValueError(f"Feature source is not known pregame: {source.get('name', 'unknown')}")
    for side in ("home", "away"):
        team = row.get(side)
        if not isinstance(team, Mapping):
            raise ValueError(f"{side} pregame profile is required")
        classification = str(team.get("classification", "unknown")).lower()
        if classification not in {"fbs", "fcs", "unknown"}:
            raise ValueError(f"Unsupported {side} classification: {classification}")


def logistic(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-20.0, min(20.0, value))))


def percentile(values: list[float], q: float) -> float:
    rows = sorted(values)
    index = (len(rows) - 1) * q
    low, high = math.floor(index), math.ceil(index)
    return rows[low] if low == high else rows[low] * (high - index) + rows[high] * (index - low)


def component_projections(row: Mapping[str, Any]) -> dict[str, dict[str, float]]:
    h, a = row["home"], row["away"]
    diff = lambda key, default=0.0: finite(h.get(key), default) - finite(a.get(key), default)
    home_adv = finite(row.get("home_field_advantage"), 2.5)
    pace_total = 46.0 + 1.6 * (finite(h.get("plays_per_game"), 70) + finite(a.get("plays_per_game"), 70) - 140) / 10
    cross = str(h.get("classification", "unknown")).lower() != str(a.get("classification", "unknown")).lower()
    class_margin = 0.0
    if cross:
        class_margin = 15.0 if str(h.get("classification", "unknown")).lower() == "fbs" else -15.0
    return {
        "power": {"margin": home_adv + diff("power_rating") + 2*diff("opponent_adjusted_efficiency") + 1.5*diff("talent_rating") + class_margin, "total": pace_total},
        "efficiency_epa": {"margin": home_adv + 18 * diff("net_epa_per_play") + 5*diff("early_down_epa") + 3*diff("success_rate"), "total": 45 + 18 * (finite(h.get("offense_epa_per_play")) + finite(a.get("offense_epa_per_play")))},
        "drive_efficiency": {"margin": home_adv + 2.3 * diff("points_per_drive") + 4*diff("finishing_drives"), "total": 12 * (finite(h.get("points_per_drive"), 2.1) + finite(a.get("points_per_drive"), 2.1))},
        "matchup_trenches": {"margin": home_adv + 8 * (diff("line_yards_rate") - diff("pressure_allowed_rate")) + 5*diff("pressure_rate") + 3*diff("coverage_grade"), "total": pace_total - 5 * (finite(h.get("pressure_allowed_rate"), .25) + finite(a.get("pressure_allowed_rate"), .25) - .5)},
        "personnel_situational": {"margin": home_adv + 5 * diff("qb_continuity") + 3 * diff("ol_continuity") + 2 * diff("returning_production") + 2*diff("transfer_translation") + 3*diff("availability_probability") + diff("coaching_continuity"), "total": pace_total},
        "explosiveness_havoc": {"margin": home_adv + 15 * diff("explosive_play_rate") + 10 * diff("havoc_rate"), "total": pace_total + 16 * (finite(h.get("explosive_play_rate"), .1) + finite(a.get("explosive_play_rate"), .1) - .2)},
        "special_teams_context": {"margin": home_adv + 2*diff("special_teams_rating") + diff("fourth_down_aggressiveness") - 2*diff("penalty_rate"), "total": pace_total + 3*finite(row.get("tempo_elasticity")) - 2*finite(row.get("weather_severity")) + finite(row.get("altitude_adjustment"))},
    }


def uncertainty(row: Mapping[str, Any], components: Mapping[str, Mapping[str, float]]) -> dict[str, Any]:
    week = int(finite(row.get("week"), 0)); h, a = row["home"], row["away"]
    continuity = mean([finite(h.get("returning_production"), .5), finite(a.get("returning_production"), .5), finite(h.get("qb_continuity"), .5), finite(a.get("qb_continuity"), .5), finite(h.get("ol_continuity"), .5), finite(a.get("ol_continuity"), .5)])
    structural = bool(h.get("coaching_change") or a.get("coaching_change") or h.get("qb_change") or a.get("qb_change") or continuity < .42)
    cross = str(h.get("classification", "unknown")) != str(a.get("classification", "unknown"))
    missing = sum(1 for side in (h, a) for key in ("power_rating","net_epa_per_play","points_per_drive","returning_production","qb_continuity","ol_continuity") if side.get(key) is None)
    early = week <= 4 and (structural or continuity < .65 or missing >= 3)
    margins = [x["margin"] for x in components.values()]
    dispersion = pstdev(margins)
    score = max(0.0, min(1.0, 1 - .055 * missing - (.12 if cross else 0) - (.14 if structural else 0)))
    return {"data_quality_score": score, "data_quality_grade": "A" if score >= .9 else "B" if score >= .78 else "C" if score >= .62 else "D", "uncertainty": 1 + (.28 if early else 0) + (.18 if cross else 0) + min(.35, dispersion / 30), "model_dispersion": dispersion, "ensemble_agreement": "LOW" if dispersion >= 7 else "MODERATE" if dispersion >= 3.5 else "HIGH", "structural_break": structural, "early_season_high_uncertainty": early, "missing_feature_count": missing}


def simulate(row: Mapping[str, Any], margin: float, total: float, quality: Mapping[str, Any], simulations: int) -> dict[str, Any]:
    seed = int(hashlib.sha256(str(row["game_id"]).encode()).hexdigest()[:16], 16)
    rng = random.Random(seed); h, a = row["home"], row["away"]
    tempo = max(9, min(18, round((finite(h.get("drives_per_game"), 12) + finite(a.get("drives_per_game"), 12)) / 2)))
    home_ppd = max(.3, (total + margin) / (2 * tempo)); away_ppd = max(.3, (total - margin) / (2 * tempo))
    margins, totals, homes, aways = [], [], [], []
    for _ in range(simulations):
        scores = []
        for side, ppd in ((h, home_ppd), (a, away_ppd)):
            drives = max(7, round(rng.gauss(tempo, 1.25)))
            explosive = finite(side.get("explosive_play_rate"), .1); turnover = finite(side.get("turnover_rate"), .12)
            points = 0
            for _drive in range(drives):
                roll = rng.random(); td = max(.06, min(.48, ppd / 7 * .72 + explosive * .25 - turnover * .18)); fg = max(.04, min(.25, ppd / 3 * .22))
                if roll < turnover: continue
                if roll < turnover + td: points += 7
                elif roll < turnover + td + fg: points += 3
            scores.append(points)
        home, away = scores
        # Explicit late-game/garbage-time response: leader slows while trailing offense gains possessions.
        if abs(home - away) >= 21:
            trailer = 1 if home > away else 0
            if rng.random() < .35: scores[trailer] += rng.choice((3, 7))
        home, away = scores; homes.append(home); aways.append(away); margins.append(home-away); totals.append(home+away)
    first_half_tempo = max(5, round(tempo * .54))
    scripted = 1.04 + .03 * (finite(h.get("early_down_epa")) + finite(a.get("early_down_epa")))
    first_half_total = total * (first_half_tempo / tempo) * scripted
    first_half_margin = margin * .56 + 1.2 * (finite(h.get("qb_continuity"), .5) - finite(a.get("qb_continuity"), .5))
    return {"projected_score": {"home": mean(homes), "away": mean(aways)}, "margin": mean(margins), "total": mean(totals), "moneyline_probabilities": {"home": sum(x > 0 for x in margins)/simulations, "away": sum(x < 0 for x in margins)/simulations}, "spread_probabilities": {}, "total_probabilities": {}, "period_probabilities": {"first_half": {"margin": first_half_margin, "total": first_half_total, "independent_model": True}}, "percentiles": {"margin": {"p10": percentile(margins,.1), "p50": percentile(margins,.5), "p90": percentile(margins,.9)}, "total": {"p10": percentile(totals,.1), "p50": percentile(totals,.5), "p90": percentile(totals,.9)}}, "distribution": {"simulations": simulations, "drive_level": True, "margin_standard_deviation": pstdev(margins), "total_standard_deviation": pstdev(totals)}}


def project(row: Mapping[str, Any], *, generated_at: str | None = None, simulations: int = SIMULATIONS) -> dict[str, Any]:
    validate_blind_input(row)
    produced_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    if parse_time(produced_at, "generated_at") >= parse_time(row["start_time"], "start_time"):
        raise ValueError("Blind projection must be generated before kickoff")
    components = component_projections(row); quality = uncertainty(row, components)
    margin = mean(x["margin"] for x in components.values()); total = mean(x["total"] for x in components.values())
    projection = simulate(row, margin, total, quality, simulations)
    favorite = abs(projection["margin"])
    diagnostics = {"blind_features": sorted({key for side in (row["home"], row["away"]) for key in side}), "component_projections": components, "why_it_wins": ["Independent power, efficiency, and drive components align."], "how_it_loses": ["Turnovers and explosive-drive variance overwhelm the mean projection."], "tail_risks": ["College roster/regime uncertainty and garbage-time scoring widen tails."], "matchup_drivers": sorted(components), "sport_specific": {"ncaaf": {"garbage_time": {"assessed": True, "favorite_points": favorite, "backup_rotation_cover_viable": favorite < 35 or quality["uncertainty"] < 1.25}, "structural_break": quality["structural_break"], "cross_class": row["home"].get("classification") != row["away"].get("classification"), "first_half_is_independent": True, "market_expression_optimizer": "LOCKED_UNTIL_MARKET_AFTER_BLIND", "residual_correlation_gate": "SHADOW_SEPARATE", "portfolio_risk": "SHADOW_SEPARATE"}}}
    diagnostics["sport_specific"]["ncaaf"]["stress_test"]={"adverse_margin_p10":projection["percentiles"]["margin"]["p10"],"tail_width":projection["percentiles"]["margin"]["p90"]-projection["percentiles"]["margin"]["p10"],"passed_for_release":False}
    output = {"schema_version": "AEGIS_NCAAF_BLIND_v1", "sport": SPORT_KEY, "engine_version": ENGINE_VERSION, "game_id": row["game_id"], "generated_at": produced_at, "game": {"id": row["game_id"], "home": row["home_team"], "away": row["away_team"], "start_time": row["start_time"], "season": row.get("season"), "week": row.get("week")}, "blind_features": diagnostics["blind_features"], "projection": projection, "quality": quality, "diagnostics": diagnostics, "provenance": row.get("provenance", []), "release_status": "SHADOW_ONLY"}
    validate_blind_input({k:v for k,v in output.items() if k != "projection"} | {"start_time": row["start_time"], "home_team": row["home_team"], "away_team": row["away_team"], "home": row["home"], "away": row["away"]})
    return output


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--input", required=True); parser.add_argument("--output", required=True); parser.add_argument("--simulations", type=int, default=SIMULATIONS)
    args = parser.parse_args(); payload = json.loads(Path(args.input).read_text(encoding="utf-8")); rows = payload if isinstance(payload,list) else [payload]
    results = [project(row, simulations=args.simulations) for row in rows]; Path(args.output).parent.mkdir(parents=True, exist_ok=True); Path(args.output).write_text(json.dumps(results if isinstance(payload,list) else results[0], indent=2), encoding="utf-8"); return 0


if __name__ == "__main__": raise SystemExit(main())
