"""
Checks on what the models publish: the model file, the predictions file of a
day, and what the state and the board carry of the two.

As in validate.py, every function returns a list of problems in plain words,
and nothing here raises on malformed input.
"""

import json
import re
from datetime import date
from pathlib import PurePosixPath

from pipeline import model, teams
from pipeline.checks import (
    as_object,
    is_points,
    is_probability,
    line_problems,
    schema_problems,
    team_problems,
    utc_time,
)
from pipeline.model import elo
from pipeline.model.season import Season, game_day
from pipeline.snapshot import published
from pipeline.timestamps import parse_utc

# The numbers of a points-and-rest forecast: its chance, its margin and the
# three parts that the margin is the sum of.
POINTS_REST_NUMBERS = ("p_home", "margin", "rating_edge", "home_court", "rest_edge")
STATUSES = (model.OK, model.DEGRADED)

_SHA_256 = re.compile(r"[0-9a-f]{64}")
_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")


def predictions_problems(before: dict[str, str], after: dict[str, str]) -> list[str]:
    """
    Forecasts are written once. `before` maps the path of every predictions
    file on disk to its content, and `after` maps the path of each file that
    would be written to its content. A file that is on disk must not be
    written with anything but what is in it. Every file is checked, the old
    ones too, because results are graded against them.
    """
    found = []
    for path in sorted({*before, *after}):
        content = after.get(path, before.get(path))
        if path in before and content != before[path]:
            found.append(
                f"{path}: the file is there, and forecasts that are published never change"
            )
            continue
        try:
            document = json.loads(content)
        except ValueError:
            found.append(f"{path}: not JSON")
            continue
        found += forecasts_problems(document, path, day=PurePosixPath(path).stem)
    return found


def forecasts_problems(document: object, where: str, *, day: str | None = None) -> list[str]:
    """
    The forecasts for the games of one day, as a predictions file holds them
    and as the state notes them for the board. `day` is the day that the
    name of the file gives.
    """
    if not isinstance(document, dict):
        return [f"{where}: not a JSON object"]
    found = schema_problems(document, where) + _provenance_problems(document, where)
    of_day = _date(document.get("day"))
    if of_day is None:
        found.append(f"{where}: day is not a date")
    elif day is not None and document["day"] != day:
        found.append(f"{where}: the forecasts in it are for {document['day']}")
    published_at = utc_time(document.get("published_at"))
    if published_at is None:
        found.append(f"{where}: published_at is not a UTC timestamp")
    if document.get("results_through") is not None and _date(document["results_through"]) is None:
        found.append(f"{where}: results_through is neither a date nor null")
    games = document.get("games")
    if not isinstance(games, list):
        return found + [f"{where}: games is not a list"]

    # An id that is not a string is named below, and is not looked for twice.
    ids = [game.get("id") for game in games if isinstance(game, dict)]
    ids = [game_id for game_id in ids if isinstance(game_id, str)]
    if len(set(ids)) != len(ids):
        found.append(f"{where}: a game is listed twice")
    for game in games:
        if not isinstance(game, dict):
            found.append(f"{where}: a game is not a JSON object")
            continue
        about = f"{where} game {game.get('id')!r}"
        if not isinstance(game.get("id"), str) or not game["id"]:
            found.append(f"{about}: id is not a string")
        found += team_problems(game, about)
        start = utc_time(game.get("commence_time"))
        if start is None:
            found.append(f"{about}: commence_time is not a UTC timestamp")
        else:
            if published_at is not None and start <= published_at:
                found.append(
                    f"{about}: starts at {game['commence_time']}, "
                    "which is not after the forecasts were published"
                )
            if of_day is not None and game_day(start) != of_day:
                found.append(f"{about}: is a game of {game_day(start)}, not of {of_day}")
        if type(game.get("neutral")) is not bool:
            found.append(f"{about}: neutral is neither true nor false")
        found += _elo_forecast_problems(game.get("elo"), game.get("neutral"), f"{about} elo")
        # A day on which the results did not pass the checks has Elo alone.
        if document.get("status") == model.DEGRADED:
            if game.get("points_rest") is not None:
                found.append(f"{about}: points_rest must be null when the status is degraded")
        else:
            found += _points_rest_forecast_problems(game.get("points_rest"), f"{about} points_rest")
        line = game.get("market")
        if line is not None:
            found += line_problems(line, f"{about} market", time_field="at")
            captured = utc_time(line.get("at")) if isinstance(line, dict) else None
            if captured is not None and published_at is not None and captured > published_at:
                found.append(
                    f"{about}: its line was captured at {line['at']}, "
                    "which is after the forecasts were published"
                )
    return found


