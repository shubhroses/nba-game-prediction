"""
Checks on the files, run before anything is written.

Every function returns a list of problems in plain words. An empty list means
the file may be written. Nothing here raises on malformed input, because the
state and the results that are read back from disk are checked with the same
code before a request is spent on them.
"""

import json
from collections import Counter
from datetime import datetime
from pathlib import PurePosixPath

from pipeline import grading, teams
from pipeline.snapshot import SCHEMA
from pipeline.timestamps import parse_utc

HISTORY_FIELDS = ["id", "at", "p_home", "lo", "hi", "n"]
RESULT_FIELDS = [
    "id",
    "commence_time",
    "home",
    "away",
    "home_pts",
    "away_pts",
    "recorded_at",
    "market",
    "market_verdict",
]


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
                # Sportsbooks that all gave the same figure are not named,
                # because the line would then be a figure with each of their
                # names on it. A single sportsbook is the plainest case.
                alike = line.get("n") == 1 or line.get("lo") == line.get("hi")
                expected = 0 if alike else line.get("n")
                if not named or len(books) != expected:
                    found.append(
                        f"{where} line: books must name each of the n sportsbooks, "
                        "and none when n is 1 or lo equals hi"
                    )
        found += _opening_problems(game.get("open"), f"{where} open")
    if slate.get("record") is not None:
        found += _headline_problems(slate["record"], "slate record")
    found += _recent_problems(slate.get("recent_results"), "slate recent_results")
    return found


def state_problems(state: object) -> list[str]:
    if not isinstance(state, dict):
        return ["state: not a JSON object"]
    found = _schema_problems(state, "state")
    # Both are null in a state that the daily work wrote before the first snapshot.
    if not _both_null(state, "last_slot", "last_run_at"):
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
    return found + _noted_problems(state.get("results"))


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


def results_problems(before: dict[str, str], after: dict[str, str]) -> list[str]:
    """
    Results only grow, and a game is recorded once. `before` maps the path
    of every results file on disk to its content, and `after` maps the path
    of each file that would be written to its new content. As with history,
    what is in a file must be the start of what would replace it. Unlike
    history, every line of every file is checked, the old ones too, because
    the record is rebuilt from all of them.
    """
    found, recorded_in = [], {}
    for path in sorted({*before, *after}):
        old = before.get(path, "")
        new = after.get(path, old)
        if not new.startswith(old):
            found.append(f"{path}: lines that are already in the file would be changed or removed")
        elif old and not old.endswith("\n"):
            found.append(f"{path}: the existing file does not end with a newline")
        elif new and not new.endswith("\n"):
            found.append(f"{path}: the added lines do not end with a newline")
        else:
            for number, text in enumerate(new.splitlines(), start=1):
                where = f"{path} line {number}"
                found += _results_line_problems(text, where, PurePosixPath(path).stem, recorded_in)
    return found


def _results_line_problems(text: str, where: str, month: str, recorded_in: dict) -> list[str]:
    """
    One line of a results file. `month` is the name of the file without its
    ending, and `recorded_in` says where each game seen so far was found.
    """
    try:
        line = json.loads(text)
    except ValueError:
        return [f"{where}: not JSON"]
    # A later version may add fields to new lines, after these.
    if not isinstance(line, dict) or list(line)[: len(RESULT_FIELDS)] != RESULT_FIELDS:
        return [f"{where}: the fields must begin with {', '.join(RESULT_FIELDS)}, in that order"]
    found = result_problems(line, where)
    if not found:
        if line["commence_time"][:7] != month:
            found.append(f"{where}: the game started in {line['commence_time'][:7]}, not {month}")
        if line["id"] in recorded_in:
            found.append(f"{where}: the game is already recorded in {recorded_in[line['id']]}")
        recorded_in.setdefault(line["id"], where)
    return found


