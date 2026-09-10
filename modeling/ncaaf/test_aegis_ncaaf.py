import json, tempfile, unittest
from pathlib import Path

from aegis_ncaaf_blind_archive import archive_document, restore
from aegis_ncaaf_engine import project, validate_blind_input
from aegis_ncaaf_shadow_publisher import build_envelope, validate_endpoint
from aegis_ncaaf_shadow_scheduler import preflight
from datetime import datetime, timezone


def sample():
    team={"classification":"fbs","power_rating":10,"net_epa_per_play":.12,"offense_epa_per_play":.15,"points_per_drive":2.5,"plays_per_game":72,"drives_per_game":12,"line_yards_rate":.5,"pressure_allowed_rate":.22,"returning_production":.7,"qb_continuity":.8,"ol_continuity":.75,"coaching_continuity":1,"explosive_play_rate":.12,"havoc_rate":.18,"turnover_rate":.11,"early_down_epa":.12}
    away={**team,"power_rating":4,"net_epa_per_play":.05,"points_per_drive":2.1,"qb_continuity":.5}
    return {"game_id":"ncaaf-test","home_team":"Georgia","away_team":"Clemson","start_time":"2026-09-12T16:00:00Z","season":2026,"week":2,"home":team,"away":away,"provenance":[{"name":"fixture","known_at":"2026-09-10T12:00:00Z"}]}


class NCAAFTests(unittest.TestCase):
    def test_leakage_and_known_at(self):
        row=sample(); row["sportsbook_spread"]=-3
        with self.assertRaisesRegex(ValueError,"leakage"): validate_blind_input(row)
        row=sample(); row["provenance"][0]["known_at"]="2026-09-13T00:00:00Z"
        with self.assertRaisesRegex(ValueError,"not known pregame"): validate_blind_input(row)
    def test_drive_distribution_and_independent_first_half(self):
        one=project(sample(),generated_at="2026-09-10T12:01:00Z",simulations=1000); two=project(sample(),generated_at="2026-09-10T12:01:00Z",simulations=1000)
        self.assertEqual(one["projection"],two["projection"]); self.assertTrue(one["projection"]["distribution"]["drive_level"]); self.assertTrue(one["projection"]["period_probabilities"]["first_half"]["independent_model"]); self.assertNotEqual(one["projection"]["period_probabilities"]["first_half"]["total"],one["projection"]["total"]/2)
    def test_fbs_fcs_and_early_uncertainty(self):
        row=sample(); row["away"]["classification"]="fcs"; row["week"]=1; row["away"]["coaching_change"]=True
        output=project(row,generated_at="2026-09-10T12:01:00Z",simulations=300); self.assertTrue(output["diagnostics"]["sport_specific"]["ncaaf"]["cross_class"]); self.assertTrue(output["quality"]["early_season_high_uncertainty"])
    def test_archive_restore_hash_and_collision(self):
        blind=project(sample(),generated_at="2026-09-10T12:01:00Z",simulations=100); raw=json.dumps(blind,indent=2); doc=archive_document(blind,raw)
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/"blind.json"; restored=restore({"original_json":raw,"original_file_sha256":doc["original_file_sha256"]},path); self.assertEqual(restored,doc["original_file_sha256"]); path.write_text("{}")
            with self.assertRaisesRegex(ValueError,"differs"): restore({"original_json":raw,"original_file_sha256":doc["original_file_sha256"]},path)
    def test_market_is_strictly_post_blind_and_production_forbidden(self):
        blind=project(sample(),generated_at="2026-09-10T12:01:00Z",simulations=100); market={"captured_at":"2026-09-10T12:02:00Z","challenger_projection":{"margin":3,"total":51}}
        self.assertEqual(build_envelope(blind,market)["publisher"]["shadow_only"],True)
        market["captured_at"]="2026-09-10T12:00:00Z"
        with self.assertRaisesRegex(ValueError,"after immutable"): build_envelope(blind,market)
        with self.assertRaisesRegex(ValueError,"Production AEGIS"): validate_endpoint("https://aegis-sports-command-center.onrender.com/api/shadow/games")
    def test_quota_free_scheduler(self):
        now=datetime(2026,9,10,12,tzinfo=timezone.utc); games=[{"game_id":"early","start_time":"2026-09-13T12:00:00Z","market_snapshots":[],"graded":False}]
        due=preflight(games,now); self.assertEqual(due["action"],"PROJECT_AND_PUBLISH"); self.assertEqual(due["odds_api_calls_planned"],1)
        games[0]["market_snapshots"]=[{"snapshot_target":"EARLY_BASELINE"}]; none=preflight(games,now); self.assertEqual(none["action"],"NO_ACTION"); self.assertEqual(none["odds_api_calls_planned"],0)


if __name__ == "__main__": unittest.main()
