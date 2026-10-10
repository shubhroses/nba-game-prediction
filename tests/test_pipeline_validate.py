"""
Tests for pipeline/validate.py.

Each test starts from something that passes, a snapshot that the builder
produced or a result and the record built from it, breaks one thing in it,
and expects that one thing to be named.
"""

import copy
from datetime import datetime, timezone

import pytest

from fake_odds_api import event
from pipeline import record, snapshot, store, validate

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


# A result as the daily run writes it: the home team was at 0.532 and won.
RESULT = {
    "id": GAME,
    "commence_time": "2026-10-20T23:00:00Z",
    "home": "BOS",
    "away": "NYK",
    "home_pts": 112,
    "away_pts": 104,
    "recorded_at": "2026-10-21T09:10:07Z",
    "market": {"p_home": 0.532, "lo": 0.52, "hi": 0.55, "n": 3, "at": "2026-10-20T22:10:41Z"},
    "market_verdict": "favorite_won",
}
OCTOBER, NOVEMBER = "v1/results/2026-10.ndjson", "v1/results/2026-11.ndjson"


def result(**changes):
    """The result above with some of its fields replaced. `market` may be a dict of changes."""
    changed = copy.deepcopy(RESULT)
    market = changes.pop("market", {})
    changed.update(changes)
    if isinstance(market, dict) and isinstance(changed["market"], dict):
        changed["market"].update(market)
    else:
        changed["market"] = market
    return changed


def other_results():
    """Three more games of the same month: an upset, a toss-up and a game without a line."""
    return [
        result(id="b" * 32, home_pts=99, away_pts=101, market_verdict="upset"),
        result(
            id="c" * 32, market={"p_home": 0.505, "lo": 0.5, "hi": 0.51}, market_verdict="toss_up"
        ),
        result(id="d" * 32, market=None, market_verdict="not_graded"),
    ]


def as_file(*lines):
    return store.to_ndjson(list(lines))


def test_a_result_as_the_daily_run_writes_it_passes():
    assert validate.result_problems(RESULT, "result") == []
    for line in other_results():
        assert validate.result_problems(line, "result") == []
    assert validate.results_problems({}, {OCTOBER: as_file(RESULT, *other_results())}) == []


@pytest.mark.parametrize(
    ("home_pts", "away_pts"),
    [
        (104, 104),
        (0, 0),
        (-1, 104),
        (112, -104),
        ("112", 104),
        (112.0, 104),
        (None, 104),
        (True, 0),
    ],
)
def test_the_two_scores_are_whole_numbers_that_are_not_negative_and_not_equal(home_pts, away_pts):
    assert validate.result_problems(result(home_pts=home_pts, away_pts=away_pts), "result") == [
        "result: home_pts and away_pts must be whole numbers that are not negative "
        f"and not equal, got {home_pts!r} and {away_pts!r}"
    ]


@pytest.mark.parametrize("captured", ["2026-10-20T23:00:00Z", "2026-10-20T23:00:01Z"])
def test_a_line_captured_at_or_after_the_start_is_refused(captured):
    # The game started at 23:00:00. A line from that second on is not a line
    # from before the game.
    assert validate.result_problems(result(market={"at": captured}), "result") == [
        f"result: the line was captured at {captured}, "
        "which is not before the start at 2026-10-20T23:00:00Z"
    ]
    assert validate.result_problems(result(market={"at": "2026-10-20T22:59:59Z"}), "result") == []


@pytest.mark.parametrize("recorded_at", ["2026-10-20T23:00:00Z", "2026-10-20T09:10:07Z"])
def test_a_result_is_recorded_after_the_start_of_its_game(recorded_at):
    assert validate.result_problems(result(recorded_at=recorded_at), "result") == [
        f"result: recorded at {recorded_at}, which is not after the start at 2026-10-20T23:00:00Z"
    ]


@pytest.mark.parametrize(
    ("changes", "verdict", "expected"),
    [
        ({}, "upset", "favorite_won"),
        ({}, "toss_up", "favorite_won"),
        ({}, "not_graded", "favorite_won"),
        ({"home_pts": 99, "away_pts": 101}, "favorite_won", "upset"),
        ({"market": {"p_home": 0.505, "lo": 0.5}}, "favorite_won", "toss_up"),
        ({"market": {"p_home": 0.468, "lo": 0.45}}, "favorite_won", "upset"),
        ({"market": None}, "favorite_won", "not_graded"),
        ({"market": None}, "toss_up", "not_graded"),
    ],
)
def test_the_verdict_is_the_one_that_the_line_and_the_score_make(changes, verdict, expected):
    assert validate.result_problems(result(**changes, market_verdict=verdict), "result") == [
        f"result: market_verdict is {verdict!r}, but the line and the score make it {expected!r}"
    ]


