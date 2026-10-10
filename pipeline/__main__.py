"""
The command line.

    python -m pipeline snapshot --all --data-dir DIR

Exit status:

    0  what was due was done, or nothing was due, or the slot was given up
    1  bad arguments or settings, for example ODDS_API_KEY is not set, or
       the files could not be written
    2  validation failed
    3  the provider refused a request (401, 429)
    4  the provider could not be reached, or its answer could not be read

Each sport is taken on its own, in two steps. The first is the daily work,
which is due once a day, in the day's first slot: the games that are over are
recorded with their final scores and graded, and for a sport that is forecast
the two models are rebuilt from the results and their forecasts for the games
of the day are frozen. The second is the snapshot. Each step is fetched,
built, validated and written before the next one is started.
For a step that fails nothing is written, and what was written for another
step or another sport stays. The exit status is that of the first failure.
"""

import argparse
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path, PurePosixPath

from pipeline import (
    config,
    forecasts,
    model,
    oddsapi,
    results,
    schedule,
    snapshot,
    store,
    validate,
    validate_forecasts,
)
from pipeline.model import season
from pipeline.timestamps import parse_utc

DONE, USAGE, INVALID, REFUSED, UNREACHABLE = 0, 1, 2, 3, 4
KEY_VARIABLE = "ODDS_API_KEY"
# The workflow puts the commit of the code it runs here, and the model files
# name it.
COMMIT_VARIABLE = "PIPELINE_COMMIT"

Clock = Callable[[], datetime]


class _Stop(Exception):
    """
    Ends one step of a sport, or the run as a whole, with an exit status and
    a message. Raised before anything of that step is written, or because
    writing it failed.
    """

    def __init__(self, status: int, *lines: str):
        super().__init__(*lines)
        self.status = status
        self.lines = lines


@dataclass(frozen=True)
class _Slot:
    """The slot a run falls in."""

    id: str
    next_due: str  # the id of the slot after it
    in_time: bool  # whether a run that starts now may still ask for this slot
    run_started: datetime
    daily: str  # the id of the slot the daily work belongs to: this one, or the last such before it
    day: date  # the New York date of that slot, which is the day whose games it forecasts

    @property
    def is_daily(self) -> bool:
        return self.id == self.daily


@dataclass(frozen=True)
class _Graded:
    """One sport's daily work, validated and ready to be written."""

    sport: config.Sport
    response: oddsapi.OddsResponse
    built: results.Results
    forecast: forecasts.Forecasts | None  # of the two models, in a sport that is forecast
    state: dict  # the state as the daily work leaves it
    files: dict[str, str]  # path in the data directory -> new content
    # What kept the models from being built, when the results were recorded
    # without them: a _Stop, or an error that nobody foresaw.
    trouble: Exception | None = None


@dataclass(frozen=True)
class _Capture:
    """One sport's snapshot, validated and ready to be written."""

    sport: config.Sport
    response: oddsapi.OddsResponse
    built: snapshot.Snapshot
    files: dict[str, str]  # path in the data directory -> new content


@dataclass
class _Run:
    """What a run has done so far. The step outputs and the exit status are made from it."""

    # The steps that were taken, in order, and written unless this is a dry run.
    done: list[_Graded | _Capture] = field(default_factory=list)
    failed: list[config.Sport] = field(default_factory=list)  # a step of theirs failed
    # Their results were recorded and their models were not built.
    without_models: list[config.Sport] = field(default_factory=list)
    given_up: list[config.Sport] = field(default_factory=list)  # too late to ask for their slot
    results_given_up: list[config.Sport] = field(default_factory=list)  # or for its daily work
    status: int = DONE  # the status of the first failure

    @property
    def graded(self) -> list[_Graded]:
        return [step for step in self.done if isinstance(step, _Graded)]

    @property
    def captures(self) -> list[_Capture]:
        return [step for step in self.done if isinstance(step, _Capture)]


