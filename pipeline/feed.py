"""
What the job reads from every event of the provider's, in an odds response
and in a scores response alike: its id, its start and its two teams.
"""

import json
import re
from datetime import datetime, timezone

from pipeline import teams

# The provider's event ids are 32 hexadecimal characters. An id is used as a
# key in the published files, so anything that is not a short plain token is
# turned away.
_EVENT_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")


class Unusable(Exception):
    """An event that cannot be recorded. The message says why."""


def id_and_start(event: object) -> tuple[str, datetime]:
    """An event's id and its start in UTC. Raises Unusable when either is missing."""
    if not isinstance(event, dict):
        raise Unusable(f"an entry that is not an event: {show(event)}")
    game_id = event.get("id")
    if not isinstance(game_id, str) or not _EVENT_ID.fullmatch(game_id):
        raise Unusable(f"an event without a usable id: {show(game_id)}")
    start = _start(event.get("commence_time"))
    if start is None:
        raise Unusable(
            f"event {game_id}: no usable commence_time: {show(event.get('commence_time'))}"
        )
    return game_id, start


def team_codes(event: dict, game_id: str) -> tuple[str, str]:
    """The home and the away team's codes. Raises Unusable for a team that is not one of the 30."""
    codes = []
    for side in ("home_team", "away_team"):
        code = teams.code(event.get(side))
        if code is None:
            raise Unusable(f"event {game_id}: unknown team {show(event.get(side))}")
        codes.append(code)
    home, away = codes
    if home == away:
        raise Unusable(f"event {game_id}: {home} is on both sides")
    return home, away


def show(value: object) -> str:
    """
    A value from a response, made safe to print: JSON-escaped, so it stays on
    one line and in ASCII, and cut to 80 characters. A value that is nested
    too deep to be written out is described instead.
    """
    try:
        text = json.dumps(value)
    except RecursionError:
        # On Python 3.14 json.loads accepts a body that is nested a little
        # deeper than json.dumps can write out again.
        return f"a {type(value).__name__} nested too deep to show"
    return text if len(text) <= 80 else text[:77] + "..."


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
