"""
Tests for pipeline/validate.py.

Each test starts from a snapshot that the builder produced and that passes,
breaks one thing in it, and expects that one thing to be named.
"""

import copy
from datetime import datetime, timezone

import pytest

from fake_odds_api import event
from pipeline import snapshot, store, validate

NOW = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)
GAME = "e" * 32
EVENTS = [
    event(
        GAME,
        "Boston Celtics",
        "New York Knicks",
        "2026-10-20T23:00:00Z",
        {"Book A": (1.50, 2.70), "Book B": (1.60, 2.40)},
    ),
    event("a" * 32, "Miami Heat", "Chicago Bulls", "2026-10-21T23:30:00Z", {}),
]
OLD_LINE = '{"id":"old","at":"2026-10-20T16:10:09Z","p_home":0.61,"lo":0.6,"hi":0.62,"n":3}\n'


@pytest.fixture
def built():
    result = snapshot.build(
        EVENTS,
        None,
        NOW,
        sport="basketball_nba",
        slot="2026-10-20T18:10-04:00",
        next_due="2026-10-20T21:10-04:00",
        credits={"remaining": 437, "used": 63, "last": 1},
    )
    return copy.deepcopy(result)


def slate_game(built):
    return built.slate["games"][0]


def test_what_the_builder_produces_passes(built):
    added = store.to_ndjson(built.history)

    assert validate.problems(built.slate, built.state, "", added) == []
    assert validate.problems(built.slate, built.state, OLD_LINE, OLD_LINE + added) == []


def test_a_problem_in_any_one_of_the_three_files_is_found(built):
    grown = OLD_LINE + store.to_ndjson(built.history)
    bad_slate, bad_state = copy.deepcopy(built.slate), copy.deepcopy(built.state)
    bad_slate["games"][0]["open"]["p_home"] = 1.0
    bad_state["games"][GAME]["latest"]["n"] = 0

    assert validate.problems(bad_slate, built.state, OLD_LINE, grown) == [
        f"slate game '{GAME}' open: p_home must be a number between 0 and 1, got 1.0"
    ]
    assert validate.problems(built.slate, bad_state, OLD_LINE, grown) == [
        f"state game '{GAME}' latest: n must be a whole number of at least 1, got 0"
    ]
    # The history file would lose the line it already has.
    assert validate.problems(built.slate, built.state, OLD_LINE, grown[len(OLD_LINE) :]) == [
        "history: lines that are already in the file would be changed or removed"
    ]


@pytest.mark.parametrize("value", [0.0, 1.0, 1.2, -0.1, 0, 1, None, "0.6", True, float("nan")])
def test_a_probability_must_lie_strictly_between_0_and_1(built, value):
    slate_game(built)["line"]["p_home"] = value
    assert len(validate.slate_problems(built.slate)) == 1
    assert "between 0 and 1" in validate.slate_problems(built.slate)[0]

    built.state["games"][GAME]["latest"]["hi"] = value
    assert "between 0 and 1" in validate.state_problems(built.state)[0]

    built.state["games"][GAME]["latest"]["hi"] = 0.6429
    built.state["games"][GAME]["first"]["p_home"] = value
    assert "between 0 and 1" in validate.state_problems(built.state)[0]


def test_the_consensus_must_lie_between_the_lowest_and_the_highest(built):
    slate_game(built)["line"].update(lo=0.63, p_home=0.62, hi=0.64)
    assert validate.slate_problems(built.slate) == [
        f"slate game '{GAME}' line: expected lo <= p_home <= hi, got lo 0.63, p_home 0.62, hi 0.64"
    ]

    built.state["games"][GAME]["latest"].update(lo=0.60, p_home=0.65, hi=0.64)
    assert validate.state_problems(built.state) == [
        f"state game '{GAME}' latest: expected lo <= p_home <= hi, got lo 0.6, p_home 0.65, hi 0.64"
    ]


@pytest.mark.parametrize("count", [0, -1, 2.0, None, True])
def test_the_count_must_be_a_whole_number_of_at_least_1(built, count):
    built.state["games"][GAME]["latest"]["n"] = count

    (problem,) = validate.state_problems(built.state)
    assert "n must be a whole number of at least 1" in problem


NAMES_PROBLEM = (
    f"slate game '{GAME}' line: books must name each of the n sportsbooks, "
    "and none when n is 1 or lo equals hi"
)


@pytest.mark.parametrize("books", [["Book A"], [], ["Book A", "Book B", "Book C"], ["Book A", ""]])
def test_the_board_names_as_many_sportsbooks_as_it_counts(built, books):
    # The game has two sportsbooks, and their figures differ.
    slate_game(built)["line"]["books"] = books

    assert validate.slate_problems(built.slate) == [NAMES_PROBLEM]


def test_the_board_does_not_name_a_single_sportsbook(built):
    line = slate_game(built)["line"]
    line.update(n=1, lo=line["p_home"], hi=line["p_home"])

    # The name of the one sportsbook next to its figure is what must not be published.
    line["books"] = ["Book A"]
    assert validate.slate_problems(built.slate) == [NAMES_PROBLEM]

    line["books"] = []
    assert validate.slate_problems(built.slate) == []


def test_the_board_does_not_name_sportsbooks_that_all_give_the_same_figure(built):
    # Two sportsbooks, and the lowest figure is the highest: it is the figure of both.
    line = slate_game(built)["line"]
    line.update(lo=line["p_home"], hi=line["p_home"])

    assert validate.slate_problems(built.slate) == [NAMES_PROBLEM]

    line["books"] = []
    assert validate.slate_problems(built.slate) == []