def main(argv: list[str] | None = None, *, clock: Clock | None = None) -> int:
    """
    Runs the command and returns its exit status.

    The clock is a function that returns the current time. The tests pass
    their own; left out, it is the system clock in UTC.
    """
    parser = _parser()
    args = parser.parse_args(argv)
    if args.prefix and args.all:
        parser.error("--prefix goes with --sport, not with --all")
    clock = clock or _utc_now

    now = clock()
    current, following = schedule.current_and_next(now)
    daily = schedule.last_daily(now)
    slot = _Slot(
        id=schedule.slot_id(current),
        next_due=schedule.slot_id(following),
        in_time=schedule.in_time(current, now),
        run_started=now,
        daily=schedule.slot_id(daily),
        day=daily.astimezone(schedule.ZONE).date(),
    )
    run = _Run()
    try:
        _snapshot(args, slot, clock, run)
    finally:
        # Also when the run ends with an error that nobody foresaw. A sport
        # that was written before it has to be reported all the same, or the
        # workflow would not push it and the next run would ask for it again.
        _write_outputs(_outputs(run, slot, dry_run=args.dry_run))
    return run.status


def _snapshot(args: argparse.Namespace, slot: _Slot, clock: Clock, run: _Run) -> None:
    """
    Does what is due for every sport, one sport after the other, and notes in
    `run` what came of it. A step that fails does not stop the others.
    """
    try:
        _take_what_is_due(args, slot, clock, run)
    except _Stop as stop:
        # Bad arguments or settings. Nothing was started for any sport.
        _fail(run, None, stop)
    if run.status != DONE:
        graded = [] if args.dry_run else [step.sport for step in run.graded]
        captured = [] if args.dry_run else [step.sport for step in run.captures]
        nothing = [sport for sport in run.failed if sport not in graded + captured]
        if not graded + captured:
            _complain("Nothing was written.")
        elif nothing:
            _complain(f"Nothing was written for {_names(nothing)}.")
        # A sport that failed and has one of its two steps written failed in the other.
        no_results = [sport for sport in run.failed if sport in captured and sport not in graded]
        no_snapshot = [sport for sport in run.failed if sport in graded and sport not in captured]
        if no_results:
            _complain(f"The results for {_names(no_results)} were not recorded.")
        if run.without_models:
            _complain(f"The models for {_names(run.without_models)} were not built.")
        if no_snapshot:
            _complain(f"The snapshot for {_names(no_snapshot)} was not taken.")


