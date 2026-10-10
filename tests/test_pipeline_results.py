"""
Tests for pipeline/results.py: what a scores response becomes, and how each
game that is over is graded against the line that was stored for it.

Every game, price and score here is invented.
"""

import copy
from datetime import datetime, timedelta, timezone

import pytest

from fake_odds_api import event, score_event
from pipeline import results, snapshot, store, validate

# Tuesday 20 October 2026. The lines are taken at 18:10 in New York, the
# early game starts at 19:00 and the late one at 22:00, and the scores are
# asked for at 05:10 the next morning.
LINES_TAKEN = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
LINES_AT = "2026-10-20T22:10:41Z"
NOW = datetime(2026, 10, 21, 9, 10, 7, tzinfo=timezone.utc)
AT = "2026-10-21T09:10:07Z"
DAILY_SLOT = "2026-10-21T05:10-04:00"
CREDITS = {"remaining": 430, "used": 70, "last": 2}

EARLY, LATE = "e" * 32, "f" * 32
EARLY_START, LATE_START = "2026-10-20T23:00:00Z", "2026-10-21T02:00:00Z"
BOSTON, NEW_YORK = "Boston Celtics", "New York Knicks"
LAKERS, WARRIORS = "Los Angeles Lakers", "Golden State Warriors"


def prices_for(home_share):
    """
    Two decimal prices whose margin-free home share is the one given. The
    share is away / (home + away), and these add up to 8: 0.532 gives 3.744
    and 4.256.
    """
    return round(8 * (1 - home_share), 4), round(8 * home_share, 4)


def state_with(early=0.532, late=None):
    """The state after one snapshot in which each game has the home share given, or no line."""
    quoted = [
        event(EARLY, BOSTON, NEW_YORK, EARLY_START, {"Book A": prices_for(early)} if early else {}),
        event(LATE, LAKERS, WARRIORS, LATE_START, {"Book A": prices_for(late)} if late else {}),
    ]
    return snapshot.build(
        quoted,
        None,
        LINES_TAKEN,
        sport="basketball_nba",
        slot="2026-10-20T18:10-04:00",
        next_due="2026-10-20T21:10-04:00",
        credits={"remaining": 432, "used": 68, "last": 1},
    ).state


def build(scores, previous=None, recorded=(), now=NOW):
    return results.build(
        scores,
        previous,
        list(recorded),
        now,
        sport="basketball_nba",
        slot=DAILY_SLOT,
        credits=CREDITS,
    )


def early_game(points=(112, 104), start=EARLY_START, completed=True):
    return score_event(EARLY, BOSTON, NEW_YORK, start, points, completed)


def late_game(points=(99, 120), start=LATE_START, completed=True):
    return score_event(LATE, LAKERS, WARRIORS, start, points, completed)


def test_a_stored_home_share_of_0_532_and_a_112_to_104_home_win_is_a_favorite_that_won():
    built = build([early_game((112, 104))], state_with(early=0.532))

    assert built.lines == [
        {
            "id": EARLY,
            "commence_time": EARLY_START,
            "home": "BOS",
            "away": "NYK",
            "home_pts": 112,
            "away_pts": 104,
            "recorded_at": AT,
            "market": {"p_home": 0.532, "lo": 0.532, "hi": 0.532, "n": 1, "at": LINES_AT},
            "market_verdict": "favorite_won",
        }
    ]
    assert list(built.lines[0]) == validate.RESULT_FIELDS
    assert (built.dropped, built.refused) == ([], [])


def test_the_same_line_and_a_home_loss_is_an_upset():
    (line,) = build([early_game((104, 112))], state_with(early=0.532)).lines

    assert (line["home_pts"], line["away_pts"], line["market_verdict"]) == (104, 112, "upset")


def test_a_stored_home_share_of_0_505_is_a_toss_up():
    (line,) = build([early_game((112, 104))], state_with(early=0.505)).lines

    assert line["market"]["p_home"] == 0.505
    assert line["market_verdict"] == "toss_up"


def test_a_game_without_a_stored_line_is_not_graded():
    # The state knows the game and never had a line for it, or does not know
    # the game, or there is no state at all.
    for previous in (state_with(early=None), state_with(early=None) | {"games": {}}, None):
        built = build([early_game()], previous)

        (line,) = built.lines
        assert (line["market"], line["market_verdict"]) == (None, "not_graded")
        assert (line["home_pts"], line["away_pts"]) == (112, 104)
        assert built.refused == []


