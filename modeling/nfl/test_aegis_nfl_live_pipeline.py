from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest


NFL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NFL_DIR))

from aegis_nfl_live_pipeline import process_slate, selected_v10, validate_pregame_game
from aegis_nfl_shadow_publisher import build_envelope, validate_blind_output


NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def game(game_id: str) -> dict:
    return {
        "id": game_id, "home_team": "BUF", "away_team": "MIA",
        "start_time": (NOW + timedelta(days=3)).isoformat(), "season": 2026, "week": 1,
    }


def blind(game_row: dict) -> dict:
    return {
        "schema_version": "AEGIS_STANDARD_GAME_OUTPUT_v1", "sport": "NFL",
        "engine_version": "NFL_v1.0_FEATURE_ABLATION", "generated_at": NOW.isoformat(),
        "game": {"id": game_row["id"], "home": game_row["home_team"], "away": game_row["away_team"], "start_time": game_row["start_time"]},
        "blind_features": ["home_epa_per_play", "away_epa_per_play"],
        "projection": {"mean_home_margin": 3.0, "mean_total": 46.0},
    }


def market_for(rows: list[dict]) -> dict:
    return {
        row["game"]["id"]: {
            "captured_at": (NOW + timedelta(seconds=1)).isoformat(),
            "challenger_projection": {"margin": 2.5, "total": 45.5},
            "decision_status": "PASS", "execution_status": "PASS",
        }
        for row in rows
    }


class LivePipelineTests(unittest.TestCase):
    def test_committed_v10_champion_contract_is_loaded(self):
        features, hyper = selected_v10()
        self.assertEqual(len(features), 25)
        self.assertEqual(hyper["margin_alpha"], 80.0)
        self.assertNotIn("spread_line", features)
        self.assertNotIn("total_line", features)

    def test_future_postgame_and_market_fields_are_rejected(self):
        for key in ("home_score", "closing_line", "future_injury_status"):
            candidate = {**game("unsafe"), key: 1}
            with self.assertRaisesRegex(ValueError, "rejected"):
                validate_pregame_game(candidate, NOW)
        mixed = blind(game("mixed"))
        mixed["market"] = {"spread": -3}
        with self.assertRaisesRegex(ValueError, "Market Challenger"):
            validate_blind_output(mixed)

    def test_market_capture_must_be_strictly_after_blind(self):
        same_time = {"captured_at": NOW.isoformat(), "challenger_projection": {"margin": 2, "total": 45}}
        with self.assertRaisesRegex(ValueError, "after"):
            build_envelope(blind(game("order")), same_time)

    def test_slate_continues_after_one_game_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [game("one"), game("bad"), game("three")]

            def factory(row):
                if row["id"] == "bad":
                    raise RuntimeError("isolated failure")
                return blind(row)

            def markets_after_files(rows):
                self.assertTrue((Path(directory) / "blind" / "one.json").exists())
                self.assertTrue((Path(directory) / "blind" / "three.json").exists())
                return market_for(rows)

            published = []
            result = process_slate(rows, factory, markets_after_files, lambda envelope: published.append(envelope) or {"ok": True}, Path(directory))
            self.assertEqual(result["blind_games"], 2)
            self.assertEqual(result["published_games"], 2)
            self.assertEqual(len(result["failures"]), 1)
            self.assertEqual({row["engine_output"]["game"]["id"] for row in published}, {"one", "three"})

    def test_existing_blind_snapshot_is_reused_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            process_slate([game("duplicate")], blind, market_for, lambda envelope: {"ok": True}, output)
            first = json.loads((output / "blind" / "duplicate.json").read_text())

            def should_not_run(_):
                raise AssertionError("immutable blind snapshot was rebuilt")

            second = process_slate([game("duplicate")], should_not_run, market_for, lambda envelope: {"ok": True}, output)
            self.assertEqual(second["published_games"], 1)
            self.assertEqual(json.loads((output / "blind" / "duplicate.json").read_text()), first)


if __name__ == "__main__":
    unittest.main()