def _take_what_is_due(args: argparse.Namespace, slot: _Slot, clock: Clock, run: _Run) -> None:
    """
    Sorts the selected sports into those whose slot is recorded, those it is
    too late for and those of which a step is due, and takes the steps that
    are due. Raises _Stop only for what concerns the run as a whole: the
    arguments and the key.
    """
    data_dir = args.data_dir
    sports = _selected(args, slot)
    openings = {sport: _opening_files(sport) for sport in sports}
    if not args.dry_run:
        # A dry run changes nothing in the data directory, not even this.
        for name in store.remove_leftovers(data_dir):
            _say(f"Removed {name}, which a run that was interrupted had left behind.")

    # First what is on disk, for every sport, before any request is made.
    previous, recorded, due = {}, [], []
    for sport in sports:
        try:
            previous[sport] = _state_on_disk(data_dir, sport)
        except _Stop as stop:
            _fail(run, sport, stop)
            continue
        slot_open = _is_due(slot, previous[sport])
        results_open = _results_are_due(slot, previous[sport])
        # A step that is not recorded may be asked for only by a run that
        # starts in time. This is what keeps a failure that lasts from being
        # paid for at every trigger: see ATTEMPT_WINDOW in schedule.py. The
        # daily work belongs to the day's first slot, so a run is in time for
        # it when it is in time for that slot. --force lifts the limit for
        # both steps and takes a snapshot that is on record again. It does
        # not repeat daily work that is on record: a game is recorded once,
        # so a second scores request the same day would find nothing to add.
        snapshot_due = args.force or (slot_open and slot.in_time)
        results_due = results_open and (args.force or (slot.is_daily and slot.in_time))
        if slot_open and not snapshot_due:
            run.given_up.append(sport)
        if results_open and slot.is_daily and not results_due:
            run.results_given_up.append(sport)
        if results_due or snapshot_due:
            due.append((sport, results_due, snapshot_due))
        elif not slot_open:
            recorded.append(sport)

    if not due:
        if recorded:
            already = f"Not due: slot {slot.id} is already recorded for {_names(recorded)}."
            _say(already, *([] if run.given_up else [_next(slot)]))
        if run.given_up:
            _say(
                f"Slot {slot.id} for {_names(run.given_up)} was not recorded in time; "
                f"the next slot starts at {slot.next_due}."
            )
        if run.results_given_up:
            _say(
                f"The results that were due in slot {slot.id} were not recorded in time for "
                f"{_names(run.results_given_up)}; the next daily run reaches back three days."
            )
        return

    api_key = _api_key()
    _say(f"Slot {slot.id}.", _next(slot))
    unforeseen = None
    for sport, results_due, snapshot_due in due:
        state, opening = previous[sport], openings[sport]
        if results_due:
            try:
                graded = _grade(
                    data_dir, sport, opening, state, api_key, slot, clock, dry_run=args.dry_run
                )
            except _Stop as stop:
                _fail(run, sport, stop)
            except Exception as error:
                # A bug in the daily work. A snapshot cannot be taken later,
                # so the ones that are due are taken first, for this sport
                # and the others, and the error is raised when that is done.
                unforeseen = unforeseen or error
                run.failed.append(sport)
            else:
                run.done.append(graded)
                state = graded.state
                if graded.trouble is not None:
                    run.without_models.append(sport)
                    if isinstance(graded.trouble, _Stop):
                        _complain(*graded.trouble.lines)
                        run.status = run.status or graded.trouble.status
                    else:
                        unforeseen = unforeseen or graded.trouble
        if snapshot_due:
            try:
                capture = _take(
                    data_dir, sport, opening, state, api_key, slot, clock, dry_run=args.dry_run
                )
            except _Stop as stop:
                _fail(run, sport, stop)
            else:
                run.done.append(capture)
    if args.dry_run and run.done:
        _say("Dry run: nothing was written.")
    if unforeseen:
        raise unforeseen


