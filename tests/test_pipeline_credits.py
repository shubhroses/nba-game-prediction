"""
The bound on requests, as a test.

Every request to The Odds API can cost a credit, and the free plan has 500 a
month. The plan is one request for each sport in each of the six slots of a
day. What must not happen is that a failure which does not pass is paid for
at every trigger of the workflow, 48 times a day.

These tests walk every trigger of one New York calendar day through the real
command, against the fake server in tests/fake_odds_api.py, with the clock
set to the moment of the trigger. They do that once for each way a run can
end, and count the requests the fake server received for each slot and each
sport. A request is counted whether or not the provider would charge for it.

Two sports are configured, so that "for each sport" is tested. Every game and
every price is invented, and the key is a dummy.
"""

import errno
import itertools
import re
import shutil
import time as stopwatch
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest

from fake_odds_api import FakeOddsApi, event
from pipeline import config, oddsapi, schedule, snapshot, store
from pipeline.__main__ import main

WORKFLOW = (Path(__file__).resolve().parent.parent / ".github/workflows/pipeline.yml").read_text()
# A made-up value. It is deliberately not shaped like a real key.
KEY = "fake-key-not-a-real-one"
NBA, OTHER = "basketball_nba", "basketball_test"


@dataclass(frozen=True)
class Day:
    """A New York calendar day and the number of times the workflow is triggered on it."""

    date: date
    triggers: int


DAYS = {
    "an ordinary day": Day(date(2026, 10, 20), 48),
    "the 25 hours of the day the clocks go back": Day(date(2026, 11, 1), 50),
    "the 23 hours of the day the clocks go forward": Day(date(2027, 3, 14), 46),
}


def triggers_of(day):
    """Every moment the workflow's cron line fires on a New York calendar day, in UTC."""
    minutes, hours = re.search(r'cron: "(\S+) (\S+) \* \* \*"', WORKFLOW).groups()
    assert hours == "*"
    midnight = datetime.combine(day.date, time(0), tzinfo=schedule.ZONE)
    next_midnight = datetime.combine(day.date + timedelta(days=1), time(0), tzinfo=schedule.ZONE)
    # Midnight in New York is a whole hour in UTC, so the hours can be counted from it.
    hour, end = midnight.astimezone(timezone.utc), next_midnight.astimezone(timezone.utc)
    found = []
    while hour < end:
        found += [hour.replace(minute=int(minute)) for minute in minutes.split(",")]
        hour += timedelta(hours=1)
    return sorted(found)


def slots_of(day):
    """The ids of the six slots that start on a New York calendar day."""
    return [
        schedule.slot_id(datetime.combine(day.date, start, tzinfo=schedule.ZONE))
        for start in schedule.SLOT_TIMES
    ]


def since_slot_start(moment):
    start, _ = schedule.current_and_next(moment)
    return moment - start


def games(day, sport):
    """Two games that start well after the day, so that they are upcoming at every trigger."""
    start = (day.date + timedelta(days=3)).strftime("%Y-%m-%dT23:00:00Z")
    return [
        event(
            "e" * 32, "Boston Celtics", "New York Knicks", start, {"Book A": (1.50, 2.70)}, sport
        ),
        event(
            "f" * 32,
            "Los Angeles Lakers",
            "Golden State Warriors",
            start,
            {"Book A": (1.91, 1.91), "Book B": (1.87, 1.95)},
            sport,
        ),
    ]


# What each way of ending does to the fake server or to the pipeline. Each one
# lasts for the whole day.


def nothing_goes_wrong(api, monkeypatch):
    pass


def the_provider_answers(status, error_code=None):
    def arrange(api, monkeypatch):
        api.status, api.error_code = status, error_code

    return arrange


def the_provider_never_answers(api, monkeypatch):
    # The fake server waits longer than the command is willing to.
    monkeypatch.setattr(oddsapi, "TIMEOUT_SECONDS", 0.02)
    api.delay_seconds = 0.15


def the_answer_cannot_be_read(api, monkeypatch):
    api.raw_body = b"<html>Service temporarily unavailable</html>"


def validation_refuses_the_files(api, monkeypatch):
    # A bug in the builder: every probability comes out as 1.
    monkeypatch.setattr(snapshot, "published", lambda probability: 1.0)


