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
from pipeline import forecasts, snapshot, validate
from pipeline.model import season

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
                    "books": [],  # a single sportsbook is not named
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
        # No daily run has recorded a result yet.
        "record": None,
        "recent_results": [],
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
        "results": None,
    }


def test_history_has_one_line_for_each_game_that_has_a_line():
    built = build([UNPRICED_GAME, LATE_GAME, EARLY_GAME])

    assert built.history == [
        {"id": EARLY, "at": AT, "p_home": 0.6214, "lo": 0.6, "hi": 0.6429, "n": 2},
        {"id": LATE, "at": AT, "p_home": 0.5, "lo": 0.5, "hi": 0.5, "n": 1},
    ]
    assert [list(line) for line in built.history] == [["id", "at", "p_home", "lo", "hi", "n"]] * 2


def test_a_single_sportsbook_is_counted_but_not_named():
    # With one sportsbook the line is that sportsbook's own figure. It is
    # published, but nothing in the files says whose it is.
    alone = event(
        EARLY,
        "Boston Celtics",
        "New York Knicks",
        "2026-10-20T23:00:00Z",
        {"Lone Book": (1.50, 2.70)},
    )

    built = build([alone])

    assert built.slate["games"][0]["line"] == {
        "p_home": 0.6429,
        "lo": 0.6429,
        "hi": 0.6429,
        "n": 1,
        "books": [],
        "captured_at": AT,
    }
    assert built.history == [
        {"id": EARLY, "at": AT, "p_home": 0.6429, "lo": 0.6429, "hi": 0.6429, "n": 1}
    ]
    assert "Lone Book" not in json.dumps([built.slate, built.state, built.history])
    assert validate.slate_problems(built.slate) == []


