"""
End-to-end tests for `python -m pipeline snapshot`.

The command runs against the fake server in tests/fake_odds_api.py, with a
dummy key, invented prices and a clock the test sets. Nothing here reaches
The Odds API. After every run the tests look for the dummy key in what was
printed, in the GITHUB_OUTPUT file and in the data directory.
"""

import errno
import importlib
import json
import os
import subprocess
import sys
from collections import namedtuple
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

import pipeline
from fake_odds_api import FakeOddsApi, event
from pipeline import config, snapshot, store
from pipeline.__main__ import main

REPOSITORY = Path(__file__).resolve().parent.parent
# A made-up value. It is deliberately not shaped like a real key.
KEY = "fake-key-not-a-real-one"

# Tuesday 20 October 2026 in New York. Slots start at 19:10 and 22:10 UTC
# that day and at 01:10 UTC the next.
AFTERNOON = datetime(2026, 10, 20, 19, 10, 9, tzinfo=timezone.utc)
EVENING = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
NIGHT = datetime(2026, 10, 21, 1, 12, 30, tzinfo=timezone.utc)
AFTERNOON_SLOT, EVENING_SLOT, NIGHT_SLOT = (
    "2026-10-20T15:10-04:00",
    "2026-10-20T18:10-04:00",
    "2026-10-20T21:10-04:00",
)

# The 18:10 slot starts at 22:10:00 UTC. A run may ask for it if it starts
# less than 75 minutes after that.
JUST_IN_TIME = datetime(2026, 10, 20, 23, 24, 59, tzinfo=timezone.utc)
TOO_LATE = datetime(2026, 10, 20, 23, 25, 0, tzinfo=timezone.utc)

EARLY, LATE, UNPRICED = "e" * 32, "f" * 32, "a" * 32


def early_game(prices):
    return event(EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", prices)


def games(early_prices=None):
    """Three games: two with prices, one that no sportsbook quotes yet."""
    return [
        early_game(early_prices or {"Book A": (1.50, 2.70), "Book B": (1.60, 2.40)}),
        event(
            LATE,
            "Los Angeles Lakers",
            "Golden State Warriors",
            "2026-10-21T02:00:00Z",
            {"Book A": (1.91, 1.91)},
        ),
        event(UNPRICED, "Miami Heat", "Chicago Bulls", "2026-10-21T23:30:00Z", {}),
    ]


@dataclass
class Result:
    status: int
    out: str
    err: str
    outputs: dict  # what the command wrote to GITHUB_OUTPUT
    requests: int  # how many requests the fake server received during the run


@pytest.fixture
def api():
    with FakeOddsApi({"basketball_nba": games()}) as fake:
        yield fake


@pytest.fixture
def data_dir(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def run(api, data_dir, tmp_path, monkeypatch, capsys):
    """Runs the command the way the workflow does, at a time the test chooses."""
    github_output = tmp_path / "github_output"
    monkeypatch.setenv("ODDS_API_KEY", KEY)
    monkeypatch.setenv("ODDS_API_BASE_URL", api.url)
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))

    def run(*options, now=EVENING, clock=None):
        github_output.write_text("")
        before = len(api.requests)
        status = main(
            ["snapshot", "--data-dir", str(data_dir), *options], clock=clock or (lambda: now)
        )
        printed = capsys.readouterr()
        written = github_output.read_text()
        for text in (printed.out, printed.err, written, *tree(data_dir).values()):
            assert KEY not in text
        outputs = dict(line.split("=", 1) for line in written.splitlines())
        return Result(status, printed.out, printed.err, outputs, len(api.requests) - before)

    return run


