from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Dict, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from aegis_nfl_shadow_publisher import SPORT_KEY, validate_blind_output, validate_shadow_endpoint


def _archive_url(endpoint: str) -> str:
    endpoint = validate_shadow_endpoint(endpoint)
    return endpoint.rsplit("/games", 1)[0] + "/blinds"


def file_payload(path: Path) -> Dict[str, object]:
    raw = path.read_bytes()
    blind = json.loads(raw.decode("utf-8"))
    validate_blind_output(blind)
    return {
        "engine_output": blind,
        "blind_json": raw.decode("utf-8"),
        "original_json": raw.decode("utf-8"),
        "original_file_sha256": hashlib.sha256(raw).hexdigest(),
    }


def _request_json(request: Request, timeout: int = 45) -> Dict[str, object]:
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Blind archive request rejected ({error.code}): {detail[:500]}") from error
    except URLError as error:
        raise RuntimeError(f"Blind archive request unavailable: {error.reason}") from error


def backfill_files(paths: Iterable[Path], endpoint: str, token: str) -> Dict[str, object]:
    if not token:
        raise ValueError("Shadow ingest token is required")
    archives = [file_payload(path) for path in paths]
    request = Request(
        _archive_url(endpoint) + "/backfill",
        data=json.dumps({"sport": SPORT_KEY, "archives": archives}).encode("utf-8"),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    return _request_json(request, 90)


def fetch_archives(endpoint: str, token: str) -> Dict[str, object]:
    if not token:
        raise ValueError("Shadow ingest token is required")
    request = Request(
        _archive_url(endpoint) + f"?sport={SPORT_KEY}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        method="GET",
    )
    return _request_json(request)


def hydrate(output_dir: Path, endpoint: str, token: str) -> Dict[str, object]:
    response = fetch_archives(endpoint, token)
    output_dir.mkdir(parents=True, exist_ok=True)
    restored, unchanged = [], []
    for archive in response.get("archives", []):
        canonical = str(archive.get("canonical_json", "")).encode("utf-8")
        if hashlib.sha256(canonical).hexdigest() != archive.get("canonical_sha256"):
            raise ValueError(f"Canonical blind archive hash mismatch: {archive.get('game_id')}")
        raw = str(archive.get("original_json", "")).encode("utf-8")
        if hashlib.sha256(raw).hexdigest() != archive.get("original_file_sha256"):
            raise ValueError(f"Original blind archive hash mismatch: {archive.get('game_id')}")
        blind = json.loads(raw.decode("utf-8"))
        validate_blind_output(blind)
        if str(blind.get("game", {}).get("id")) != str(archive.get("game_id")):
            raise ValueError("Hydrated blind game_id does not match archive")
        path = output_dir / f"{archive['game_id']}.json"
        if path.exists():
            if hashlib.sha256(path.read_bytes()).hexdigest() != archive.get("original_file_sha256"):
                raise ValueError(f"Local blind differs from durable immutable archive: {archive['game_id']}")
            unchanged.append(archive["game_id"])
        else:
            path.write_bytes(raw)
            restored.append(archive["game_id"])
    return {"archive_count": response.get("count", len(restored) + len(unchanged)), "restored": restored, "unchanged": unchanged}


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill or hydrate durable NFL shadow blind snapshots")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--backfill-dir")
    action.add_argument("--hydrate-dir")
    parser.add_argument("--endpoint", default=os.getenv("AEGIS_SHADOW_ENDPOINT", ""))
    parser.add_argument("--token-env", default="AEGIS_SHADOW_INGEST_SECRET")
    args = parser.parse_args()
    try:
        token = os.getenv(args.token_env, "")
        if args.backfill_dir:
            paths = sorted(Path(args.backfill_dir).glob("*.json"))
            if not paths:
                raise ValueError("No blind JSON files found for backfill")
            result = backfill_files(paths, args.endpoint, token)
        else:
            result = hydrate(Path(args.hydrate_dir), args.endpoint, token)
        print(json.dumps(result, indent=2))
        return 0
    except Exception as error:
        print(f"NFL blind archive operation failed safely: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
