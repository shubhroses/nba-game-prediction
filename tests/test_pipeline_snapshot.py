"""
Tests for pipeline/snapshot.py: what a response becomes, and the rules the
state follows from one snapshot to the next.

Every price here is invented.
"""

import copy
import json
from datetime import datetime, timedelta, timezone

import pytest

from fake_odds_api import event
from pipeline import snapshot

SLOT, NEXT_DUE = "2026-10-20T18:10-04:00", "2026-10-20T21:10-04:00"
NOW = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
AT = "2026-10-20T22:10:41Z"
CREDITS = {"remaining": 437, "used": 63, "last": 1}

EARLY, LATE, UNPRICED = "e" * 32, "f" * 32, "a" * 32

# Home shares: Book A 2.70 / 4.20 = 0.6429, Book B 2.40 / 4.00 = 0.6000, median 0.6214.
EARLY_GAME = event(
    EARLY,
    "Boston Celtics",
    "New York Knicks",
    "2026-10-20T23:00:00Z",
    {"Book B": (1.60, 2.40), "Book A": (1.50, 2.70)},
)
LATE_GAME = event(
    LATE,
    "Los Angeles Lakers",
    "Golden State Warriors",
    "2026-10-21T02:00:00Z",
    {"Book A": (1.91, 1.91)},
)
UNPRICED_GAME = event(UNPRICED, "Miami Heat", "Chicago Bulls", "2026-10-21T23:30:00Z", {})


def build(events, previous=None, now=NOW, slot=SLOT):
    return snapshot.build(
        events,
        previous,
        now,
        sport="basketball_nba",
        slot=slot,
        next_due=NEXT_DUE,
        credits=CREDITS,
    )


def test_the_board_lists_the_upcoming_games_in_order_of_start():
    built = build([UNPRICED_GAME, LATE_GAME, EARLY_GAME])

    assert built.slate == {
        "schema": 1,
        "sport": "basketball_nba",
        "generated_at": AT,
        "slot": SLOT,
        "next_due": NEXT_DUE,
        "games": [
            {
                "id": EARLY,
                "commence_time": "2026-10-20T23:00:00Z",
                "home": "BOS",
                "away": "NYK",
                "line": {
                    "p_home": 0.6214,
                    "lo": 0.6,
                    "hi": 0.6429,
                    "n": 2,
                    "books": ["Book A", "Book B"],
                    "captured_at": AT,
                },
                "open": {"p_home": 0.6214, "at": AT},
            },
            {
                "id": LATE,
                "commence_time": "2026-10-21T02:00:00Z",
                "home": "LAL",
                "away": "GSW",
                "line": {
                    "p_home": 0.5,
                    "lo": 0.5,
                    "hi": 0.5,
                    "n": 1,
                    "books": ["Book A"],
                    "captured_at": AT,
                },
                "open": {"p_home": 0.5, "at": AT},
            },
            {
                "id": UNPRICED,
                "commence_time": "2026-10-21T23:30:00Z",
                "home": "MIA",
                "away": "CHI",
                "line": None,
                "open": None,
            },
        ],
    }
    assert built.dropped == []


def test_the_state_records_the_run_and_every_game():
    built = build([UNPRICED_GAME, LATE_GAME, EARLY_GAME])

    assert built.state == {
        "schema": 1,
        "last_slot": SLOT,
        "last_run_at": AT,
        "credits": {"remaining": 437, "used": 63, "last": 1},
        "games": {
            EARLY: {
                "commence_time": "2026-10-20T23:00:00Z",
                "home": "BOS",
                "away": "NYK",
                "first": {"p_home": 0.6214, "at": AT},
                "latest": {"p_home": 0.6214, "lo": 0.6, "hi": 0.6429, "n": 2, "at": AT},
            },
            LATE: {
                "commence_time": "2026-10-21T02:00:00Z",
                "home": "LAL",
                "away": "GSW",
                "first": {"p_home": 0.5, "at": AT},
                "latest": {"p_home": 0.5, "lo": 0.5, "hi": 0.5, "n": 1, "at": AT},
            },
            UNPRICED: {
                "commence_time": "2026-10-21T23:30:00Z",
                "home": "MIA",
                "away": "CHI",
                "first": None,
                "latest": None,
            },
        },
    }


def test_history_has_one_line_for_each_game_that_has_a_line():
    built = build([UNPRICED_GAME, LATE_GAME, EARLY_GAME])

    assert built.history == [
        {"id": EARLY, "at": AT, "p_home": 0.6214, "lo": 0.6, "hi": 0.6429, "n": 2},
        {"id": LATE, "at": AT, "p_home": 0.5, "lo": 0.5, "hi": 0.5, "n": 1},
    ]
    assert [list(line) for line in built.history] == [["id", "at", "p_home", "lo", "hi", "n"]] * 2


def test_only_derived_values_are_published():
    built = build([UNPRICED_GAME, LATE_GAME, EARLY_GAME])
    prices = {1.50, 2.70, 1.60, 2.40, 1.91}

    def numbers(value):
        if isinstance(value, dict):
            return [number for item in value.values() for number in numbers(item)]
        if isinstance(value, list):
            return [number for item in value for number in numbers(item)]
        return [value] if isinstance(value, float) else []

    published = numbers(built.slate) + numbers(built.state) + numbers(built.history)
    assert published
    assert all(0 < number < 1 for number in published)
    assert not prices.intersection(published)
    # Nor do the response's own field names appear anywhere.
    as_text = json.dumps([built.slate, built.state, built.history])
    for name in ("price", "outcomes", "bookmakers", "markets", "last_update"):
        assert name not in as_text


def test_the_opening_line_is_kept_while_the_latest_line_moves():
    first = build([EARLY_GAME])
    later = NOW + timedelta(minutes=30)
    moved = event(
        EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {"Book A": (1.40, 3.00)}
    )

    second = build([moved], previous=first.state, now=later)

    game = second.state["games"][EARLY]
    assert game["first"] == {"p_home": 0.6214, "at": AT}
    assert game["latest"] == {
        "p_home": 0.6818,
        "lo": 0.6818,
        "hi": 0.6818,
        "n": 1,
        "at": "2026-10-20T22:40:41Z",
    }
    assert second.slate["games"][0]["open"] == {"p_home": 0.6214, "at": AT}
    assert second.slate["games"][0]["line"]["p_home"] == 0.6818


def test_a_started_games_line_is_never_replaced():
    before = build([EARLY_GAME, LATE_GAME])
    half_time = datetime(2026, 10, 21, 0, 10, 5, tzinfo=timezone.utc)
    # The response still lists the game, now with in-play prices.
    in_play = event(
        EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {"Book A": (1.05, 11.0)}
    )

    after = build([in_play, LATE_GAME], previous=before.state, now=half_time)

    assert after.state["games"][EARLY] == before.state["games"][EARLY]
    assert [game["id"] for game in after.slate["games"]] == [LATE]
    assert [line["id"] for line in after.history] == [LATE]
    assert after.dropped == []


def test_a_game_that_starts_at_the_very_moment_of_the_snapshot_counts_as_started():
    tip_off = datetime(2026, 10, 20, 23, 0, 0, tzinfo=timezone.utc)

    assert build([EARLY_GAME], now=tip_off).slate["games"] == []
    assert len(build([EARLY_GAME], now=tip_off - timedelta(seconds=1)).slate["games"]) == 1


def test_a_snapshot_without_a_line_leaves_the_last_line_alone():
    before = build([EARLY_GAME])
    off_the_board = event(EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {})

    after = build([off_the_board], previous=before.state, now=NOW + timedelta(minutes=30))

    assert after.state["games"][EARLY] == before.state["games"][EARLY]
    assert after.slate["games"][0]["line"] is None
    assert after.slate["games"][0]["open"] == {"p_home": 0.6214, "at": AT}
    assert after.history == []


def test_a_game_gets_its_opening_line_when_a_sportsbook_first_quotes_it():
    before = build([UNPRICED_GAME])
    later = NOW + timedelta(hours=3)
    quoted = event(
        UNPRICED, "Miami Heat", "Chicago Bulls", "2026-10-21T23:30:00Z", {"Book A": (2.00, 2.00)}
    )

    after = build([quoted], previous=before.state, now=later)

    assert before.state["games"][UNPRICED]["first"] is None
    assert after.state["games"][UNPRICED]["first"] == {"p_home": 0.5, "at": "2026-10-21T01:10:41Z"}


def test_a_game_that_is_missing_from_a_response_stays_in_the_state():
    before = build([EARLY_GAME, LATE_GAME])

    after = build([LATE_GAME], previous=before.state, now=NOW + timedelta(minutes=30))

    assert after.state["games"][EARLY] == before.state["games"][EARLY]
    assert [game["id"] for game in after.slate["games"]] == [LATE]


def test_a_game_stays_in_the_state_until_14_days_after_its_start():
    before = build([EARLY_GAME])
    start = datetime(2026, 10, 20, 23, 0, 0, tzinfo=timezone.utc)

    one_second_short = build([], previous=before.state, now=start + timedelta(days=14, seconds=-1))
    fourteen_days = build([], previous=before.state, now=start + timedelta(days=14))

    assert one_second_short.state["games"][EARLY] == before.state["games"][EARLY]
    assert fourteen_days.state["games"] == {}