@pytest.mark.parametrize("start", ["2026-10-20T22:10:41Z", "2026-10-20T22:00:00Z"])
def test_a_line_captured_at_or_after_the_start_is_refused(start):
    # The line was taken at 22:10:41, when the odds gave 23:00:00 as the
    # start. The scores give a start that the line does not come before, so
    # it may be a price from during the game.
    built = build([early_game(start=start)], state_with(early=0.532))

    (line,) = built.lines
    assert (line["market"], line["market_verdict"]) == (None, "not_graded")
    assert line["commence_time"] == start
    assert built.refused == [
        f"event {EARLY}: its line was captured at {LINES_AT}, "
        f"which is not before the start at {start}"
    ]
    assert built.dropped == []


def test_a_line_captured_one_second_before_the_start_is_graded_against():
    built = build([early_game(start="2026-10-20T22:10:42Z")], state_with(early=0.532))

    assert built.lines[0]["market_verdict"] == "favorite_won"
    assert built.refused == []


def test_the_start_of_a_result_is_the_one_the_scores_give():
    # The provider moves a start to the moment the game went live. The odds
    # gave 23:00:00 and the scores give 23:10:38.
    (line,) = build([early_game(start="2026-10-20T23:10:38.400Z")], state_with()).lines

    assert line["commence_time"] == "2026-10-20T23:10:38Z"
    assert line["market_verdict"] == "favorite_won"


def test_a_line_for_other_teams_is_refused():
    # The same id, with home and away the other way round than when the line
    # was taken. The line is the home team's chance, and home is another team now.
    swapped = score_event(EARLY, NEW_YORK, BOSTON, EARLY_START, (112, 104))

    built = build([swapped], state_with(early=0.532))

    (line,) = built.lines
    assert (line["home"], line["away"]) == ("NYK", "BOS")
    assert (line["market"], line["market_verdict"]) == (None, "not_graded")
    assert built.refused == [
        f"event {EARLY}: its line is for NYK at BOS, and the game was played by BOS at NYK"
    ]


def test_only_a_game_that_is_marked_as_completed_is_recorded():
    in_play = late_game((55, 61), completed=False)
    to_come = score_event(
        "a" * 32, "Miami Heat", "Chicago Bulls", "2026-10-21T23:30:00Z", None, False
    )
    not_quite_true = early_game() | {"completed": "true"}

    built = build([in_play, to_come, not_quite_true], state_with())

    assert built.lines == []
    assert (built.dropped, built.refused) == ([], [])


@pytest.mark.parametrize(
    "scores",
    [
        None,
        [],
        "112-104",
        [{"name": BOSTON, "score": "112"}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": "104"}, {"name": "x"}],
        [{"name": BOSTON, "score": "112"}, {"name": "New York", "score": "104"}],
        [{"name": BOSTON, "score": "112"}, {"name": BOSTON, "score": "104"}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": None}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": ""}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": "104.0"}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": "-4"}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": -4}],
        [{"name": BOSTON, "score": "112"}, {"name": NEW_YORK, "score": True}],
        [{"name": BOSTON, "score": "112"}, "104"],
        [{"name": [BOSTON], "score": "112"}, {"name": NEW_YORK, "score": "104"}],
    ],
)
def test_a_completed_game_without_two_usable_scores_is_dropped_and_reported(scores):
    broken = early_game() | {"scores": scores}

    built = build([broken, late_game()], state_with())

    assert [line["id"] for line in built.lines] == [LATE]
    (reason,) = built.dropped
    assert reason.startswith(f"event {EARLY}: completed without two usable scores: ")


def test_a_completed_game_with_two_equal_scores_is_dropped_and_reported():
    built = build([early_game((104, 104)), late_game()], state_with())

    assert [line["id"] for line in built.lines] == [LATE]
    assert built.dropped == [f"event {EARLY}: completed with two equal scores of 104"]


def test_a_score_is_taken_as_text_or_as_a_number_and_from_either_place_in_the_list():
    away_first = early_game() | {
        "scores": [{"name": NEW_YORK, "score": 104}, {"name": BOSTON, "score": "112"}]
    }

    (line,) = build([away_first], state_with()).lines

    assert (line["home_pts"], line["away_pts"]) == (112, 104)