def result_problems(line: object, where: str) -> list[str]:
    """One result: a game, its final score, the line it was graded against and the verdict."""
    if not isinstance(line, dict):
        return [f"{where}: not a JSON object"]
    missing = [name for name in RESULT_FIELDS if name not in line]
    if missing:
        return [f"{where}: missing {', '.join(missing)}"]
    found = []
    if not isinstance(line["id"], str) or not line["id"]:
        found.append(f"{where}: id is not a string")
    found += _team_problems(line, where)
    start, recorded_at = _time(line["commence_time"]), _time(line["recorded_at"])
    if start is None:
        found.append(f"{where}: commence_time is not a UTC timestamp")
    if recorded_at is None:
        found.append(f"{where}: recorded_at is not a UTC timestamp")
    elif start is not None and recorded_at <= start:
        found.append(
            f"{where}: recorded at {line['recorded_at']}, "
            f"which is not after the start at {line['commence_time']}"
        )
    home_pts, away_pts = line["home_pts"], line["away_pts"]
    if not (_is_score(home_pts) and _is_score(away_pts) and home_pts != away_pts):
        found.append(
            f"{where}: home_pts and away_pts must be whole numbers that are not negative "
            f"and not equal, got {home_pts!r} and {away_pts!r}"
        )

    market = line["market"]
    if market is not None:
        found += _line_problems(market, f"{where} market", time_field="at")
        captured = _time(market.get("at")) if isinstance(market, dict) else None
        if captured is not None and start is not None and captured >= start:
            found.append(
                f"{where}: the line was captured at {market['at']}, "
                f"which is not before the start at {line['commence_time']}"
            )
    verdict = line["market_verdict"]
    if not isinstance(verdict, str) or verdict not in grading.VERDICTS:
        found.append(
            f"{where}: market_verdict is {verdict!r}, "
            f"which is not one of {', '.join(grading.VERDICTS)}"
        )
    elif not found:
        expected = grading.verdict(market and market["p_home"], home_pts, away_pts)
        if verdict != expected:
            found.append(
                f"{where}: market_verdict is {verdict!r}, "
                f"but the line and the score make it {expected!r}"
            )
    return found


def record_problems(record: object, lines: list[dict]) -> list[str]:
    """
    The record's totals must equal a recount of the result lines it was built
    from. The lines are taken to have passed result_problems.
    """
    if not isinstance(record, dict):
        return ["record: not a JSON object"]
    verdicts = Counter(line["market_verdict"] for line in lines)
    wins, losses = verdicts[grading.FAVORITE_WON], verdicts[grading.UPSET]
    toss_ups, not_graded = verdicts[grading.TOSS_UP], verdicts[grading.NOT_GRADED]
    home_wins = sum(line["home_pts"] > line["away_pts"] for line in lines)

    market, baseline = _object(record.get("market")), _object(record.get("baseline_home"))
    bands, days = _objects(market.get("bands")), _objects(record.get("by_day"))
    tallies = [_object(day.get("market")) for day in days]
    recount = [
        ("games", record.get("games"), len(lines)),
        ("market.games", market.get("games"), wins + losses),
        ("market.wins", market.get("wins"), wins),
        ("market.losses", market.get("losses"), losses),
        ("market.toss_ups", market.get("toss_ups"), toss_ups),
        ("market.not_graded", market.get("not_graded"), not_graded),
        ("market.with_line", market.get("with_line"), len(lines) - not_graded),
        ("baseline_home.games", baseline.get("games"), len(lines)),
        ("baseline_home.wins", baseline.get("wins"), home_wins),
        ("the sum of games over the bands", _sum(bands, "games"), wins + losses),
        ("the sum of wins over the bands", _sum(bands, "wins"), wins),
        ("the sum of games over the days", _sum(days, "games"), len(lines)),
        ("the sum of wins over the days", _sum(tallies, "wins"), wins),
        ("the sum of losses over the days", _sum(tallies, "losses"), losses),
        ("the sum of toss_ups over the days", _sum(tallies, "toss_ups"), toss_ups),
        ("the sum of not_graded over the days", _sum(tallies, "not_graded"), not_graded),
    ]
    found = _schema_problems(record, "record") + [
        f"record: {name} is {got!r}, and a recount of the result lines gives {counted}"
        for name, got, counted in recount
        if type(got) is not int or got != counted
    ]
    accuracy = round(wins / (wins + losses), 4) if wins + losses else None
    if market.get("accuracy") != accuracy:
        found.append(
            f"record: market.accuracy is {market.get('accuracy')!r}, "
            f"and {wins} wins in {wins + losses} games give {accuracy}"
        )
    return found