def model_problems(document: object, lines: list[dict], season: Season) -> list[str]:
    """
    The model file. What it counts must equal a recount of the result lines
    of the season, and its ratings must be ratings that the results could
    have left: a team that has not played is where the season's opening file
    put it, and the Elo ratings add up to what they added up to there, give
    or take the rounding of each. The lines are taken to have passed
    result_problems.
    """
    where = "model"
    if not isinstance(document, dict):
        return [f"{where}: not a JSON object"]
    found = schema_problems(document, where) + _provenance_problems(document, where)
    if utc_time(document.get("built_at")) is None:
        found.append(f"{where}: built_at is not a UTC timestamp")
    if document.get("season") != season.name:
        found.append(f"{where}: season is {document.get('season')!r}, expected {season.name!r}")

    played = [line for line in lines if _day_of(line) >= season.first_day]
    through = max((_day_of(line) for line in played), default=None)
    table = {team: {"wins": 0, "losses": 0} for team in teams.ALL_CODES}
    for line in played:
        home_won = line["home_pts"] > line["away_pts"]
        table[line["home"]]["wins" if home_won else "losses"] += 1
        table[line["away"]]["losses" if home_won else "wins"] += 1
    recount = [
        ("games", document.get("games"), len(played)),
        ("results_through", document.get("results_through"), through and through.isoformat()),
        ("teams", document.get("teams"), table),
    ]
    found += [
        f"{where}: {name} is {got!r}, and a recount of the result lines gives {counted!r}"
        for name, got, counted in recount
        if got != counted
    ]

    opening = season.elo["ratings"]
    rated = as_object(document.get("elo"))
    ratings = rated.get("ratings")
    if rated.get("constants") != season.elo["constants"]:
        found.append(f"{where}: elo.constants are not the ones of the season's opening file")
    if not _is_table(ratings, {"rating": int, "week_ago": int}):
        found.append(f"{where}: elo.ratings must give each of the 30 teams a rating and week_ago")
    else:
        total = sum(team["rating"] for team in ratings.values())
        if abs(total - sum(opening.values())) > len(opening) / 2:
            found.append(
                f"{where}: the Elo ratings add up to {total}, and a game leaves "
                f"the sum of the opening ratings, {sum(opening.values())}, as it was"
            )
        found += [
            f"{where}: {team} has not played and is not at its opening rating of {opening[team]}"
            for team in sorted(opening)
            if table[team] == {"wins": 0, "losses": 0}
            and ratings[team] != {"rating": opening[team], "week_ago": opening[team]}
        ]

    points = document.get("points_rest")
    if document.get("status") == model.DEGRADED:
        if points is not None:
            found.append(f"{where}: points_rest must be null when the status is degraded")
    elif (
        not isinstance(points, dict)
        or type(points.get("home_court")) is not float
        or not _is_table(points.get("ratings"), {"rating": float, "uncertainty": float})
    ):
        found.append(
            f"{where}: points_rest must give the league's home court and, for each of "
            "the 30 teams, a rating and its uncertainty"
        )
    else:
        # Each rating is rounded to a hundredth after the mean is taken off.
        mean_taken_off = sum(team["rating"] for team in points["ratings"].values())
        if abs(mean_taken_off) > 0.16:
            found.append(
                f"{where}: the points_rest ratings do not have the league's mean taken off"
            )
        if not all(team["uncertainty"] > 0 for team in points["ratings"].values()):
            found.append(f"{where}: an uncertainty of the points_rest ratings is not above 0")
    return found


def note_problems(noted: object) -> list[str]:
    """
    What the daily work notes of the models in the state, for the board:
    Elo's whole-number ratings and the forecasts of the day. Null until the
    models have been built once, and not there at all in the state of a
    sport that is not forecast or from before the models were added.
    """
    if noted is None:
        return []
    where = "state models"
    if not isinstance(noted, dict):
        return [f"{where}: not a JSON object"]
    found = []
    if utc_time(noted.get("built_at")) is None:
        found.append(f"{where}: built_at is not a UTC timestamp")
    found += _freshness_problems(noted, where)
    ratings = noted.get("elo")
    if (
        not isinstance(ratings, dict)
        or set(ratings) != teams.ALL_CODES
        or not all(type(rating) is int for rating in ratings.values())
    ):
        found.append(f"{where}: elo must give each of the 30 teams a whole-number rating")
    if noted.get("predictions") is not None:
        found += forecasts_problems(noted["predictions"], f"{where} predictions")
    return found


def board_problems(noted: object) -> list[str]:
    """What the board says of the models as a whole. Null until they have been built once."""
    if noted is None:
        return []
    where = "slate models"
    if not isinstance(noted, dict):
        return [f"{where}: not a JSON object"]
    found = _freshness_problems(noted, where)
    if noted.get("predictions_day") is not None and _date(noted["predictions_day"]) is None:
        found.append(f"{where}: predictions_day is neither a date nor null")
    return found