def _grade(
    data_dir: Path,
    sport: config.Sport,
    opening: season.Season | None,
    previous: dict | None,
    api_key: str,
    slot: _Slot,
    clock: Clock,
    *,
    dry_run: bool,
) -> _Graded:
    """
    One sport's daily work from its request to its files on disk: every game
    that is over and not yet recorded gets a result line with its final score
    and the verdict on its last line from before the start, and the record is
    rebuilt. For a sport that is forecast, the line also gets the verdict on
    what each model said that morning, the models are rebuilt from every
    result of the season, and their forecasts for the games of the day are
    frozen. Raises _Stop when something fails, and nothing of the daily work
    is written then.

    The models come second. When they cannot be built or do not pass their
    checks, the results are written without them, and what went wrong is
    handed back with them: a night's results can only be had for three days,
    and a fault in the models is no reason to lose them.
    """
    # As in _take, what will be added to is checked before the request.
    before = _results_on_disk(data_dir, sport)
    frozen = _predictions_on_disk(data_dir, sport) if opening else {}
    try:
        response = oddsapi.fetch_scores(sport.key, api_key)
    except oddsapi.Refused as error:
        raise _Stop(
            REFUSED, f"The provider refused the scores request for {sport.key}: {error}."
        ) from None
    except oddsapi.Unreachable as error:
        raise _Stop(
            UNREACHABLE,
            f"The provider gave no usable answer to the scores request for {sport.key}: {error}.",
        ) from None

    received = clock()
    recorded = [line for content in before.values() for line in store.from_ndjson(content)]
    # The forecasts that each day's file froze, by day, for the results to be held against.
    published = {
        PurePosixPath(path).stem: store.from_json(content) for path, content in frozen.items()
    }
    built = results.build(
        response.events,
        previous,
        recorded,
        received,
        sport=sport.key,
        slot=slot.daily,
        credits={"remaining": response.remaining, "used": response.used, "last": response.last},
        predictions=published if opening else None,
    )
    after = dict(before)
    for line in built.lines:
        path = store.results_path(sport.prefix, parse_utc(line["commence_time"]).date())
        after[path] = after.get(path, "") + store.to_ndjson([line])

    every_line = recorded + built.lines
    models = model.NAMES if opening else ()
    found = validate.results_problems(before, after, forecast=opening is not None)
    if not found:
        # The recounts take every line to be sound, so they come after the check of the lines.
        found = validate.record_problems(built.record, every_line, models=models)
        found += validate.board_problems(
            built.state["results"]["record"], every_line, models=models
        )
    found += validate.state_problems(built.state)
    if found:
        raise _Stop(
            INVALID, f"Validation failed for the results of {sport.key}:", *_indented(found)
        )

    forecast, state, trouble, published_now = None, built.state, None, {}
    if opening:
        try:
            forecast, published_now = _forecast(
                sport, opening, every_line, built.state, received, slot, frozen
            )
            state = forecast.state
        except Exception as error:
            trouble = error

    # The state is listed last, for the reason given in _capture: if the
    # moves were interrupted, the daily work would not be on record and the
    # next run would do it again. It would find the games that were written
    # already recorded and add none of them twice, find the forecasts of the
    # day published and leave them as they are, and rebuild the rest.
    files = {path: content for path, content in after.items() if content != before.get(path)}
    files |= published_now
    if forecast:
        files[store.model_path(sport.prefix)] = store.to_json(forecast.model)
    files[store.record_path(sport.prefix)] = store.to_json(built.record)
    files[store.state_path(sport.prefix)] = store.to_json(state)
    graded = _Graded(
        sport=sport,
        response=response,
        built=built,
        forecast=forecast,
        state=state,
        files=files,
        trouble=trouble,
    )
    _say(_results_summary(graded))
    for reason in built.dropped:
        _say(f"  dropped {reason}")
    for reason in built.refused:
        _say(f"  not graded {reason}")
    if forecast:
        _say(_models_summary(graded, slot))
        for reason in forecast.reasons:
            _say(f"  points-and-rest left out: {reason}")
    if not dry_run:
        _write(data_dir, sport, files, "results")
    return graded


def _forecast(
    sport: config.Sport,
    opening: season.Season,
    lines: list[dict],
    state: dict,
    received: datetime,
    slot: _Slot,
    frozen: dict[str, str],
) -> tuple[forecasts.Forecasts, dict[str, str]]:
    """
    The models' part of a sport's daily work, built and validated: what goes
    into the model file and the state, and the predictions file of the day
    with its path, when one is to be written. `lines` are all the result
    lines, `state` is the state with the daily work noted, and `frozen` are
    the predictions files on disk. Raises _Stop when validation refuses what
    was built.
    """
    today = store.predictions_path(sport.prefix, slot.day)
    forecast = forecasts.build(
        lines,
        state,
        received,
        sport=sport.key,
        season=opening,
        day=slot.day,
        frozen=store.from_json(frozen[today]) if today in frozen else None,
        commit=_commit(),
    )
    published_now = {}
    if forecast.predictions is not None:
        published_now[today] = store.to_json(forecast.predictions)
    found = validate_forecasts.model_problems(forecast.model, lines, opening)
    found += validate_forecasts.predictions_problems(frozen, frozen | published_now)
    found += validate.state_problems(forecast.state)
    if found:
        raise _Stop(INVALID, f"Validation failed for the models of {sport.key}:", *_indented(found))
    return forecast, published_now


def _take(
    data_dir: Path,
    sport: config.Sport,
    opening: season.Season | None,
    previous: dict | None,
    api_key: str,
    slot: _Slot,
    clock: Clock,
    *,
    dry_run: bool,
) -> _Capture:
    """
    One sport's snapshot from its request to its files on disk. Raises _Stop
    when something fails, and nothing of the snapshot is written then.
    """
    # Whatever can be checked without the provider is checked before the
    # request: the state file by the caller, the key, and here the history
    # file that will be added to. A request whose result is then refused has
    # spent its credit for nothing.
    _history_on_disk(data_dir, sport, slot.run_started)
    capture = _capture(data_dir, sport, opening, previous, api_key, slot, clock)
    _say(_summary(capture))
    for reason in capture.built.dropped:
        _say(f"  dropped {reason}")
    if not dry_run:
        _write(data_dir, sport, capture.files, "files")
    return capture