def the_write_fails(api, monkeypatch):
    def no_space_left(source, destination):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(store.os, "replace", no_space_left)


def the_second_sport_is_unknown_to_the_provider(api, monkeypatch):
    del api.events[OTHER]  # the fake server answers 404 for a sport it does not have


@dataclass(frozen=True)
class Ending:
    """One way a run can end, and what a day of it may cost."""

    arrange: object
    status: int  # the exit status of a run that asks
    per_slot: dict  # sport -> requests for one slot
    per_day: dict  # sport -> requests for the day
    recorded: bool = True  # False: what a run writes is gone before the next run starts


ONCE, THREE_TIMES = {NBA: 1, OTHER: 1}, {NBA: 3, OTHER: 3}
SIX, EIGHTEEN = {NBA: 6, OTHER: 6}, {NBA: 18, OTHER: 18}

ENDINGS = {
    "success": Ending(nothing_goes_wrong, 0, ONCE, SIX),
    "the provider answers 401": Ending(
        the_provider_answers(401, "INVALID_KEY"), 3, THREE_TIMES, EIGHTEEN
    ),
    "the provider answers 429": Ending(the_provider_answers(429), 3, THREE_TIMES, EIGHTEEN),
    "the provider answers 503": Ending(the_provider_answers(503), 4, THREE_TIMES, EIGHTEEN),
    "the provider never answers": Ending(the_provider_never_answers, 4, THREE_TIMES, EIGHTEEN),
    "a 200 that cannot be read": Ending(the_answer_cannot_be_read, 4, THREE_TIMES, EIGHTEEN),
    "validation refuses the files": Ending(validation_refuses_the_files, 2, THREE_TIMES, EIGHTEEN),
    "the write fails": Ending(the_write_fails, 1, THREE_TIMES, EIGHTEEN),
    # What a push that the remote refuses looks like to the next run, and a
    # run that is killed after its request: the files of this run are not there.
    "the files are written but never recorded": Ending(
        nothing_goes_wrong, 0, THREE_TIMES, EIGHTEEN, recorded=False
    ),
    "one sport fails and the other answers": Ending(
        the_second_sport_is_unknown_to_the_provider, 3, {NBA: 1, OTHER: 3}, {NBA: 6, OTHER: 18}
    ),
}

# A slot is asked for by the trigger at its start. While that brings nothing,
# the triggers 30 and 60 minutes later ask again, and no other.
ASKING = {
    1: [timedelta(minutes=0)],
    3: [timedelta(minutes=0), timedelta(minutes=30), timedelta(minutes=60)],
}


@pytest.fixture
def data_dir(tmp_path):
    return tmp_path / "data"


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(
        config,
        "SPORTS",
        (config.Sport(key=NBA, prefix="v1"), config.Sport(key=OTHER, prefix="v1-test")),
    )
    with FakeOddsApi() as fake:
        monkeypatch.setenv("ODDS_API_KEY", KEY)
        monkeypatch.setenv("ODDS_API_BASE_URL", fake.url)
        monkeypatch.delenv("GITHUB_OUTPUT", raising=False)
        yield fake


@pytest.fixture
def run_at(api, data_dir, capsys):
    """Runs the command as the workflow does, at the moment given, and returns its exit status."""

    def run_at(moment):
        status = main(["snapshot", "--all", "--data-dir", str(data_dir)], clock=lambda: moment)
        printed = capsys.readouterr()
        assert KEY not in printed.out + printed.err
        return status

    return run_at


def content_of(directory):
    """Every file under a directory with its content, or None when there is no directory."""
    if not directory.exists():
        return None
    return {
        path.relative_to(directory): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file()
    }


def put_back(directory, content):
    """Makes a directory hold exactly the files it held when content_of() looked at it."""
    shutil.rmtree(directory, ignore_errors=True)
    for path, data in (content or {}).items():
        (directory / path).parent.mkdir(parents=True, exist_ok=True)
        (directory / path).write_bytes(data)


def requests_by_slot(api, expected):
    """
    For each slot and sport, how long after the slot's start each request
    for it was sent. A request carries the time its run began, which is how
    it is put to its trigger. The server notes a request that is never
    answered when it arrives, which can be a moment after the command has
    given up on it, so the last ones are waited for.
    """
    deadline = stopwatch.monotonic() + 2
    while len(api.requests) < expected and stopwatch.monotonic() < deadline:
        stopwatch.sleep(0.01)
    asked = {}
    for received in list(api.requests):
        began = datetime.strptime(received.query["commenceTimeFrom"], "%Y-%m-%dT%H:%M:%SZ")
        began = began.replace(tzinfo=timezone.utc)
        slot_start, _ = schedule.current_and_next(began)
        asked.setdefault((schedule.slot_id(slot_start), received.sport), []).append(
            began - slot_start
        )
    return {key: sorted(offsets) for key, offsets in asked.items()}


@pytest.mark.parametrize("day", DAYS.values(), ids=DAYS.keys())
def test_the_walk_covers_every_trigger_of_the_day(day):
    triggers = triggers_of(day)

    assert len(triggers) == day.triggers
    assert all(
        later - earlier == timedelta(minutes=30) for earlier, later in itertools.pairwise(triggers)
    )
    assert {trigger.astimezone(schedule.ZONE).date() for trigger in triggers} == {day.date}
    # Each of the day's six slots starts on a trigger, and the triggers 30
    # and 60 minutes after it are triggers of the same day.
    starts = [trigger for trigger in triggers if since_slot_start(trigger) == timedelta(0)]
    assert [schedule.slot_id(start) for start in starts] == slots_of(day)
    assert all(start + timedelta(minutes=late) in triggers for start in starts for late in (30, 60))


@pytest.mark.parametrize("day", DAYS.values(), ids=DAYS.keys())
@pytest.mark.parametrize("ending", ENDINGS.values(), ids=ENDINGS.keys())
def test_requests_for_each_slot_and_for_the_day(ending, day, api, run_at, data_dir, monkeypatch):
    api.events = {NBA: games(day, NBA), OTHER: games(day, OTHER)}
    triggers, slots = triggers_of(day), slots_of(day)
    # The evening before went well: its last slot is recorded.
    assert run_at(triggers[0] - timedelta(hours=3)) == 0
    the_evening_before = content_of(data_dir)
    api.requests.clear()
    ending.arrange(api, monkeypatch)

    statuses = {}
    for trigger in triggers:
        before = content_of(data_dir)
        statuses[trigger] = run_at(trigger)
        if not ending.recorded:
            put_back(data_dir, before)

    asked = requests_by_slot(api, expected=sum(ending.per_day.values()))
    for sport in (NBA, OTHER):
        per_slot = [len(asked.get((slot, sport), [])) for slot in slots]
        assert per_slot == [ending.per_slot[sport]] * 6
        assert sum(per_slot) == ending.per_day[sport]
    # Which triggers asked, and that nothing was asked for any other slot.
    assert asked == {
        (slot, sport): ASKING[ending.per_slot[sport]] for slot in slots for sport in (NBA, OTHER)
    }
    assert len(api.requests) == sum(ending.per_day.values())

    # A run that asks and fails ends with the status of the failure. A run
    # that comes too late for the slot makes no request and ends with 0.
    asking = ASKING[max(ending.per_slot.values())]
    assert statuses == {
        trigger: ending.status if since_slot_start(trigger) in asking else 0 for trigger in triggers
    }

    if ending.status == 0 and ending.recorded:
        # Success: the day's last slot is on record for both sports.
        for prefix in ("v1", "v1-test"):
            assert f'"last_slot": "{slots[-1]}"' in (data_dir / prefix / "state.json").read_text()
    elif ending.per_slot == THREE_TIMES:
        # Nothing was recorded all day, and what was there is as it was.
        assert content_of(data_dir) == the_evening_before
    else:
        # The sport that answers is recorded, and the other one is as it was.
        assert f'"last_slot": "{slots[-1]}"' in (data_dir / "v1/state.json").read_text()
        untouched = {
            path: data for path, data in content_of(data_dir).items() if path.parts[0] == "v1-test"
        }
        assert untouched == {
            path: data for path, data in the_evening_before.items() if path.parts[0] == "v1-test"
        }