def game_problems(game: dict, where: str) -> list[str]:
    """What a game on the board carries of the two models: Elo's chance, and a frozen forecast."""
    found = []
    chance = game.get("elo")
    is_chance = isinstance(chance, dict) and is_probability(chance.get("p_home"))
    if "elo" not in game or not (chance is None or is_chance):
        found.append(f"{where} elo: must be null or hold p_home, a number between 0 and 1")
    if "points_rest" not in game:
        found.append(f"{where} points_rest: must be null or a forecast")
    elif game["points_rest"] is not None:
        found += _points_rest_forecast_problems(game["points_rest"], f"{where} points_rest")
    return found


def _provenance_problems(document: dict, where: str) -> list[str]:
    """
    What the model file and a predictions file say of how they were made:
    whether the results passed the checks, and which parameters and which
    code the numbers come from.
    """
    found = []
    status, reasons = document.get("status"), document.get("reasons")
    if status not in STATUSES:
        found.append(f"{where}: status is {status!r}, which is not one of {', '.join(STATUSES)}")
    if not isinstance(reasons, list) or not all(isinstance(why, str) and why for why in reasons):
        found.append(f"{where}: reasons is not a list of sentences")
    elif status in STATUSES and bool(reasons) != (status == model.DEGRADED):
        found.append(f"{where}: a status of degraded must come with its reasons, and ok with none")
    parameters = document.get("parameters")
    if (
        not isinstance(parameters, dict)
        or set(parameters) != set(model.NAMES)
        or not all(
            isinstance(digest, str) and _SHA_256.fullmatch(digest) for digest in parameters.values()
        )
    ):
        found.append(f"{where}: parameters must give the SHA-256 of the file of each model")
    commit = document.get("code_commit")
    if commit is not None and not (isinstance(commit, str) and _COMMIT.fullmatch(commit)):
        found.append(f"{where}: code_commit is neither a commit nor null")
    return found


def _elo_forecast_problems(forecast: object, neutral: object, where: str) -> list[str]:
    """
    Elo's forecast in a predictions file: the chance must be the one that
    the two whole-number ratings and the home court next to it give.
    """
    if not isinstance(forecast, dict):
        return [f"{where}: not a JSON object"]
    home, away, court = (forecast.get(key) for key in ("home_rating", "away_rating", "home_court"))
    if type(home) is not int or type(away) is not int:
        return [f"{where}: home_rating and away_rating must be whole numbers"]
    if type(court) not in (int, float) or court < 0 or (neutral is True and court != 0):
        return [f"{where}: home_court must be a number, and 0 on a neutral floor"]
    try:
        chance = published(elo.win_probability(home, away, court))
    except OverflowError:
        return [f"{where}: home_rating, away_rating and home_court are too large to give a chance"]
    if forecast.get("p_home") != chance:
        return [
            f"{where}: p_home is {forecast.get('p_home')!r}, "
            f"and the ratings and the home court give {chance}"
        ]
    return []


def _points_rest_forecast_problems(forecast: object, where: str) -> list[str]:
    """
    The points-and-rest forecast in a predictions file and on the board: a
    chance, and a margin that is the sum of its three parts as written.
    """
    if not isinstance(forecast, dict):
        return [f"{where}: not a JSON object"]
    found = []
    if not is_probability(forecast.get("p_home")):
        found.append(
            f"{where}: p_home must be a number between 0 and 1, got {forecast.get('p_home')!r}"
        )
    points = [forecast.get(key) for key in POINTS_REST_NUMBERS[1:]]
    if not all(is_points(number) for number in points):
        found.append(f"{where}: {', '.join(POINTS_REST_NUMBERS[1:])} must be numbers of points")
    else:
        margin, *parts = (round(number * 100) for number in points)
        if margin != sum(parts):
            found.append(
                f"{where}: margin is {forecast['margin']}, and rating_edge, home_court "
                f"and rest_edge add up to {sum(parts) / 100}"
            )
    return found


def _freshness_problems(noted: dict, where: str) -> list[str]:
    found = []
    if noted.get("results_through") is not None and _date(noted["results_through"]) is None:
        found.append(f"{where}: results_through is neither a date nor null")
    if noted.get("status") not in STATUSES:
        found.append(
            f"{where}: status is {noted.get('status')!r}, "
            f"which is not one of {', '.join(STATUSES)}"
        )
    return found


def _is_table(table: object, columns: dict) -> bool:
    """Whether a value gives each of the 30 teams the named numbers, each of its own kind."""
    return (
        isinstance(table, dict)
        and set(table) == teams.ALL_CODES
        and all(
            isinstance(row, dict)
            and all(type(row.get(name)) is kind for name, kind in columns.items())
            for row in table.values()
        )
    )


def _day_of(line: dict) -> date:
    return game_day(parse_utc(line["commence_time"]))


def _date(value: object) -> date | None:
    """A date written as YYYY-MM-DD, or None for anything else."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None
