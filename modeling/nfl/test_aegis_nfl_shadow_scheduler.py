from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parent))
from aegis_nfl_shadow_scheduler import infer_existing_targets, preflight, schedule_kickoff, target_for


NOW = datetime(2026, 9, 9, 16, 0, tzinfo=timezone.utc)


def game(game_id: str, hours: float) -> dict:
    return {
        "game_id": game_id, "season": "2026", "game_type": "REG",
        "start_time": (NOW + timedelta(hours=hours)).isoformat(),
    }


class ShadowSchedulerTests(unittest.TestCase):
    def test_snapshot_windows(self):
        self.assertEqual(target_for(NOW + timedelta(hours=72), NOW), "EARLY_BASELINE")
        self.assertEqual(target_for(NOW + timedelta(hours=24), NOW), "DAY_BEFORE")
        self.assertEqual(target_for(NOW + timedelta(hours=2), NOW), "PREGAME")
        self.assertEqual(target_for(NOW + timedelta(minutes=45), NOW), "FINAL_PRE_KICK")
        self.assertIsNone(target_for(NOW + timedelta(hours=10), NOW))
        self.assertIsNone(target_for(NOW - timedelta(minutes=1), NOW))

    def test_dst_uses_america_new_york(self):
        winter = schedule_kickoff({"gameday": "2026-01-04", "gametime": "13:00"})
        summer = schedule_kickoff({"gameday": "2026-09-13", "gametime": "13:00"})
        self.assertEqual(winter.hour, 18)
        self.assertEqual(summer.hour, 17)

    def test_no_action_plans_zero_odds_calls(self):
        result = preflight([game("outside", 10)], {"games": []}, NOW)
        self.assertEqual(result["action"], "NO_ACTION")
        self.assertEqual(result["odds_api_calls_planned"], 0)

    def test_one_board_call_services_multiple_due_games(self):
        result = preflight([game("early", 72), game("day-before", 24), game("pregame", 2)], {"games": []}, NOW)
        self.assertEqual(result["action"], "PROJECT_AND_PUBLISH")
        self.assertEqual(result["odds_api_calls_planned"], 1)
        self.assertEqual(len(result["project_games"]), 3)

    def test_existing_target_is_not_recaptured(self):
        kickoff = NOW + timedelta(hours=72)
        state = {"games": [{
            "game_id": "existing", "market_snapshots": [
                {"captured_at": (kickoff - timedelta(hours=70)).isoformat(), "snapshot_target": "EARLY_BASELINE"}
            ], "graded": False,
        }]}
        result = preflight([game("existing", 72)], state, NOW)
        self.assertEqual(result["action"], "NO_ACTION")
        self.assertEqual(infer_existing_targets(kickoff, state["games"][0]["market_snapshots"]), {"EARLY_BASELINE"})

    def test_settled_ungraded_game_requests_grade_only(self):
        result = preflight([game("settled", -6)], {"games": [{"game_id": "settled", "graded": False}]}, NOW)
        self.assertEqual(result["action"], "GRADE_ONLY")
        self.assertEqual(result["odds_api_calls_planned"], 0)


if __name__ == "__main__":
    unittest.main()
