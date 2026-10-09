"""
Turns one response into what is published: the board, the state and the
history lines.

build() reads nothing, writes nothing and does not look at the clock. The
same events, previous state and time always give the same result.
"""

import copy
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pipeline import consensus, teams
from pipeline.timestamps import format_utc, parse_utc

SCHEMA = 1

# A game stays in the state this long after its start, so that the grading
# step can still find the last line taken before the start.
RETENTION = timedelta(days=14)

# The provider's event ids are 32 hexadecimal characters. An id is used as a
# key in the published files, so anything that is not a short plain token is
# turned away.
_EVENT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


@dataclass(frozen=True)
class Snapshot:
    slate: dict  # the board, as written to slate.json
    state: dict  # as written to state.json
    history: list[dict]  # one line per game that has a line, in board order
    dropped: list[str]  # one sentence per event that was left out, saying why


class _Unusable(Exception):
    """An event that cannot be recorded. The message says why."""


def build(
    events: list,
    previous: dict | None,
    now: datetime,
    *,
    sport: str,
    slot: str,
    next_due: str,
    credits: dict,
) -> Snapshot:
    """
    events    the events of one response
    previous  the state the last run wrote, or None on the first run
    now       when the response was received

    The rules:

    - An event that starts at or before now is ignored. The game is under
      way or over, and its prices are no longer pre-game prices.
    - An upcoming event with a team that is not one of the 30, or an event
      without a usable id or start time, is left out and reported in
      Snapshot.dropped.
    - The first line seen for a game is its opening line and is kept.
    - A game's latest line is replaced only by a snapshot taken before the
      game starts. A snapshot in which the game has no line leaves it alone.
    - A game leaves the state 14 days after its start.
    """
    at = format_utc(now)
    games = copy.deepcopy(previous["games"]) if previous else {}
    board, dropped, listed = [], [], set()

    for event in events:
        try:
            game_id, start = _id_and_start(event)
            if start <= now:
                continue
            home, away = _team_codes(event, game_id)
        except _Unusable as reason:
            dropped.append(str(reason))
            continue
        if game_id in listed:
            dropped.append(f"event {game_id}: listed twice, the second entry is ignored")
            continue
        listed.add(game_id)

        known = games.get(game_id, {})
        first, latest = known.get("first"), known.get("latest")
        line = consensus.game_line(event)
        on_board = None
        if line is not None:
            numbers = {
                "p_home": published(line.p_home),
                "lo": published(line.lo),
                "hi": published(line.hi),
                "n": line.n,
            }
            latest = {**numbers, "at": at}
            first = first or {"p_home": numbers["p_home"], "at": at}
            on_board = {**numbers, "books": list(line.books), "captured_at": at}

        game = {"commence_time": format_utc(start), "home": home, "away": away}
        games[game_id] = {**game, "first": first, "latest": latest}
        board.append({"id": game_id, **game, "line": on_board, "open": copy.copy(first)})

    board.sort(key=lambda game: (game["commence_time"], game["id"]))
    history = [
        {
            "id": game["id"],
            "at": at,
            **{key: game["line"][key] for key in ("p_home", "lo", "hi", "n")},
        }
        for game in board
        if game["line"] is not None
    ]
    oldest_kept = now - RETENTION
    games = {
        game_id: game
        for game_id, game in games.items()
        if parse_utc(game["commence_time"]) > oldest_kept
    }

    slate = {
        "schema": SCHEMA,
        "sport": sport,
        "generated_at": at,
        "slot": slot,
        "next_due": next_due,
        "games": board,
    }
    state = {
        "schema": SCHEMA,
        "last_slot": slot,
        "last_run_at": at,
        "credits": dict(credits),
        "games": games,
    }
    return Snapshot(slate=slate, state=state, history=history, dropped=dropped)


def published(probability: float) -> float:
    """
    A probability as it is written to the files: four decimals, and never
    exactly 0 or 1. A value that would round to 0 or 1 is written as 0.0001
    or 0.9999 instead, so that every published probability can be scored
    with a logarithm.
    """
    return min(0.9999, max(0.0001, round(probability, 4)))


def _id_and_start(event: object) -> tuple[str, datetime]:
    """An event's id and its start in UTC. Raises _Unusable when either is missing."""
    if not isinstance(event, dict):
        raise _Unusable(f"an entry that is not an event: {_show(event)}")
    game_id = event.get("id")
    if not isinstance(game_id, str) or not _EVENT_ID.fullmatch(game_id):
        raise _Unusable(f"an event without a usable id: {_show(game_id)}")
    start = _start(event.get("commence_time"))
    if start is None:
        raise _Unusable(
            f"event {game_id}: no usable commence_time: {_show(event.get('commence_time'))}"
        )
    return game_id, start


def _team_codes(event: dict, game_id: str) -> tuple[str, str]:
    """The home and the away team's codes. Raises _Unusable for a team that is not one of the 30."""
    codes = []
    for side in ("home_team", "away_team"):
        code = teams.code(event.get(side))
        if code is None:
            raise _Unusable(f"event {game_id}: unknown team {_show(event.get(side))}")
        codes.append(code)
    home, away = codes
    if home == away:
        raise _Unusable(f"event {game_id}: {home} is on both sides")
    return home, away


def _start(value: object) -> datetime | None:
    """
    The provider's commence_time in UTC, to the second. None when it is not
    an ISO 8601 time with an offset.
    """
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
        if moment.tzinfo is None:
            return None
        # A fraction of a second is dropped here, before the time is compared
        # with anything, because it is dropped when the time is written. Left
        # on, it could put a game on the board that the validator, reading
        # the written time, finds has already started.
        return moment.astimezone(timezone.utc).replace(microsecond=0)
    except (ValueError, OverflowError):
        return None


def _show(value: object) -> str:
    """
    A value from the response, made safe to print: JSON-escaped, so it stays
    on one line and in ASCII, and cut to 80 characters.
    """
    text = json.dumps(value)
    return text if len(text) <= 80 else text[:77] + "..."
