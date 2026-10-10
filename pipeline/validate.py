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

from pipeline import grading, model, validate_forecasts
from pipeline.checks import (
    as_object,
    is_probability,
    is_score,
    line_problems,
    objects_in,
    schema_problems,
    team_problems,
    utc_time,
)

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
# What a result line of a sport that is forecast carries after those: for
# each model its forecast and the verdict on it.
MODEL_FIELDS = [field for name in model.NAMES for field in (name, f"{name}_verdict")]


def problems(
    slate: object, state: object, history_before: str, history_after: str, *, forecast: bool = False
) -> list[str]:
    """
    Everything wrong with one snapshot: the board, the state and the day's
    history file. `forecast` says whether the sport is one that the models
    forecast, whose board carries their forecasts.
    """
    return (
        slate_problems(slate, forecast=forecast)
        + state_problems(state)
        + history_problems(history_before, history_after)
    )


def slate_problems(slate: object, *, forecast: bool = False) -> list[str]:
    if not isinstance(slate, dict):
        return ["slate: not a JSON object"]
    found = schema_problems(slate, "slate")
    generated_at = utc_time(slate.get("generated_at"))
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
        found += team_problems(game, where)
        start = utc_time(game.get("commence_time"))
        if start is None:
            found.append(f"{where}: commence_time is not a UTC timestamp")
        elif generated_at is not None and start <= generated_at:
            found.append(
                f"{where}: starts at {game['commence_time']}, which is not after the snapshot time"
            )

        line = game.get("line")
        if line is not None:
            found += line_problems(line, f"{where} line", time_field="captured_at")
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
        if forecast:
            found += validate_forecasts.game_problems(game, where)
    if forecast:
        found += validate_forecasts.board_problems(slate.get("models"))
    if slate.get("record") is not None:
        found += _headline_problems(slate["record"], "slate record")
    found += _recent_problems(slate.get("recent_results"), "slate recent_results")
    return found


def state_problems(state: object) -> list[str]:
    if not isinstance(state, dict):
        return ["state: not a JSON object"]
    found = schema_problems(state, "state")
    # Both are null in a state that the daily work wrote before the first snapshot.
    if not _both_null(state, "last_slot", "last_run_at"):
        if not isinstance(state.get("last_slot"), str):
            found.append("state: last_slot is not a string")
        if utc_time(state.get("last_run_at")) is None:
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
        found += team_problems(game, where)
        if utc_time(game.get("commence_time")) is None:
            found.append(f"{where}: commence_time is not a UTC timestamp")
        found += _opening_problems(game.get("first"), f"{where} first")
        if game.get("latest") is not None:
            found += line_problems(game["latest"], f"{where} latest", time_field="at")
    return (
        found
        + _noted_problems(state.get("results"))
        + validate_forecasts.note_problems(state.get("models"))
    )


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
        found += line_problems(line, where, time_field="at")
    return found


def results_problems(
    before: dict[str, str], after: dict[str, str], *, forecast: bool = False
) -> list[str]:
    """
    Results only grow, and a game is recorded once. `before` maps the path
    of every results file on disk to its content, and `after` maps the path
    of each file that would be written to its new content. As with history,
    what is in a file must be the start of what would replace it. Unlike
    history, every line of every file is checked, the old ones too, because
    the record is rebuilt from all of them.

    `forecast` says whether the sport is one that the models forecast. A
    line that is added must then carry the fields of the models after the
    nine, and no other field. In a sport that is not forecast it must have
    the nine and nothing else.
    """
    found, recorded_in = [], {}
    added_fields = RESULT_FIELDS + MODEL_FIELDS if forecast else RESULT_FIELDS
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
                fields = added_fields if number > old.count("\n") else None
                found += _results_line_problems(
                    text, where, PurePosixPath(path).stem, recorded_in, fields
                )
    return found


def _results_line_problems(
    text: str, where: str, month: str, recorded_in: dict, fields: list[str] | None
) -> list[str]:
    """
    One line of a results file. `month` is the name of the file without its
    ending, and `recorded_in` says where each game seen so far was found.
    `fields` are the fields that a line this run adds must have, and None
    for a line that is already in the file.
    """
    try:
        line = json.loads(text)
    except ValueError:
        return [f"{where}: not JSON"]
    # A line that is in the file may be from before the models were added,
    # or from a later version that adds fields after the ones known here.
    if not isinstance(line, dict) or list(line)[: len(RESULT_FIELDS)] != RESULT_FIELDS:
        return [f"{where}: the fields must begin with {', '.join(RESULT_FIELDS)}, in that order"]
    if fields is not None and list(line) != fields:
        return [f"{where}: the fields must be {', '.join(fields)}, in that order"]
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
    found += team_problems(line, where)
    start, recorded_at = utc_time(line["commence_time"]), utc_time(line["recorded_at"])
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
    if not _is_final_score(line):
        found.append(
            f"{where}: home_pts and away_pts must be whole numbers that are not negative "
            f"and not equal, got {home_pts!r} and {away_pts!r}"
        )

    market = line["market"]
    if market is not None:
        found += line_problems(market, f"{where} market", time_field="at")
        captured = utc_time(market.get("at")) if isinstance(market, dict) else None
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
    if any(name in line for name in MODEL_FIELDS):
        if [name for name in line if name in MODEL_FIELDS] != MODEL_FIELDS:
            return found + [f"{where}: the fields of the models must be {', '.join(MODEL_FIELDS)}"]
        for name in model.NAMES:
            found += _graded_forecast_problems(line, name, where, start)
    return found