@pytest.mark.parametrize("code", ["XXX", "bos", "Boston Celtics", "", None, ["BOS"]])
def test_a_team_code_must_be_one_of_the_30(built, code):
    slate_game(built)["home"] = code
    built.state["games"][GAME]["away"] = code

    assert validate.slate_problems(built.slate) == [
        f"slate game '{GAME}': home is {code!r}, which is not one of the 30 team codes"
    ]
    assert validate.state_problems(built.state) == [
        f"state game '{GAME}': away is {code!r}, which is not one of the 30 team codes"
    ]


@pytest.mark.parametrize(
    "start", ["2026-10-20T22:10:41Z", "2026-10-20T22:10:40Z", "2026-10-19T23:00:00Z"]
)
def test_a_game_on_the_board_must_start_after_the_snapshot_time(built, start):
    slate_game(built)["commence_time"] = start

    assert validate.slate_problems(built.slate) == [
        f"slate game '{GAME}': starts at {start}, which is not after the snapshot time"
    ]


@pytest.mark.parametrize(
    "timestamp",
    [
        "2026-10-20 23:00:00",
        "2026-10-20T23:00:00+00:00",
        "2026-10-20T23:00Z",
        "2026-10-20T23:0:0Z",
        "",
        None,
        0,
    ],
)
def test_times_must_be_in_the_one_utc_format(built, timestamp):
    slate_game(built)["commence_time"] = timestamp
    assert validate.slate_problems(built.slate) == [
        f"slate game '{GAME}': commence_time is not a UTC timestamp"
    ]

    built.state["last_run_at"] = timestamp
    assert validate.state_problems(built.state) == ["state: last_run_at is not a UTC timestamp"]


def test_an_unknown_schema_is_refused(built):
    built.slate["schema"] = 2
    built.state["schema"] = 2

    assert validate.slate_problems(built.slate) == ["slate: schema is 2, expected 1"]
    assert validate.state_problems(built.state) == ["state: schema is 2, expected 1"]


@pytest.mark.parametrize("document", [None, [], "text", 7])
def test_something_that_is_not_an_object_is_refused_without_an_error(document):
    assert validate.slate_problems(document) == ["slate: not a JSON object"]
    assert validate.state_problems(document) == ["state: not a JSON object"]


def test_a_state_of_the_wrong_shape_is_described_without_an_error():
    found = validate.state_problems(
        {
            "schema": 1,
            "games": {"x": [], "y": {"home": "BOS", "away": "NYK", "first": 0.6, "latest": "0.6"}},
        }
    )

    assert found == [
        "state: last_slot is not a string",
        "state: last_run_at is not a UTC timestamp",
        "state: credits must hold whole numbers or null for remaining, used and last",
        "state game 'x': not a JSON object",
        "state game 'y': commence_time is not a UTC timestamp",
        "state game 'y' first: not a JSON object",
        "state game 'y' latest: not a JSON object",
    ]


def test_history_may_only_grow():
    added = '{"id":"new","at":"2026-10-20T22:10:41Z","p_home":0.6214,"lo":0.6,"hi":0.6429,"n":2}\n'
    refusal = ["history: lines that are already in the file would be changed or removed"]

    assert validate.history_problems(OLD_LINE, OLD_LINE + added) == []
    assert validate.history_problems(OLD_LINE, OLD_LINE) == []
    assert validate.history_problems("", "") == []
    # Replaced, edited, reordered or emptied: each time the old content is no longer the start.
    assert validate.history_problems(OLD_LINE, added) == refusal
    assert validate.history_problems(OLD_LINE, OLD_LINE.replace("0.61", "0.62") + added) == refusal
    assert validate.history_problems(OLD_LINE, added + OLD_LINE) == refusal
    assert validate.history_problems(OLD_LINE, "") == refusal


def test_a_history_file_that_was_cut_off_is_not_added_to():
    cut_off = OLD_LINE.rstrip("\n")

    assert validate.history_problems(cut_off, cut_off) == [
        "history: the existing file does not end with a newline"
    ]


@pytest.mark.parametrize(
    ("added", "problem"),
    [
        ("not json\n", "history line 2: not JSON"),
        (
            '{"id":"new","p_home":0.6}\n',
            "history line 2: the fields must be id, at, p_home, lo, hi, n, in that order",
        ),
        (
            '{"at":"2026-10-20T22:10:41Z","id":"new","p_home":0.6,"lo":0.6,"hi":0.6,"n":1}\n',
            "history line 2: the fields must be id, at, p_home, lo, hi, n, in that order",
        ),
        (
            '{"id":"new","at":"2026-10-20T22:10:41Z","p_home":1.0,"lo":0.6,"hi":0.6,"n":1}\n',
            "history line 2: p_home, lo and hi must be numbers between 0 and 1, got 1.0, 0.6, 0.6",
        ),
        (
            '{"id":"new","at":"2026-10-20T22:10:41Z","p_home":0.6,"lo":0.6,"hi":0.6,"n":0}\n',
            "history line 2: n must be a whole number of at least 1, got 0",
        ),
        (
            '{"id":"new","at":"yesterday","p_home":0.6,"lo":0.6,"hi":0.6,"n":1}\n',
            "history line 2: at is not a UTC timestamp",
        ),
        (
            '{"id":"new","at":"2026-10-20T22:10:41Z","p_home":0.6,"lo":0.6,"hi":0.6,"n":1}',
            "history: the added lines do not end with a newline",
        ),
    ],
)
def test_each_added_history_line_must_be_a_complete_record(added, problem):
    assert validate.history_problems(OLD_LINE, OLD_LINE + added) == [problem]
