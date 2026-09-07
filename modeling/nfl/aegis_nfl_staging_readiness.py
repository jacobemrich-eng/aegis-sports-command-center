from __future__ import annotations

import argparse
import json
import os
import sys

from aegis_nfl_shadow_publisher import verify_staging_readiness


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify isolated NFL shadow staging before publishing")
    parser.add_argument("--endpoint", default=os.getenv("AEGIS_SHADOW_ENDPOINT", ""))
    parser.add_argument("--token-env", default="AEGIS_SHADOW_INGEST_SECRET")
    parser.add_argument("--timeout", type=int, default=30)
    args = parser.parse_args()
    try:
        payload = verify_staging_readiness(args.endpoint, os.getenv(args.token_env, ""), args.timeout)
        print(json.dumps({
            "ready": True,
            "environment": payload.get("environment"),
            "state_id": payload.get("state_id"),
            "shadow_only": payload.get("shadow_only"),
            "production_release_allowed": payload.get("production_release_allowed"),
            "persistence": payload.get("persistence"),
            "endpoints": payload.get("endpoints"),
        }, indent=2))
        return 0
    except Exception as error:
        print(f"NFL staging is not publish-ready: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
