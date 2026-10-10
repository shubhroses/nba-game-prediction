"""
Turns one scores response into what the daily run publishes: a result line
for each game that is over and not yet recorded, graded against the line the
sportsbooks gave before the start, the record rebuilt from every line so far,
and the state with the run noted in it.

build() reads nothing, writes nothing and does not look at the clock. The
same events, previous state, recorded lines and time always give the same
result.
"""

import copy
import re
from dataclasses import dataclass
from datetime import datetime

from pipeline import feed, grading, record, snapshot
from pipeline.timestamps import format_utc, parse_utc

# What a result keeps of the line its game is graded against.
_LINE_FIELDS = ("p_home", "lo", "hi", "n", "at")


@dataclass(frozen=True)
class Results:
    lines: list[dict]  # one result line per game that this run records, in order of start
    record: dict  # as written to record.json
    state: dict  # as written to state.json
    dropped: list[str]  # one sentence per completed event that was left out, saying why
    refused: list[str]  # one sentence per stored line that was not graded against, saying why


class _Refused(Exception):
    """A stored line that its game cannot be graded against. The message says why."""


def build(
    events: list,
    previous: dict | None,
    recorded: list[dict],
    now: datetime,
    *,
    sport: str,
    slot: str,
    credits: dict,
) -> Results:
    """
    events    the events of one scores response
    previous  the state the last run wrote, or None when there is none
    recorded  every result line that is already on disk
    now       when the response was received
    slot      the id of the daily slot that this work is done for

    The rules:

    - Only an event that is marked as completed and has two scores is
      recorded, and only once: a game that is in `recorded` is passed over.
    - A completed event with a team that is not one of the 30, without a
      usable id, start or pair of scores, with two equal scores, or with a
      start that is still to come is left out and reported in
      Results.dropped. The next daily run looks at it again.
    - A game is graded against the latest line the state holds for it. The
      snapshot replaces that line only before the game starts, so it is the
      last one from before the start.
    - A line that was captured at or after the start the scores give, or
      that is for other teams, is refused. Its game is recorded as not
      graded, and the reason is in Results.refused.
    - A game that the state has no line for is recorded as not graded.
    """
    at = format_utc(now)
    games = previous["games"] if previous else {}
    already = {line["id"] for line in recorded}
    lines, dropped, refused, listed = [], [], [], set()

    for event in events:
        try:
            game_id, start = feed.id_and_start(event)
            if event.get("completed") is not True or game_id in already:
                continue
            if start >= now:
                raise feed.Unusable(
                    f"event {game_id}: completed, but its start at {format_utc(start)} "
                    "is still to come"
                )
            home, away = feed.team_codes(event, game_id)
            home_pts, away_pts = _points(event, game_id)
        except feed.Unusable as reason:
            dropped.append(str(reason))
            continue
        if game_id in listed:
            dropped.append(f"event {game_id}: listed twice, the second entry is ignored")
            continue
        listed.add(game_id)

        try:
            line = _line_before_the_start(games.get(game_id), home, away, start)
        except _Refused as reason:
            line = None
            refused.append(f"event {game_id}: {reason}")
        lines.append(
            {
                "id": game_id,
                "commence_time": format_utc(start),
                "home": home,
                "away": away,
                "home_pts": home_pts,
                "away_pts": away_pts,
                "recorded_at": at,
                "market": line,
                "market_verdict": grading.verdict(line and line["p_home"], home_pts, away_pts),
            }
        )

    lines.sort(key=lambda line: (line["commence_time"], line["id"]))
    everything = recorded + lines
    rebuilt = record.build(everything, sport=sport)
    state = copy.deepcopy(previous) if previous else _blank_state()
    state["credits"] = dict(credits)
    state["results"] = {
        "last_slot": slot,
        "last_run_at": at,
        "record": record.headline(rebuilt),
        "recent": copy.deepcopy(snapshot.recent(everything, now)),
    }
    return Results(lines=lines, record=rebuilt, state=state, dropped=dropped, refused=refused)


def _line_before_the_start(game: dict | None, home: str, away: str, start: datetime) -> dict | None:
    """
    The line a game is graded against: the latest one the state holds for
    it. None when the state does not know the game or has no line for it.
    Raises _Refused for a line that is there and must not be used.
    """
    line = game and game.get("latest")
    if not line:
        return None
    if (game["home"], game["away"]) != (home, away):
        raise _Refused(
            f"its line is for {game['away']} at {game['home']}, "
            f"and the game was played by {away} at {home}"
        )
    # The snapshot took the line before the start it knew of. The scores can
    # give another start, and a line from that moment on may be a price that
    # was quoted while the game was played.
    if parse_utc(line["at"]) >= start:
        raise _Refused(
            f"its line was captured at {line['at']}, "
            f"which is not before the start at {format_utc(start)}"
        )
    return {field: line[field] for field in _LINE_FIELDS}


def _points(event: dict, game_id: str) -> tuple[int, int]:
    """
    The final scores of the home and the away team. Raises feed.Unusable
    when the event does not give one for each of them, or gives the same for
    both, which no finished game has.
    """
    scores = event.get("scores")
    by_team = {}
    if isinstance(scores, list) and len(scores) == 2:
        for entry in scores:
            if isinstance(entry, dict) and isinstance(entry.get("name"), str):
                by_team[entry["name"]] = _whole(entry.get("score"))
    home_pts, away_pts = by_team.get(event["home_team"]), by_team.get(event["away_team"])
    if home_pts is None or away_pts is None:
        raise feed.Unusable(
            f"event {game_id}: completed without two usable scores: {feed.show(scores)}"
        )
    if home_pts == away_pts:
        raise feed.Unusable(f"event {game_id}: completed with two equal scores of {home_pts}")
    return home_pts, away_pts


def _whole(score: object) -> int | None:
    """
    A score as a whole number. The provider writes it as text, as in "113".
    A number is taken as well.
    """
    if isinstance(score, str) and re.fullmatch(r"[0-9]{1,4}", score):
        return int(score)
    if type(score) is int and score >= 0:
        return score
    return None


def _blank_state() -> dict:
    """The state of a sport of which no snapshot has been recorded yet."""
    return {"schema": snapshot.SCHEMA, "last_slot": None, "last_run_at": None, "games": {}}