@pytest.mark.parametrize("verdict", ["win", "", None, 1, ["upset"]])
def test_the_verdict_is_one_of_the_four(verdict):
    assert validate.result_problems(result(market_verdict=verdict), "result") == [
        f"result: market_verdict is {verdict!r}, "
        "which is not one of favorite_won, upset, toss_up, not_graded"
    ]


def test_the_line_of_a_result_is_held_to_the_rules_of_every_line():
    assert validate.result_problems(result(market={"p_home": 1.0}), "result") == [
        "result market: p_home, lo and hi must be numbers between 0 and 1, got 1.0, 0.52, 0.55"
    ]
    assert validate.result_problems(result(market={"n": 0}), "result") == [
        "result market: n must be a whole number of at least 1, got 0"
    ]
    assert validate.result_problems(result(market="0.532"), "result") == [
        "result market: not a JSON object"
    ]


def test_the_game_of_a_result_has_an_id_two_teams_and_two_times():
    assert validate.result_problems(result(id=""), "result") == ["result: id is not a string"]
    assert validate.result_problems(result(home="Boston Celtics"), "result") == [
        "result: home is 'Boston Celtics', which is not one of the 30 team codes"
    ]
    assert validate.result_problems(result(commence_time="2026-10-20 23:00"), "result") == [
        "result: commence_time is not a UTC timestamp"
    ]
    assert validate.result_problems(result(recorded_at=None), "result") == [
        "result: recorded_at is not a UTC timestamp"
    ]


def test_a_result_that_lacks_a_field_or_is_not_an_object_is_described_without_an_error():
    incomplete = {key: value for key, value in RESULT.items() if key not in ("away_pts", "market")}

    assert validate.result_problems(incomplete, "result") == ["result: missing away_pts, market"]
    for line in (None, [], "text", 7):
        assert validate.result_problems(line, "result") == ["result: not a JSON object"]


def test_results_may_only_grow():
    old, added = as_file(RESULT), as_file(*other_results())
    refusal = [f"{OCTOBER}: lines that are already in the file would be changed or removed"]

    assert validate.results_problems({OCTOBER: old}, {OCTOBER: old + added}) == []
    assert validate.results_problems({OCTOBER: old}, {OCTOBER: old}) == []
    assert validate.results_problems({OCTOBER: old}, {}) == []
    assert validate.results_problems({}, {}) == []
    # Replaced, edited, reordered or emptied: each time the old content is no longer the start.
    assert validate.results_problems({OCTOBER: old}, {OCTOBER: added}) == refusal
    assert validate.results_problems({OCTOBER: old}, {OCTOBER: added + old}) == refusal
    assert validate.results_problems({OCTOBER: old}, {OCTOBER: ""}) == refusal
    rescored = as_file(result(home_pts=113))
    assert validate.results_problems({OCTOBER: old}, {OCTOBER: rescored + added}) == refusal


def test_a_results_file_that_was_cut_off_is_not_added_to():
    cut_off = as_file(RESULT).rstrip("\n")

    assert validate.results_problems({OCTOBER: cut_off}, {OCTOBER: cut_off}) == [
        f"{OCTOBER}: the existing file does not end with a newline"
    ]
    assert validate.results_problems({}, {OCTOBER: cut_off}) == [
        f"{OCTOBER}: the added lines do not end with a newline"
    ]


def test_every_line_of_every_results_file_is_checked_the_old_ones_too():
    # The record is rebuilt from all the lines, so a line that is already on
    # disk has to be as sound as one that is added.
    on_disk = {
        OCTOBER: as_file(RESULT, result(id="b" * 32, home_pts=104)),
        NOVEMBER: "not json\n",
    }

    assert validate.results_problems(on_disk, on_disk) == [
        f"{OCTOBER} line 2: home_pts and away_pts must be whole numbers that are not negative "
        "and not equal, got 104 and 104",
        f"{NOVEMBER} line 1: not JSON",
    ]


