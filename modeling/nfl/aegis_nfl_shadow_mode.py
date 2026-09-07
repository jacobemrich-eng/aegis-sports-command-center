
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional
import json
from pathlib import Path
from datetime import datetime, timezone


@dataclass
class ShadowModeConfig:
    release_real_bets: bool = False
    display_core_candidates: bool = True
    require_manual_verification: bool = True


class NFLShadowModeRecorder:
    """
    Command Center shadow mode.

    The model can generate its full daily card candidate output,
    but no recommendation is treated as production-authoritative until
    the user/manual verification gate approves it.
    """

    def __init__(self, path: str | Path, config: Optional[ShadowModeConfig]=None):
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        self.config=config or ShadowModeConfig()

    def record(self, output: Dict[str,object]) -> Dict[str,object]:
        row={
            "recorded_at":datetime.now(timezone.utc).isoformat(),
            "engine_version":output.get("engine_version"),
            "sport":output.get("sport"),
            "game":output.get("game"),
            "projection":output.get("projection"),
            "quality":output.get("quality"),
            "decision":output.get("decision"),
            "market_expressions":output.get("market_expressions"),
            "shadow_mode":{
                "release_real_bets":self.config.release_real_bets,
                "require_manual_verification":self.config.require_manual_verification,
                "status":"SHADOW_ONLY" if not self.config.release_real_bets else "PRODUCTION_ALLOWED",
            }
        }
        with self.path.open("a",encoding="utf-8") as f:
            f.write(json.dumps(row)+"\n")
        return row