def test_a_new_start_time_replaces_the_old_one():
    before = build([EARLY_GAME])
    moved = event(
        EARLY, "Boston Celtics", "New York Knicks", "2026-10-22T23:00:00Z", {"Book A": (1.50, 2.70)}
    )

    after = build([moved], previous=before.state, now=NOW + timedelta(minutes=30))

    assert after.state["games"][EARLY]["commence_time"] == "2026-10-22T23:00:00Z"
    assert after.state["games"][EARLY]["first"] == {"p_home": 0.6214, "at": AT}


def test_a_start_time_with_an_offset_is_written_in_utc():
    in_new_york_time = event(
        EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T19:00:00-04:00", {}
    )

    assert build([in_new_york_time]).slate["games"][0]["commence_time"] == "2026-10-20T23:00:00Z"


def test_an_unknown_team_is_dropped_and_reported_and_the_rest_is_kept():
    exhibition = event(
        "b" * 32,
        "Toronto Raptors",
        "Example Visitors",
        "2026-10-20T23:30:00Z",
        {"Book A": (1.20, 4.60)},
    )

    built = build([exhibition, EARLY_GAME])

    assert [game["id"] for game in built.slate["games"]] == [EARLY]
    assert list(built.state["games"]) == [EARLY]
    assert [line["id"] for line in built.history] == [EARLY]
    assert built.dropped == [f'event {"b" * 32}: unknown team "Example Visitors"']


def test_a_started_game_with_an_unknown_team_is_ignored_not_reported():
    under_way = event("b" * 32, "Toronto Raptors", "Example Visitors", "2026-10-20T22:00:00Z", {})

    built = build([under_way, EARLY_GAME])

    assert built.dropped == []
    assert [game["id"] for game in built.slate["games"]] == [EARLY]


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"id": None}, "an event without a usable id: null"),
        ({"id": "../../etc/passwd"}, 'an event without a usable id: "../../etc/passwd"'),
        ({"commence_time": "tomorrow"}, f'event {"c" * 32}: no usable commence_time: "tomorrow"'),
        (
            {"commence_time": "2026-10-20T23:00:00"},
            f'event {"c" * 32}: no usable commence_time: "2026-10-20T23:00:00"',
        ),
        ({"home_team": None}, f'event {"c" * 32}: unknown team null'),
        ({"away_team": "Boston Celtics"}, f'event {"c" * 32}: BOS is on both sides'),
    ],
)
def test_an_event_that_cannot_be_used_is_dropped_and_reported(change, reason):
    broken = event("c" * 32, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {})
    broken.update(change)

    built = build([broken, LATE_GAME])

    assert built.dropped == [reason]
    assert [game["id"] for game in built.slate["games"]] == [LATE]


def test_entries_that_are_not_events_are_dropped_and_reported():
    built = build(["text", None, LATE_GAME])

    assert built.dropped == [
        'an entry that is not an event: "text"',
        "an entry that is not an event: null",
    ]
    assert [game["id"] for game in built.slate["games"]] == [LATE]


def test_text_from_the_response_is_reported_on_one_line():
    # A team name is the provider's text. In the job's log it must not be able
    # to start a new line, which is where GitHub Actions looks for commands.
    hostile = event(
        "d" * 32, "Boston Celtics", "x\n::error::made up" + "y" * 200, "2026-10-20T23:00:00Z", {}
    )

    (reason,) = build([hostile]).dropped

    assert "\n" not in reason
    assert reason.startswith(f'event {"d" * 32}: unknown team "x\\n::error::made up')
    assert len(reason) < 140


def test_an_event_listed_twice_is_recorded_once():
    again = event(
        EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {"Book A": (1.10, 7.00)}
    )

    built = build([EARLY_GAME, again])

    assert len(built.slate["games"]) == 1
    assert built.slate["games"][0]["line"]["p_home"] == 0.6214
    assert built.dropped == [f"event {EARLY}: listed twice, the second entry is ignored"]


def test_the_previous_state_is_not_changed():
    previous = build([EARLY_GAME, LATE_GAME]).state
    untouched = copy.deepcopy(previous)

    build([EARLY_GAME], previous=previous, now=NOW + timedelta(days=20))

    assert previous == untouched


def test_an_empty_response_gives_an_empty_board():
    built = build([])

    assert built.slate["games"] == []
    assert built.state["games"] == {}
    assert built.history == []


@pytest.mark.parametrize(
    ("probability", "written"),
    [
        (0.642857, 0.6429),
        (0.63149999, 0.6315),
        (0.5, 0.5),
        (0.99996, 0.9999),
        (1.0, 0.9999),
        (0.00004, 0.0001),
        (0.0, 0.0001),
    ],
)
def test_probabilities_are_written_with_four_decimals_and_never_as_0_or_1(probability, written):
    assert snapshot.published(probability) == written