def _write(data_dir: Path, sport: config.Sport, files: dict[str, str], what: str) -> None:
    """Writes the files of one step and says so. Raises _Stop when they cannot be written."""
    try:
        store.write(data_dir, files)
    except OSError as error:
        # The status of a setting that cannot be used, which is the likeliest
        # cause: a data directory that cannot be written to.
        raise _Stop(
            USAGE, f"The {what} for {sport.key} could not be written: {_os_error(error)}."
        ) from None
    _say(f"Wrote {', '.join(files)}.")


def _fail(run: _Run, sport: config.Sport | None, stop: _Stop) -> None:
    """Reports that a step of a sport failed, or the run as a whole when there is no sport."""
    _complain(*stop.lines)
    if sport is not None and sport not in run.failed:
        run.failed.append(sport)
    if run.status == DONE:
        run.status = stop.status


def _capture(
    data_dir: Path,
    sport: config.Sport,
    opening: season.Season | None,
    previous: dict | None,
    api_key: str,
    slot: _Slot,
    clock: Clock,
) -> _Capture:
    """Fetches one sport, builds its files and validates them. Writes nothing."""
    try:
        response = oddsapi.fetch_odds(sport.key, api_key, slot.run_started)
    except oddsapi.Refused as error:
        raise _Stop(
            REFUSED, f"The provider refused the request for {sport.key}: {error}."
        ) from None
    except oddsapi.Unreachable as error:
        raise _Stop(
            UNREACHABLE, f"The provider gave no usable answer for {sport.key}: {error}."
        ) from None

    # Read the clock again now that the response is here. A game is recorded
    # only if it had not started when its prices arrived, however long the
    # request took.
    captured_at = clock()
    built = snapshot.build(
        response.events,
        previous,
        captured_at,
        sport=sport.key,
        slot=slot.id,
        next_due=slot.next_due,
        credits={"remaining": response.remaining, "used": response.used, "last": response.last},
        season=opening,
    )
    history_file, before = _history_on_disk(data_dir, sport, captured_at)
    after = before + store.to_ndjson(built.history)

    found = validate.problems(built.slate, built.state, before, after, forecast=opening is not None)
    if found:
        raise _Stop(INVALID, f"Validation failed for {sport.key}:", *_indented(found))

    # The state is listed last, and store.write moves the files into place in
    # this order. If the moves were interrupted, the old state would still be
    # there and the next run would take the snapshot again.
    files = {history_file: after} if built.history else {}
    files[store.slate_path(sport.prefix)] = store.to_json(built.slate)
    files[store.state_path(sport.prefix)] = store.to_json(built.state)
    return _Capture(sport=sport, response=response, built=built, files=files)


def _selected(args: argparse.Namespace, slot: _Slot) -> list[config.Sport]:
    if args.all:
        sports = list(config.sports_on(slot.run_started.astimezone(schedule.ZONE).date()))
        if not sports:
            raise _Stop(USAGE, "No sport in pipeline/config.py is captured today.")
        return sports
    if args.prefix:
        return [config.Sport(key=args.sport, prefix=args.prefix)]
    for sport in config.SPORTS:
        if sport.key == args.sport:
            return [sport]
    raise _Stop(
        USAGE, f"{args.sport} is not in pipeline/config.py. Say where to write it with --prefix."
    )


def _state_on_disk(data_dir: Path, sport: config.Sport) -> dict | None:
    """The state the last run wrote, checked. None when there is none yet."""
    path = store.state_path(sport.prefix)
    try:
        state = store.read_json(data_dir, path)
    except ValueError:
        raise _Stop(INVALID, f"{path} is not JSON.") from None
    if state is None:
        return None
    found = validate.state_problems(state)
    if found:
        raise _Stop(
            INVALID, f"{path} is not a state file this job can continue from:", *_indented(found)
        )
    return state


