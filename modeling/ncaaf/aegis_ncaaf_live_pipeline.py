from __future__ import annotations

import argparse, json, os, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from .aegis_ncaaf_engine import project
    from .aegis_ncaaf_shadow_publisher import archive_blinds, build_envelope, fetch_blind_archives, publish
    from .aegis_ncaaf_blind_archive import archive_document, restore
except ImportError:
    from aegis_ncaaf_engine import project
    from aegis_ncaaf_shadow_publisher import archive_blinds, build_envelope, fetch_blind_archives, publish
    from aegis_ncaaf_blind_archive import archive_document, restore

SPORT="americanfootball_ncaaf"


def get_json(url: str, headers: dict | None = None) -> tuple[object, dict]:
    with urlopen(Request(url,headers=headers or {"User-Agent":"AEGIS-NCAAF-shadow/0.1"}),timeout=30) as response:
        return json.loads(response.read()), dict(response.headers)


def discover(season: int, lookahead_days: int, now: datetime) -> list[dict]:
    payload,_=get_json(f"https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates={season}&limit=1000")
    horizon=now+timedelta(days=lookahead_days); rows=[]
    for event in payload.get("events",[]):
        kickoff=datetime.fromisoformat(event["date"].replace("Z","+00:00"))
        if not now < kickoff <= horizon: continue
        comp=event.get("competitions",[{}])[0]; competitors=comp.get("competitors",[])
        home=next((x for x in competitors if x.get("homeAway")=="home"),None); away=next((x for x in competitors if x.get("homeAway")=="away"),None)
        if not home or not away: continue
        rows.append({"game_id":f"espn-{event['id']}","home_team":home["team"]["displayName"],"away_team":away["team"]["displayName"],"start_time":kickoff.isoformat().replace("+00:00","Z"),"season":season,"week":event.get("week",{}).get("number"),"home":{"classification":"unknown"},"away":{"classification":"unknown"},"provenance":[{"name":"ESPN public pregame schedule","known_at":now.isoformat().replace("+00:00","Z"),"url":"https://site.api.espn.com/"}]})
    return rows


def enrich_cfbd(rows: list[dict], season: int, now: datetime) -> list[dict]:
    key=os.getenv("CFBD_API_KEY","").strip()
    if not key: return rows
    headers={"Authorization":f"Bearer {key}","User-Agent":"AEGIS-NCAAF-shadow/0.1"}
    ratings,_=get_json(f"https://api.collegefootballdata.com/ratings/sp?year={season}",headers)
    teams,_=get_json(f"https://api.collegefootballdata.com/teams/fbs?year={season}",headers)
    by_name={str(x.get("team","")).casefold():x for x in ratings}; fbs={str(x.get("school","")).casefold() for x in teams}
    for row in rows:
        for side in ("home","away"):
            name=row[f"{side}_team"].casefold(); rating=by_name.get(name,{}); profile=row[side]
            profile["classification"]="fbs" if name in fbs else "unknown"
            profile["power_rating"]=rating.get("rating")
            profile["offense_epa_per_play"]=None; profile["net_epa_per_play"]=None; profile["points_per_drive"]=None
        row["provenance"].append({"name":"CollegeFootballData SP+ and FBS classification","known_at":now.isoformat().replace("+00:00","Z"),"url":"https://api.collegefootballdata.com/"})
    return rows


def capture_board(api_key: str) -> tuple[list[dict], dict]:
    if not api_key: raise ValueError("ODDS_API_KEY is required only after all blinds are immutable")
    query=urlencode({"apiKey":api_key,"regions":"us","markets":"spreads,totals,h2h","oddsFormat":"american","dateFormat":"iso"})
    board,headers=get_json(f"https://api.the-odds-api.com/v4/sports/{SPORT}/odds?{query}")
    quota={key.lower():value for key,value in headers.items() if key.lower().startswith("x-requests-")}
    return board,quota


