"""
Checks on the files, run before anything is written.

Every function returns a list of problems in plain words. An empty list means
the file may be written. Nothing here raises on malformed input, because the
state that is read back from disk is checked with the same code before a
request is spent on it.
"""

import json
from datetime import datetime

from pipeline import teams
from pipeline.snapshot import SCHEMA
from pipeline.timestamps import parse_utc

HISTORY_FIELDS = ["id", "at", "p_home", "lo", "hi", "n"]


def problems(slate: object, state: object, history_before: str, history_after: str) -> list[str]:
    """Everything wrong with one snapshot: the board, the state and the day's history file."""
    return (
        slate_problems(slate)
        + state_problems(state)
        + history_problems(history_before, history_after)
    )


def slate_problems(slate: object) -> list[str]:
    if not isinstance(slate, dict):
        return ["slate: not a JSON object"]
    found = _schema_problems(slate, "slate")
    generated_at = _time(slate.get("generated_at"))
    if generated_at is None:
        found.append("slate: generated_at is not a UTC timestamp")
    games = slate.get("games")
    if not isinstance(games, list):
        return found + ["slate: games is not a list"]

    for game in games:
        if not isinstance(game, dict):
            found.append("slate: a game is not a JSON object")
            continue
        where = f"slate game {game.get('id')!r}"
        found += _team_problems(game, where)
        start = _time(game.get("commence_time"))
        if start is None:
            found.append(f"{where}: commence_time is not a UTC timestamp")
        elif generated_at is not None and start <= generated_at:
            found.append(
                f"{where}: starts at {game['commence_time']}, which is not after the snapshot time"
            )

        line = game.get("line")
        if line is not None:
            found += _line_problems(line, f"{where} line", time_field="captured_at")
            if isinstance(line, dict):
                books = line.get("books")
                named = isinstance(books, list) and all(
                    isinstance(book, str) and book for book in books
                )
                if not named or len(books) != line.get("n"):
                    found.append(f"{where} line: books must name each of the n sportsbooks")
        found += _opening_problems(game.get("open"), f"{where} open")
    return found


def state_problems(state: object) -> list[str]:
    if not isinstance(state, dict):
        return ["state: not a JSON object"]
    found = _schema_problems(state, "state")
    if not isinstance(state.get("last_slot"), str):
        found.append("state: last_slot is not a string")
    if _time(state.get("last_run_at")) is None:
        found.append("state: last_run_at is not a UTC timestamp")
    credits = state.get("credits")
    if not isinstance(credits, dict) or not all(
        credits.get(key) is None or type(credits.get(key)) is int
        for key in ("remaining", "used", "last")
    ):
        found.append("state: credits must hold whole numbers or null for remaining, used and last")
    games = state.get("games")
    if not isinstance(games, dict):
        return found + ["state: games is not a JSON object"]

    for game_id, game in games.items():
        where = f"state game {game_id!r}"
        if not isinstance(game, dict):
            found.append(f"{where}: not a JSON object")
            continue
        found += _team_problems(game, where)
        if _time(game.get("commence_time")) is None:
            found.append(f"{where}: commence_time is not a UTC timestamp")
        found += _opening_problems(game.get("first"), f"{where} first")
        if game.get("latest") is not None:
            found += _line_problems(game["latest"], f"{where} latest", time_field="at")
    return found


def history_problems(before: str, after: str) -> list[str]:
    """
    History only grows. `before` is the day's file as it is on disk (empty
    when there is none) and `after` is what would replace it: the old content
    must be the start of the new content, and each added line must be a
    complete record.
    """
    if not after.startswith(before):
        return ["history: lines that are already in the file would be changed or removed"]
    if before and not before.endswith("\n"):
        return ["history: the existing file does not end with a newline"]
    added = after[len(before) :]
    if added and not added.endswith("\n"):
        return ["history: the added lines do not end with a newline"]

    found = []
    for number, text in enumerate(added.splitlines(), start=before.count("\n") + 1):
        where = f"history line {number}"
        try:
            line = json.loads(text)
        except ValueError:
            found.append(f"{where}: not JSON")
            continue
        if not isinstance(line, dict) or list(line) != HISTORY_FIELDS:
            found.append(f"{where}: the fields must be {', '.join(HISTORY_FIELDS)}, in that order")
            continue
        if not isinstance(line["id"], str) or not line["id"]:
            found.append(f"{where}: id is not a string")
        found += _line_problems(line, where, time_field="at")
    return found


def _schema_problems(document: dict, where: str) -> list[str]:
    if document.get("schema") != SCHEMA:
        return [f"{where}: schema is {document.get('schema')!r}, expected {SCHEMA}"]
    return []


def _team_problems(game: dict, where: str) -> list[str]:
    return [
        f"{where}: {side} is {game.get(side)!r}, which is not one of the 30 team codes"
        for side in ("home", "away")
        if not isinstance(game.get(side), str) or game[side] not in teams.ALL_CODES
    ]


def _line_problems(line: object, where: str, *, time_field: str) -> list[str]:
    """A consensus line: probabilities with lo <= p_home <= hi, a count of at least 1, a time."""
    if not isinstance(line, dict):
        return [f"{where}: not a JSON object"]
    found = []
    p_home, lo, hi = line.get("p_home"), line.get("lo"), line.get("hi")
    if not (_is_probability(p_home) and _is_probability(lo) and _is_probability(hi)):
        found.append(
            f"{where}: p_home, lo and hi must be numbers between 0 and 1, "
            f"got {p_home!r}, {lo!r}, {hi!r}"
        )
    elif not lo <= p_home <= hi:
        found.append(f"{where}: expected lo <= p_home <= hi, got lo {lo}, p_home {p_home}, hi {hi}")
    if type(line.get("n")) is not int or line["n"] < 1:
        found.append(f"{where}: n must be a whole number of at least 1, got {line.get('n')!r}")
    if _time(line.get(time_field)) is None:
        found.append(f"{where}: {time_field} is not a UTC timestamp")
    return found


def _opening_problems(opening: object, where: str) -> list[str]:
    """An opening line is null or a probability with the time it was first seen."""
    if opening is None:
        return []
    if not isinstance(opening, dict):
        return [f"{where}: not a JSON object"]
    found = []
    if not _is_probability(opening.get("p_home")):
        found.append(
            f"{where}: p_home must be a number between 0 and 1, got {opening.get('p_home')!r}"
        )
    if _time(opening.get("at")) is None:
        found.append(f"{where}: at is not a UTC timestamp")
    return found


def _is_probability(value: object) -> bool:
    """Strictly between 0 and 1. A whole number cannot be, and neither can NaN."""
    return type(value) is float and 0 < value < 1


def _time(value: object) -> datetime | None:
    try:
        return parse_utc(value)
    except ValueError:
        return None