def test_a_completed_game_with_a_team_outside_the_30_is_dropped_and_reported():
    exhibition = score_event(
        "b" * 32, "Toronto Raptors", "Example Visitors", "2026-10-20T23:30:00Z", (110, 88)
    )

    built = build([exhibition, early_game()], state_with())

    assert [line["id"] for line in built.lines] == [EARLY]
    assert built.dropped == [f'event {"b" * 32}: unknown team "Example Visitors"']


def test_a_game_with_a_team_outside_the_30_that_is_not_over_is_passed_over_in_silence():
    exhibition = score_event(
        "b" * 32, "Toronto Raptors", "Example Visitors", "2026-10-21T23:30:00Z", None, False
    )

    assert build([exhibition], state_with()).dropped == []


def test_a_completed_game_whose_start_is_still_to_come_is_dropped_and_reported():
    # NOW is 09:10:07 on 21 October.
    built = build([early_game(start="2026-10-21T09:10:07Z"), late_game()], state_with())

    assert [line["id"] for line in built.lines] == [LATE]
    assert built.dropped == [
        f"event {EARLY}: completed, but its start at 2026-10-21T09:10:07Z is still to come"
    ]


def test_entries_that_cannot_be_read_are_dropped_and_reported_as_in_a_snapshot():
    without_a_start = early_game() | {"commence_time": "last night"}

    built = build(["text", {"id": None, "completed": True}, without_a_start, late_game()], None)

    assert [line["id"] for line in built.lines] == [LATE]
    assert built.dropped == [
        'an entry that is not an event: "text"',
        "an event without a usable id: null",
        f'event {EARLY}: no usable commence_time: "last night"',
    ]


def test_an_event_listed_twice_is_recorded_once():
    built = build([early_game((112, 104)), early_game((90, 80))], state_with())

    assert [(line["home_pts"], line["away_pts"]) for line in built.lines] == [(112, 104)]
    assert built.dropped == [f"event {EARLY}: listed twice, the second entry is ignored"]


def test_a_game_that_is_already_recorded_is_passed_over():
    first = build([early_game()], state_with(late=0.25))

    # The next morning the scores still list the early game, and the late one is over too.
    second = build(
        [early_game((1, 0)), late_game()],
        first.state,
        recorded=first.lines,
        now=NOW + timedelta(days=1),
    )

    assert [line["id"] for line in second.lines] == [LATE]
    assert second.dropped == []
    # The record is of both games: BOS at 0.532 won, and GSW at 0.75 won at LAL.
    assert second.record["games"] == 2
    assert (second.record["market"]["wins"], second.record["market"]["losses"]) == (2, 0)


def test_the_same_response_a_second_time_records_nothing_and_gives_the_same_record():
    first = build([early_game(), late_game()], state_with(late=0.25))

    again = build([early_game(), late_game()], first.state, recorded=first.lines)

    assert again.lines == []
    assert store.to_json(again.record) == store.to_json(first.record)
    assert again.state == first.state


def test_two_daily_runs_that_were_missed_are_caught_up_from_one_response():
    # The daily runs of 20 and 21 October did not happen. The run of 22
    # October finds the games of three evenings, from the 19th on, in its
    # one response, which reaches back three days.
    third, third_start = "d" * 32, "2026-10-19T23:30:00Z"
    previous = state_with(early=0.532, late=0.25)
    previous["games"][third] = {
        "commence_time": third_start,
        "home": "MIA",
        "away": "CHI",
        "first": None,
        "latest": {"p_home": 0.7, "lo": 0.7, "hi": 0.7, "n": 2, "at": "2026-10-19T22:10:30Z"},
    }
    response = [
        late_game((99, 120)),
        early_game((112, 104)),
        score_event(third, "Miami Heat", "Chicago Bulls", third_start, (95, 101)),
        score_event("a" * 32, "Utah Jazz", "Phoenix Suns", "2026-10-22T01:00:00Z", (120, 110)),
        score_event(
            "c" * 32, "Denver Nuggets", "Dallas Mavericks", "2026-10-23T01:00:00Z", None, False
        ),
    ]

    built = build(response, previous, now=datetime(2026, 10, 22, 9, 10, 7, tzinfo=timezone.utc))

    # In order of start, whatever the order in the response.
    assert [(line["id"], line["market_verdict"]) for line in built.lines] == [
        (third, "upset"),
        (EARLY, "favorite_won"),
        (LATE, "favorite_won"),
        ("a" * 32, "not_graded"),
    ]
    assert built.record["since"] == "2026-10-19"
    assert [(day["day"], day["games"]) for day in built.record["by_day"]] == [
        ("2026-10-19", 1),
        ("2026-10-20", 2),
        ("2026-10-21", 1),
    ]
    assert (built.record["market"]["wins"], built.record["market"]["losses"]) == (2, 1)
    assert built.state["results"]["record"] == {"market": {"wins": 2, "losses": 1}}