def _graded_forecast_problems(
    line: dict, name: str, where: str, start: datetime | None
) -> list[str]:
    """
    What a result line carries of one model: the forecast that was frozen on
    the morning of the game, or null, and the verdict on it. A forecast that
    was published at or after the start is not graded.
    """
    forecast, verdict = line[name], line[f"{name}_verdict"]
    found, published_at = [], None
    if forecast is not None:
        if not isinstance(forecast, dict):
            return [f"{where} {name}: not a JSON object"]
        if not is_probability(forecast.get("p_home")):
            found.append(
                f"{where} {name}: p_home must be a number between 0 and 1, "
                f"got {forecast.get('p_home')!r}"
            )
        if name == "points_rest" and type(forecast.get("margin")) is not float:
            found.append(f"{where} {name}: margin is not a number of points")
        published_at = utc_time(forecast.get("published_at"))
        if published_at is None:
            found.append(f"{where} {name}: published_at is not a UTC timestamp")
    if not isinstance(verdict, str) or verdict not in grading.VERDICTS:
        found.append(
            f"{where}: {name}_verdict is {verdict!r}, "
            f"which is not one of {', '.join(grading.VERDICTS)}"
        )
    elif not found and start is not None and _is_final_score(line):
        counted = forecast is not None and published_at < start
        graded = forecast["p_home"] if counted else None
        expected = grading.verdict(graded, line["home_pts"], line["away_pts"])
        if verdict != expected:
            found.append(
                f"{where}: {name}_verdict is {verdict!r}, but the forecast, "
                f"the time it was published at and the score make it {expected!r}"
            )
    return found


def _is_final_score(line: dict) -> bool:
    home_pts, away_pts = line["home_pts"], line["away_pts"]
    return is_score(home_pts) and is_score(away_pts) and home_pts != away_pts


def record_problems(record: object, lines: list[dict], *, models: tuple = ()) -> list[str]:
    """
    The record's totals must equal a recount of the result lines it was built
    from, for the sportsbooks' line and for each of the models that the
    sport is forecast by. The lines are taken to have passed result_problems.
    """
    if not isinstance(record, dict):
        return ["record: not a JSON object"]
    home_wins = sum(line["home_pts"] > line["away_pts"] for line in lines)
    baseline, days = as_object(record.get("baseline_home")), objects_in(record.get("by_day"))
    recount = [
        ("games", record.get("games"), len(lines)),
        ("baseline_home.games", baseline.get("games"), len(lines)),
        ("baseline_home.wins", baseline.get("wins"), home_wins),
        ("the sum of games over the days", _sum(days, "games"), len(lines)),
    ]
    found = schema_problems(record, "record")
    for source in ("market", *models):
        verdicts = Counter(_verdict_of(line, source) for line in lines)
        wins, losses = verdicts[grading.FAVORITE_WON], verdicts[grading.UPSET]
        toss_ups, not_graded = verdicts[grading.TOSS_UP], verdicts[grading.NOT_GRADED]
        card = as_object(record.get(source))
        bands = objects_in(card.get("bands"))
        tallies = [as_object(day.get(source)) for day in days]
        of = _of(source)
        recount += [
            (f"{source}.games", card.get("games"), wins + losses),
            (f"{source}.wins", card.get("wins"), wins),
            (f"{source}.losses", card.get("losses"), losses),
            (f"{source}.toss_ups", card.get("toss_ups"), toss_ups),
            (f"{source}.not_graded", card.get("not_graded"), not_graded),
            (f"{source}.with_line", card.get("with_line"), len(lines) - not_graded),
            (f"the sum of {of}games over the bands", _sum(bands, "games"), wins + losses),
            (f"the sum of {of}wins over the bands", _sum(bands, "wins"), wins),
            (f"the sum of {of}wins over the days", _sum(tallies, "wins"), wins),
            (f"the sum of {of}losses over the days", _sum(tallies, "losses"), losses),
            (f"the sum of {of}toss_ups over the days", _sum(tallies, "toss_ups"), toss_ups),
            (f"the sum of {of}not_graded over the days", _sum(tallies, "not_graded"), not_graded),
        ]
        accuracy = round(wins / (wins + losses), 4) if wins + losses else None
        if card.get("accuracy") != accuracy:
            found.append(
                f"record: {source}.accuracy is {card.get('accuracy')!r}, "
                f"and {wins} wins in {wins + losses} games give {accuracy}"
            )
        if source != "market":
            recount += _against_market_recount(card, lines, source)
    return found + [
        f"record: {name} is {got!r}, and a recount of the result lines gives {counted}"
        for name, got, counted in recount
        if type(got) is not int or got != counted
    ]