def test_the_fields_of_a_results_line_come_in_one_order_and_more_may_follow():
    in_another_order = {"commence_time": RESULT["commence_time"], **RESULT}
    with_more = {**RESULT, "another": {"p_home": 0.61}, "another_verdict": "favorite_won"}
    order = (
        "the fields must begin with id, commence_time, home, away, home_pts, away_pts, "
        "recorded_at, market, market_verdict, in that order"
    )

    assert validate.results_problems({}, {OCTOBER: as_file(in_another_order)}) == [
        f"{OCTOBER} line 1: {order}"
    ]
    assert validate.results_problems({}, {OCTOBER: "[]\n"}) == [f"{OCTOBER} line 1: {order}"]
    # A later version may add fields to the lines it writes, after these. A
    # line that is in the file with such fields is taken as it is.
    on_disk = {OCTOBER: as_file(with_more)}
    assert validate.results_problems(on_disk, on_disk) == []


def test_a_line_that_is_added_has_the_nine_fields_and_no_other():
    with_more = {**RESULT, "another": {"p_home": 0.61}, "another_verdict": "favorite_won"}
    nine = (
        "the fields must be id, commence_time, home, away, home_pts, away_pts, "
        "recorded_at, market, market_verdict, in that order"
    )

    assert validate.results_problems({}, {OCTOBER: as_file(with_more)}) == [
        f"{OCTOBER} line 1: {nine}"
    ]
    # The first line is on disk and the second is added.
    on_disk = as_file(with_more)
    added = result(id="b" * 32)
    assert validate.results_problems({OCTOBER: on_disk}, {OCTOBER: on_disk + as_file(added)}) == []
    assert validate.results_problems(
        {OCTOBER: on_disk}, {OCTOBER: on_disk + as_file({**added, "another": None})}
    ) == [f"{OCTOBER} line 2: {nine}"]


def test_a_result_is_in_the_file_of_the_month_its_game_started_in():
    in_november = result(id="b" * 32, commence_time="2026-11-01T00:30:00Z", recorded_at=None)
    in_november["recorded_at"] = "2026-11-01T10:10:07Z"
    in_november["market"]["at"] = "2026-10-31T22:10:41Z"

    assert validate.results_problems({}, {NOVEMBER: as_file(in_november)}) == []
    assert validate.results_problems({}, {OCTOBER: as_file(RESULT, in_november)}) == [
        f"{OCTOBER} line 2: the game started in 2026-11, not 2026-10"
    ]


def test_a_game_is_recorded_once():
    again = result(home_pts=120)

    assert validate.results_problems({}, {OCTOBER: as_file(RESULT, again)}) == [
        f"{OCTOBER} line 2: the game is already recorded in {OCTOBER} line 1"
    ]
    # Also when the second record of it is in another file.
    moved = result(commence_time="2026-11-01T00:30:00Z", recorded_at="2026-11-01T10:10:07Z")
    assert validate.results_problems({OCTOBER: as_file(RESULT)}, {NOVEMBER: as_file(moved)}) == [
        f"{NOVEMBER} line 1: the game is already recorded in {OCTOBER} line 1"
    ]


def record_of(lines):
    return record.build(lines, sport="basketball_nba")


def test_the_record_that_is_built_from_the_lines_passes():
    lines = [RESULT, *other_results()]

    assert validate.record_problems(record_of(lines), lines) == []
    assert validate.record_problems(record_of([]), []) == []


@pytest.mark.parametrize(
    ("path", "name", "recount"),
    [
        (["games"], "games", 4),
        (["market", "games"], "market.games", 2),
        (["market", "wins"], "market.wins", 1),
        (["market", "losses"], "market.losses", 1),
        (["market", "toss_ups"], "market.toss_ups", 1),
        (["market", "not_graded"], "market.not_graded", 1),
        (["market", "with_line"], "market.with_line", 3),
        (["baseline_home", "games"], "baseline_home.games", 4),
        (["baseline_home", "wins"], "baseline_home.wins", 3),
        (["market", "bands", 0, "games"], "the sum of games over the bands", 2),
        (["market", "bands", 4, "wins"], "the sum of wins over the bands", 1),
        (["by_day", 0, "games"], "the sum of games over the days", 4),
        (["by_day", 0, "market", "wins"], "the sum of wins over the days", 1),
        (["by_day", 0, "market", "losses"], "the sum of losses over the days", 1),
        (["by_day", 0, "market", "toss_ups"], "the sum of toss_ups over the days", 1),
        (["by_day", 0, "market", "not_graded"], "the sum of not_graded over the days", 1),
    ],
)
def test_a_total_of_the_record_that_differs_from_a_recount_of_the_lines_is_named(
    path, name, recount
):
    # Four games: a favorite that won, an upset, a toss-up and a game without
    # a line. Each count of the record in turn is made one too many.
    lines = [RESULT, *other_results()]
    built = record_of(lines)
    holder = built
    for key in path[:-1]:
        holder = holder[key]
    holder[path[-1]] += 1

    assert validate.record_problems(built, lines) == [
        f"record: {name} is {recount + 1}, and a recount of the result lines gives {recount}"
    ]