def board_problems(headline: object, lines: list[dict]) -> list[str]:
    """
    The wins and the losses that the state notes for the board must equal a
    recount of the result lines as well. The lines are taken to have passed
    result_problems.
    """
    where = "state results record"
    found = _headline_problems(headline, where)
    if not found:
        verdicts = Counter(line["market_verdict"] for line in lines)
        recount = {"wins": verdicts[grading.FAVORITE_WON], "losses": verdicts[grading.UPSET]}
        found = [
            f"{where}: {name} is {headline['market'][name]}, "
            f"and a recount of the result lines gives {counted}"
            for name, counted in recount.items()
            if headline["market"][name] != counted
        ]
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


def _noted_problems(noted: object) -> list[str]:
    """
    What the daily work notes in the state: the slot it was done for, when,
    and what the board shows of it. Null until it has been done once, and not
    there at all in a state from before there was any daily work.
    """
    if noted is None:
        return []
    if not isinstance(noted, dict):
        return ["state results: not a JSON object"]
    found = []
    if not isinstance(noted.get("last_slot"), str):
        found.append("state results: last_slot is not a string")
    if _time(noted.get("last_run_at")) is None:
        found.append("state results: last_run_at is not a UTC timestamp")
    return (
        found
        + _headline_problems(noted.get("record"), "state results record")
        + _recent_problems(noted.get("recent"), "state results recent")
    )


def _headline_problems(headline: object, where: str) -> list[str]:
    """The record as the board carries it: the wins and the losses of the sportsbooks' favorite."""
    market = headline.get("market") if isinstance(headline, dict) else None
    if not isinstance(market, dict) or not all(
        _is_score(market.get(count)) for count in ("wins", "losses")
    ):
        return [f"{where}: market must hold whole numbers for wins and losses"]
    return []


def _recent_problems(lines: object, where: str) -> list[str]:
    """The recent results, each of which is a result line."""
    if not isinstance(lines, list):
        return [f"{where}: not a list"]
    found = []
    for line in lines:
        game_id = line.get("id") if isinstance(line, dict) else None
        found += result_problems(line, f"{where} {game_id!r}")
    return found


def _both_null(document: dict, first: str, second: str) -> bool:
    """Whether two fields are both there and both null."""
    return first in document and second in document and document[first] is document[second] is None


def _is_probability(value: object) -> bool:
    """Strictly between 0 and 1. A whole number cannot be, and neither can NaN."""
    return type(value) is float and 0 < value < 1


def _is_score(value: object) -> bool:
    """A whole number that is not negative. True and False are not scores."""
    return type(value) is int and value >= 0


def _object(value: object) -> dict:
    """The value when it is a JSON object, and an empty one otherwise."""
    return value if isinstance(value, dict) else {}


def _objects(value: object) -> list[dict]:
    """The JSON objects in a list, or nothing when the value is not a list."""
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _sum(rows: list[dict], name: str) -> int | None:
    """The sum of a count over rows. None when a row does not have it as a whole number."""
    counts = [row.get(name) for row in rows]
    return sum(counts) if all(type(count) is int for count in counts) else None


def _time(value: object) -> datetime | None:
    try:
        return parse_utc(value)
    except ValueError:
        return None