def test_two_sportsbooks_or_more_are_named_when_they_differ():
    for titles in (["Book A", "Book B"], ["Book A", "Book B", "Book C"]):
        # Each sportsbook quotes the home team a little differently.
        prices = {
            title: (1.50 + number / 100, 2.70) for number, title in enumerate(reversed(titles))
        }
        quoted = event(EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", prices)

        line = build([quoted]).slate["games"][0]["line"]

        assert line["lo"] < line["hi"]
        assert (line["n"], line["books"]) == (len(titles), titles)


@pytest.mark.parametrize(
    "prices",
    [
        {"Book A": (1.50, 2.70), "Book B": (1.50, 2.70)},
        {"Book A": (1.50, 2.70), "Book B": (1.50, 2.70), "Book C": (1.50, 2.70)},
        # 0.64286 and 0.64287: different shares that are written as the same number.
        {"Book A": (1.50, 2.70), "Book B": (1.4999, 2.70)},
    ],
)
def test_sportsbooks_that_all_give_the_same_figure_are_counted_but_not_named(prices):
    # When the lowest and the highest figure are the same number, it is the
    # figure of every sportsbook behind the line. Their names next to it
    # would say what each of them gave.
    agreed = event(EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", prices)

    built = build([agreed])

    assert built.slate["games"][0]["line"] == {
        "p_home": 0.6429,
        "lo": 0.6429,
        "hi": 0.6429,
        "n": len(prices),
        "books": [],
        "captured_at": AT,
    }
    assert "Book" not in json.dumps([built.slate, built.state, built.history])
    assert validate.slate_problems(built.slate) == []


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


def test_a_fraction_of_a_second_in_a_start_time_is_dropped_before_it_is_compared():
    # NOW is 22:10:41. The files carry whole seconds, so the first game is
    # written as starting at 22:10:41, which is not after the snapshot.
    at_once = event(EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T22:10:41.900Z", {})
    a_second_on = event(
        LATE, "Los Angeles Lakers", "Golden State Warriors", "2026-10-20T22:10:42.900Z", {}
    )

    built = build([at_once, a_second_on])

    assert [(game["id"], game["commence_time"]) for game in built.slate["games"]] == [
        (LATE, "2026-10-20T22:10:42Z")
    ]
    assert validate.slate_problems(built.slate) == []


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


def test_a_value_nested_too_deep_to_print_is_described_and_the_rest_is_kept():
    # json.dumps gives up on a value like this one with RecursionError. Most
    # such bodies never get past json.loads, but on Python 3.14 the parser
    # accepts a body that is nested a little deeper than json.dumps can write
    # out again, so the builder can be handed one.
    deep = []
    for _ in range(200_000):
        deep = [deep]
    without_an_id = event("c" * 32, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {})
    without_an_id["id"] = deep

    built = build([deep, without_an_id, LATE_GAME])

    assert built.dropped == [
        "an entry that is not an event: a list nested too deep to show",
        "an event without a usable id: a list nested too deep to show",
    ]
    assert [game["id"] for game in built.slate["games"]] == [LATE]


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
    moved = event(
        EARLY, "Boston Celtics", "New York Knicks", "2026-10-20T23:00:00Z", {"Book A": (1.40, 3.00)}
    )

    # One snapshot gives a game a new line. Another is so late that both games leave the state.
    updated = build([moved], previous=previous, now=NOW + timedelta(minutes=30))
    emptied = build([], previous=previous, now=NOW + timedelta(days=20))

    assert updated.state["games"][EARLY]["latest"] != untouched["games"][EARLY]["latest"]
    assert emptied.state["games"] == {}
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


def result_line(game_id, start, verdict="favorite_won"):
    """A result as the daily run writes it, for a game that the home team won 112 to 104."""
    lines = {"favorite_won": 0.532, "upset": 0.468, "toss_up": 0.505, "not_graded": None}
    line = lines[verdict] and {
        "p_home": lines[verdict],
        "lo": lines[verdict],
        "hi": lines[verdict],
        "n": 1,
        "at": "2026-10-01T22:10:41Z",
    }
    return {
        "id": game_id,
        "commence_time": start,
        "home": "BOS",
        "away": "NYK",
        "home_pts": 112,
        "away_pts": 104,
        "recorded_at": "2026-10-20T09:10:07Z",
        "market": line,
        "market_verdict": verdict,
    }


def noted_by_the_daily_run(recent):
    """A state in which the daily run of this morning has noted its work."""
    state = build([EARLY_GAME]).state
    state["results"] = {
        "last_slot": "2026-10-20T05:10-04:00",
        "last_run_at": "2026-10-20T09:10:07Z",
        "record": {"market": {"wins": 41, "losses": 19}},
        "recent": recent,
    }
    return state


def test_what_the_daily_run_noted_is_carried_over_and_shown_on_the_board():
    yesterday = result_line("1" * 32, "2026-10-19T23:00:00Z")
    the_day_before = result_line("2" * 32, "2026-10-18T23:00:00Z", "upset")
    previous = noted_by_the_daily_run([the_day_before, yesterday])

    built = build([EARLY_GAME], previous=previous)

    assert built.state["results"] == previous["results"]
    assert built.slate["record"] == {"market": {"wins": 41, "losses": 19}}
    assert built.slate["recent_results"] == [the_day_before, yesterday]
    assert validate.slate_problems(built.slate) == []
    assert validate.state_problems(built.state) == []


def test_a_result_leaves_the_board_eight_days_after_the_start_of_its_game():
    # NOW is 22:10:41 on 20 October. Eight days before it is 22:10:41 on 12 October.
    eight_days_old = result_line("1" * 32, "2026-10-12T22:10:41Z")
    one_second_short = result_line("2" * 32, "2026-10-12T22:10:42Z")
    previous = noted_by_the_daily_run([eight_days_old, one_second_short])

    built = build([], previous=previous)

    assert built.slate["recent_results"] == [one_second_short]
    assert built.state["results"]["recent"] == [one_second_short]
    # The record is of every game, not of the recent ones.
    assert built.slate["record"] == {"market": {"wins": 41, "losses": 19}}
    assert built.state["results"]["last_slot"] == "2026-10-20T05:10-04:00"


def test_the_recent_results_are_listed_in_order_of_start_and_then_of_id():
    starts = [("3" * 32, "2026-10-19T23:00:00Z"), ("2" * 32, "2026-10-18T23:00:00Z")]
    starts += [("1" * 32, "2026-10-19T23:00:00Z")]
    previous = noted_by_the_daily_run([result_line(game_id, start) for game_id, start in starts])

    listed = build([], previous=previous).slate["recent_results"]

    assert [line["id"] for line in listed] == ["2" * 32, "1" * 32, "3" * 32]


def test_a_state_from_before_there_was_any_daily_work_is_continued_from():
    previous = build([EARLY_GAME]).state
    del previous["results"]

    built = build([EARLY_GAME], previous=previous, now=NOW + timedelta(minutes=30))

    assert built.state["results"] is None
    assert (built.slate["record"], built.slate["recent_results"]) == (None, [])
    assert built.state["games"][EARLY]["first"] == {"p_home": 0.6214, "at": AT}


def test_the_board_and_the_state_do_not_share_what_they_carry():
    previous = noted_by_the_daily_run([result_line("1" * 32, "2026-10-19T23:00:00Z")])
    untouched = copy.deepcopy(previous)

    built = build([], previous=previous)
    built.slate["record"]["market"]["wins"] = 0
    built.slate["recent_results"][0]["market"]["p_home"] = 0.9
    built.state["results"]["recent"][0]["home_pts"] = 0

    assert built.state["results"]["record"] == {"market": {"wins": 41, "losses": 19}}
    assert built.state["results"]["recent"][0]["market"]["p_home"] == 0.532
    assert previous == untouched


# From here on: a sport that the two models forecast. The daily run of
# Tuesday morning built the models and froze the forecasts for Tuesday's two
# games, and noted both in the state.
OPENING = season.load("2026_27")
TUESDAY_MORNING = datetime(2026, 10, 20, 9, 10, 7, tzinfo=timezone.utc)


def forecast_build(events, previous=None, now=NOW):
    return snapshot.build(
        events,
        previous,
        now,
        sport="basketball_nba",
        slot=SLOT,
        next_due=NEXT_DUE,
        credits=CREDITS,
        season=OPENING,
    )


def after_the_daily_run(events=(EARLY_GAME, LATE_GAME, UNPRICED_GAME)):
    """The state after Monday night's snapshot and Tuesday morning's daily run."""
    monday_night = datetime(2026, 10, 20, 1, 10, 30, tzinfo=timezone.utc)
    listed = forecast_build(list(events), now=monday_night).state
    return forecasts.build(
        [],
        listed,
        TUESDAY_MORNING,
        sport="basketball_nba",
        season=OPENING,
        day=TUESDAY_MORNING.date(),
        frozen=None,
        commit=None,
    ).state


def by_id(built):
    return {game["id"]: game for game in built.slate["games"]}


def test_a_game_of_the_day_carries_the_frozen_forecasts_of_both_models():
    previous = after_the_daily_run()
    frozen = {game["id"]: game for game in previous["models"]["predictions"]["games"]}
    assert sorted(frozen) == [EARLY, LATE]

    board = by_id(forecast_build([EARLY_GAME, LATE_GAME, UNPRICED_GAME], previous))

    for game_id in (EARLY, LATE):
        assert board[game_id]["elo"] == {"p_home": frozen[game_id]["elo"]["p_home"]}
        assert board[game_id]["points_rest"] == frozen[game_id]["points_rest"]
    # Boston, 1607, hosts New York, 1720: 0.3965. The Lakers, 1568, host
    # Golden State, 1451: 10 ^ (-157 / 400) = 0.405042, and 1 / 1.405042 = 0.7117.
    assert (board[EARLY]["elo"], board[LATE]["elo"]) == ({"p_home": 0.3965}, {"p_home": 0.7117})
    assert list(board[EARLY]["points_rest"]) == [
        "p_home",
        "margin",
        "rating_edge",
        "home_court",
        "rest_edge",
    ]


def test_a_game_of_a_later_day_carries_what_elos_ratings_make_of_it_now_and_nothing_else():
    board = by_id(forecast_build([EARLY_GAME, UNPRICED_GAME], after_the_daily_run()))

    # Miami, 1520, hosts Chicago, 1385, on Wednesday:
    # 10 ^ (-(1520 + 40 - 1385) / 400) = 0.365174, and 1 / 1.365174 = 0.7325.
    assert board[UNPRICED]["elo"] == {"p_home": 0.7325}
    assert board[UNPRICED]["points_rest"] is None


def test_the_frozen_forecast_is_shown_and_not_what_the_ratings_would_make_of_the_game_now():
    # The ratings that are noted have moved since the forecasts were frozen,
    # as they have when the daily work is done a second time that morning.
    previous = after_the_daily_run()
    previous["models"]["elo"].update(BOS=1619, NYK=1708, MIA=1530)

    board = by_id(forecast_build([EARLY_GAME, UNPRICED_GAME], previous))

    assert board[EARLY]["elo"] == {"p_home": 0.3965}
    # A game that has no frozen forecast follows the ratings.
    assert board[UNPRICED]["elo"] == {
        "p_home": round(1 / (1 + 10 ** (-(1530 + 40 - 1385) / 400)), 4)
    }


def test_before_the_models_have_been_built_the_board_carries_neither():
    built = forecast_build([EARLY_GAME, UNPRICED_GAME])

    assert [(game["elo"], game["points_rest"]) for game in built.slate["games"]] == [
        (None, None),
        (None, None),
    ]
    assert built.slate["models"] is None
    assert built.state["models"] is None
    assert validate.problems(built.slate, built.state, "", "", forecast=True) == []
    # The same from a state that was written before the models were added.
    old = build([EARLY_GAME]).state
    assert "models" not in old
    assert forecast_build([EARLY_GAME], old).slate["games"][0]["elo"] is None


def test_the_board_says_how_far_the_models_reach_and_which_days_forecasts_it_carries():
    built = forecast_build([EARLY_GAME], after_the_daily_run())

    assert built.slate["models"] == {
        "results_through": None,
        "status": "ok",
        "predictions_day": "2026-10-20",
    }
    # On a day without a game to forecast there is no such day.
    no_game = forecast_build([UNPRICED_GAME], after_the_daily_run([UNPRICED_GAME]))
    assert no_game.slate["models"]["predictions_day"] is None
    assert no_game.slate["games"][0]["elo"] == {"p_home": 0.7325}


def test_what_the_daily_run_noted_of_the_models_is_carried_over_as_it_is():
    previous = after_the_daily_run()
    untouched = copy.deepcopy(previous)

    built = forecast_build([EARLY_GAME, LATE_GAME], previous)
    built.slate["games"][0]["points_rest"]["margin"] = 99.0
    built.state["models"]["elo"]["BOS"] = 0

    assert previous == untouched
    assert forecast_build([EARLY_GAME], previous).state["models"] == untouched["models"]


def test_a_game_that_was_put_off_to_another_day_does_not_keep_its_frozen_forecast():
    previous = after_the_daily_run()
    put_off = dict(EARLY_GAME, commence_time="2026-10-21T23:00:00Z")

    board = by_id(forecast_build([put_off], previous))

    # The forecast of Tuesday morning knew nothing of who plays on Tuesday.
    # Elo's chance happens to be the same, because no rating has moved.
    assert board[EARLY]["points_rest"] is None
    assert board[EARLY]["elo"] == {"p_home": 0.3965}


def test_a_frozen_forecast_for_other_teams_is_not_shown():
    previous = after_the_daily_run()
    previous["models"]["predictions"]["games"][0].update(home="NYK", away="BOS")
    previous["models"]["predictions"]["games"][0]["elo"]["p_home"] = 0.9

    board = by_id(forecast_build([EARLY_GAME], previous))

    assert board[EARLY] | {"line": None, "open": None} == {
        "id": EARLY,
        "commence_time": "2026-10-20T23:00:00Z",
        "home": "BOS",
        "away": "NYK",
        "line": None,
        "open": None,
        "elo": {"p_home": 0.3965},
        "points_rest": None,
    }


def test_elos_chance_on_the_board_has_no_home_court_on_a_neutral_floor():
    # Indiana and Denver in Mexico City on 7 November, seen on the board the evening before.
    mexico_city = event("9" * 32, "Indiana Pacers", "Denver Nuggets", "2026-11-07T22:00:00Z", {})
    evening = datetime(2026, 11, 6, 23, 10, 30, tzinfo=timezone.utc)
    previous = after_the_daily_run([])

    (game,) = forecast_build([mexico_city], previous, now=evening).slate["games"]

    # 1 / (1 + 10 ^ ((1597 - 1379) / 400)) = 0.2219. With a home court of 40 it would be 0.2641.
    assert game["elo"] == {"p_home": 0.2219}


def test_on_a_day_with_elo_alone_the_board_carries_elos_frozen_forecast_and_no_other():
    previous = after_the_daily_run()
    noted = previous["models"]
    noted["status"] = noted["predictions"]["status"] = "degraded"
    noted["predictions"]["reasons"] = ["BOS has 2 results on 2026-10-19"]
    for game in noted["predictions"]["games"]:
        game["points_rest"] = None

    built = forecast_build([EARLY_GAME, UNPRICED_GAME], previous)

    assert by_id(built)[EARLY]["elo"] == {"p_home": 0.3965}
    assert by_id(built)[EARLY]["points_rest"] is None
    assert built.slate["models"]["status"] == "degraded"
    assert validate.problems(built.slate, built.state, "", "", forecast=True) == []


def test_the_board_of_a_forecast_sport_passes_the_checks():
    built = forecast_build([EARLY_GAME, LATE_GAME, UNPRICED_GAME], after_the_daily_run())

    assert validate.problems(built.slate, built.state, "", "", forecast=True) == []


def test_a_sport_that_is_not_forecast_carries_nothing_of_the_models():
    # Even from a state that has them noted.
    built = build([EARLY_GAME, UNPRICED_GAME], after_the_daily_run())

    assert "models" not in built.slate and "models" not in built.state
    assert all("elo" not in game and "points_rest" not in game for game in built.slate["games"])