def _history_on_disk(data_dir: Path, sport: config.Sport, moment: datetime) -> tuple[str, str]:
    """The path and the present content of the history file for the UTC date of a moment."""
    path = store.history_path(sport.prefix, moment.astimezone(timezone.utc).date())
    try:
        content = store.read_text(data_dir, path)
    except ValueError:
        raise _Stop(INVALID, f"{path} is not UTF-8 text.") from None
    found = validate.history_problems(content, content)
    if found:
        raise _Stop(INVALID, f"{path} cannot be added to:", *_indented(found))
    return path, content


def _results_on_disk(data_dir: Path, sport: config.Sport) -> dict[str, str]:
    """The path and the content of every results file of a sport, checked line by line."""
    before = {}
    for path in store.results_paths(data_dir, sport.prefix):
        try:
            before[path] = store.read_text(data_dir, path)
        except ValueError:
            raise _Stop(INVALID, f"{path} is not UTF-8 text.") from None
    found = validate.results_problems(before, before)
    if found:
        raise _Stop(
            INVALID,
            f"The results in {sport.prefix}/results/ cannot be added to:",
            *_indented(found),
        )
    return before


def _predictions_on_disk(data_dir: Path, sport: config.Sport) -> dict[str, str]:
    """The path and the content of every predictions file of a sport, checked."""
    frozen = {}
    for path in store.predictions_paths(data_dir, sport.prefix):
        try:
            frozen[path] = store.read_text(data_dir, path)
        except ValueError:
            raise _Stop(INVALID, f"{path} is not UTF-8 text.") from None
    found = validate_forecasts.predictions_problems(frozen, frozen)
    if found:
        raise _Stop(
            INVALID,
            f"The forecasts in {sport.prefix}/predictions/ cannot be continued from:",
            *_indented(found),
        )
    return frozen


def _opening_files(sport: config.Sport) -> season.Season | None:
    """The opening files of the season a sport is forecast from. None for a sport that is not."""
    if sport.season is None:
        return None
    try:
        return season.load(sport.season)
    except (OSError, ValueError, KeyError) as error:
        raise _Stop(
            USAGE,
            f"The opening files of season {sport.season} in pipeline/model/ cannot be used "
            f"for {sport.key}: {type(error).__name__}: {error}.",
        ) from None


def _commit() -> str | None:
    """
    The commit of the code that runs, as the workflow passes it on. None
    when the environment does not say, as on a developer's machine, or says
    something that is not a commit.
    """
    commit = os.environ.get(COMMIT_VARIABLE, "").strip()
    return commit if re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", commit) else None


def _is_due(slot: _Slot, previous: dict | None) -> bool:
    return schedule.is_due(slot.id, previous["last_slot"] if previous else None)


def _results_are_due(slot: _Slot, previous: dict | None) -> bool:
    """Whether the daily work of the last daily slot is still to be recorded."""
    noted = previous.get("results") if previous else None
    return schedule.is_due(slot.daily, noted["last_slot"] if noted else None)


def _api_key() -> str:
    """The key from the environment. Also refuses a base URL that is not allowed."""
    api_key = os.environ.get(KEY_VARIABLE, "").strip()
    if not api_key:
        raise _Stop(USAGE, f"{KEY_VARIABLE} is not set.")
    try:
        oddsapi.base_url()
    except ValueError as error:
        raise _Stop(USAGE, f"{error}.") from None
    return api_key


def _summary(capture: _Capture) -> str:
    response = capture.response
    return (
        f"{capture.sport.key} -> {capture.sport.prefix}/: {_games(capture)}, "
        f"{len(capture.built.history)} with a line, {len(capture.built.dropped)} dropped. "
        f"Credits: {_known(response.remaining)} remaining, {_known(response.used)} used, "
        f"{_known(response.last)} spent on this call."
    )


def _results_summary(graded: _Graded) -> str:
    response, built = graded.response, graded.built
    return (
        f"{graded.sport.key} -> {graded.sport.prefix}/: {_results(graded)}, "
        f"{_not_graded(graded)} not graded, {len(built.dropped)} dropped. "
        f"Credits: {_known(response.remaining)} remaining, {_known(response.used)} used, "
        f"{_known(response.last)} spent on this call."
    )


