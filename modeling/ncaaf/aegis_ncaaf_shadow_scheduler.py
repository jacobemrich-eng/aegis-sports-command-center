from __future__ import annotations
import argparse, json
from datetime import datetime, timezone
from pathlib import Path

WINDOWS=(("EARLY_BASELINE",48,96),("DAY_BEFORE",18,30),("PREGAME",1.5,3),("FINAL_PRE_KICK",1/3,1.25))

def target(kickoff: datetime, now: datetime) -> str | None:
    hours=(kickoff-now).total_seconds()/3600
    if hours <= 0: return None
    return next((name for name,low,high in WINDOWS if low <= hours <= high),None)

def preflight(games: list[dict], now: datetime) -> dict:
    due={}; grades=[]
    for game in games:
        kickoff=datetime.fromisoformat(str(game["start_time"]).replace("Z","+00:00")).astimezone(timezone.utc)
        if kickoff <= now and not game.get("graded"): grades.append(game["game_id"]); continue
        selected=target(kickoff,now); existing={x.get("snapshot_target") for x in game.get("market_snapshots",[])}
        if selected and selected not in existing: due[game["game_id"]]=selected
    return {"action":"PROJECT_AND_PUBLISH" if due else "GRADE_ONLY" if grades else "NO_ACTION","snapshot_targets":due,"grade_games":grades,"odds_api_calls_planned":1 if due else 0,"shadow_only":True}

if __name__=="__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--state",required=True); parser.add_argument("--now"); parser.add_argument("--output"); args=parser.parse_args(); data=json.loads(Path(args.state).read_text()); now=datetime.fromisoformat(args.now.replace("Z","+00:00")) if args.now else datetime.now(timezone.utc); result=preflight(data.get("games",[]),now); text=json.dumps(result,indent=2); print(text); Path(args.output).write_text(text) if args.output else None