def _against_market_recount(card: dict, lines: list[dict], name: str) -> list[tuple]:
    """
    What the record says of a model next to the sportsbooks, with a recount
    from the verdicts. When both had a favorite and picked the same side,
    their verdicts are the same. So the two picked different winners in
    exactly the games in which one verdict says that a favorite won and the
    other that one lost, and the one whose favorite won was right.
    """
    picked = (grading.FAVORITE_WON, grading.UPSET)
    differing = [
        _verdict_of(line, name)
        for line in lines
        if _verdict_of(line, name) in picked
        and line["market_verdict"] in picked
        and _verdict_of(line, name) != line["market_verdict"]
    ]
    late = sum(line.get(name) is not None and _is_not_graded(line, name) for line in lines)
    both = sum(not _is_not_graded(line, name) and line["market"] is not None for line in lines)
    picks = as_object(card.get("picks_against_market"))
    brier = as_object(card.get("brier_against_market"))
    model_right = differing.count(grading.FAVORITE_WON)
    return [
        (f"{name}.late", card.get("late"), late),
        (f"{name}.picks_against_market.differ", picks.get("differ"), len(differing)),
        (f"{name}.picks_against_market.model_right", picks.get("model_right"), model_right),
        (
            f"{name}.picks_against_market.market_right",
            picks.get("market_right"),
            len(differing) - model_right,
        ),
        (f"{name}.brier_against_market.games", brier.get("games"), both),
    ]


def board_problems(headline: object, lines: list[dict], *, models: tuple = ()) -> list[str]:
    """
    The wins and the losses that the state notes for the board must equal a
    recount of the result lines as well, for each source. The lines are taken
    to have passed result_problems.
    """
    where = "state results record"
    found = _headline_problems(headline, where)
    for source in ("market", *models) if not found else ():
        counts = headline.get(source)
        if not _is_tally(counts):
            found.append(f"{where}: {source} must hold whole numbers for wins and losses")
            continue
        verdicts = Counter(_verdict_of(line, source) for line in lines)
        recount = {"wins": verdicts[grading.FAVORITE_WON], "losses": verdicts[grading.UPSET]}
        found += [
            f"{where}: {_of(source)}{name} is {counts[name]}, "
            f"and a recount of the result lines gives {counted}"
            for name, counted in recount.items()
            if counts[name] != counted
        ]
    return found


def _opening_problems(opening: object, where: str) -> list[str]:
    """An opening line is null or a probability with the time it was first seen."""
    if opening is None:
        return []
    if not isinstance(opening, dict):
        return [f"{where}: not a JSON object"]
    found = []
    if not is_probability(opening.get("p_home")):
        found.append(
            f"{where}: p_home must be a number between 0 and 1, got {opening.get('p_home')!r}"
        )
    if utc_time(opening.get("at")) is None:
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
    if utc_time(noted.get("last_run_at")) is None:
        found.append("state results: last_run_at is not a UTC timestamp")
    return (
        found
        + _headline_problems(noted.get("record"), "state results record")
        + _recent_problems(noted.get("recent"), "state results recent")
    )


def _headline_problems(headline: object, where: str) -> list[str]:
    """
    The record as the board carries it: the wins and the losses of the
    sportsbooks' favorite and, in a sport that is forecast, of each model's.
    """
    if not isinstance(headline, dict) or not _is_tally(headline.get("market")):
        return [f"{where}: market must hold whole numbers for wins and losses"]
    return [
        f"{where}: {name} must hold whole numbers for wins and losses"
        for name in model.NAMES
        if name in headline and not _is_tally(headline[name])
    ]


def _is_tally(counts: object) -> bool:
    return isinstance(counts, dict) and all(
        is_score(counts.get(count)) for count in ("wins", "losses")
    )


def _of(source: str) -> str:
    """Names a model in front of one of its counts. The sportsbooks' counts go without a name."""
    return "" if source == "market" else f"{source} "


def _verdict_of(line: dict, source: str) -> str:
    """The verdict of a source on a result. A line from before a model was added has none."""
    return line.get(f"{source}_verdict", grading.NOT_GRADED)


def _is_not_graded(line: dict, source: str) -> bool:
    return _verdict_of(line, source) == grading.NOT_GRADED


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


def _sum(rows: list[dict], name: str) -> int | None:
    """The sum of a count over rows. None when a row does not have it as a whole number."""
    counts = [row.get(name) for row in rows]
    return sum(counts) if all(type(count) is int for count in counts) else None