def test_the_accuracy_of_the_record_is_the_share_of_wins():
    lines = [RESULT, *other_results()]
    built = record_of(lines)
    built["market"]["accuracy"] = 0.6

    assert validate.record_problems(built, lines) == [
        "record: market.accuracy is 0.6, and 1 wins in 2 games give 0.5"
    ]


def test_a_record_of_other_lines_is_refused():
    lines = [RESULT, *other_results()]

    found = validate.record_problems(record_of(lines[:3]), lines)

    assert "record: games is 3, and a recount of the result lines gives 4" in found
    assert "record: market.not_graded is 0, and a recount of the result lines gives 1" in found


def test_a_record_of_the_wrong_shape_is_described_without_an_error():
    assert validate.record_problems(None, []) == ["record: not a JSON object"]
    found = validate.record_problems({"schema": 2, "market": [], "by_day": "x"}, [RESULT])

    assert found[0] == "record: schema is 2, expected 1"
    assert "record: games is None, and a recount of the result lines gives 1" in found
    assert "record: market.accuracy is None, and 1 wins in 1 games give 1.0" in found


# What the daily run notes in the state after it has recorded the result above.
NOTED = {
    "last_slot": "2026-10-21T05:10-04:00",
    "last_run_at": "2026-10-21T09:10:07Z",
    "record": {"market": {"wins": 1, "losses": 0}},
    "recent": [RESULT],
}
HEADLINE_PROBLEM = "market must hold whole numbers for wins and losses"


def test_a_state_passes_with_the_notes_of_the_daily_work_and_without_them(built):
    built.state["results"] = copy.deepcopy(NOTED)
    assert validate.state_problems(built.state) == []

    # Null until the daily work has been done once.
    built.state["results"] = None
    assert validate.state_problems(built.state) == []

    # A state from before there was any daily work does not have the field.
    del built.state["results"]
    assert validate.state_problems(built.state) == []


@pytest.mark.parametrize(
    ("change", "problem"),
    [
        ({"last_slot": None}, "state results: last_slot is not a string"),
        ({"last_run_at": "this morning"}, "state results: last_run_at is not a UTC timestamp"),
        ({"record": None}, f"state results record: {HEADLINE_PROBLEM}"),
        ({"record": {"market": {"wins": 1}}}, f"state results record: {HEADLINE_PROBLEM}"),
        ({"recent": None}, "state results recent: not a list"),
        ({"recent": ["text"]}, "state results recent None: not a JSON object"),
        (
            {"recent": [RESULT, result(id="b" * 32, market_verdict="upset")]},
            f"state results recent '{'b' * 32}': market_verdict is 'upset', "
            "but the line and the score make it 'favorite_won'",
        ),
    ],
)
def test_each_note_of_the_daily_work_is_checked(built, change, problem):
    built.state["results"] = {**copy.deepcopy(NOTED), **change}

    assert validate.state_problems(built.state) == [problem]


def test_notes_that_are_not_an_object_are_described_without_an_error(built):
    for notes in ([], "text", 7):
        built.state["results"] = notes
        assert validate.state_problems(built.state) == ["state results: not a JSON object"]


def test_a_state_from_before_the_first_snapshot_names_no_slot_and_no_time(built):
    # The daily work can be recorded before a snapshot ever is.
    built.state.update(last_slot=None, last_run_at=None, games={})
    assert validate.state_problems(built.state) == []

    # One of the two without the other is not such a state.
    built.state.update(last_slot=None, last_run_at="2026-10-20T22:10:41Z")
    assert validate.state_problems(built.state) == ["state: last_slot is not a string"]
    built.state.update(last_slot="2026-10-20T18:10-04:00", last_run_at=None)
    assert validate.state_problems(built.state) == ["state: last_run_at is not a UTC timestamp"]

    # And a state that lacks the two fields is not one either.
    del built.state["last_slot"], built.state["last_run_at"]
    assert validate.state_problems(built.state) == [
        "state: last_slot is not a string",
        "state: last_run_at is not a UTC timestamp",
    ]


