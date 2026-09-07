from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional
import json
import time
import requests
import pandas as pd

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
NFLDATA_GAMES = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"

URLS = {
    "pbp": lambda season: f"{NFLVERSE}/pbp/play_by_play_{season}.parquet",
    "injuries": lambda season: f"{NFLVERSE}/injuries/injuries_{season}.parquet",
    "weekly_rosters": lambda season: f"{NFLVERSE}/weekly_rosters/roster_weekly_{season}.parquet",
    "snap_counts": lambda season: f"{NFLVERSE}/snap_counts/snap_counts_{season}.parquet",
    "team_stats_week": lambda season: f"{NFLVERSE}/stats_team/stats_team_week_{season}.parquet",
    "player_stats_week": lambda season: f"{NFLVERSE}/stats_player/stats_player_week_{season}.parquet",
    "ngs_passing": lambda season: f"{NFLVERSE}/nextgen_stats/ngs_passing.parquet",
    "ngs_receiving": lambda season: f"{NFLVERSE}/nextgen_stats/ngs_receiving.parquet",
    "ngs_rushing": lambda season: f"{NFLVERSE}/nextgen_stats/ngs_rushing.parquet",
}

@dataclass
class DownloadResult:
    dataset: str
    season: int
    url: str
    path: str
    bytes: int
    cached: bool


def download(dataset: str, season: int, cache_dir: str | Path = "data/nflverse", *, refresh: bool = False, timeout: int = 120, retries: int = 4) -> DownloadResult:
    if dataset not in URLS:
        raise KeyError(f"Unknown dataset: {dataset}")
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    url = URLS[dataset](season)
    path = cache_dir / f"{dataset}_{season}.parquet"
    if path.exists() and path.stat().st_size > 0 and not refresh:
        return DownloadResult(dataset, season, url, str(path), path.stat().st_size, True)
    last = None
    for attempt in range(retries):
        try:
            with requests.get(url, stream=True, timeout=timeout, allow_redirects=True) as r:
                if r.status_code == 404:
                    raise FileNotFoundError(f"{dataset} {season} unavailable: {url}")
                r.raise_for_status()
                tmp = path.with_suffix(path.suffix + ".part")
                with tmp.open("wb") as f:
                    for chunk in r.iter_content(1024 * 1024):
                        if chunk:
                            f.write(chunk)
                tmp.replace(path)
            return DownloadResult(dataset, season, url, str(path), path.stat().st_size, False)
        except Exception as e:
            last = e
            time.sleep(min(12, 2 ** attempt))
    raise RuntimeError(f"Download failed: {dataset} {season}: {last}")


def load(dataset: str, season: int, cache_dir="data/nflverse") -> pd.DataFrame:
    result = download(dataset, season, cache_dir)
    df = pd.read_parquet(result.path)
    if dataset.startswith("ngs_") and "season" in df.columns:
        df = df[df["season"].eq(season)].copy()
    return df


def load_schedule(seasons: Optional[Iterable[int]] = None) -> pd.DataFrame:
    df = pd.read_csv(NFLDATA_GAMES)
    if seasons is not None:
        keep = set(int(x) for x in seasons)
        df = df[df["season"].isin(keep)].copy()
    return df


def bootstrap(seasons: Iterable[int], *, cache_dir="data/nflverse", datasets: Optional[List[str]] = None) -> Dict[str, object]:
    # The real walk-forward requires only PBP. Other datasets are optional enrichments.
    datasets = datasets or ["pbp"]
    ok, fail = [], []
    for season in seasons:
        for dataset in datasets:
            try:
                ok.append(download(dataset, int(season), cache_dir).__dict__)
            except Exception as e:
                fail.append({"dataset": dataset, "season": int(season), "error": f"{type(e).__name__}: {e}"})
    return {"downloads": ok, "failures": fail, "required_failures": [x for x in fail if x["dataset"] == "pbp"]}


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--start", type=int, default=2021)
    p.add_argument("--end", type=int, default=2025)
    p.add_argument("--cache-dir", default="data/nflverse")
    p.add_argument("--manifest", default="data/nflverse/bootstrap.json")
    args = p.parse_args()
    result = bootstrap(range(args.start, args.end + 1), cache_dir=args.cache_dir)
    out = Path(args.manifest)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    if result["required_failures"]:
        raise SystemExit(2)
