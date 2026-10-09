"""
The command line.

    python -m pipeline snapshot --all --data-dir DIR

Exit status:

    0  a snapshot was taken, or none was due, or the slot was given up
    1  bad arguments or settings, for example ODDS_API_KEY is not set
    2  validation failed
    3  the provider refused the request (401, 429)
    4  the provider could not be reached, or its answer could not be read

Each sport is taken on its own: fetched, built, validated and written before
the next one is started. For a sport that fails nothing is written, and what
was written for another sport stays. The exit status is that of the first
failure.
"""

import argparse
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from pipeline import config, oddsapi, schedule, snapshot, store, validate

DONE, USAGE, INVALID, REFUSED, UNREACHABLE = 0, 1, 2, 3, 4
KEY_VARIABLE = "ODDS_API_KEY"

Clock = Callable[[], datetime]


class _Stop(Exception):
    """
    Ends one sport's part in the run, or the run as a whole, with an exit
    status and a message. Raised only before anything of that sport is
    written.
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

    captures: list[_Capture] = field(default_factory=list)  # taken, and written unless a dry run
    failed: list[config.Sport] = field(default_factory=list)
    given_up: list[config.Sport] = field(default_factory=list)  # too late to ask for their slot
    status: int = DONE  # the status of the first failure


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
    slot = _Slot(
        id=schedule.slot_id(current),
        next_due=schedule.slot_id(following),
        in_time=schedule.in_time(current, now),
        run_started=now,
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
    Takes the snapshot of every sport that is due, one sport after the other,
    and notes in `run` what came of it. A sport that fails does not stop the
    others.
    """
    try:
        _take_what_is_due(args, slot, clock, run)
    except _Stop as stop:
        # Bad arguments or settings. Nothing was started for any sport.
        _fail(run, None, stop)
    if run.status != DONE:
        if run.captures and not args.dry_run:
            _complain(f"Nothing was written for {_names(run.failed)}.")
        else:
            _complain("Nothing was written.")


def _take_what_is_due(args: argparse.Namespace, slot: _Slot, clock: Clock, run: _Run) -> None:
    data_dir = args.data_dir
    sports = _selected(args, slot)

    # First what is on disk, for every sport, before any request is made.
    previous, recorded, due = {}, [], []
    for sport in sports:
        try:
            previous[sport] = _state_on_disk(data_dir, sport)
        except _Stop as stop:
            _fail(run, sport, stop)
            continue
        if args.force:
            due.append(sport)
        elif not _is_due(slot, previous[sport]):
            recorded.append(sport)
        elif slot.in_time:
            due.append(sport)
        else:
            # The slot is not recorded and it is too late to ask for it. This
            # is what keeps a failure that lasts from being paid for at every
            # trigger: see ATTEMPT_WINDOW in schedule.py.
            run.given_up.append(sport)

    if not due:
        if recorded:
            already = f"Not due: slot {slot.id} is already recorded for {_names(recorded)}."
            _say(already, *([] if run.given_up else [_next(slot)]))
        if run.given_up:
            _say(
                f"Slot {slot.id} for {_names(run.given_up)} was not recorded in time; "
                f"the next slot starts at {slot.next_due}."
            )
        return

    api_key = _api_key()
    _say(f"Slot {slot.id}.", _next(slot))
    for sport in due:
        try:
            capture = _take(
                data_dir, sport, previous[sport], api_key, slot, clock, dry_run=args.dry_run
            )
        except _Stop as stop:
            _fail(run, sport, stop)
        else:
            run.captures.append(capture)
    if args.dry_run and run.captures:
        _say("Dry run: nothing was written.")


def _take(
    data_dir: Path,
    sport: config.Sport,
    previous: dict | None,
    api_key: str,
    slot: _Slot,
    clock: Clock,
    *,
    dry_run: bool,
) -> _Capture:
    """
    One sport from its request to its files on disk. Raises _Stop when a step
    fails, and nothing of this sport is written then.
    """
    # Whatever can be checked without the provider is checked before the
    # request: the state file by the caller, the key, and here the history
    # file that will be added to. A request whose result is then refused has
    # spent its credit for nothing.
    _history_on_disk(data_dir, sport, slot.run_started)
    capture = _capture(data_dir, sport, previous, api_key, slot, clock)
    _say(_summary(capture))
    for reason in capture.built.dropped:
        _say(f"  dropped {reason}")
    if not dry_run:
        store.write(data_dir, capture.files)
        _say(f"Wrote {', '.join(capture.files)}.")
    return capture


def _fail(run: _Run, sport: config.Sport | None, stop: _Stop) -> None:
    """Reports that a sport failed, or the run as a whole when there is no sport to name."""
    _complain(*stop.lines)
    if sport is not None:
        run.failed.append(sport)
    if run.status == DONE:
        run.status = stop.status


def _capture(
    data_dir: Path,
    sport: config.Sport,
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
    )
    history_file, before = _history_on_disk(data_dir, sport, captured_at)
    after = before + store.to_ndjson(built.history)

    found = validate.problems(built.slate, built.state, before, after)
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


def _is_due(slot: _Slot, previous: dict | None) -> bool:
    return schedule.is_due(slot.id, previous["last_slot"] if previous else None)


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
    games, response = len(capture.built.slate["games"]), capture.response
    return (
        f"{capture.sport.key} -> {capture.sport.prefix}/: "
        f"{games} {'game' if games == 1 else 'games'}, "
        f"{len(capture.built.history)} with a line, {len(capture.built.dropped)} dropped. "
        f"Credits: {_known(response.remaining)} remaining, {_known(response.used)} used, "
        f"{_known(response.last)} spent on this call."
    )


def _outputs(run: _Run, slot: _Slot, *, dry_run: bool) -> dict:
    """
    The step outputs. `changed` says whether anything was written. The counts
    are totals over the sports taken in this run, and the credits remaining
    and used are those of the last response. `failed` and `given_up` name
    sports, and are left out when there is none to name.
    """
    captures = run.captures
    outputs = {"changed": "true" if captures and not dry_run else "false", "slot": slot.id}
    if captures:
        costs = [capture.response.last for capture in captures if capture.response.last is not None]
        last = captures[-1].response
        outputs |= {
            "games": sum(len(capture.built.slate["games"]) for capture in captures),
            "with_line": sum(len(capture.built.history) for capture in captures),
            "dropped": sum(len(capture.built.dropped) for capture in captures),
            "credits_remaining": _known(last.remaining, otherwise=""),
            "credits_used": _known(last.used, otherwise=""),
            "credits_spent": sum(costs) if costs else "",
        }
    if run.failed:
        outputs["failed"] = _names(run.failed)
    if run.given_up:
        outputs["given_up"] = _names(run.given_up)
    return outputs


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


def _next(slot: _Slot) -> str:
    return f"The next slot starts at {slot.next_due}."


def _indented(lines: list[str]) -> list[str]:
    return [f"  {line}" for line in lines]


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
    parser = _Parser(prog="python -m pipeline", description="Odds snapshots for NBA games.")
    commands = parser.add_subparsers(dest="command", required=True, metavar="command")
    command = commands.add_parser(
        "snapshot",
        help="record the sportsbook consensus for the upcoming games",
        description=(
            "Record the sportsbook consensus for the upcoming games, if a snapshot is due. "
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
            "or is too old to be asked for"
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