def test_a_board_passes_with_a_record_and_recent_results(built):
    built.slate["record"] = {"market": {"wins": 1, "losses": 0}}
    built.slate["recent_results"] = [copy.deepcopy(RESULT), *other_results()]

    assert validate.slate_problems(built.slate) == []


@pytest.mark.parametrize(
    "headline",
    [
        {},
        {"market": None},
        {"market": {"wins": 1}},
        {"market": {"wins": "1", "losses": 0}},
        {"market": {"wins": -1, "losses": 0}},
        {"market": {"wins": 1.0, "losses": 0}},
        {"market": {"wins": True, "losses": 0}},
        [],
        "41-19",
    ],
)
def test_the_record_on_the_board_is_null_or_holds_wins_and_losses(built, headline):
    built.slate["record"] = headline

    assert validate.slate_problems(built.slate) == [f"slate record: {HEADLINE_PROBLEM}"]


def test_the_recent_results_on_the_board_are_a_list_of_results(built):
    built.slate["recent_results"] = [RESULT, result(id="b" * 32, home_pts=104)]
    assert validate.slate_problems(built.slate) == [
        f"slate recent_results '{'b' * 32}': home_pts and away_pts must be whole numbers "
        "that are not negative and not equal, got 104 and 104"
    ]

    del built.slate["recent_results"]
    assert validate.slate_problems(built.slate) == ["slate recent_results: not a list"]


def test_the_wins_and_losses_for_the_board_are_held_to_a_recount_of_the_lines_too():
    # Five games: two favorites that won, an upset, a toss-up and a game without a line.
    lines = [RESULT, result(id="f" * 32), *other_results()]
    where = "state results record"

    assert validate.board_problems({"market": {"wins": 2, "losses": 1}}, lines) == []
    assert validate.board_problems({"market": {"wins": 3, "losses": 1}}, lines) == [
        f"{where}: wins is 3, and a recount of the result lines gives 2"
    ]
    assert validate.board_problems({"market": {"wins": 2, "losses": 0}}, lines) == [
        f"{where}: losses is 0, and a recount of the result lines gives 1"
    ]
    # The wins and the losses the wrong way round.
    assert validate.board_problems({"market": {"wins": 1, "losses": 2}}, lines) == [
        f"{where}: wins is 1, and a recount of the result lines gives 2",
        f"{where}: losses is 2, and a recount of the result lines gives 1",
    ]
    assert validate.board_problems({"market": {"wins": 0, "losses": 0}}, []) == []
    assert validate.board_problems(None, lines) == [f"{where}: {HEADLINE_PROBLEM}"]


# From here on: a sport that the two models forecast. Its result lines carry
# each model's forecast of the morning of the game and the verdict on it.
MORNING = "2026-10-20T09:10:07Z"
# Boston won 112 to 104. Elo had given it 39.65%, so its favorite lost, and
# the points-and-rest model 55%, so its favorite won.
FORECAST_RESULT = {
    **RESULT,
    "elo": {"p_home": 0.3965, "published_at": MORNING},
    "elo_verdict": "upset",
    "points_rest": {"p_home": 0.55, "margin": 1.42, "published_at": MORNING},
    "points_rest_verdict": "favorite_won",
}
MODELS = ("elo", "points_rest")
THIRTEEN = (
    "the fields must be id, commence_time, home, away, home_pts, away_pts, recorded_at, "
    "market, market_verdict, elo, elo_verdict, points_rest, points_rest_verdict, in that order"
)


def forecast_result(**changes):
    """The result above with some fields replaced. A model's field may be a dict of changes."""
    changed = copy.deepcopy(FORECAST_RESULT)
    for name in MODELS:
        made = changes.pop(name, {})
        if isinstance(made, dict) and made:
            changed[name].update(made)
        elif made != {}:
            changed[name] = made
    changed.update(changes)
    return changed


