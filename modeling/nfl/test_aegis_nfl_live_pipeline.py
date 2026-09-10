from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


NFL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NFL_DIR))

from aegis_nfl_live_pipeline import _event_for, process_slate, selected_v10, validate_pregame_game
from aegis_nfl_blind_archive import hydrate
from aegis_nfl_shadow_publisher import (
    build_envelope,
    validate_blind_output,
    validate_shadow_endpoint,
    verify_staging_readiness,
)


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
    def test_market_matcher_accepts_immutable_blind_game_schema(self):
        blind_game = blind(game("market-match"))["game"]
        event = {"id": "odds-event", "home_team": "Buffalo Bills", "away_team": "Miami Dolphins"}
        self.assertEqual(_event_for(blind_game, [event]), event)

    def test_publish_endpoint_rejects_production_and_unrelated_hosts(self):
        with self.assertRaisesRegex(ValueError, "required"):
            validate_shadow_endpoint("")
        with self.assertRaisesRegex(ValueError, "Production AEGIS endpoint is forbidden"):
            validate_shadow_endpoint("https://aegis-sports-command-center.onrender.com/api/shadow/games")
        with self.assertRaisesRegex(ValueError, "not the NFL staging host"):
            validate_shadow_endpoint("https://unrelated.example/api/shadow/games")
        self.assertEqual(
            validate_shadow_endpoint("https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games"),
            "https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games",
        )
        self.assertEqual(validate_shadow_endpoint("http://localhost:3000/api/shadow/games"), "http://localhost:3000/api/shadow/games")

    def test_readiness_requires_isolated_state_and_all_release_guards(self):
        payload = {
            "ready": True, "environment": "nfl-shadow-staging", "state_id": "nfl-shadow-staging",
            "shadow_only": True, "production_release_allowed": False, "autopilot_enabled": False,
            "sport_engine_flags": {"NFL_SIM_ENABLED": True, "NFL_SIM_SHADOW_ONLY": True, "AEGIS_NEW_ENGINE_AUTO_RELEASE": False},
            "persistence": {"ok": True, "persistent": True},
            "endpoints": {"ingest": True, "grading": True},
        }

        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return json.dumps(payload).encode()

        with patch("aegis_nfl_shadow_publisher.urlopen", return_value=Response()):
            result = verify_staging_readiness("https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games", "test-token")
        self.assertEqual(result["state_id"], "nfl-shadow-staging")
        payload["state_id"] = "main"
        with patch("aegis_nfl_shadow_publisher.urlopen", return_value=Response()):
            with self.assertRaisesRegex(RuntimeError, "state_id"):
                verify_staging_readiness("https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games", "test-token")

    def test_publisher_dry_run_needs_no_endpoint_or_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blind_path, market_path = root / "blind.json", root / "market.json"
            blind_path.write_text(json.dumps(blind(game("dry-run"))), encoding="utf-8")
            market_path.write_text(json.dumps(market_for([blind(game("dry-run"))])["dry-run"]), encoding="utf-8")
            environment = os.environ.copy()
            environment.pop("AEGIS_SHADOW_ENDPOINT", None)
            environment.pop("AEGIS_SHADOW_INGEST_SECRET", None)
            result = subprocess.run(
                [sys.executable, str(NFL_DIR / "aegis_nfl_shadow_publisher.py"), "--blind-output", str(blind_path), "--market-input", str(market_path), "--dry-run"],
                capture_output=True, text=True, env=environment, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('"shadow_only": true', result.stdout)

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

    def test_empty_runner_cache_hydrates_exact_durable_blind(self):
        original = json.dumps(blind(game("hydrated")), indent=2) + "\n"
        canonical = json.dumps(json.loads(original), sort_keys=True, separators=(",", ":"))
        archive = {
            "game_id": "hydrated", "original_json": original,
            "original_file_sha256": hashlib.sha256(original.encode()).hexdigest(),
            "canonical_json": canonical,
            "canonical_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        }
        with tempfile.TemporaryDirectory() as directory:
            with patch("aegis_nfl_blind_archive.fetch_archives", return_value={"count": 1, "archives": [archive]}):
                result = hydrate(Path(directory), "https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games", "token")
            restored = Path(directory) / "hydrated.json"
            self.assertEqual(result["restored"], ["hydrated"])
            self.assertEqual(restored.read_bytes(), original.encode())
            with patch("aegis_nfl_blind_archive.fetch_archives", return_value={"count": 1, "archives": [archive]}):
                again = hydrate(Path(directory), "https://aegis-nfl-shadow-staging.onrender.com/api/shadow/games", "token")
            self.assertEqual(again["unchanged"], ["hydrated"])


if __name__ == "__main__":
    unittest.main()