def tree(directory):
    """Every file under a directory, by relative path, with its content."""
    return {
        str(path.relative_to(directory)): path.read_text()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def read(directory, path):
    return json.loads((directory / path).read_text())


def history(directory, day="2026-10-20", prefix="v1"):
    lines = (directory / prefix / "history" / f"{day}.ndjson").read_text().splitlines()
    return [json.loads(line) for line in lines]


def test_the_first_run_writes_the_three_files_and_reports_a_change(run, data_dir):
    result = run("--all")

    assert result.status == 0
    assert result.requests == 1
    assert result.err == ""
    assert result.out.splitlines() == [
        f"Slot {EVENING_SLOT}. The next slot starts at {NIGHT_SLOT}.",
        "basketball_nba -> v1/: 3 games, 2 with a line, 0 dropped. "
        "Credits: 499 remaining, 1 used, 1 spent on this call.",
        "Wrote v1/history/2026-10-20.ndjson, v1/slate.json, v1/state.json.",
    ]
    assert result.outputs == {
        "changed": "true",
        "slot": EVENING_SLOT,
        "games": "3",
        "with_line": "2",
        "dropped": "0",
        "credits_remaining": "499",
        "credits_used": "1",
        "credits_spent": "1",
        "written": "v1 3 games",
    }
    assert sorted(tree(data_dir)) == [
        "v1/history/2026-10-20.ndjson",
        "v1/slate.json",
        "v1/state.json",
    ]

    at = "2026-10-20T22:10:41Z"
    slate = read(data_dir, "v1/slate.json")
    assert {key: value for key, value in slate.items() if key != "games"} == {
        "schema": 1,
        "sport": "basketball_nba",
        "generated_at": at,
        "slot": EVENING_SLOT,
        "next_due": NIGHT_SLOT,
    }
    assert [(game["id"], game["home"], game["away"]) for game in slate["games"]] == [
        (EARLY, "BOS", "NYK"),
        (LATE, "LAL", "GSW"),
        (UNPRICED, "MIA", "CHI"),
    ]
    assert slate["games"][0]["line"] == {
        "p_home": 0.6214,
        "lo": 0.6,
        "hi": 0.6429,
        "n": 2,
        "books": ["Book A", "Book B"],
        "captured_at": at,
    }
    assert slate["games"][2]["line"] is None

    state = read(data_dir, "v1/state.json")
    assert state["last_slot"] == EVENING_SLOT
    assert state["last_run_at"] == at
    assert state["credits"] == {"remaining": 499, "used": 1, "last": 1}
    assert sorted(state["games"]) == sorted([EARLY, LATE, UNPRICED])

    assert history(data_dir) == [
        {"id": EARLY, "at": at, "p_home": 0.6214, "lo": 0.6, "hi": 0.6429, "n": 2},
        {"id": LATE, "at": at, "p_home": 0.5, "lo": 0.5, "hi": 0.5, "n": 1},
    ]


def test_a_second_run_in_the_same_slot_makes_no_request_and_changes_nothing(run, data_dir):
    run("--all")
    after_first_run = tree(data_dir)

    # The next trigger, half an hour later, is still in the 18:10 slot.
    result = run("--all", now=EVENING + timedelta(minutes=30))

    assert result.status == 0
    assert result.requests == 0
    assert result.out == (
        f"Not due: slot {EVENING_SLOT} is already recorded for basketball_nba. "
        f"The next slot starts at {NIGHT_SLOT}.\n"
    )
    assert result.err == ""
    assert result.outputs == {"changed": "false", "slot": EVENING_SLOT}
    assert tree(data_dir) == after_first_run


def test_three_slots_of_one_evening(run, api, data_dir):
    # 15:10 in New York. Both games are still to come.
    assert run("--all", now=AFTERNOON).status == 0
    first_history = (data_dir / "v1/history/2026-10-20.ndjson").read_text()

    # 18:10. The early game's prices have moved.
    api.events["basketball_nba"] = games({"Book A": (1.40, 3.00), "Book B": (1.45, 2.90)})
    assert run("--all", now=EVENING).outputs["changed"] == "true"

    # History grew: the afternoon's lines are still there, word for word.
    second_history = (data_dir / "v1/history/2026-10-20.ndjson").read_text()
    assert second_history.startswith(first_history)
    assert [(line["id"], line["at"], line["p_home"]) for line in history(data_dir)] == [
        (EARLY, "2026-10-20T19:10:09Z", 0.6214),
        (LATE, "2026-10-20T19:10:09Z", 0.5),
        (EARLY, "2026-10-20T22:10:41Z", 0.6742),
        (LATE, "2026-10-20T22:10:41Z", 0.5),
    ]
    # The opening line is the afternoon's and the latest line is the evening's.
    early = read(data_dir, "v1/state.json")["games"][EARLY]
    assert early["first"] == {"p_home": 0.6214, "at": "2026-10-20T19:10:09Z"}
    assert early["latest"]["p_home"] == 0.6742
    board = read(data_dir, "v1/slate.json")["games"][0]
    assert (board["open"]["p_home"], board["line"]["p_home"]) == (0.6214, 0.6742)

    # 21:10. The early game tipped off at 19:00 New York time. The fake server
    # still lists it, with in-play prices.
    api.events["basketball_nba"] = games({"Book A": (1.02, 15.0)})
    result = run("--all", now=NIGHT)

    assert result.outputs["games"] == "2"
    assert [game["id"] for game in read(data_dir, "v1/slate.json")["games"]] == [LATE, UNPRICED]
    # Its last line from before the start is still in the state for grading.
    assert read(data_dir, "v1/state.json")["games"][EARLY] == early
    # This snapshot was taken on the next UTC date, so its line starts a new file.
    assert (data_dir / "v1/history/2026-10-20.ndjson").read_text() == second_history
    assert [line["id"] for line in history(data_dir, day="2026-10-21")] == [LATE]


def test_a_game_that_starts_while_the_request_is_under_way_is_left_out(run, api, data_dir):
    # The clock is read when the run begins and again when the response is
    # there. Here the request took 90 seconds, as a response that arrives a
    # little at a time can, and the early game tipped off at 23:00:00 in the
    # meantime.
    begun = datetime(2026, 10, 20, 22, 59, 0, tzinfo=timezone.utc)
    readings = iter([begun, begun + timedelta(seconds=90)])

    result = run("--all", clock=lambda: next(readings))

    assert result.status == 0
    assert api.requests[0].query["commenceTimeFrom"] == "2026-10-20T22:59:00Z"
    slate = read(data_dir, "v1/slate.json")
    assert slate["generated_at"] == "2026-10-20T23:00:30Z"
    assert [game["id"] for game in slate["games"]] == [LATE, UNPRICED]
    assert EARLY not in read(data_dir, "v1/state.json")["games"]
    assert [line["at"] for line in history(data_dir)] == ["2026-10-20T23:00:30Z"]


@pytest.mark.parametrize(
    ("status", "error_code", "shown"),
    [(401, "INVALID_KEY", "HTTP 401 (INVALID_KEY)"), (429, None, "HTTP 429")],
)
def test_a_refusal_is_asked_once_and_ends_with_status_3(
    run, api, data_dir, status, error_code, shown
):
    api.status, api.error_code = status, error_code

    result = run("--all")

    assert result.status == 3
    assert result.requests == 1
    assert result.err.splitlines() == [
        f"The provider refused the request for basketball_nba: {shown}.",
        "Nothing was written.",
    ]
    assert result.outputs == {"changed": "false", "slot": EVENING_SLOT, "failed": "basketball_nba"}
    assert not data_dir.exists()


def test_a_503_is_asked_once_and_ends_with_status_4(run, api, data_dir):
    api.status = 503

    result = run("--all")

    assert result.status == 4
    assert result.requests == 1
    assert result.err.splitlines() == [
        "The provider gave no usable answer for basketball_nba: HTTP 503.",
        "Nothing was written.",
    ]
    assert result.outputs == {"changed": "false", "slot": EVENING_SLOT, "failed": "basketball_nba"}
    assert not data_dir.exists()


def test_an_answer_that_cannot_be_read_ends_with_status_4_after_one_request(run, api, data_dir):
    api.raw_body = b"<html>Service temporarily unavailable</html>"

    result = run("--all")

    assert result.status == 4
    assert result.requests == 1
    assert result.err.splitlines() == [
        "The provider gave no usable answer for basketball_nba: the response was not JSON.",
        "Nothing was written.",
    ]
    assert not data_dir.exists()


def test_an_answer_nested_too_deep_to_read_ends_with_status_4_and_no_traceback(run, api, data_dir):
    # json.loads raises RecursionError for this body, which is not a
    # ValueError. Left to itself it would end the command with a traceback
    # and status 1.
    api.raw_body = b"[" * 1_000_000

    result = run("--all")

    assert result.status == 4
    assert result.requests == 1
    assert result.err.splitlines() == [
        "The provider gave no usable answer for basketball_nba: "
        "the response could not be read (RecursionError).",
        "Nothing was written.",
    ]
    assert not data_dir.exists()


def test_a_failure_leaves_the_files_of_the_last_run_untouched_and_the_slot_due(run, api, data_dir):
    run("--all", now=AFTERNOON)
    after_first_run = tree(data_dir)

    api.status = 503
    assert run("--all", now=EVENING).status == 4
    assert tree(data_dir) == after_first_run

    # The provider is back for the next trigger, and the slot is still due.
    api.status = 200
    result = run("--all", now=EVENING + timedelta(minutes=30))
    assert (result.status, result.requests, result.outputs["changed"]) == (0, 1, "true")


def test_validation_refuses_a_bad_file_and_nothing_is_written(run, data_dir, monkeypatch):
    run("--all", now=AFTERNOON)
    after_first_run = tree(data_dir)
    # A bug in the builder: every probability comes out as 1.
    monkeypatch.setattr(snapshot, "published", lambda probability: 1.0)

    result = run("--all", now=EVENING)

    assert result.status == 2
    assert result.requests == 1
    assert result.err.splitlines()[0] == "Validation failed for basketball_nba:"
    assert (
        f"  slate game '{EARLY}' line: p_home, lo and hi must be numbers between 0 and 1, "
        "got 1.0, 1.0, 1.0"
    ) in result.err.splitlines()
    assert result.err.splitlines()[-1] == "Nothing was written."
    assert result.outputs == {"changed": "false", "slot": EVENING_SLOT, "failed": "basketball_nba"}
    assert tree(data_dir) == after_first_run


def no_space_left(monkeypatch, only_under=""):
    """Makes the move of a file into place fail, for every file or for those under one prefix."""
    replace = os.replace

    def failing_replace(source, destination):
        if not only_under or only_under in Path(destination).parts:
            raise OSError(errno.ENOSPC, "No space left on device")
        replace(source, destination)

    monkeypatch.setattr(store.os, "replace", failing_replace)


def test_files_that_cannot_be_written_end_the_run_with_status_1_and_a_message(
    run, data_dir, monkeypatch
):
    run("--all", now=AFTERNOON)
    after_first_run = tree(data_dir)
    no_space_left(monkeypatch)

    result = run("--all", now=EVENING)

    assert result.status == 1
    assert result.requests == 1
    assert result.err.splitlines() == [
        "The files for basketball_nba could not be written: OSError: No space left on device.",
        "Nothing was written.",
    ]
    assert result.outputs == {"changed": "false", "slot": EVENING_SLOT, "failed": "basketball_nba"}
    assert tree(data_dir) == after_first_run
    assert not list(data_dir.glob(".staging-*"))


@pytest.mark.parametrize(
    ("content", "complaint"),
    [
        ("", "v1/state.json is not JSON."),
        ("{not json", "v1/state.json is not JSON."),
        ('{"schema": 2}', "v1/state.json is not a state file this job can continue from:"),
    ],
)
def test_a_state_file_that_cannot_be_continued_from_stops_the_run_before_a_request(
    run, data_dir, content, complaint
):
    (data_dir / "v1").mkdir(parents=True)
    (data_dir / "v1/state.json").write_text(content)

    result = run("--all")

    assert result.status == 2
    assert result.requests == 0
    assert result.err.splitlines()[0] == complaint
    assert tree(data_dir) == {"v1/state.json": content}


def test_a_history_file_that_was_cut_off_stops_the_run_before_a_request(run, data_dir):
    cut_off = '{"id":"x","at":"2026-10-20T19:10:09Z","p_home":0.6'
    (data_dir / "v1/history").mkdir(parents=True)
    (data_dir / "v1/history/2026-10-20.ndjson").write_text(cut_off)

    result = run("--all")

    assert result.status == 2
    assert result.requests == 0
    assert result.err.splitlines() == [
        "v1/history/2026-10-20.ndjson cannot be added to:",
        "  history: the existing file does not end with a newline",
        "Nothing was written.",
    ]
    assert tree(data_dir) == {"v1/history/2026-10-20.ndjson": cut_off}


def test_an_unknown_team_is_dropped_and_reported_and_the_run_succeeds(run, api, data_dir):
    exhibition = "b" * 32
    api.events["basketball_nba"] = games() + [
        event(
            exhibition,
            "Toronto Raptors",
            "Example Visitors",
            "2026-10-20T23:30:00Z",
            {"Book A": (1.20, 4.60)},
        )
    ]

    result = run("--all")

    assert result.status == 0
    assert result.outputs["changed"] == "true"
    assert (result.outputs["games"], result.outputs["dropped"]) == ("3", "1")
    assert (
        f'  dropped event {exhibition}: unknown team "Example Visitors"' in result.out.splitlines()
    )
    assert "3 games, 2 with a line, 1 dropped" in result.out
    assert all(exhibition not in content for content in tree(data_dir).values())


def test_a_dry_run_fetches_and_validates_but_writes_nothing(run, data_dir):
    result = run("--all", "--dry-run")

    assert result.status == 0
    assert result.requests == 1
    assert result.out.splitlines()[-1] == "Dry run: nothing was written."
    assert result.outputs["changed"] == "false"
    assert (result.outputs["games"], result.outputs["with_line"]) == ("3", "2")
    # Nothing was written, so there is nothing to name in a commit message.
    assert "written" not in result.outputs
    assert not data_dir.exists()

    # Nothing was recorded, so the slot is still due.
    assert run("--all").requests == 1


def test_a_dry_run_in_a_recorded_slot_makes_no_request_unless_it_is_forced(run, data_dir):
    run("--all")
    after_first_run = tree(data_dir)
    a_little_later = EVENING + timedelta(minutes=5)

    assert run("--all", "--dry-run", now=a_little_later).requests == 0

    forced = run("--all", "--dry-run", "--force", now=a_little_later)
    assert (forced.status, forced.requests, forced.outputs["changed"]) == (0, 1, "false")
    assert tree(data_dir) == after_first_run


def test_force_takes_another_snapshot_in_a_slot_that_is_already_recorded(run, data_dir):
    run("--all")

    result = run("--all", "--force", now=EVENING + timedelta(minutes=5))

    assert (result.status, result.requests, result.outputs["changed"]) == (0, 1, "true")
    assert [line["at"] for line in history(data_dir)] == ["2026-10-20T22:10:41Z"] * 2 + [
        "2026-10-20T22:15:41Z"
    ] * 2
    assert read(data_dir, "v1/state.json")["games"][EARLY]["first"]["at"] == "2026-10-20T22:10:41Z"


def test_a_run_that_starts_just_inside_75_minutes_takes_the_slot(run, data_dir):
    result = run("--all", now=JUST_IN_TIME)

    assert (result.status, result.requests, result.outputs["changed"]) == (0, 1, "true")
    assert read(data_dir, "v1/state.json")["last_slot"] == EVENING_SLOT


def test_a_run_that_starts_75_minutes_after_the_slot_gives_it_up(run, data_dir):
    result = run("--all", now=TOO_LATE)

    assert result.status == 0
    assert result.requests == 0
    assert result.out == (
        f"Slot {EVENING_SLOT} for basketball_nba was not recorded in time; "
        f"the next slot starts at {NIGHT_SLOT}.\n"
    )
    assert result.err == ""
    assert result.outputs == {
        "changed": "false",
        "slot": EVENING_SLOT,
        "given_up": "basketball_nba",
    }
    assert not data_dir.exists()


def test_a_slot_that_is_given_up_leaves_the_files_of_the_slot_before_untouched(run, data_dir):
    run("--all", now=AFTERNOON)
    after_the_afternoon = tree(data_dir)

    result = run("--all", now=TOO_LATE)

    assert (result.status, result.requests) == (0, 0)
    assert "was not recorded in time" in result.out
    assert tree(data_dir) == after_the_afternoon


def test_force_takes_a_slot_that_is_too_old_to_be_asked_for(run, data_dir):
    result = run("--all", "--force", now=TOO_LATE)

    assert (result.status, result.requests, result.outputs["changed"]) == (0, 1, "true")
    assert read(data_dir, "v1/state.json")["last_slot"] == EVENING_SLOT
    assert "given_up" not in result.outputs


def test_a_dry_run_in_a_slot_that_is_too_old_makes_no_request_unless_it_is_forced(run, data_dir):
    unforced = run("--all", "--dry-run", now=TOO_LATE)
    assert (unforced.status, unforced.requests) == (0, 0)
    assert "was not recorded in time" in unforced.out

    forced = run("--all", "--dry-run", "--force", now=TOO_LATE)
    assert (forced.status, forced.requests, forced.outputs["changed"]) == (0, 1, "false")
    assert not data_dir.exists()


def test_a_failure_that_lasts_is_asked_three_times_for_a_slot_and_then_left_alone(
    run, api, data_dir
):
    # The triggers of one slot, half an hour apart, while the provider is
    # down, and then the first trigger of the next slot three hours on.
    api.status = 503
    slot_start = datetime(2026, 10, 20, 22, 10, 0, tzinfo=timezone.utc)

    results = [run("--all", now=slot_start + timedelta(minutes=30 * n)) for n in range(7)]

    assert [result.requests for result in results] == [1, 1, 1, 0, 0, 0, 1]
    assert [result.status for result in results] == [4, 4, 4, 0, 0, 0, 4]
    assert [result.outputs["slot"] for result in results] == [EVENING_SLOT] * 6 + [NIGHT_SLOT]
    assert all("was not recorded in time" in result.out for result in results[3:6])
    assert not data_dir.exists()


class TestAll:
    """--all with a second sport that has a last day, as the preseason rehearsal has."""

    @pytest.fixture(autouse=True)
    def two_sports(self, monkeypatch, api):
        monkeypatch.setattr(
            config,
            "SPORTS",
            (
                config.Sport(key="basketball_nba", prefix="v1"),
                config.Sport(key="basketball_test", prefix="v1-test", last_day=date(2026, 10, 17)),
            ),
        )
        api.events["basketball_test"] = [
            event(
                "c" * 32,
                "Utah Jazz",
                "Phoenix Suns",
                "2026-10-22T01:00:00Z",
                {"Book A": (2.30, 1.65)},
            )
        ]

    # 17 October, 18:10 in New York: the last day of the second sport.
    SATURDAY = datetime(2026, 10, 17, 22, 10, 41, tzinfo=timezone.utc)
    SLOT, NEXT_SLOT = "2026-10-17T18:10-04:00", "2026-10-17T21:10-04:00"
    FILES_OF_NBA = ["v1/history/2026-10-17.ndjson", "v1/slate.json", "v1/state.json"]
    FILES_OF_TEST = [
        "v1-test/history/2026-10-17.ndjson",
        "v1-test/slate.json",
        "v1-test/state.json",
    ]

    def test_both_sports_are_captured_each_under_its_own_prefix(self, run, api, data_dir):
        result = run("--all", now=self.SATURDAY)

        assert result.status == 0
        assert [received.sport for received in api.requests] == [
            "basketball_nba",
            "basketball_test",
        ]
        # One sport is written before the next one is asked for.
        assert result.out.splitlines() == [
            f"Slot {self.SLOT}. The next slot starts at {self.NEXT_SLOT}.",
            "basketball_nba -> v1/: 3 games, 2 with a line, 0 dropped. "
            "Credits: 499 remaining, 1 used, 1 spent on this call.",
            "Wrote v1/history/2026-10-17.ndjson, v1/slate.json, v1/state.json.",
            "basketball_test -> v1-test/: 1 game, 1 with a line, 0 dropped. "
            "Credits: 498 remaining, 2 used, 1 spent on this call.",
            "Wrote v1-test/history/2026-10-17.ndjson, v1-test/slate.json, v1-test/state.json.",
        ]
        assert sorted(tree(data_dir)) == [
            "v1-test/history/2026-10-17.ndjson",
            "v1-test/slate.json",
            "v1-test/state.json",
            "v1/history/2026-10-17.ndjson",
            "v1/slate.json",
            "v1/state.json",
        ]
        assert read(data_dir, "v1-test/slate.json")["sport"] == "basketball_test"
        # The counts are totals, and `written` has one count for each prefix.
        # The credits are those of the last response.
        assert result.outputs == {
            "changed": "true",
            "slot": self.SLOT,
            "games": "4",
            "with_line": "3",
            "dropped": "0",
            "credits_remaining": "498",
            "credits_used": "2",
            "credits_spent": "2",
            "written": "v1 3 games, v1-test 1 game",
        }

    def test_the_last_day_is_a_new_york_calendar_day(self, run, api):
        # 02:00 UTC on the 18th is 22:00 on the 17th in New York.
        run("--all", now=datetime(2026, 10, 18, 2, 0, 0, tzinfo=timezone.utc))
        assert [received.sport for received in api.requests] == [
            "basketball_nba",
            "basketball_test",
        ]

        # 09:10 UTC on the 18th is 05:10 on the 18th in New York.
        api.requests.clear()
        run("--all", now=datetime(2026, 10, 18, 9, 10, 0, tzinfo=timezone.utc))
        assert [received.sport for received in api.requests] == ["basketball_nba"]

    def test_a_sport_that_was_written_stays_written_when_a_later_one_fails(
        self, run, api, data_dir
    ):
        del api.events["basketball_test"]  # the fake server now answers 404 for it

        result = run("--all", now=self.SATURDAY)

        assert result.status == 3
        assert [received.sport for received in api.requests] == [
            "basketball_nba",
            "basketball_test",
        ]
        assert result.out.splitlines() == [
            f"Slot {self.SLOT}. The next slot starts at {self.NEXT_SLOT}.",
            "basketball_nba -> v1/: 3 games, 2 with a line, 0 dropped. "
            "Credits: 499 remaining, 1 used, 1 spent on this call.",
            "Wrote v1/history/2026-10-17.ndjson, v1/slate.json, v1/state.json.",
        ]
        assert result.err.splitlines() == [
            "The provider refused the request for basketball_test: HTTP 404 (UNKNOWN_SPORT).",
            "Nothing was written for basketball_test.",
        ]
        # Something was written, so the workflow has something to push. The
        # counts are those of the sport that was taken.
        assert result.outputs == {
            "changed": "true",
            "slot": self.SLOT,
            "games": "3",
            "with_line": "2",
            "dropped": "0",
            "credits_remaining": "499",
            "credits_used": "1",
            "credits_spent": "1",
            "written": "v1 3 games",
            "failed": "basketball_test",
        }
        assert sorted(tree(data_dir)) == self.FILES_OF_NBA
        assert read(data_dir, "v1/state.json")["last_slot"] == self.SLOT

    def test_the_sport_that_failed_is_asked_again_in_time_and_the_one_written_is_not(
        self, run, api, data_dir
    ):
        del api.events["basketball_test"]
        slot_start = datetime(2026, 10, 17, 22, 10, 0, tzinfo=timezone.utc)

        # The four triggers of the slot's first hour and a half.
        results = [run("--all", now=slot_start + timedelta(minutes=30 * n)) for n in range(4)]

        assert [received.sport for received in api.requests] == [
            "basketball_nba",
            "basketball_test",
            "basketball_test",
            "basketball_test",
        ]
        assert [result.requests for result in results] == [2, 1, 1, 0]
        assert [result.status for result in results] == [3, 3, 3, 0]
        assert [result.outputs["changed"] for result in results] == [
            "true",
            "false",
            "false",
            "false",
        ]
        assert results[3].out.splitlines() == [
            f"Not due: slot {self.SLOT} is already recorded for basketball_nba.",
            f"Slot {self.SLOT} for basketball_test was not recorded in time; "
            f"the next slot starts at {self.NEXT_SLOT}.",
        ]
        assert sorted(tree(data_dir)) == self.FILES_OF_NBA

    def test_the_sport_that_failed_is_taken_by_the_next_trigger_if_it_answers_then(
        self, run, api, data_dir
    ):
        events_of_the_second_sport = api.events.pop("basketball_test")
        assert run("--all", now=self.SATURDAY).status == 3
        after_the_first_run = tree(data_dir)

        api.events["basketball_test"] = events_of_the_second_sport
        api.requests.clear()
        result = run("--all", now=self.SATURDAY + timedelta(minutes=30))

        assert result.status == 0
        assert [received.sport for received in api.requests] == ["basketball_test"]
        assert (result.outputs["changed"], result.outputs["games"]) == ("true", "1")
        assert "failed" not in result.outputs
        assert sorted(tree(data_dir)) == sorted(self.FILES_OF_TEST + self.FILES_OF_NBA)
        # The files of the first sport are as the first run left them.
        assert {path: tree(data_dir)[path] for path in self.FILES_OF_NBA} == after_the_first_run

    def test_a_sport_that_fails_does_not_keep_the_next_one_from_being_taken(
        self, run, api, data_dir
    ):
        del api.events["basketball_nba"]

        result = run("--all", now=self.SATURDAY)

        assert result.status == 3
        assert [received.sport for received in api.requests] == [
            "basketball_nba",
            "basketball_test",
        ]
        assert result.err.splitlines() == [
            "The provider refused the request for basketball_nba: HTTP 404 (UNKNOWN_SPORT).",
            "Nothing was written for basketball_nba.",
        ]
        assert (result.outputs["changed"], result.outputs["games"]) == ("true", "1")
        assert (result.outputs["written"], result.outputs["failed"]) == (
            "v1-test 1 game",
            "basketball_nba",
        )
        assert sorted(tree(data_dir)) == self.FILES_OF_TEST

    def test_files_that_validation_refuses_for_one_sport_leave_the_other_written(
        self, run, data_dir, monkeypatch
    ):
        build = snapshot.build

        def build_with_a_bug_for_one_sport(*args, sport, **kwargs):
            built = build(*args, sport=sport, **kwargs)
            if sport == "basketball_test":
                built.slate["games"][0]["line"]["p_home"] = 1.0
            return built

        monkeypatch.setattr(snapshot, "build", build_with_a_bug_for_one_sport)

        result = run("--all", now=self.SATURDAY)

        assert result.status == 2
        assert result.requests == 2
        assert result.err.splitlines()[0] == "Validation failed for basketball_test:"
        assert result.err.splitlines()[-1] == "Nothing was written for basketball_test."
        assert (result.outputs["changed"], result.outputs["failed"]) == ("true", "basketball_test")
        assert sorted(tree(data_dir)) == self.FILES_OF_NBA

    def test_files_that_cannot_be_written_for_one_sport_leave_the_other_written(
        self, run, data_dir, monkeypatch
    ):
        no_space_left(monkeypatch, only_under="v1")

        result = run("--all", now=self.SATURDAY)

        assert result.status == 1
        assert result.requests == 2
        assert result.err.splitlines() == [
            "The files for basketball_nba could not be written: "
            "OSError: No space left on device.",
            "Nothing was written for basketball_nba.",
        ]
        assert (result.outputs["changed"], result.outputs["failed"]) == ("true", "basketball_nba")
        assert sorted(tree(data_dir)) == self.FILES_OF_TEST

    def test_a_state_file_that_cannot_be_continued_from_stops_its_own_sport_only(
        self, run, api, data_dir
    ):
        (data_dir / "v1").mkdir(parents=True)
        (data_dir / "v1/state.json").write_text("{not json")

        result = run("--all", now=self.SATURDAY)

        assert result.status == 2
        # No request is spent on the sport whose state cannot be read.
        assert [received.sport for received in api.requests] == ["basketball_test"]
        assert result.err.splitlines() == [
            "v1/state.json is not JSON.",
            "Nothing was written for basketball_nba.",
        ]
        assert (result.outputs["changed"], result.outputs["failed"]) == ("true", "basketball_nba")
        assert sorted(tree(data_dir)) == sorted(self.FILES_OF_TEST + ["v1/state.json"])
        assert (data_dir / "v1/state.json").read_text() == "{not json"

    def test_when_both_sports_fail_the_exit_status_is_that_of_the_first_failure(
        self, run, api, data_dir
    ):
        (data_dir / "v1").mkdir(parents=True)
        (data_dir / "v1/state.json").write_text("{not json")
        del api.events["basketball_test"]

        result = run("--all", now=self.SATURDAY)

        assert result.status == 2
        assert result.err.splitlines() == [
            "v1/state.json is not JSON.",
            "The provider refused the request for basketball_test: HTTP 404 (UNKNOWN_SPORT).",
            "Nothing was written.",
        ]
        assert result.outputs == {
            "changed": "false",
            "slot": self.SLOT,
            "failed": "basketball_nba, basketball_test",
        }
        assert tree(data_dir) == {"v1/state.json": "{not json"}

    def test_a_dry_run_in_which_one_sport_fails_writes_nothing_and_fails(self, run, api, data_dir):
        del api.events["basketball_test"]

        result = run("--all", "--dry-run", now=self.SATURDAY)

        assert result.status == 3
        assert result.requests == 2
        assert result.out.splitlines()[-1] == "Dry run: nothing was written."
        assert result.err.splitlines()[-1] == "Nothing was written."
        assert (result.outputs["changed"], result.outputs["games"]) == ("false", "3")
        assert result.outputs["failed"] == "basketball_test"
        assert not data_dir.exists()

    def test_an_error_nobody_foresaw_does_not_lose_the_report_of_what_was_written(
        self, run, data_dir, tmp_path, monkeypatch
    ):
        build = snapshot.build

        def build_that_breaks_for_one_sport(*args, sport, **kwargs):
            if sport == "basketball_test":
                raise RuntimeError("a bug")
            return build(*args, sport=sport, **kwargs)

        monkeypatch.setattr(snapshot, "build", build_that_breaks_for_one_sport)

        # The command ends with a traceback, as a program with a bug does.
        with pytest.raises(RuntimeError, match="a bug"):
            run("--all", now=self.SATURDAY)

        # The first sport is on disk, and the output file says so. Without
        # that line the workflow would not push it.
        assert sorted(tree(data_dir)) == self.FILES_OF_NBA
        written = (tmp_path / "github_output").read_text().splitlines()
        assert written[:3] == ["changed=true", f"slot={self.SLOT}", "games=3"]

    def test_too_late_for_one_sport_while_the_other_is_recorded(self, run, api):
        run("--sport", "basketball_nba", now=self.SATURDAY)

        result = run("--all", now=self.SATURDAY + timedelta(minutes=75))

        assert (result.status, result.requests) == (0, 0)
        assert result.out.splitlines() == [
            f"Not due: slot {self.SLOT} is already recorded for basketball_nba.",
            f"Slot {self.SLOT} for basketball_test was not recorded in time; "
            f"the next slot starts at {self.NEXT_SLOT}.",
        ]
        assert result.outputs == {
            "changed": "false",
            "slot": self.SLOT,
            "given_up": "basketball_test",
        }

    def test_too_late_for_both_sports(self, run, api, data_dir):
        result = run("--all", now=datetime(2026, 10, 17, 23, 25, 0, tzinfo=timezone.utc))

        assert (result.status, result.requests) == (0, 0)
        assert result.out == (
            f"Slot {self.SLOT} for basketball_nba, basketball_test "
            f"was not recorded in time; the next slot starts at {self.NEXT_SLOT}.\n"
        )
        assert result.outputs["given_up"] == "basketball_nba, basketball_test"
        assert not data_dir.exists()

    def test_only_the_sport_that_is_due_is_requested(self, run, api):
        run("--sport", "basketball_nba", now=self.SATURDAY)
        api.requests.clear()

        result = run("--all", now=self.SATURDAY + timedelta(minutes=30))

        assert [received.sport for received in api.requests] == ["basketball_test"]
        assert result.outputs["games"] == "1"


def test_the_real_configuration():
    regular_season = config.SPORTS[0]
    assert (regular_season.key, regular_season.prefix, regular_season.last_day) == (
        "basketball_nba",
        "v1",
        None,
    )
    # Anything else is temporary and has to say when it ends.
    assert all(sport.last_day is not None for sport in config.SPORTS[1:])
    assert len({sport.prefix for sport in config.SPORTS}) == len(config.SPORTS)
    assert config.sports_on(date(2027, 1, 1)) == (regular_season,)


def test_one_sport_can_be_captured_by_name(run, data_dir):
    assert run("--sport", "basketball_nba").status == 0
    assert sorted(tree(data_dir)) == [
        "v1/history/2026-10-20.ndjson",
        "v1/slate.json",
        "v1/state.json",
    ]

    # With --prefix it goes wherever the caller says, and that place has its own state.
    result = run("--sport", "basketball_nba", "--prefix", "scratch")
    assert (result.status, result.requests) == (0, 1)
    assert read(data_dir, "scratch/slate.json")["sport"] == "basketball_nba"


def test_a_sport_that_is_not_configured_needs_a_prefix(run, data_dir):
    result = run("--sport", "icehockey_nhl")

    assert result.status == 1
    assert result.requests == 0
    assert result.err.splitlines() == [
        "icehockey_nhl is not in pipeline/config.py. Say where to write it with --prefix.",
        "Nothing was written.",
    ]
    assert not data_dir.exists()


@pytest.mark.parametrize(
    "arguments",
    [
        ["snapshot"],
        ["snapshot", "--all"],
        ["snapshot", "--data-dir", "d"],
        ["snapshot", "--data-dir", "d", "--all", "--sport", "basketball_nba"],
        ["snapshot", "--data-dir", "d", "--all", "--prefix", "v2"],
        ["snapshot", "--data-dir", "d", "--sport", "../x"],
        ["snapshot", "--data-dir", "d", "--sport", "basketball_nba", "--prefix", "../outside"],
        ["snapshot", "--data-dir", "d", "--sport", "basketball_nba", "--prefix", ".git"],
        ["grade"],
        [],
    ],
)
def test_bad_arguments_end_with_status_1_not_2(arguments, capsys):
    # argparse would exit with 2, which here means that validation failed.
    with pytest.raises(SystemExit) as stopped:
        main(arguments)

    assert stopped.value.code == 1
    assert "usage: python -m pipeline" in capsys.readouterr().err


def test_without_a_key_no_request_is_made(run, data_dir, monkeypatch):
    monkeypatch.delenv("ODDS_API_KEY")

    result = run("--all")

    assert result.status == 1
    assert result.requests == 0
    assert result.err.splitlines() == ["ODDS_API_KEY is not set.", "Nothing was written."]
    # The run as a whole could not start, so no sport is named as failed.
    assert result.outputs == {"changed": "false", "slot": EVENING_SLOT}
    assert not data_dir.exists()


def test_white_space_around_the_key_is_not_sent(run, api, monkeypatch):
    # A secret that was pasted with a line break after it is still the key.
    monkeypatch.setenv("ODDS_API_KEY", f"  {KEY}\n")

    assert run("--all").status == 0
    assert api.requests[0].query["apiKey"] == KEY


def test_an_address_that_is_not_on_this_machine_is_refused(run, data_dir, monkeypatch):
    monkeypatch.setenv("ODDS_API_BASE_URL", "https://example.com")

    result = run("--all")

    assert result.status == 1
    assert result.requests == 0
    assert "may only name a server on this machine" in result.err
    assert not data_dir.exists()


def test_outside_github_actions_no_output_file_is_needed(run, data_dir, monkeypatch):
    monkeypatch.delenv("GITHUB_OUTPUT")

    result = run("--all")

    assert result.status == 0
    assert result.outputs == {}
    assert (data_dir / "v1/state.json").exists()


def test_a_python_older_than_3_11_is_refused(monkeypatch):
    # On 3.10 the package would import and run, and then drop every game,
    # because fromisoformat there does not accept the provider's times.
    version = namedtuple("version_info", "major minor micro releaselevel serial")
    monkeypatch.setattr(sys, "version_info", version(3, 10, 18, "final", 0))

    with pytest.raises(RuntimeError, match="needs Python 3.11 or newer"):
        importlib.reload(pipeline)


def test_the_module_runs_as_a_program_with_the_real_clock(tmp_path):
    # Everything above calls main() with a clock of its own. This starts the
    # program the way the workflow does, except that it is forced: with the
    # real clock, whether a run may still ask for its slot depends on the
    # time of day the test is run at.
    in_two_days = (datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    upcoming = [
        event(EARLY, "Boston Celtics", "New York Knicks", in_two_days, {"Book A": (1.50, 2.70)})
    ]
    github_output = tmp_path / "github_output"

    with FakeOddsApi({sport.key: upcoming for sport in config.SPORTS}) as fake:
        finished = subprocess.run(
            [
                sys.executable,
                "-m",
                "pipeline",
                "snapshot",
                "--all",
                "--force",
                "--data-dir",
                str(tmp_path / "data"),
            ],
            cwd=REPOSITORY,
            env={
                **os.environ,
                "ODDS_API_KEY": KEY,
                "ODDS_API_BASE_URL": fake.url,
                "GITHUB_OUTPUT": str(github_output),
            },
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    assert finished.returncode == 0, finished.stderr
    assert finished.stderr == ""
    assert "basketball_nba -> v1/: 1 game, 1 with a line, 0 dropped." in finished.stdout
    assert "changed=true\n" in github_output.read_text()
    assert read(tmp_path / "data", "v1/slate.json")["games"][0]["line"]["p_home"] == 0.6429
    for text in (finished.stdout, github_output.read_text(), *tree(tmp_path / "data").values()):
        assert KEY not in text