def other_forecast_results():
    """Three more games: one that neither model forecast, a late forecast and Elo alone."""
    nothing = {"elo": None, "elo_verdict": "not_graded"}
    nothing |= {"points_rest": None, "points_rest_verdict": "not_graded"}
    late = {"published_at": "2026-10-20T23:00:00Z"}
    return [
        forecast_result(id="b" * 32, **nothing),
        forecast_result(
            id="c" * 32,
            elo=late,
            points_rest=late,
            elo_verdict="not_graded",
            points_rest_verdict="not_graded",
        ),
        forecast_result(
            id="d" * 32,
            home_pts=99,
            away_pts=101,
            market_verdict="upset",
            elo_verdict="favorite_won",
            points_rest=None,
            points_rest_verdict="not_graded",
        ),
    ]


def test_a_result_of_a_forecast_sport_as_the_daily_run_writes_it_passes():
    lines = [FORECAST_RESULT, *other_forecast_results()]

    for line in lines:
        assert validate.result_problems(line, "result") == []
    assert validate.results_problems({}, {OCTOBER: as_file(*lines)}, forecast=True) == []


def test_a_line_that_is_added_in_a_forecast_sport_has_the_thirteen_fields_and_no_other():
    # The nine alone, the four of the models in another order, and one field more.
    swapped = {**RESULT}
    for name in ("points_rest", "points_rest_verdict", "elo", "elo_verdict"):
        swapped[name] = FORECAST_RESULT[name]
    for line in (RESULT, swapped, {**FORECAST_RESULT, "another": None}):
        assert validate.results_problems({}, {OCTOBER: as_file(line)}, forecast=True) == [
            f"{OCTOBER} line 1: {THIRTEEN}"
        ]

    # And a sport that is not forecast gets no fields of the models.
    assert len(validate.results_problems({}, {OCTOBER: as_file(FORECAST_RESULT)})) == 1


def test_a_line_from_before_the_models_stays_as_it_is_in_a_forecast_sport():
    on_disk = as_file(RESULT)
    added = forecast_result(id="b" * 32)

    assert (
        validate.results_problems(
            {OCTOBER: on_disk}, {OCTOBER: on_disk + as_file(added)}, forecast=True
        )
        == []
    )


def test_the_fields_of_the_models_come_together():
    without_one = {key: value for key, value in FORECAST_RESULT.items() if key != "elo_verdict"}

    assert validate.result_problems(without_one, "result") == [
        "result: the fields of the models must be elo, elo_verdict, points_rest, "
        "points_rest_verdict"
    ]


@pytest.mark.parametrize(
    ("change", "complaint"),
    [
        ({"elo": 0.3965}, "result elo: not a JSON object"),
        (
            {"elo": {"p_home": 1.0}},
            "result elo: p_home must be a number between 0 and 1, got 1.0",
        ),
        (
            {"elo": {"published_at": "this morning"}},
            "result elo: published_at is not a UTC timestamp",
        ),
        (
            {"points_rest": {"margin": None}},
            "result points_rest: margin is not a number of points",
        ),
        (
            {"points_rest": {"margin": 1}},
            "result points_rest: margin is not a number of points",
        ),
        (
            {"points_rest_verdict": "won"},
            "result: points_rest_verdict is 'won', "
            "which is not one of favorite_won, upset, toss_up, not_graded",
        ),
    ],
)
def test_what_a_result_carries_of_a_model_is_a_forecast_or_null_and_a_verdict(change, complaint):
    assert validate.result_problems(forecast_result(**change), "result") == [complaint]


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"elo_verdict": "favorite_won"}, "upset"),
        ({"elo_verdict": "not_graded"}, "upset"),
        ({"elo": {"p_home": 0.5}}, "toss_up"),
        ({"elo": None}, "not_graded"),
    ],
)
def test_the_verdict_on_a_model_is_the_one_its_forecast_and_the_score_make(change, expected):
    line = forecast_result(**change)

    assert validate.result_problems(line, "result") == [
        f"result: elo_verdict is {line['elo_verdict']!r}, but the forecast, "
        f"the time it was published at and the score make it {expected!r}"
    ]


