"""
The command line.

    python -m pipeline snapshot --all --data-dir DIR

Exit status:

    0  a snapshot was taken, or none was due
    1  bad arguments or settings, for example ODDS_API_KEY is not set
    2  validation failed
    3  the provider refused the request (401, 429)
    4  the provider could not be reached

On any failure nothing is written.
"""

import argparse
import os
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from pipeline import config, oddsapi, schedule, snapshot, store, validate

DONE, USAGE, INVALID, REFUSED, UNREACHABLE = 0, 1, 2, 3, 4
KEY_VARIABLE = "ODDS_API_KEY"

Clock = Callable[[], datetime]


class _Stop(Exception):
    """Ends the run with an exit status and a message. Raised only before anything is written."""

    def __init__(self, status: int, *lines: str):
        super().__init__(*lines)
        self.status = status
        self.lines = lines


@dataclass(frozen=True)
class _Slot:
    """The slot a run falls in."""

    id: str
    next_due: str  # the id of the slot after it
    run_started: datetime


@dataclass(frozen=True)
class _Capture:
    """One sport's snapshot, validated and ready to be written."""

    sport: config.Sport
    response: oddsapi.OddsResponse
    built: snapshot.Snapshot
    files: dict[str, str]  # path in the data directory -> new content


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
        id=schedule.slot_id(current), next_due=schedule.slot_id(following), run_started=now
    )
    try:
        outputs = _snapshot(args, slot, clock)
        status = DONE
    except _Stop as stop:
        for line in (*stop.lines, "Nothing was written."):
            print(line, file=sys.stderr, flush=True)
        outputs = {"changed": "false", "slot": slot.id}
        status = stop.status
    _write_outputs(outputs)
    return status


def _snapshot(args: argparse.Namespace, slot: _Slot, clock: Clock) -> dict:
    """
    Takes the snapshot of every sport that is due and returns the values for
    GITHUB_OUTPUT. Raises _Stop on any failure, and writes only when every
    sport has been fetched and validated.
    """
    data_dir = args.data_dir
    sports = _selected(args, slot)
    previous = {sport: _state_on_disk(data_dir, sport) for sport in sports}
    due = [sport for sport in sports if args.force or _is_due(slot, previous[sport])]
    if not due:
        names = ", ".join(sport.key for sport in sports)
        _say(f"Not due: slot {slot.id} is already recorded for {names}.", _next(slot))
        return {"changed": "false", "slot": slot.id}

    # Whatever can be checked without the provider is checked before the
    # request: the state files above, and here the key and the history files
    # that will be added to. A request whose result is then refused has spent
    # its credit for nothing, and the next trigger would spend another.
    api_key = _api_key()
    for sport in due:
        _history_on_disk(data_dir, sport, slot.run_started)

    _say(f"Slot {slot.id}.", _next(slot))
    captures = []
    for sport in due:
        capture = _capture(data_dir, sport, previous[sport], api_key, slot, clock)
        captures.append(capture)
        _say(_summary(capture))
        for reason in capture.built.dropped:
            _say(f"  dropped {reason}")

    files = {path: content for capture in captures for path, content in capture.files.items()}
    if args.dry_run:
        _say("Dry run: nothing was written.")
    else:
        store.write(data_dir, files)
        _say(f"Wrote {', '.join(files)}.")
    return _outputs(captures, slot, changed=not args.dry_run)


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
            UNREACHABLE, f"The provider could not be reached for {sport.key}: {error}."
        ) from None

    # Read the clock again now that the response is here. A game is recorded
    # only if it had not started when its prices arrived, however long the
    # request and its retries took.
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


def _outputs(captures: list[_Capture], slot: _Slot, *, changed: bool) -> dict:
    """
    The step outputs. The counts are totals over the sports captured in this
    run; the credits remaining and used are those of the last response.
    """
    costs = [capture.response.last for capture in captures if capture.response.last is not None]
    last = captures[-1].response
    return {
        "changed": "true" if changed else "false",
        "slot": slot.id,
        "games": sum(len(capture.built.slate["games"]) for capture in captures),
        "with_line": sum(len(capture.built.history) for capture in captures),
        "dropped": sum(len(capture.built.dropped) for capture in captures),
        "credits_remaining": _known(last.remaining, otherwise=""),
        "credits_used": _known(last.used, otherwise=""),
        "credits_spent": sum(costs) if costs else "",
    }


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
        help="take a snapshot even if the current slot is already recorded",
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
