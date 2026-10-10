"""
Builds what the daily run publishes of the two models: the model file, with
every team's ratings as the results of the season leave them, and the
forecasts for the games of the day, which are written once and never changed.

Both models are replayed from their opening files through every result of
the season, every day. Nothing of yesterday's ratings is carried over, so a
day that was missed repairs itself with the next run.

build() reads nothing, writes nothing and does not look at the clock. The
same lines, state, day and time always give the same result.
"""

import copy
import math
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from pipeline import model, snapshot, teams
from pipeline.model import elo, points_rest
from pipeline.model.season import Final, Game, Season, game_day
from pipeline.timestamps import format_utc, parse_utc

# A game that started this long ago is over, and its result is expected. A
# daily run comes a little over six hours after the latest starts of an
# evening.
OVER_AFTER = timedelta(hours=6)
# The scores reach back three days. A result that is still missing after
# that is not going to come, and the models go on without it.
SCORES_REACH = timedelta(days=3)

_WEEK = timedelta(days=7)
# What a forecast keeps of the sportsbooks' line at the moment it is made.
_LINE_FIELDS = ("p_home", "lo", "hi", "n", "at")


@dataclass(frozen=True)
class Forecasts:
    model: dict  # as written to model.json
    # As written to the predictions file of the day. None when nothing is to
    # be written: the file is there already, or no game of the day is left.
    predictions: dict | None
    state: dict  # the state, with the models noted in it for the board
    reasons: list[str]  # why the points-and-rest model is left out, when it is


def build(
    lines: list[dict],
    state: dict,
    now: datetime,
    *,
    sport: str,
    season: Season,
    day: date,
    frozen: dict | None,
    commit: str | None,
) -> Forecasts:
    """
    lines   every result line there is, the ones of this run included
    state   the state as the daily work leaves it
    now     when the scores response was received
    day     the day whose games are forecast: the one that the daily slot
            is the morning of
    frozen  the predictions file of that day, when there is one already
    commit  the commit of the code that runs, when it is known

    The rules:

    - Only a game of the season counts: a game of a day before the
      season's first is neither replayed nor checked nor forecast.
    - Before the replay is trusted, the results are checked: no game is
      recorded twice, no team has two results on one day, and every game
      the state knows that started between six hours and three days ago
      has a result. If a check fails, the points-and-rest model is left
      out, of the model file and of the day's forecasts, and the reasons
      are given in both. Elo is published all the same: a missing game
      leaves two of its ratings a little behind and nothing else.
    - A forecast is made for each game of the day that the state knows and
      that has not started, from the results of earlier days only. A game
      whose result is on record gets none, whatever start the state has
      for it.
    - A predictions file is written once. When the day has one, no forecast
      is made, and the file is noted in the state as it is.
    """
    at = format_utc(now)
    # In order of start, whatever order the lines were recorded in, so that
    # the same results give the same ratings to the last digit.
    of_the_season = [
        line
        for line in sorted(lines, key=lambda line: (line["commence_time"], line["id"]))
        if game_day(parse_utc(line["commence_time"])) >= season.first_day
    ]
    played = [_final(line, season) for line in of_the_season]
    reasons = distrust(of_the_season, state["games"], now, season)
    status = model.DEGRADED if reasons else model.OK
    through = max((final.day for final in played), default=None)

    ratings = _elo_ratings(season, played)
    a_week_earlier = _elo_ratings(
        season, [final for final in played if final.day + _WEEK <= through]
    )
    document = {
        "schema": snapshot.SCHEMA,
        "sport": sport,
        "season": season.name,
        "built_at": at,
        "results_through": through and through.isoformat(),
        "games": len(played),
        "status": status,
        "reasons": list(reasons),
        "parameters": dict(season.parameters),
        "code_commit": commit,
        "elo": {
            "constants": dict(season.elo["constants"]),
            "ratings": {
                team: {"rating": ratings[team], "week_ago": a_week_earlier[team]}
                for team in sorted(ratings)
            },
        },
        "points_rest": None if reasons else _points_rest_ratings(season, played),
        "teams": _wins_and_losses(played),
    }

    predictions = None
    if frozen is None:
        before = [final for final in played if final.day < day]
        over = {line["id"] for line in lines}
        games = _forecasts_for(
            state["games"], over, now, day, season, before, with_points_rest=not reasons
        )
        if games:
            earlier = max((final.day for final in before), default=None)
            predictions = {
                "schema": snapshot.SCHEMA,
                "sport": sport,
                "day": day.isoformat(),
                "published_at": at,
                "results_through": earlier and earlier.isoformat(),
                "status": status,
                "reasons": list(reasons),
                "parameters": dict(season.parameters),
                "code_commit": commit,
                "games": games,
            }

    noted = copy.deepcopy(state)
    noted["models"] = {
        "built_at": at,
        "results_through": document["results_through"],
        "status": status,
        "elo": ratings,
        "predictions": copy.deepcopy(frozen if frozen is not None else predictions),
    }
    return Forecasts(model=document, predictions=predictions, state=noted, reasons=reasons)