@pytest.mark.parametrize("published_at", ["2026-10-20T23:00:00Z", "2026-10-20T23:00:01Z"])
def test_a_forecast_published_at_or_after_the_start_must_not_be_graded(published_at):
    # The game started at 23:00:00.
    graded = forecast_result(points_rest={"published_at": published_at})
    assert validate.result_problems(graded, "result") == [
        "result: points_rest_verdict is 'favorite_won', but the forecast, "
        "the time it was published at and the score make it 'not_graded'"
    ]

    not_graded = forecast_result(
        points_rest={"published_at": published_at}, points_rest_verdict="not_graded"
    )
    assert validate.result_problems(not_graded, "result") == []
    in_time = forecast_result(points_rest={"published_at": "2026-10-20T22:59:59Z"})
    assert validate.result_problems(in_time, "result") == []


def forecast_record_of(lines):
    return record.build(lines, sport="basketball_nba", models=MODELS)


def test_the_record_of_a_forecast_sport_passes_for_the_lines_it_was_built_from():
    lines = [FORECAST_RESULT, *other_forecast_results()]

    assert validate.record_problems(forecast_record_of(lines), lines, models=MODELS) == []
    assert validate.record_problems(forecast_record_of([]), [], models=MODELS) == []
    # Lines from before the models, with the lines that have them.
    mixed = [RESULT, forecast_result(id="b" * 32)]
    assert validate.record_problems(forecast_record_of(mixed), mixed, models=MODELS) == []


@pytest.mark.parametrize(
    ("path", "name", "recount"),
    [
        (["elo", "games"], "elo.games", 2),
        (["elo", "wins"], "elo.wins", 1),
        (["elo", "losses"], "elo.losses", 1),
        (["points_rest", "toss_ups"], "points_rest.toss_ups", 0),
        (["elo", "not_graded"], "elo.not_graded", 2),
        (["points_rest", "not_graded"], "points_rest.not_graded", 3),
        (["elo", "with_line"], "elo.with_line", 2),
        (["elo", "late"], "elo.late", 1),
        (["points_rest", "late"], "points_rest.late", 1),
        (["elo", "bands", 0, "games"], "the sum of elo games over the bands", 2),
        (["points_rest", "bands", 0, "wins"], "the sum of points_rest wins over the bands", 1),
        (["by_day", 0, "elo", "wins"], "the sum of elo wins over the days", 1),
        (["by_day", 0, "elo", "losses"], "the sum of elo losses over the days", 1),
        (
            ["by_day", 0, "points_rest", "toss_ups"],
            "the sum of points_rest toss_ups over the days",
            0,
        ),
        (["by_day", 0, "elo", "not_graded"], "the sum of elo not_graded over the days", 2),
        (["elo", "picks_against_market", "differ"], "elo.picks_against_market.differ", 2),
        (
            ["elo", "picks_against_market", "model_right"],
            "elo.picks_against_market.model_right",
            1,
        ),
        (
            ["elo", "picks_against_market", "market_right"],
            "elo.picks_against_market.market_right",
            1,
        ),
        (
            ["points_rest", "picks_against_market", "differ"],
            "points_rest.picks_against_market.differ",
            0,
        ),
        (["elo", "brier_against_market", "games"], "elo.brier_against_market.games", 2),
        (
            ["points_rest", "brier_against_market", "games"],
            "points_rest.brier_against_market.games",
            1,
        ),
    ],
)
def test_a_count_of_a_models_record_that_differs_from_a_recount_of_the_lines_is_named(
    path, name, recount
):
    # Four games. In the first the line's favorite won and Elo's lost. One
    # had no forecast and one a late one. In the last, which the
    # points-and-rest model sat out, Elo's favorite won and the line's lost.
    lines = [FORECAST_RESULT, *other_forecast_results()]
    built = forecast_record_of(lines)
    holder = built
    for key in path[:-1]:
        holder = holder[key]
    holder[path[-1]] += 1

    assert validate.record_problems(built, lines, models=MODELS) == [
        f"record: {name} is {recount + 1}, and a recount of the result lines gives {recount}"
    ]


def test_a_game_without_a_line_is_not_one_of_the_games_both_forecast():
    # Elo is graded in both games. The sportsbooks had a line for the first only.
    without_a_line = forecast_result(id="b" * 32, market=None, market_verdict="not_graded")
    lines = [FORECAST_RESULT, without_a_line]
    built = forecast_record_of(lines)

    assert built["elo"]["brier_against_market"]["games"] == 1
    assert validate.record_problems(built, lines, models=MODELS) == []


def test_the_accuracy_of_a_model_is_the_share_of_its_wins():
    lines = [FORECAST_RESULT, *other_forecast_results()]
    built = forecast_record_of(lines)
    built["elo"]["accuracy"] = 1.0

    assert validate.record_problems(built, lines, models=MODELS) == [
        "record: elo.accuracy is 1.0, and 1 wins in 2 games give 0.5"
    ]


