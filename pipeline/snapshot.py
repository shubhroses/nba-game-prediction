"""
Turns one response into what is published: the board, the state and the
history lines.

build() reads nothing, writes nothing and does not look at the clock. The
same events, previous state and time always give the same result.
"""

import copy
from dataclasses import dataclass
from datetime import datetime, timedelta

from pipeline import consensus, feed
from pipeline.model import elo
from pipeline.model.season import Season
from pipeline.timestamps import format_utc, parse_utc

SCHEMA = 1

# A game stays in the state this long after its start, so that the grading
# step can still find the last line taken before the start.
RETENTION = timedelta(days=14)

# The board lists the results of the games that started less than this long
# ago: a full week of them, whatever the time of day the board is read at.
RECENT = timedelta(days=8)


@dataclass(frozen=True)
class Snapshot:
    slate: dict  # the board, as written to slate.json
    state: dict  # as written to state.json
    history: list[dict]  # one line per game that has a line, in board order
    dropped: list[str]  # one sentence per event that was left out, saying why


def build(
    events: list,
    previous: dict | None,
    now: datetime,
    *,
    sport: str,
    slot: str,
    next_due: str,
    credits: dict,
    season: Season | None = None,
) -> Snapshot:
    """
    events    the events of one response
    previous  the state the last run wrote, or None on the first run
    now       when the response was received
    season    for a sport that is forecast, the opening files of its season

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
    - What the last daily run noted in the state is carried over, and the
      board shows it: the record so far and the recent results. A result
      leaves that list eight days after the start of its game.
    - In a sport that is forecast, what the daily run noted of the models
      is carried over as well, and every game on the board is given Elo's
      chance. A game of the day whose forecasts are frozen is given those
      forecasts, of both models. Any other game is given what the Elo
      ratings of the last daily run make of it now, and nothing of the
      points-and-rest model, which says nothing before the morning of a game.
    """
    at = format_utc(now)
    games = copy.deepcopy(previous["games"]) if previous else {}
    board, dropped, listed = [], [], set()

    for event in events:
        try:
            game_id, start = feed.id_and_start(event)
            if start <= now:
                continue
            home, away = feed.team_codes(event, game_id)
        except feed.Unusable as reason:
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
            on_board = {**numbers, "books": _named(line, numbers), "captured_at": at}

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

    noted = previous.get("results") if previous else None
    results = noted and {**noted, "recent": recent(noted["recent"], now)}
    slate = {
        "schema": SCHEMA,
        "sport": sport,
        "generated_at": at,
        "slot": slot,
        "next_due": next_due,
        "games": board,
        "record": copy.deepcopy(results["record"]) if results else None,
        "recent_results": copy.deepcopy(results["recent"]) if results else [],
    }
    state = {
        "schema": SCHEMA,
        "last_slot": slot,
        "last_run_at": at,
        "credits": dict(credits),
        "games": games,
        "results": copy.deepcopy(results),
    }
    if season is not None:
        models = previous.get("models") if previous else None
        frozen = models and models["predictions"]
        for game in board:
            game.update(_forecasts(game, models, season))
        slate["models"] = models and {
            "results_through": models["results_through"],
            "status": models["status"],
            "predictions_day": frozen and frozen["day"],
        }
        state["models"] = copy.deepcopy(models)
    return Snapshot(slate=slate, state=state, history=history, dropped=dropped)


def recent(lines: list[dict], now: datetime) -> list[dict]:
    """The result lines of the games that started less than eight days before now, by start."""
    oldest_kept = now - RECENT
    kept = [line for line in lines if parse_utc(line["commence_time"]) > oldest_kept]
    return sorted(kept, key=lambda line: (line["commence_time"], line["id"]))


def _forecasts(game: dict, models: dict | None, season: Season) -> dict:
    """
    What a game on the board carries of the two models, from what the last
    daily run noted of them: nothing when no daily run has built them yet.
    """
    if models is None:
        return {"elo": None, "points_rest": None}
    fixture = season.game(parse_utc(game["commence_time"]), game["home"], game["away"])
    frozen = models["predictions"]
    if frozen and frozen["day"] == fixture.day.isoformat():
        for forecast in frozen["games"]:
            if (forecast["id"], forecast["home"], forecast["away"]) == (
                game["id"],
                fixture.home,
                fixture.away,
            ):
                return {
                    "elo": {"p_home": forecast["elo"]["p_home"]},
                    "points_rest": copy.deepcopy(forecast["points_rest"]),
                }
    ratings = models["elo"]
    chance = elo.win_probability(
        ratings[fixture.home], ratings[fixture.away], season.elo_home_court(fixture)
    )
    return {"elo": {"p_home": published(chance)}, "points_rest": None}


def published(probability: float) -> float:
    """
    A probability as it is written to the files: four decimals, and never
    exactly 0 or 1. A value that would round to 0 or 1 is written as 0.0001
    or 0.9999 instead, so that every published probability can be scored
    with a logarithm.
    """
    return min(0.9999, max(0.0001, round(probability, 4)))


def _named(line: consensus.Line, numbers: dict) -> list[str]:
    """
    The names of the sportsbooks behind a line, for the board. They are named
    only when the lowest and the highest figure are written as different
    numbers. When the two are the same, every sportsbook behind the line gave
    that figure, and the names next to it would say what each of them gave.
    The files never put a figure to the name of a sportsbook. A single
    sportsbook is the plainest case: it is counted but not named.
    """
    return list(line.books) if numbers["lo"] != numbers["hi"] else []