def distrust(lines: list[dict], known: dict, now: datetime, season: Season) -> list[str]:
    """
    Why the results of the season cannot be trusted to be sound and
    complete, one sentence for each thing found. `lines` are the result
    lines of the season and `known` the games of the state. An empty list
    means that both models may be replayed from them.
    """
    reasons = []
    recorded = Counter(line["id"] for line in lines)
    reasons += [
        f"game {game_id} is recorded {times} times"
        for game_id, times in sorted(recorded.items())
        if times > 1
    ]
    results_on = Counter(
        (game_day(parse_utc(line["commence_time"])), line[side])
        for line in lines
        for side in ("home", "away")
    )
    reasons += [
        f"{team} has {times} results on {day}"
        for (day, team), times in sorted(results_on.items())
        if times > 1
    ]
    for game_id, game in _in_order_of_start(known):
        start = parse_utc(game["commence_time"])
        of_the_season = game_day(start) >= season.first_day
        if of_the_season and OVER_AFTER <= now - start < SCORES_REACH and game_id not in recorded:
            reasons.append(
                f"no result for {game['away']} at {game['home']}, "
                f"which started at {game['commence_time']} (game {game_id})"
            )
    return reasons


def _in_order_of_start(known: dict) -> list:
    """The games of the state with their ids, by start and then by id."""
    return sorted(known.items(), key=lambda item: (item[1]["commence_time"], item[0]))


def _final(line: dict, season: Season) -> Final:
    return season.final(
        parse_utc(line["commence_time"]),
        line["home"],
        line["away"],
        line["home_pts"],
        line["away_pts"],
    )


def _elo_ratings(season: Season, played: list[Final]) -> dict:
    """Every team's Elo rating after the games, as a whole number."""
    constants = season.elo["constants"]
    after = elo.replay(
        season.elo["ratings"], played, k=constants["k"], home_court=constants["home_court"]
    )
    return {team: round(rating) for team, rating in after.items()}


def _points_rest_ratings(season: Season, played: list[Final]) -> dict:
    """
    What the model file gives of the points-and-rest model after the games:
    the league's home court, and for every team its rating and how well the
    rating is known. The model's ratings are relative to each other and do
    not average zero, so the league's mean is taken off them: a rating here
    is in points against an average team.
    """
    state = points_rest.Model(season.points_rest).replay(played)
    mean = sum(state.rating.values()) / len(state.rating)
    return {
        "home_court": _hundredths(state.home_court) / 100,
        "ratings": {
            team: {
                "rating": _hundredths(state.rating[team] - mean) / 100,
                "uncertainty": _hundredths(math.sqrt(state.variance[team])) / 100,
            }
            for team in sorted(state.rating)
        },
    }


def _wins_and_losses(played: list[Final]) -> dict:
    table = {team: {"wins": 0, "losses": 0} for team in sorted(teams.ALL_CODES)}
    for final in played:
        home_won = final.home_pts > final.away_pts
        table[final.home]["wins" if home_won else "losses"] += 1
        table[final.away]["losses" if home_won else "wins"] += 1
    return table


def _forecasts_for(
    known: dict,
    over: set,
    now: datetime,
    day: date,
    season: Season,
    before: list[Final],
    *,
    with_points_rest: bool,
) -> list[dict]:
    """
    The forecasts for the games of a day that have not started, in order of
    start. `before` are the results of the earlier days, and nothing else
    goes into a forecast: a game of the same day that is already over, as it
    can be when the daily work is done late, changes nothing. `over` are the
    ids of the games that have a result. The state can still have such a
    game as one to come, when it was played earlier than any snapshot saw,
    and a forecast for it would be one made after the game.
    """
    ratings = _elo_ratings(season, before)
    state = points_rest.Model(season.points_rest).replay(before) if with_points_rest else None
    forecasts = []
    for game_id, game in _in_order_of_start(known):
        start = parse_utc(game["commence_time"])
        fixture = season.game(start, game["home"], game["away"])
        if start <= now or fixture.day != day or day < season.first_day or game_id in over:
            continue
        line = game["latest"]
        forecasts.append(
            {
                "id": game_id,
                "commence_time": game["commence_time"],
                "home": game["home"],
                "away": game["away"],
                "neutral": fixture.neutral,
                "elo": _elo_forecast(season, ratings, fixture),
                "points_rest": state and _points_rest_forecast(state.forecast(fixture)),
                "market": line and {field: line[field] for field in _LINE_FIELDS},
            }
        )
    return forecasts


def _elo_forecast(season: Season, ratings: dict, game: Game) -> dict:
    """
    Elo's forecast as it is published. The chance is worked out from the
    whole-number ratings that are published with it, so that a reader who
    puts the three numbers into the formula gets the chance that is written.
    """
    home_court = season.elo_home_court(game)
    chance = elo.win_probability(ratings[game.home], ratings[game.away], home_court)
    return {
        "p_home": snapshot.published(chance),
        "home_rating": ratings[game.home],
        "away_rating": ratings[game.away],
        "home_court": home_court,
    }


def _points_rest_forecast(forecast: points_rest.Forecast) -> dict:
    """
    The points-and-rest forecast as it is published. The three parts are
    rounded to hundredths of a point, and the margin is the sum of the
    rounded parts, so the parts that are written add up to the margin that
    is written. The chance is the model's own, rounded like every chance.
    """
    parts = {
        "rating_edge": _hundredths(forecast.rating_edge),
        "home_court": _hundredths(forecast.home_court),
        "rest_edge": _hundredths(forecast.rest_edge),
    }
    return {
        "p_home": snapshot.published(forecast.p_home),
        "margin": sum(parts.values()) / 100,
        **{name: part / 100 for name, part in parts.items()},
    }


def _hundredths(points: float) -> int:
    """
    A number of points as a whole number of hundredths. Dividing it by 100
    gives the number to two decimals, and never a zero with a minus sign.
    """
    return round(points * 100)
