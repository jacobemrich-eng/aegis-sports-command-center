from __future__ import annotations

import hashlib, json
from pathlib import Path
from typing import Mapping

try:
    from .aegis_ncaaf_engine import ENGINE_VERSION, SPORT_KEY, FORBIDDEN, walk_keys
except ImportError:
    from aegis_ncaaf_engine import ENGINE_VERSION, SPORT_KEY, FORBIDDEN, walk_keys


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def archive_document(blind: Mapping[str, object], original_json: str | None = None) -> dict:
    if blind.get("sport") != SPORT_KEY or blind.get("engine_version") != ENGINE_VERSION: raise ValueError("NCAAF archive accepts only the current candidate")
    violations=[path for key,path in walk_keys(blind) if key in FORBIDDEN or key.startswith("sportsbook_") or key.startswith("postgame_")]
    if "market" in blind or "market_expressions" in blind or violations: raise ValueError("Archived NCAAF blind cannot contain market/postgame data")
    original = original_json if original_json is not None else canonical_json(blind)
    return {"sport":SPORT_KEY,"engine_output":dict(blind),"blind_json":original,"original_file_sha256":sha256(original),"canonical_sha256":sha256(canonical_json(blind)),"release_status":"SHADOW_ONLY"}


def restore(archive: Mapping[str, object], path: str | Path) -> str:
    raw=str(archive["original_json"]); expected=str(archive["original_file_sha256"])
    if sha256(raw) != expected: raise ValueError("Archived NCAAF blind SHA-256 mismatch")
    target=Path(path); target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and sha256(target.read_text(encoding="utf-8")) != expected: raise ValueError("Local NCAAF blind differs from immutable archive")
    target.write_text(raw,encoding="utf-8"); return expected
