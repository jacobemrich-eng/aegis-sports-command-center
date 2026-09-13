from __future__ import annotations

from collections import defaultdict
from statistics import mean
from typing import Any, Iterable, Mapping

try:
    from .aegis_ncaaf_snapshot_builder import (
        aggregate_history, classification, game_team_summary, number,
        season_payload, summarize_drives, summarize_plays,
    )
except ImportError:
    from aegis_ncaaf_snapshot_builder import (
        aggregate_history, classification, game_team_summary, number,
        season_payload, summarize_drives, summarize_plays,
    )


def prior_schedule_ratings(games: Iterable[Mapping[str, Any]]) -> dict[str, float]:
    """Completed-prior-season opponent-adjusted margin rating.

    This retrospective calculation is permitted only as a following-season
    preseason prior. It is never assigned to a game from the same season.
    """
    results = []
    teams = set()
    for game in games:
        home_score, away_score = number(game.get("homePoints")), number(game.get("awayPoints"))
        home, away = str(game.get("homeTeam") or ""), str(game.get("awayTeam") or "")
        if not home or not away or home_score is None or away_score is None or not game.get("completed"):
            continue
        adjusted_margin = home_score - away_score - (0 if game.get("neutralSite") else 2.5)
        results.append((home, away, adjusted_margin)); teams.update((home, away))
    ratings = {team: 0.0 for team in teams}
    for _ in range(30):
        performances = defaultdict(list)
        for home, away, margin in results:
            performances[home].append(margin + ratings[away])
            performances[away].append(-margin + ratings[home])
        updated = {team: mean(values) for team, values in performances.items() if values}
        center = mean(updated.values()) if updated else 0.0
        ratings = {team: max(-45.0, min(45.0, updated.get(team, 0.0) - center)) for team in teams}
    return ratings


def build_prior_profiles(target_years: Iterable[int]) -> dict[int, dict[str, dict[str, Any]]]:
    years = sorted(set(int(year) for year in target_years))
    # The local raw store contains detailed plays/drives for target seasons.
    # They become priors only for the next season.
    play_summaries = summarize_plays(years)
    drive_summaries = summarize_drives(years)
    output: dict[int, dict[str, dict[str, Any]]] = {}
    for target_year in years:
        prior_year = target_year - 1
        games = season_payload("games", prior_year)
        ratings = prior_schedule_ratings(games)
        histories = defaultdict(list); margins = defaultdict(list); classes = {}
        for game in games:
            home_score, away_score = number(game.get("homePoints")), number(game.get("awayPoints"))
            if home_score is None or away_score is None or not game.get("completed"):
                continue
            game_id = int(game["id"]); home, away = str(game["homeTeam"]), str(game["awayTeam"])
            histories[home].append(game_team_summary(game_id, home, play_summaries, drive_summaries))
            histories[away].append(game_team_summary(game_id, away, play_summaries, drive_summaries))
            margins[home].append(home_score - away_score); margins[away].append(away_score - home_score)
            classes[home] = classification(game.get("homeClassification")); classes[away] = classification(game.get("awayClassification"))
        profiles = {}
        for team in set(histories) | set(ratings):
            profile = aggregate_history(histories.get(team, []), {}, None,
                                        mean(margins[team]) if margins.get(team) else None,
                                        classes.get(team, "unknown"))
            profile["schedule_strength"] = ratings.get(team)
            profile["source_season"] = prior_year
            profile["known_before_season"] = target_year
            profiles[team] = profile
        output[target_year] = profiles
    return output