def market_for(game: dict, board: list[dict], quota: dict, captured_at: str) -> dict | None:
    home_name=game.get("home_team") or game.get("home"); away_name=game.get("away_team") or game.get("away")
    event=next((x for x in board if x.get("home_team")==home_name and x.get("away_team")==away_name),None)
    if not event: return None
    spreads=[]; totals=[]; books=[]
    for book in event.get("bookmakers",[]):
        spread=next((m for m in book.get("markets",[]) if m.get("key")=="spreads"),None); total=next((m for m in book.get("markets",[]) if m.get("key")=="totals"),None)
        home=next((x for x in (spread or {}).get("outcomes",[]) if x.get("name")==home_name),None); over=next((x for x in (total or {}).get("outcomes",[]) if x.get("name")=="Over"),None)
        if home and over: spreads.append(float(home["point"])); totals.append(float(over["point"])); books.append({"book":book.get("key"),"home_spread":home,"over":over})
    if not spreads or not totals: return None
    spread=sum(spreads)/len(spreads); total=sum(totals)/len(totals)
    return {"captured_at":captured_at,"challenger_projection":{"margin":-spread,"total":total},"current_price":{"home_spread":spread,"total_line":total,"bookmaker_count":len(books),"selected_books":books},"quota":quota,"decision_status":"PASS","execution_status":"PASS"}


def main() -> int:
    parser=argparse.ArgumentParser(description="Manual leakage-safe NCAAF shadow pipeline"); parser.add_argument("--season",type=int,required=True); parser.add_argument("--lookahead-days",type=int,default=10); parser.add_argument("--input"); parser.add_argument("--data-dir",default="data/ncaaf-shadow-runtime"); parser.add_argument("--publish",action="store_true"); parser.add_argument("--endpoint",default=os.getenv("AEGIS_SHADOW_ENDPOINT","")); parser.add_argument("--simulations",type=int,default=20_000)
    args=parser.parse_args(); now=datetime.now(timezone.utc); root=Path(args.data_dir); blind_dir=root/"blind"; market_dir=root/"market"; blind_dir.mkdir(parents=True,exist_ok=True); market_dir.mkdir(parents=True,exist_ok=True)
    try:
        rows=json.loads(Path(args.input).read_text()) if args.input else enrich_cfbd(discover(args.season,args.lookahead_days,now),args.season,now)
        if not rows: print(json.dumps({"status":"NO_UPCOMING_GAMES","games":0,"odds_api_calls":0})); return 0
        token=os.getenv("AEGIS_SHADOW_INGEST_SECRET",""); remote=fetch_blind_archives(args.endpoint,token) if args.publish else {}
        blinds=[]; archive_documents=[]
        # Phase 1 is complete for the entire slate before any sportsbook request.
        for row in rows:
            path=blind_dir/f"{row['game_id']}.json"
            if row["game_id"] in remote:
                archived=remote[row["game_id"]]; restore(archived,path); blind=json.loads(path.read_text())
            elif path.exists(): blind=json.loads(path.read_text())
            else:
                blind=project(row,generated_at=now.isoformat().replace("+00:00","Z"),simulations=args.simulations)
                path.write_text(json.dumps(blind,indent=2),encoding="utf-8")
            blinds.append(blind)
            archive_documents.append(archive_document(blind,path.read_text(encoding="utf-8")))
        # Durable immutable archive is committed before the sole sportsbook board request.
        if args.publish: archive_blinds(args.endpoint,token,archive_documents)
        board,quota=capture_board(os.getenv("ODDS_API_KEY","")); captured=datetime.now(timezone.utc).isoformat().replace("+00:00","Z"); published=[]; missing=[]
        for blind in blinds:
            market=market_for(blind["game"],board,quota,captured)
            if market is None: missing.append(blind["game_id"]); continue
            (market_dir/f"{blind['game_id']}-{captured.replace(':','')}.json").write_text(json.dumps(market,indent=2),encoding="utf-8")
            envelope=build_envelope(blind,market)
            if args.publish: published.append(publish(envelope,args.endpoint,token)["record"]["game_id"])
        print(json.dumps({"status":"SHADOW_ONLY","games":len(rows),"blind_snapshots":len(blinds),"market_snapshots":len(blinds)-len(missing),"published":published,"missing_markets":missing,"odds_api_calls":1},indent=2)); return 0
    except Exception as error: print(f"NCAAF shadow pipeline failed safely: {error}",file=sys.stderr); return 1


if __name__ == "__main__": raise SystemExit(main())