def _models_summary(graded: _Graded, slot: _Slot) -> str:
    made, built = graded.forecast, graded.forecast.model
    which = "Elo and points-and-rest" if not made.reasons else "Elo alone"
    through = f" through {built['results_through']}" if built["games"] else ""
    if made.predictions is not None:
        frozen = f"{_forecasts(graded)} for {slot.day}"
    elif made.state["models"]["predictions"] is not None:
        frozen = f"the forecasts for {slot.day} are published already"
    else:
        frozen = f"no game to forecast for {slot.day}"
    return (
        f"{graded.sport.key} -> {graded.sport.prefix}/: {which} from "
        f"{built['games']} {'result' if built['games'] == 1 else 'results'}{through}, {frozen}."
    )


def _outputs(run: _Run, slot: _Slot, *, dry_run: bool) -> dict:
    """
    The step outputs. `changed` says whether anything was written, and
    `written` gives the counts for each prefix that was, for the message of
    the commit: "v1 9 results and 12 games, v1-dryrun 3 games". The other
    counts are totals over the sports of which that step was taken in this
    run, and the credits remaining and used are those of the last response.
    `failed`, `given_up` and `results_given_up` name sports, and are left out
    when there is none to name. `models` and `forecasts` are there when the
    daily work was done for a sport that is forecast: whether both models
    were built or Elo alone, and how many games got a forecast in this run.
    """
    graded, captures = run.graded, run.captures
    outputs = {"changed": "true" if run.done and not dry_run else "false", "slot": slot.id}
    if graded:
        outputs |= {
            "results": sum(len(step.built.lines) for step in graded),
            "results_not_graded": sum(_not_graded(step) for step in graded),
            "results_dropped": sum(len(step.built.dropped) for step in graded),
        }
    forecast = [step for step in graded if step.forecast]
    if forecast:
        left_out = any(step.forecast.reasons for step in forecast)
        outputs |= {
            "models": model.DEGRADED if left_out else model.OK,
            "forecasts": sum(_forecast_count(step) for step in forecast),
        }
    if captures:
        outputs |= {
            "games": sum(len(capture.built.slate["games"]) for capture in captures),
            "with_line": sum(len(capture.built.history) for capture in captures),
            "dropped": sum(len(capture.built.dropped) for capture in captures),
        }
    if run.done:
        costs = [step.response.last for step in run.done if step.response.last is not None]
        last = run.done[-1].response
        outputs |= {
            "credits_remaining": _known(last.remaining, otherwise=""),
            "credits_used": _known(last.used, otherwise=""),
            "credits_spent": sum(costs) if costs else "",
        }
        if not dry_run:
            outputs["written"] = _written(run)
    failed = run.failed + [sport for sport in run.without_models if sport not in run.failed]
    if failed:
        outputs["failed"] = _names(failed)
    if run.given_up:
        outputs["given_up"] = _names(run.given_up)
    if run.results_given_up:
        outputs["results_given_up"] = _names(run.results_given_up)
    return outputs


def _written(run: _Run) -> str:
    """What each prefix got, in the order it was written: "v1 9 results and 12 games"."""
    counts = {}
    for step in run.done:
        count = _results(step) if isinstance(step, _Graded) else _games(step)
        counts.setdefault(step.sport.prefix, []).append(count)
    return ", ".join(f"{prefix} {' and '.join(said)}" for prefix, said in counts.items())


def _write_outputs(outputs: dict) -> None:
    """
    Appends name=value lines to the file that GitHub Actions names in
    GITHUB_OUTPUT. Does nothing when the variable is not set.
    """
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as file:
            file.writelines(f"{name}={value}\n" for name, value in outputs.items())


def _say(*sentences: str) -> None:
    print(*sentences, flush=True)


def _complain(*lines: str) -> None:
    for line in lines:
        print(line, file=sys.stderr, flush=True)


