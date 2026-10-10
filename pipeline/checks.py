"""
The small checks that the checks on the files are made of: what a time, a
probability, a score, a pair of teams and a line have to be.

Like the functions that use them, they raise on nothing. A value that is not
what it should be is a problem to be named, or simply not what was asked for.
"""

from datetime import datetime

from pipeline import teams
from pipeline.snapshot import SCHEMA
from pipeline.timestamps import parse_utc


def schema_problems(document: dict, where: str) -> list[str]:
    if document.get("schema") != SCHEMA:
        return [f"{where}: schema is {document.get('schema')!r}, expected {SCHEMA}"]
    return []


def team_problems(game: dict, where: str) -> list[str]:
    return [
        f"{where}: {side} is {game.get(side)!r}, which is not one of the 30 team codes"
        for side in ("home", "away")
        if not isinstance(game.get(side), str) or game[side] not in teams.ALL_CODES
    ]


def line_problems(line: object, where: str, *, time_field: str) -> list[str]:
    """A consensus line: probabilities with lo <= p_home <= hi, a count of at least 1, a time."""
    if not isinstance(line, dict):
        return [f"{where}: not a JSON object"]
    found = []
    p_home, lo, hi = line.get("p_home"), line.get("lo"), line.get("hi")
    if not (is_probability(p_home) and is_probability(lo) and is_probability(hi)):
        found.append(
            f"{where}: p_home, lo and hi must be numbers between 0 and 1, "
            f"got {p_home!r}, {lo!r}, {hi!r}"
        )
    elif not lo <= p_home <= hi:
        found.append(f"{where}: expected lo <= p_home <= hi, got lo {lo}, p_home {p_home}, hi {hi}")
    if type(line.get("n")) is not int or line["n"] < 1:
        found.append(f"{where}: n must be a whole number of at least 1, got {line.get('n')!r}")
    if utc_time(line.get(time_field)) is None:
        found.append(f"{where}: {time_field} is not a UTC timestamp")
    return found


def utc_time(value: object) -> datetime | None:
    try:
        return parse_utc(value)
    except ValueError:
        return None


def is_probability(value: object) -> bool:
    """Strictly between 0 and 1. A whole number cannot be, and neither can NaN."""
    return type(value) is float and 0 < value < 1


def is_score(value: object) -> bool:
    """A whole number that is not negative. True and False are not scores."""
    return type(value) is int and value >= 0


def as_object(value: object) -> dict:
    """The value when it is a JSON object, and an empty one otherwise."""
    return value if isinstance(value, dict) else {}


def objects_in(value: object) -> list[dict]:
    """The JSON objects in a list, or nothing when the value is not a list."""
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []
