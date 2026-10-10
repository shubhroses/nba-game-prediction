"""
The bound on requests, as a test.

Every request to The Odds API can cost credits, and the free plan has 500 a
month. The plan is one odds request for each sport in each of the six slots
of a day, at one credit, and one scores request for each sport a day, in the
day's first slot, at two. What must not happen is that a failure which does
not pass is paid for at every trigger of the workflow, 48 times a day.

These tests walk every trigger of one New York calendar day through the real
command, against the fake server in tests/fake_odds_api.py, with the clock
set to the moment of the trigger. They do that once for each way a run can
end, and count the requests the fake server received for each slot and each
sport. A request is counted whether or not the provider would charge for it.

Two sports are configured, so that "for each sport" is tested. Every game,
every price and every score is invented, and the key is a dummy.
"""

import errno
import itertools
import json
import re
import shutil
import time as stopwatch
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest

from fake_odds_api import FakeOddsApi, event, score_event
from pipeline import config, oddsapi, record, schedule, snapshot, store
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


def finished(day, sport):
    """A game that ended the evening before the day, so that every daily run of the day finds it."""
    start = (day.date - timedelta(days=1)).strftime("%Y-%m-%dT23:00:00Z")
    return [score_event("d" * 32, "Miami Heat", "Chicago Bulls", start, (112, 104), sport=sport)]


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
    # A bug in each builder: every probability comes out as 1, and the record
    # counts a win too many.
    monkeypatch.setattr(snapshot, "published", lambda probability: 1.0)
    build = record.build

    def build_with_a_win_too_many(lines, **options):
        built = build(lines, **options)
        built["market"]["wins"] += 1
        return built

    monkeypatch.setattr(record, "build", build_with_a_win_too_many)


def the_write_fails(api, monkeypatch):
    def no_space_left(source, destination):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(store.os, "replace", no_space_left)


def the_second_sport_is_unknown_to_the_provider(api, monkeypatch):
    del api.events[OTHER]  # the fake server answers 404 for a sport it does not have


def the_scores_are_not_answered(api, monkeypatch):
    api.scores_status = 503


def the_odds_are_not_answered(api, monkeypatch):
    api.status, api.scores_status = 503, 200


@dataclass(frozen=True)
class Ending:
    """One way a run can end, and what a day of it may cost."""

    arrange: object
    status: int  # the exit status of a run that asks and fails
    per_slot: dict  # sport -> odds requests for one slot
    per_day: dict  # sport -> odds requests for the day
    scores: dict  # sport -> scores requests for the day, all of them in its first slot
    recorded: bool = True  # False: what a run writes is gone before the next run starts


ONCE, THREE_TIMES = {NBA: 1, OTHER: 1}, {NBA: 3, OTHER: 3}
SIX, EIGHTEEN = {NBA: 6, OTHER: 6}, {NBA: 18, OTHER: 18}

ENDINGS = {
    "success": Ending(nothing_goes_wrong, 0, ONCE, SIX, ONCE),
    "the provider answers 401": Ending(
        the_provider_answers(401, "INVALID_KEY"), 3, THREE_TIMES, EIGHTEEN, THREE_TIMES
    ),
    "the provider answers 429": Ending(
        the_provider_answers(429), 3, THREE_TIMES, EIGHTEEN, THREE_TIMES
    ),
    "the provider answers 503": Ending(
        the_provider_answers(503), 4, THREE_TIMES, EIGHTEEN, THREE_TIMES
    ),
    "the provider never answers": Ending(
        the_provider_never_answers, 4, THREE_TIMES, EIGHTEEN, THREE_TIMES
    ),
    "a 200 that cannot be read": Ending(
        the_answer_cannot_be_read, 4, THREE_TIMES, EIGHTEEN, THREE_TIMES
    ),
    "validation refuses the files": Ending(
        validation_refuses_the_files, 2, THREE_TIMES, EIGHTEEN, THREE_TIMES
    ),
    "the write fails": Ending(the_write_fails, 1, THREE_TIMES, EIGHTEEN, THREE_TIMES),
    # What a push that the remote refuses looks like to the next run, and a
    # run that is killed after its request: the files of this run are not there.
    "the files are written but never recorded": Ending(
        nothing_goes_wrong, 0, THREE_TIMES, EIGHTEEN, THREE_TIMES, recorded=False
    ),
    "one sport fails and the other answers": Ending(
        the_second_sport_is_unknown_to_the_provider,
        3,
        {NBA: 1, OTHER: 3},
        {NBA: 6, OTHER: 18},
        {NBA: 1, OTHER: 3},
    ),
    # The two requests of a sport fail apart from each other. The step that
    # answers is recorded at the first trigger and not asked for again.
    "the scores fail and the odds answer": Ending(
        the_scores_are_not_answered, 4, ONCE, SIX, THREE_TIMES
    ),
    "the odds fail and the scores answer": Ending(
        the_odds_are_not_answered, 4, THREE_TIMES, EIGHTEEN, ONCE
    ),
}

# A slot is asked for by the trigger at its start. While that brings nothing,
# the triggers 30 and 60 minutes later ask again, and no other. The same goes
# for the scores, which belong to the day's first slot.
ASKING = {
    1: [timedelta(minutes=0)],
    3: [timedelta(minutes=0), timedelta(minutes=30), timedelta(minutes=60)],
}
# What the provider's guide charges: one credit for these odds, two for scores of past days.
ODDS_CREDITS, SCORES_CREDITS = 1, 2


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
def scores_asked():
    """One entry for each scores request the command set out to send: its run's start, the sport."""
    return []


@pytest.fixture
def run_at(api, data_dir, capsys, monkeypatch, scores_asked):
    """Runs the command as the workflow does, at the moment given, and returns its exit status."""
    fetch_scores = oddsapi.fetch_scores

    def run_at(moment):
        # An odds request carries the time its run began. A scores request
        # does not, so each one is noted here on its way out.
        def noting(sport, api_key):
            scores_asked.append((moment, sport))
            return fetch_scores(sport, api_key)

        monkeypatch.setattr(oddsapi, "fetch_scores", noting)
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


def received(api, endpoint, expected):
    """
    The requests of one kind that the fake server received. The server notes
    a request that is never answered when it arrives, which can be a moment
    after the command has given up on it, so the last ones are waited for.
    """
    deadline = stopwatch.monotonic() + 2
    while stopwatch.monotonic() < deadline:
        found = [request for request in list(api.requests) if request.endpoint == endpoint]
        if len(found) >= expected:
            break
        stopwatch.sleep(0.01)
    return found


def by_slot(asked):
    """
    For each slot and sport, how long after the slot's start each request
    for it was sent. `asked` lists the moment the run of each request began,
    and the sport.
    """
    offsets = {}
    for began, sport in asked:
        slot_start, _ = schedule.current_and_next(began)
        offsets.setdefault((schedule.slot_id(slot_start), sport), []).append(began - slot_start)
    return {key: sorted(found) for key, found in offsets.items()}


def odds_by_slot(api, expected):
    """The odds requests by slot and sport. A request carries the time its run began."""
    asked = []
    for request in received(api, "odds", expected):
        began = datetime.strptime(request.query["commenceTimeFrom"], "%Y-%m-%dT%H:%M:%SZ")
        asked.append((began.replace(tzinfo=timezone.utc), request.sport))
    return by_slot(asked)


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
def test_requests_for_each_slot_and_for_the_day(
    ending, day, api, run_at, scores_asked, data_dir, monkeypatch
):
    api.events = {NBA: games(day, NBA), OTHER: games(day, OTHER)}
    api.scores = {NBA: finished(day, NBA), OTHER: finished(day, OTHER)}
    triggers, slots = triggers_of(day), slots_of(day)
    # The evening before went well: its last slot is recorded. It is not the
    # slot for the daily work, so no scores were asked for.
    assert run_at(triggers[0] - timedelta(hours=3)) == 0
    assert scores_asked == []
    the_evening_before = content_of(data_dir)
    api.requests.clear()
    ending.arrange(api, monkeypatch)

    statuses = {}
    for trigger in triggers:
        before = content_of(data_dir)
        statuses[trigger] = run_at(trigger)
        if not ending.recorded:
            put_back(data_dir, before)

    asked = odds_by_slot(api, expected=sum(ending.per_day.values()))
    for sport in (NBA, OTHER):
        per_slot = [len(asked.get((slot, sport), [])) for slot in slots]
        assert per_slot == [ending.per_slot[sport]] * 6
        assert sum(per_slot) == ending.per_day[sport]
    # Which triggers asked, and that nothing was asked for any other slot.
    assert asked == {
        (slot, sport): ASKING[ending.per_slot[sport]] for slot in slots for sport in (NBA, OTHER)
    }

    # The scores are asked for in the day's first slot and in no other, by
    # the triggers that may ask for that slot: once when it works, and three
    # times a day for each sport when it does not.
    assert by_slot(scores_asked) == {
        (slots[0], sport): ASKING[ending.scores[sport]] for sport in (NBA, OTHER)
    }
    for_scores = received(api, "scores", expected=sum(ending.scores.values()))
    assert Counter(request.sport for request in for_scores) == ending.scores
    assert all(SCORES_CREDITS * count <= 6 for count in ending.scores.values())
    assert len(api.requests) == sum(ending.per_day.values()) + sum(ending.scores.values())

    # A run that asks and fails ends with the status of the failure. A run
    # that comes too late for what is not recorded makes no request and ends
    # with 0. The odds are asked for in every slot and the scores in the first.
    def asks_in_vain(trigger):
        slot_start, _ = schedule.current_and_next(trigger)
        in_time = trigger - slot_start in ASKING[3]
        in_the_first_slot = schedule.slot_id(slot_start) == slots[0]
        odds_fail, scores_fail = 3 in ending.per_slot.values(), 3 in ending.scores.values()
        return in_time and (odds_fail or (scores_fail and in_the_first_slot))

    assert statuses == {
        trigger: ending.status if asks_in_vain(trigger) else 0 for trigger in triggers
    }

    the_slot_before = schedule.slot_id(triggers[0] - timedelta(hours=3))
    for sport, prefix in ((NBA, "v1"), (OTHER, "v1-test")):
        of_the_sport = {
            path: data for path, data in content_of(data_dir).items() if path.parts[0] == prefix
        }
        snapshots_taken = ending.recorded and ending.per_slot[sport] == 1
        daily_work_done = ending.recorded and ending.scores[sport] == 1
        if not snapshots_taken and not daily_work_done:
            # Nothing of the sport was recorded all day, and what was there is as it was.
            assert of_the_sport == {
                path: data for path, data in the_evening_before.items() if path.parts[0] == prefix
            }
            continue
        state = json.loads(of_the_sport[Path(prefix, "state.json")])
        # The day's last slot is on record, or still the one of the evening before.
        assert state["last_slot"] == (slots[-1] if snapshots_taken else the_slot_before)
        # The daily work is noted for the day's first slot with its one result, or not at all.
        if daily_work_done:
            assert state["results"]["last_slot"] == slots[0]
            assert [line["id"] for line in state["results"]["recent"]] == ["d" * 32]
            assert Path(prefix, "record.json") in of_the_sport
        else:
            assert state["results"] is None
            assert not [path for path in of_the_sport if "results" in path.parts]


def test_a_day_as_planned_costs_8_credits_for_each_sport(api, run_at):
    # The fake server charges what the provider's guide says: 1 credit for an
    # odds request and 2 for a scores request that asks for past days.
    day = DAYS["an ordinary day"]
    api.events = {NBA: games(day, NBA), OTHER: games(day, OTHER)}
    api.scores = {NBA: finished(day, NBA), OTHER: finished(day, OTHER)}

    for trigger in triggers_of(day):
        assert run_at(trigger) == 0

    assert Counter((request.sport, request.endpoint) for request in api.requests) == {
        (NBA, "odds"): 6,
        (NBA, "scores"): 1,
        (OTHER, "odds"): 6,
        (OTHER, "scores"): 1,
    }
    for_one_sport = 6 * ODDS_CREDITS + 1 * SCORES_CREDITS
    assert for_one_sport == 8
    assert (api.used, api.remaining) == (2 * for_one_sport, 500 - 2 * for_one_sport)
    # For one sport that is 248 of the 500 credits in a month of 31 days.
    assert 31 * for_one_sport == 248