def _names(sports: list[config.Sport]) -> str:
    return ", ".join(sport.key for sport in sports)


def _games(capture: _Capture) -> str:
    """The number of games on a sport's board, in words: "1 game", "12 games"."""
    count = len(capture.built.slate["games"])
    return f"{count} {'game' if count == 1 else 'games'}"


def _results(graded: _Graded) -> str:
    """The number of results a daily run recorded, in words: "1 result", "9 results"."""
    count = len(graded.built.lines)
    return f"{count} {'result' if count == 1 else 'results'}"


def _not_graded(graded: _Graded) -> int:
    return sum(line["market"] is None for line in graded.built.lines)


def _forecast_count(graded: _Graded) -> int:
    """How many games got a forecast in this run: none when the day's file was there already."""
    made = graded.forecast.predictions
    return len(made["games"]) if made else 0


def _forecasts(graded: _Graded) -> str:
    """The number of games a daily run forecast, in words: "1 game forecast", "9 games forecast"."""
    count = _forecast_count(graded)
    return f"{count} {'game' if count == 1 else 'games'} forecast"


def _next(slot: _Slot) -> str:
    return f"The next slot starts at {slot.next_due}."


def _indented(lines: list[str]) -> list[str]:
    return [f"  {line}" for line in lines]


def _os_error(error: OSError) -> str:
    """The class of the error with the operating system's own description, as in oddsapi._kind."""
    name = type(error).__name__
    return f"{name}: {error.strerror}" if error.strerror else name


def _known(value: int | None, otherwise: str = "unknown") -> int | str:
    return otherwise if value is None else value


def _utc_now() -> datetime:
    """The current time in UTC, to the second."""
    return datetime.now(timezone.utc).replace(microsecond=0)


class _Parser(argparse.ArgumentParser):
    """
    argparse ends with status 2 on a bad argument. Here 2 means that
    validation failed, so a bad argument ends with 1.
    """

    def error(self, message: str):
        self.print_usage(sys.stderr)
        self.exit(USAGE, f"{self.prog}: error: {message}\n")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(
        prog="python -m pipeline", description="Odds snapshots, results and forecasts of NBA games."
    )
    commands = parser.add_subparsers(dest="command", required=True, metavar="command")
    command = commands.add_parser(
        "snapshot",
        help="record the sportsbook consensus for the upcoming games",
        description=(
            "Record the sportsbook consensus for the upcoming games, if a snapshot is due, "
            "and before it the final scores of the games that are over and the forecasts of "
            "the two models for the games of the day, if the daily work is. "
            f"The key for The Odds API is read from the environment variable {KEY_VARIABLE}."
        ),
    )
    command.add_argument(
        "--data-dir",
        required=True,
        type=Path,
        metavar="DIR",
        help="a checkout of the data branch; created if it does not exist",
    )
    which = command.add_mutually_exclusive_group(required=True)
    which.add_argument(
        "--all",
        action="store_true",
        help="every sport in pipeline/config.py that is captured today",
    )
    which.add_argument(
        "--sport", type=_sport_key, metavar="KEY", help="one sport, by its key in The Odds API"
    )
    command.add_argument(
        "--prefix",
        type=_prefix,
        metavar="NAME",
        help="with --sport: the directory under DIR to write to (default: see pipeline/config.py)",
    )
    command.add_argument(
        "--force",
        action="store_true",
        help=(
            "take a snapshot even if the current slot is already recorded, "
            "or is too old to be asked for; the daily work is done as well "
            "if that of the last daily slot is not on record"
        ),
    )
    command.add_argument(
        "--dry-run", action="store_true", help="fetch and validate, but write nothing"
    )
    return parser


def _sport_key(text: str) -> str:
    if not re.fullmatch(r"[a-z0-9_]+", text):
        raise argparse.ArgumentTypeError(
            "a sport key has lower-case letters, digits and underscores only"
        )
    return text


def _prefix(text: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", text):
        raise argparse.ArgumentTypeError(
            "a prefix is one directory name: letters, digits, dots, hyphens, underscores"
        )
    return text


if __name__ == "__main__":
    sys.exit(main())