def test_the_run_is_noted_in_the_state_and_nothing_else_of_it_changes():
    previous = state_with(early=0.532, late=0.25)
    untouched = copy.deepcopy(previous)

    built = build([early_game(), late_game()], previous)

    assert built.state["results"] == {
        "last_slot": DAILY_SLOT,
        "last_run_at": AT,
        "record": {"market": {"wins": 2, "losses": 0}},
        "recent": built.lines,
    }
    # The credits are those of the scores response, the last one received.
    assert built.state["credits"] == CREDITS
    # The snapshot that was recorded last is still the one on record.
    for unchanged in ("schema", "last_slot", "last_run_at", "games"):
        assert built.state[unchanged] == untouched[unchanged]
    assert previous == untouched
    assert validate.state_problems(built.state) == []


def test_without_a_state_the_run_is_noted_in_a_new_one():
    built = build([early_game()], None)

    assert built.state == {
        "schema": 1,
        "last_slot": None,
        "last_run_at": None,
        "credits": CREDITS,
        "games": {},
        "results": {
            "last_slot": DAILY_SLOT,
            "last_run_at": AT,
            "record": {"market": {"wins": 0, "losses": 0}},
            "recent": built.lines,
        },
    }
    assert validate.state_problems(built.state) == []


def test_a_run_that_finds_no_game_over_is_noted_all_the_same():
    built = build([late_game((55, 61), completed=False)], state_with())

    assert built.lines == []
    assert built.state["results"] == {
        "last_slot": DAILY_SLOT,
        "last_run_at": AT,
        "record": {"market": {"wins": 0, "losses": 0}},
        "recent": [],
    }
    assert (built.record["games"], built.record["since"]) == (0, None)


def test_the_state_notes_the_results_of_the_last_eight_days_and_the_record_counts_them_all():
    def recorded_earlier(game_id, start):
        (line,) = build(
            [score_event(game_id, BOSTON, NEW_YORK, start, (112, 104))],
            None,
            now=datetime(2026, 10, 14, 9, 10, 7, tzinfo=timezone.utc),
        ).lines
        return line

    # NOW is 09:10:07 on 21 October. Eight days before it is 09:10:07 on 13 October.
    eight_days_old = recorded_earlier("1" * 32, "2026-10-13T09:10:07Z")
    one_second_short = recorded_earlier("2" * 32, "2026-10-13T09:10:08Z")

    built = build([early_game()], state_with(), recorded=[eight_days_old, one_second_short])

    assert [line["id"] for line in built.state["results"]["recent"]] == ["2" * 32, EARLY]
    assert built.record["games"] == 3
    assert built.record["baseline_home"] == {"games": 3, "wins": 3}


def test_what_is_built_passes_the_checks():
    built = build([early_game(), late_game((104, 104))], state_with(early=0.505, late=0.25))
    path = "v1/results/2026-10.ndjson"

    assert validate.results_problems({}, {path: store.to_ndjson(built.lines)}) == []
    assert validate.record_problems(built.record, built.lines) == []
    assert validate.state_problems(built.state) == []


def test_the_lines_that_were_recorded_before_are_not_changed():
    first = build([early_game()], state_with())
    untouched = copy.deepcopy(first.lines)

    second = build([late_game()], first.state, recorded=first.lines)
    second.state["results"]["recent"][0]["home_pts"] = 0

    assert first.lines == untouched
    assert [line["home_pts"] for line in second.lines] == [99]
