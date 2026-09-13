import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from aegis_ncaaf_engine import project
from aegis_ncaaf_history_store import CFBDCache, planned_requests
from aegis_ncaaf_snapshot_builder import aggregate_history
from aegis_ncaaf_walkforward import split_name, validate_dataset


def historical_row():
    blind = {
        "game_id": "cfbd-1", "home_team": "Alpha", "away_team": "Beta",
        "start_time": "2024-09-07T16:00:00Z", "kickoff_at": "2024-09-07T16:00:00Z",
        "prediction_cutoff_at": "2024-09-07T15:55:00Z",
        "source_max_known_at": "2024-08-31T21:00:00Z", "leakage_check_passed": True,
        "season": 2024, "week": 2,
        "home": {"classification": "fbs", "sample_games": 1},
        "away": {"classification": "fcs", "sample_games": 0},
        "provenance": [{"name": "prior game", "known_at": "2024-08-31T21:00:00Z"}],
    }
    return {"blind_input": blind, "targets": {"actual_margin": 7},
            "market": {"home_spread": -3, "blind_feature_eligible": False}}


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()
        self.headers = {"X-CallLimit-Remaining": "998"}
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self): return self.payload


class HistoricalPipelineTests(unittest.TestCase):
    def test_request_plan_includes_prior_context_and_calendar(self):
        weeks = {2019: range(16), 2020: range(16), 2021: range(15), 2022: range(15),
                 2023: range(15), 2024: range(16), 2025: range(16)}
        plan = planned_requests(range(2019, 2026), weeks)
        self.assertEqual(plan["bulk_total"], 267)
        self.assertEqual(plan["including_calendar"], 274)

    def test_cache_is_content_validated_and_idempotent(self):
        with tempfile.TemporaryDirectory() as root:
            client = CFBDCache("fixture-key", root)
            with patch("aegis_ncaaf_history_store.urlopen", return_value=FakeResponse([{"id": 1}])) as request:
                first = client.fetch("/games", {"year": 2024}, "SAFE_WITH_CUTOFF")
                second = client.fetch("/games", {"year": 2024}, "SAFE_WITH_CUTOFF")
            self.assertFalse(first.cache_hit); self.assertTrue(second.cache_hit)
            self.assertEqual(client.api_calls, 1); self.assertEqual(request.call_count, 1)
            envelope = json.loads(Path(first.path).read_text())
            envelope["payload"] = [{"id": 2}]
            Path(first.path).write_text(json.dumps(envelope))
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                client.fetch("/games", {"year": 2024}, "SAFE_WITH_CUTOFF")

    def test_target_and_end_of_season_fields_are_rejected(self):
        for forbidden in ("actual_margin", "postseason_rank"):
            row = historical_row(); row["blind_input"][forbidden] = 1
            with self.subTest(forbidden=forbidden), self.assertRaisesRegex(ValueError, "forbidden"):
                validate_dataset([row])

    def test_retrospective_ratings_are_rejected(self):
        for forbidden in ("core", "sp_rating", "srs", "postgame_elo"):
            row = historical_row(); row["blind_input"]["home"][forbidden] = 1
            with self.subTest(forbidden=forbidden), self.assertRaisesRegex(ValueError, "forbidden"):
                validate_dataset([row])

    def test_market_remains_outside_blind_matrix(self):
        row = historical_row(); self.assertTrue(validate_dataset([row])["leakage_check_passed"])
        row["market"]["blind_feature_eligible"] = True
        with self.assertRaisesRegex(ValueError, "market_not_separated"):
            validate_dataset([row])

    def test_weekly_cutoff_allows_completed_prior_game_not_target_game(self):
        row = historical_row(); self.assertTrue(validate_dataset([row])["leakage_check_passed"])
        row["blind_input"]["source_max_known_at"] = row["blind_input"]["kickoff_at"]
        with self.assertRaisesRegex(ValueError, "cutoff_not_before_kickoff"):
            validate_dataset([row])

    def test_future_game_source_is_rejected(self):
        row = historical_row()
        row["blind_input"]["source_max_known_at"] = "2024-09-14T20:00:00Z"
        with self.assertRaisesRegex(ValueError, "cutoff_not_before_kickoff"):
            validate_dataset([row])

    def test_week_one_and_empty_history_preserve_preseason_prior(self):
        profile = aggregate_history([], {"talent_rating": 1.2, "coaching_change": True}, 1550, 8.0, "fbs")
        self.assertEqual(profile["sample_games"], 0)
        self.assertEqual(profile["power_rating"], 2.0)
        self.assertEqual(profile["talent_rating"], 1.2)
        self.assertTrue(profile["coaching_change"])
        row = historical_row(); row["blind_input"]["week"] = 1
        row["blind_input"]["home"]["sample_games"] = 0
        self.assertTrue(validate_dataset([row])["leakage_check_passed"])

    def test_coaching_change_drives_structural_break_uncertainty(self):
        row = historical_row()["blind_input"]
        for side in ("home", "away"):
            row[side].update({"power_rating": 0, "coaching_change": side == "home"})
        output = project(row, generated_at=row["prediction_cutoff_at"], simulations=100)
        self.assertTrue(output["quality"]["structural_break"])

    def test_walk_forward_split_is_frozen_and_season_aware(self):
        expected = {2019:"development_2019_2022", 2022:"development_2019_2022",
                    2023:"validation_2023", 2024:"untouched_holdout_2024_2025",
                    2025:"untouched_holdout_2024_2025"}
        self.assertEqual({year: split_name(year) for year in expected}, expected)
        with self.assertRaises(ValueError): split_name(2026)


if __name__ == "__main__": unittest.main()