def test_a_record_without_a_model_that_the_sport_is_forecast_by_is_refused():
    lines = [FORECAST_RESULT]
    without = record.build(lines, sport="basketball_nba")

    found = validate.record_problems(without, lines, models=MODELS)

    assert "record: elo.games is None, and a recount of the result lines gives 1" in found
    assert "record: points_rest.wins is None, and a recount of the result lines gives 1" in found
    # A sport that is not forecast is not asked for them.
    assert validate.record_problems(without, lines) == []


def test_the_wins_and_losses_of_each_model_for_the_board_are_held_to_a_recount_too():
    lines = [FORECAST_RESULT, *other_forecast_results()]
    where = "state results record"
    headline = {
        "market": {"wins": 3, "losses": 1},
        "elo": {"wins": 1, "losses": 1},
        "points_rest": {"wins": 1, "losses": 0},
    }

    assert validate.board_problems(headline, lines, models=MODELS) == []
    wrong = {**headline, "elo": {"wins": 2, "losses": 1}, "points_rest": {"wins": 1, "losses": 1}}
    assert validate.board_problems(wrong, lines, models=MODELS) == [
        f"{where}: elo wins is 2, and a recount of the result lines gives 1",
        f"{where}: points_rest losses is 1, and a recount of the result lines gives 0",
    ]
    without = {"market": headline["market"]}
    assert validate.board_problems(without, lines, models=MODELS) == [
        f"{where}: elo must hold whole numbers for wins and losses",
        f"{where}: points_rest must hold whole numbers for wins and losses",
    ]
    assert validate.board_problems(without, lines) == []


@pytest.mark.parametrize("counts", [None, {"wins": 1}, {"wins": "1", "losses": 0}, 3])
def test_a_models_wins_and_losses_on_the_board_are_whole_numbers(built, counts):
    built.slate["record"] = {"market": {"wins": 1, "losses": 0}, "elo": counts}
    built.state["results"] = {**NOTED, "record": built.slate["record"]}

    assert validate.slate_problems(built.slate) == [
        "slate record: elo must hold whole numbers for wins and losses"
    ]
    assert validate.state_problems(built.state) == [
        "state results record: elo must hold whole numbers for wins and losses"
    ]


def test_the_board_of_a_forecast_sport_has_the_models_fields_and_another_board_need_not(built):
    assert validate.slate_problems(built.slate) == []

    found = validate.slate_problems(built.slate, forecast=True)

    # Two games, and neither has the two fields.
    assert found == [
        f"slate game '{GAME}' elo: must be null or hold p_home, a number between 0 and 1",
        f"slate game '{GAME}' points_rest: must be null or a forecast",
        f"slate game '{'a' * 32}' elo: must be null or hold p_home, a number between 0 and 1",
        f"slate game '{'a' * 32}' points_rest: must be null or a forecast",
    ]
    # The check of a whole snapshot finds the same, when it is told that the sport is forecast.
    assert validate.problems(built.slate, built.state, "", "", forecast=True) == found
    assert validate.problems(built.slate, built.state, "", "") == []
    for game in built.slate["games"]:
        game.update(elo={"p_home": 0.55}, points_rest=None)
    built.slate["models"] = None
    assert validate.slate_problems(built.slate, forecast=True) == []
    assert validate.problems(built.slate, built.state, "", "", forecast=True) == []


def test_what_the_board_says_of_the_models_is_checked_in_a_forecast_sport(built):
    for game in built.slate["games"]:
        game.update(elo=None, points_rest=None)
    built.slate["models"] = {"results_through": None, "status": "fine", "predictions_day": None}

    assert validate.slate_problems(built.slate, forecast=True) == [
        "slate models: status is 'fine', which is not one of ok, degraded"
    ]
    assert validate.slate_problems(built.slate) == []


def test_what_the_state_notes_of_the_models_is_checked_with_the_state(built):
    built.state["models"] = None
    assert validate.state_problems(built.state) == []

    built.state["models"] = {"built_at": "2026-10-21T09:10:07Z", "results_through": None}
    assert validate.state_problems(built.state) == [
        "state models: status is None, which is not one of ok, degraded",
        "state models: elo must give each of the 30 teams a whole-number rating",
    ]
