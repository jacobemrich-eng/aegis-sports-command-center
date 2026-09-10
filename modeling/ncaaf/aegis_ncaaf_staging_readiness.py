from __future__ import annotations
import json, os, sys
from urllib.request import Request, urlopen
try:
    from .aegis_ncaaf_shadow_publisher import validate_endpoint
except ImportError:
    from aegis_ncaaf_shadow_publisher import validate_endpoint

def verify(endpoint: str, token: str) -> dict:
    endpoint=validate_endpoint(endpoint)
    if not token: raise ValueError("AEGIS_SHADOW_INGEST_SECRET is required")
    url=endpoint.rsplit("/games",1)[0]+"/readiness"
    with urlopen(Request(url,headers={"Authorization":f"Bearer {token}","Accept":"application/json"}),timeout=30) as response: payload=json.loads(response.read())
    flags=payload.get("sport_engine_flags",{}); persistence=payload.get("persistence",{})
    checks={"ready":payload.get("ready") is True,"environment":payload.get("environment")=="ncaaf-shadow-staging","state":payload.get("state_id")=="ncaaf-shadow-staging","shadow_only":payload.get("shadow_only") is True,"release_blocked":payload.get("production_release_allowed") is False,"autopilot_disabled":payload.get("autopilot_enabled") is False,"ncaaf_enabled":flags.get("NCAAF_SIM_ENABLED") is True,"ncaaf_shadow_only":flags.get("NCAAF_SIM_SHADOW_ONLY") is True,"auto_release_disabled":flags.get("AEGIS_NEW_ENGINE_AUTO_RELEASE") is False,"persistence":persistence.get("persistent") is True and persistence.get("ok") is True,"grading":payload.get("endpoints",{}).get("grading") is True}
    failed=[key for key,value in checks.items() if not value]
    if failed: raise RuntimeError("NCAAF staging readiness failed: "+", ".join(failed))
    return {"ready":True,"checks":checks,"environment":"ncaaf-shadow-staging","state_id":"ncaaf-shadow-staging","shadow_only":True}

if __name__=="__main__":
    try: print(json.dumps(verify(os.getenv("AEGIS_SHADOW_ENDPOINT",""),os.getenv("AEGIS_SHADOW_INGEST_SECRET","")),indent=2))
    except Exception as error: print(f"NCAAF staging readiness stopped safely: {error}",file=sys.stderr); raise SystemExit(1)
