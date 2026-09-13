import json
from pathlib import Path
import unittest

from aegis_ncaaf_v02_engine import (
    adapt_blind_input, bayesian_profile, calibration_features, class_direction,
    fit_ridge, implied_margin_regime, project, research_firewall, simulate_possessions,
    validate_calibration_features,
)
from aegis_ncaaf_v02_research import OBSERVED_AUDIT_YEARS, TRAIN_YEARS, VALIDATION_A_YEAR, VALIDATION_B_YEAR, fit_bundle


def team(classification="fbs", games=0, plays=0):
    return {"classification":classification,"sample_games":games,"sample_plays":plays,
            "power_rating":5,"talent_rating":1,"returning_production":.65,"qb_continuity":.7,
            "coaching_continuity":1,"coaching_change":False,"net_epa_per_play":.1,
            "offense_epa_per_play":.15,"early_down_epa":.1,"success_rate":.45,
            "points_per_drive":2.4,"drives_per_game":12,"plays_per_game":72,
            "explosive_play_rate":.1,"havoc_rate":.14,"turnover_rate":.1,
            "line_yards_rate":.5,"pressure_rate":.08,"pressure_allowed_rate":.08}


def game(home=None, away=None):
    return {"game_id":"v02-test","home_team":"Alpha","away_team":"Beta","season":2026,"week":1,
            "start_time":"2026-09-05T16:00:00Z","home_field_advantage":2.5,
            "home":home or team(),"away":away or team(),
            "provenance":[{"name":"fixture","known_at":"2026-08-01T00:00:00Z"}]}


class NCAAFV02Tests(unittest.TestCase):
    def test_calibration_rejects_market_and_odds(self):
        validate_calibration_features({"raw_margin":3,"dispersion":2})
        for field in ("spread","home_spread","market_consensus","sportsbook_total","odds"):
            with self.subTest(field=field),self.assertRaisesRegex(ValueError,"leakage"):
                validate_calibration_features({"raw_margin":3,field:-3})

    def test_early_prior_transition_is_smooth_and_sample_driven(self):
        prior={"net_epa_per_play":.0,"points_per_drive":2.0}
        weights=[];states=[]
        for games_count in (0,2,8,20):
            profile=bayesian_profile(team(games=games_count,plays=games_count*65),prior,5)
            weights.append(profile["current_evidence_weight"]);states.append(profile["evidence_state"])
        self.assertEqual(weights,sorted(weights));self.assertEqual(states[0],"PRESEASON_HEAVY")
        self.assertIn("TRANSITION",states);self.assertEqual(states[-1],"CURRENT_SEASON_STABLE")

    def test_cross_class_is_separate_and_sparse_fcs_passes(self):
        row=adapt_blind_input(game(team("fbs",8,520),team("fcs",0,0)),{},5)
        self.assertEqual(class_direction(row),1)
        self.assertEqual(research_firewall(row,18,3,"C",5,8),"PASS")

    def test_blind_implied_blowout_regimes_do_not_need_market(self):
        self.assertEqual(implied_margin_regime(12.9),"0_13")
        self.assertEqual(implied_margin_regime(-21),"21_28")
        self.assertEqual(implied_margin_regime(35),"35_PLUS")

    def test_garbage_time_and_independent_halves(self):
        row=adapt_blind_input(game(team(games=8,plays=520),team(games=8,plays=520)),{},5)
        moderate=simulate_possessions(row,10,52,2000);blowout=simulate_possessions(row,38,58,2000)
        self.assertGreater(blowout["starter_removal_probability"],moderate["starter_removal_probability"])
        self.assertTrue(blowout["first_half"]["independent"])
        self.assertTrue(blowout["second_half_conditional"]["conditioned_on_simulated_halftime"])
        self.assertNotAlmostEqual(blowout["first_half"]["margin"],blowout["margin"]/2,places=1)

    def test_blind_calibration_is_monotonic_in_raw_margin(self):
        rows=[{"raw_margin":value,"dispersion":3,"data_quality_score":.8} for value in (-20,-10,0,10,20)]
        model=fit_ridge(rows,(-14,-7,0,7,14),10,nonnegative_feature="raw_margin")
        predictions=[model.predict(row) for row in rows]
        self.assertEqual(predictions,sorted(predictions))

    def test_uncertainty_firewall_blocks_extremes(self):
        row=adapt_blind_input(game(team(games=8,plays=520),team(games=8,plays=520)),{},5)
        self.assertEqual(research_firewall(row,36,3,"B",5,8),"PASS")
        self.assertEqual(research_firewall(row,24,3,"B",5,8),"CORE_BLOCK")
        self.assertEqual(research_firewall(row,8,9,"B",5,8),"PASS")

    def test_research_chronology_excludes_observed_audit_from_tuning(self):
        self.assertEqual(TRAIN_YEARS,{2019,2020,2021})
        self.assertEqual((VALIDATION_A_YEAR,VALIDATION_B_YEAR),(2022,2023))
        self.assertTrue(TRAIN_YEARS.isdisjoint(OBSERVED_AUDIT_YEARS))
        self.assertNotIn(2024,TRAIN_YEARS|{VALIDATION_A_YEAR,VALIDATION_B_YEAR})
        with self.assertRaisesRegex(ValueError,"prohibited"):
            fit_bundle([], {2019,2024}, 10, {"margin":1,"total":1}, 10)

    def test_frozen_candidate_output_is_permanently_shadow_only(self):
        artifact_path=Path(__file__).parent/"results"/"ncaaf-v02-model-artifact.json"
        artifact=json.loads(artifact_path.read_text(encoding="utf-8"))
        output=project(game(team(games=8,plays=520),team(games=8,plays=520)),{},artifact,generated_at="2026-09-01T00:00:00Z",simulations=200)
        self.assertEqual(output["release_status"],"SHADOW_ONLY")
        self.assertFalse(output["official_final_card_eligible"])
        self.assertFalse(output["official_bankroll_eligible"])
        self.assertFalse(output["auto_release_allowed"])
        self.assertTrue(output["projection"]["period_probabilities"]["first_half"]["independent_model"])


if __name__=="__main__":unittest.main()
