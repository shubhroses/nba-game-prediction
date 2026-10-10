"""
Tests for pipeline/validate_forecasts.py.

Each test starts from something that passes, a model file and the forecasts
of a day as the builder produced them from two invented results, breaks one
thing in it, and expects that one thing to be named.
"""

import copy
from datetime import date, datetime, timezone

import pytest

from pipeline import forecasts, store
from pipeline import validate_forecasts as validate
from pipeline.model import season

OPENING = season.load("2026_27")
MORNING = datetime(2026, 10, 21, 9, 10, 7, tzinfo=timezone.utc)
TODAY = "v1/predictions/2026-10-21.json"
DET_BOS, SAS_OKC = "d" * 32, "e" * 32


def result(game_id, home, away, home_pts, away_pts, start="2026-10-20T23:30:00Z"):
    return {
        "id": game_id,
        "commence_time": start,
        "home": home,
        "away": away,
        "home_pts": home_pts,
        "away_pts": away_pts,
        "recorded_at": "2026-10-21T09:10:07Z",
        "market": None,
        "market_verdict": "not_graded",
    }


# Tuesday's two results, and the two games of Wednesday evening.
LINES = [result("b" * 32, "BOS", "NYK", 112, 104), result("c" * 32, "LAL", "GSW", 99, 120)]
LINE = {"p_home": 0.6, "lo": 0.58, "hi": 0.61, "n": 3, "at": "2026-10-21T01:10:30Z"}
GAMES = {
    DET_BOS: {"commence_time": "2026-10-21T23:00:00Z", "home": "DET", "away": "BOS"}
    | {"first": None, "latest": LINE},
    SAS_OKC: {"commence_time": "2026-10-22T00:00:00Z", "home": "SAS", "away": "OKC"}
    | {"first": None, "latest": None},
}


def build(lines=LINES, games=GAMES, commit=None):
    return forecasts.build(
        list(lines),
        {"schema": 1, "games": games},
        MORNING,
        sport="basketball_nba",
        season=OPENING,
        day=date(2026, 10, 21),
        frozen=None,
        commit=commit,
    )


@pytest.fixture
def built():
    return copy.deepcopy(build())


@pytest.fixture
def model(built):
    return built.model


@pytest.fixture
def predictions(built):
    return built.predictions


def model_problems(document, lines=LINES):
    return validate.model_problems(document, lines, OPENING)


def forecasts_problems(document):
    return validate.forecasts_problems(document, "predictions")


def first_game(predictions):
    return predictions["games"][0]


def test_what_the_builder_produces_passes(built):
    assert model_problems(built.model) == []
    assert forecasts_problems(built.predictions) == []
    assert validate.note_problems(built.state["models"]) == []
    assert validate.predictions_problems({}, {TODAY: store.to_json(built.predictions)}) == []


def test_what_the_builder_produces_on_a_day_with_elo_alone_passes():
    # A game of Tuesday that the state knows has no result.
    missed = {"commence_time": "2026-10-20T23:00:00Z", "home": "MIA", "away": "CHI"}
    alone = build(games={**GAMES, "f" * 32: {**missed, "first": None, "latest": None}})

    assert alone.model["status"] == "degraded"
    assert model_problems(alone.model) == []
    assert forecasts_problems(alone.predictions) == []
    assert validate.note_problems(alone.state["models"]) == []


@pytest.mark.parametrize("document", [None, [], "model"])
def test_a_document_that_is_not_an_object_is_refused(document):
    assert model_problems(document) == ["model: not a JSON object"]
    assert forecasts_problems(document) == ["predictions: not a JSON object"]


def test_the_schema_must_be_1(model, predictions):
    model["schema"] = predictions["schema"] = 2

    assert model_problems(model) == ["model: schema is 2, expected 1"]
    assert forecasts_problems(predictions) == ["predictions: schema is 2, expected 1"]


@pytest.mark.parametrize("status", ["fine", None, True])
def test_the_status_is_ok_or_degraded(model, predictions, status):
    model["status"] = predictions["status"] = status

    assert f"model: status is {status!r}, which is not one of ok, degraded" in model_problems(model)
    assert (
        f"predictions: status is {status!r}, which is not one of ok, degraded"
        in forecasts_problems(predictions)
    )


def test_a_status_of_degraded_comes_with_its_reasons_and_ok_with_none(model, predictions):
    together = "a status of degraded must come with its reasons, and ok with none"
    model["reasons"] = predictions["reasons"] = ["no result for CHI at MIA"]

    assert model_problems(model) == [f"model: {together}"]
    assert forecasts_problems(predictions) == [f"predictions: {together}"]

    model["reasons"], model["status"], model["points_rest"] = [], "degraded", None
    assert model_problems(model) == [f"model: {together}"]


@pytest.mark.parametrize("reasons", [None, "no result", [""], [3]])
def test_the_reasons_are_a_list_of_sentences(model, reasons):
    model["reasons"] = reasons

    assert model_problems(model) == ["model: reasons is not a list of sentences"]


@pytest.mark.parametrize(
    "parameters",
    [
        None,
        {},
        {"elo": "0" * 64},
        {"elo": "0" * 64, "points_rest": "0" * 63},
        {"elo": "0" * 64, "points_rest": "G" * 64},
        {"elo": "0" * 64, "points_rest": "0" * 64, "third": "0" * 64},
    ],
)
def test_the_parameters_are_the_sha_256_of_the_file_of_each_model(model, predictions, parameters):
    model["parameters"] = predictions["parameters"] = parameters
    what = "parameters must give the SHA-256 of the file of each model"

    assert model_problems(model) == [f"model: {what}"]
    assert forecasts_problems(predictions) == [f"predictions: {what}"]


@pytest.mark.parametrize("commit", ["main", "0123abc", "0" * 39, "G" * 40, 7])
def test_the_commit_of_the_code_is_a_commit_or_null(model, commit):
    model["code_commit"] = commit
    assert model_problems(model) == ["model: code_commit is neither a commit nor null"]

    model["code_commit"] = "0123456789abcdef0123456789abcdef01234567"
    assert model_problems(model) == []
    # A repository that names its commits by SHA-256 has 64 characters.
    model["code_commit"] = "0" * 64
    assert model_problems(model) == []


def test_the_model_file_says_when_it_was_built_and_for_which_season(model):
    model["built_at"], model["season"] = "this morning", "2025-26"

    assert model_problems(model) == [
        "model: built_at is not a UTC timestamp",
        "model: season is '2025-26', expected '2026-27'",
    ]


def test_the_games_of_the_model_file_are_a_recount_of_the_results_of_the_season(model):
    model["games"] = 3
    assert model_problems(model) == ["model: games is 3, and a recount of the result lines gives 2"]

    # A result from before the first day of the season is not counted.
    preseason = result("a" * 32, "DET", "BOS", 120, 80, start="2026-10-19T23:00:00Z")
    assert model_problems(model, [preseason, *LINES]) == [
        "model: games is 3, and a recount of the result lines gives 2"
    ]


def test_the_day_the_results_reach_is_the_day_of_the_last_result(model):
    model["results_through"] = "2026-10-21"

    assert model_problems(model) == [
        "model: results_through is '2026-10-21', "
        "and a recount of the result lines gives '2026-10-20'"
    ]


def test_every_teams_wins_and_losses_are_a_recount(model):
    model["teams"]["BOS"] = {"wins": 0, "losses": 1}

    (problem,) = model_problems(model)
    assert problem.startswith("model: teams is {")
    assert "and a recount of the result lines gives {" in problem


def test_elos_constants_are_the_ones_of_the_opening_file(model):
    model["elo"]["constants"]["home_court"] = 100

    assert model_problems(model) == [
        "model: elo.constants are not the ones of the season's opening file"
    ]


@pytest.mark.parametrize(
    "change",
    [
        lambda ratings: ratings.pop("WAS"),
        lambda ratings: ratings.update(SEA={"rating": 1500, "week_ago": 1500}),
        lambda ratings: ratings["BOS"].update(rating=1618.64),
        lambda ratings: ratings["BOS"].pop("week_ago"),
        lambda ratings: ratings.update(BOS=1619),
    ],
    ids=["a team missing", "a team too many", "decimals", "no week_ago", "a bare number"],
)
def test_elo_gives_each_of_the_30_teams_two_whole_numbers(model, change):
    change(model["elo"]["ratings"])

    assert model_problems(model) == [
        "model: elo.ratings must give each of the 30 teams a rating and week_ago"
    ]


def test_the_elo_ratings_add_up_to_what_the_opening_ratings_add_up_to(model):
    # Boston gained 12 points from New York. Here New York did not lose them.
    model["elo"]["ratings"]["NYK"]["rating"] += 12
    assert model_problems(model) == []

    # Rounding can move the sum by half a point for each team, and no further.
    model["elo"]["ratings"]["NYK"]["rating"] += 4
    assert model_problems(model) == [
        "model: the Elo ratings add up to 45165, and a game leaves "
        "the sum of the opening ratings, 45149, as it was"
    ]


def test_a_team_that_has_not_played_is_at_its_opening_rating(model):
    model["elo"]["ratings"]["DET"]["rating"] = 1615
    model["elo"]["ratings"]["WAS"]["week_ago"] = 1290

    assert model_problems(model) == [
        "model: DET has not played and is not at its opening rating of 1614",
        "model: WAS has not played and is not at its opening rating of 1289",
    ]


@pytest.mark.parametrize(
    "change",
    [
        lambda points: points.update(home_court=2),
        lambda points: points.pop("home_court"),
        lambda points: points["ratings"].pop("WAS"),
        lambda points: points["ratings"]["BOS"].update(uncertainty=None),
        lambda points: points["ratings"]["BOS"].update(rating="5.1"),
        lambda points: points.update(ratings=[]),
    ],
)
def test_points_and_rest_gives_the_home_court_and_two_numbers_for_each_team(model, change):
    change(model["points_rest"])

    assert model_problems(model) == [
        "model: points_rest must give the league's home court and, for each of "
        "the 30 teams, a rating and its uncertainty"
    ]


def test_the_points_and_rest_ratings_have_the_leagues_mean_taken_off(model):
    for team in model["points_rest"]["ratings"].values():
        team["rating"] = round(team["rating"] + 0.25, 2)

    assert model_problems(model) == [
        "model: the points_rest ratings do not have the league's mean taken off"
    ]


def test_an_uncertainty_is_above_zero(model):
    model["points_rest"]["ratings"]["BOS"]["uncertainty"] = 0.0

    assert model_problems(model) == [
        "model: an uncertainty of the points_rest ratings is not above 0"
    ]


def test_points_and_rest_is_left_out_of_the_model_file_exactly_when_the_status_is_degraded(model):
    without = dict(model, points_rest=None)
    assert model_problems(without) == [
        "model: points_rest must give the league's home court and, for each of "
        "the 30 teams, a rating and its uncertainty"
    ]

    left_in = dict(model, status="degraded", reasons=["BOS has 2 results on 2026-10-20"])
    assert model_problems(left_in) == [
        "model: points_rest must be null when the status is degraded"
    ]


def test_the_forecasts_say_which_day_they_are_for_and_when_they_were_published(predictions):
    predictions["day"], predictions["published_at"] = "21 October", "2026-10-21 09:10"
    predictions["results_through"] = "yesterday"

    assert forecasts_problems(predictions) == [
        "predictions: day is not a date",
        "predictions: published_at is not a UTC timestamp",
        "predictions: results_through is neither a date nor null",
    ]


@pytest.mark.parametrize(
    "day", ["2026-13-01", "2026-10-21T00:00:00Z", "20261021", "2026-W43-3", 20261021, None]
)
def test_a_day_is_written_as_a_date(predictions, day):
    predictions["day"] = day

    assert forecasts_problems(predictions) == ["predictions: day is not a date"]


def test_the_games_are_a_list_of_objects_and_none_is_listed_twice(predictions):
    assert forecasts_problems(dict(predictions, games=None)) == ["predictions: games is not a list"]

    predictions["games"] += ["a game", copy.deepcopy(first_game(predictions))]
    assert forecasts_problems(predictions) == [
        "predictions: a game is listed twice",
        "predictions: a game is not a JSON object",
    ]


def test_a_forecast_names_its_game_by_an_id_and_two_of_the_30_teams(predictions):
    first_game(predictions).update(id="", away="SEA")

    assert forecasts_problems(predictions) == [
        "predictions game '': id is not a string",
        "predictions game '': away is 'SEA', which is not one of the 30 team codes",
    ]


def test_a_forecast_is_for_a_game_that_had_not_started_when_it_was_published(predictions):
    # The first game starts at 23:00:00 UTC, and the second an hour later.
    predictions["published_at"] = "2026-10-21T23:00:00Z"
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}': starts at 2026-10-21T23:00:00Z, "
        "which is not after the forecasts were published"
    ]
    predictions["published_at"] = "2026-10-21T22:59:59Z"
    assert forecasts_problems(predictions) == []

    first_game(predictions)["commence_time"] = "23:00"
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}': commence_time is not a UTC timestamp"
    ]


def test_a_forecast_is_for_a_game_of_the_day_of_its_file(predictions):
    # 10:00 UTC on Thursday is where Thursday's games begin.
    first_game(predictions)["commence_time"] = "2026-10-22T10:00:00Z"
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}': is a game of 2026-10-22, not of 2026-10-21"
    ]

    first_game(predictions)["commence_time"] = "2026-10-22T09:59:59Z"
    assert forecasts_problems(predictions) == []


def test_a_forecast_says_whether_the_floor_is_neutral(predictions):
    first_game(predictions)["neutral"] = "no"

    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}': neutral is neither true nor false"
    ]


def test_elos_chance_must_be_the_one_its_ratings_and_the_home_court_give(predictions):
    # Detroit, 1614, hosts Boston, 1619 after its win on Tuesday:
    # 10 ^ (-(1614 + 40 - 1619) / 400) = 0.817523, and 1 / 1.817523 = 0.5502.
    chance = first_game(predictions)["elo"]
    assert chance == {"p_home": 0.5502, "home_rating": 1614, "away_rating": 1619, "home_court": 40}

    # The chance that the rating before rounding, 1618.64, would have given.
    chance["p_home"] = 0.5507
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' elo: p_home is 0.5507, "
        "and the ratings and the home court give 0.5502"
    ]
    # The rating that was not rounded, with the chance of the rounded one.
    chance.update(p_home=0.5502, away_rating=1618.64)
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' elo: home_rating and away_rating must be whole numbers"
    ]
    first_game(predictions)["elo"] = 0.5502
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' elo: not a JSON object"
    ]


def test_elo_gives_the_home_team_nothing_on_a_neutral_floor(predictions):
    game = first_game(predictions)
    game["neutral"] = True
    court = (
        f"predictions game '{DET_BOS}' elo: home_court must be a number, and 0 on a neutral floor"
    )
    assert forecasts_problems(predictions) == [court]

    # 1 / (1 + 10 ^ (5 / 400)) = 0.4928
    game["elo"].update(home_court=0, p_home=0.4928)
    assert forecasts_problems(predictions) == []

    game["elo"]["home_court"] = None
    assert forecasts_problems(predictions) == [court]


def test_elos_home_court_is_never_below_zero(predictions):
    # 1 / (1 + 10 ^ (-(1614 - 40 - 1619) / 400)) = 0.4356: the arithmetic
    # adds up, and a home court that counts against the home team is refused.
    first_game(predictions)["elo"].update(home_court=-40, p_home=0.4356)

    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' elo: home_court must be a number, and 0 on a neutral floor"
    ]


def test_the_margin_of_points_and_rest_is_the_sum_of_its_three_parts_as_written(predictions):
    # Boston's win by 8, where 1.21 points against it were expected, moved
    # its rating from 5.12 to 5.67. Detroit is at 5.26. Boston played
    # yesterday, and has one game more in the last seven days.
    forecast = first_game(predictions)["points_rest"]
    assert forecast == {
        "p_home": 0.5944,
        "margin": 2.83,
        "rating_edge": -0.41,
        "home_court": 1.22,
        "rest_edge": 2.02,
    }

    forecast["margin"] = 2.84
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' points_rest: margin is 2.84, and rating_edge, "
        "home_court and rest_edge add up to 2.83"
    ]


@pytest.mark.parametrize(
    ("change", "complaint"),
    [
        ({"p_home": 1.0}, "p_home must be a number between 0 and 1, got 1.0"),
        (
            {"rest_edge": 2},
            "margin, rating_edge, home_court, rest_edge must be numbers of points",
        ),
        (
            {"margin": None},
            "margin, rating_edge, home_court, rest_edge must be numbers of points",
        ),
    ],
)
def test_a_points_and_rest_forecast_is_a_chance_and_four_numbers_of_points(
    predictions, change, complaint
):
    first_game(predictions)["points_rest"].update(change)

    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' points_rest: {complaint}"
    ]


def test_points_and_rest_is_left_out_of_the_forecasts_exactly_when_the_status_is_degraded(
    predictions,
):
    first_game(predictions)["points_rest"] = None
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' points_rest: not a JSON object"
    ]

    predictions.update(status="degraded", reasons=["BOS has 2 results on 2026-10-20"])
    assert forecasts_problems(predictions) == [
        f"predictions game '{SAS_OKC}': points_rest must be null when the status is degraded"
    ]


def test_the_line_next_to_a_forecast_is_a_line_from_before_it_was_published(predictions):
    game = first_game(predictions)
    assert game["market"] == LINE

    game["market"]["at"] = "2026-10-21T09:10:08Z"
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}': its line was captured at 2026-10-21T09:10:08Z, "
        "which is after the forecasts were published"
    ]
    # A line of the same second is one the job had when it published.
    game["market"]["at"] = "2026-10-21T09:10:07Z"
    assert forecasts_problems(predictions) == []

    game["market"]["n"] = 0
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' market: n must be a whole number of at least 1, got 0"
    ]
    game["market"] = 0.6
    assert forecasts_problems(predictions) == [
        f"predictions game '{DET_BOS}' market: not a JSON object"
    ]


def test_a_predictions_file_that_is_on_disk_is_never_written_again(predictions):
    on_disk = store.to_json(predictions)
    first_game(predictions)["market"] = None
    changed = store.to_json(predictions)
    never = f"{TODAY}: the file is there, and forecasts that are published never change"

    assert validate.predictions_problems({TODAY: on_disk}, {TODAY: changed}) == [never]
    assert validate.predictions_problems({TODAY: on_disk}, {TODAY: ""}) == [never]
    # Written with what is in it, it is not changed.
    assert validate.predictions_problems({TODAY: on_disk}, {TODAY: on_disk}) == []
    assert validate.predictions_problems({TODAY: on_disk}, {}) == []


def test_every_predictions_file_is_checked_the_old_ones_too(predictions):
    yesterday = "v1/predictions/2026-10-20.json"
    today = store.to_json(predictions)
    first_game(predictions)["neutral"] = None
    damaged = store.to_json(predictions)

    assert validate.predictions_problems({yesterday: "not json"}, {TODAY: today}) == [
        f"{yesterday}: not JSON"
    ]
    assert validate.predictions_problems({TODAY: damaged}, {}) == [
        f"{TODAY} game '{DET_BOS}': neutral is neither true nor false"
    ]


def test_a_predictions_file_holds_the_forecasts_of_the_day_in_its_name(predictions):
    tomorrow = "v1/predictions/2026-10-22.json"

    assert validate.predictions_problems({}, {tomorrow: store.to_json(predictions)}) == [
        f"{tomorrow}: the forecasts in it are for 2026-10-21"
    ]


def test_the_note_in_the_state_is_null_or_sound(built):
    noted = built.state["models"]
    assert validate.note_problems(None) == []
    assert validate.note_problems([]) == ["state models: not a JSON object"]

    noted.update(built_at=None, results_through="yesterday", status="fine")
    assert validate.note_problems(noted) == [
        "state models: built_at is not a UTC timestamp",
        "state models: results_through is neither a date nor null",
        "state models: status is 'fine', which is not one of ok, degraded",
    ]


@pytest.mark.parametrize(
    "change",
    [
        lambda ratings: ratings.pop("WAS"),
        lambda ratings: ratings.update(SEA=1500),
        lambda ratings: ratings.update(BOS=1618.64),
    ],
)
def test_the_state_notes_a_whole_number_rating_for_each_of_the_30_teams(built, change):
    noted = built.state["models"]
    change(noted["elo"])

    assert validate.note_problems(noted) == [
        "state models: elo must give each of the 30 teams a whole-number rating"
    ]
    assert validate.note_problems(dict(noted, elo=None)) == [
        "state models: elo must give each of the 30 teams a whole-number rating"
    ]


def test_the_forecasts_that_the_state_notes_are_held_to_the_checks_of_a_predictions_file(built):
    noted = built.state["models"]
    noted["predictions"]["games"][0]["elo"]["p_home"] = 0.9

    assert validate.note_problems(noted) == [
        f"state models predictions game '{DET_BOS}' elo: p_home is 0.9, "
        "and the ratings and the home court give 0.5502"
    ]
    # A day without a game to forecast has none.
    assert validate.note_problems(dict(noted, predictions=None)) == []


def test_what_the_board_says_of_the_models_is_null_or_sound():
    said = {"results_through": "2026-10-20", "status": "ok", "predictions_day": "2026-10-21"}

    assert validate.board_problems(None) == []
    assert validate.board_problems(said) == []
    assert validate.board_problems(dict(said, results_through=None, predictions_day=None)) == []
    assert validate.board_problems("ok") == ["slate models: not a JSON object"]
    assert validate.board_problems(dict(said, status=None, predictions_day="today")) == [
        "slate models: status is None, which is not one of ok, degraded",
        "slate models: predictions_day is neither a date nor null",
    ]
    assert validate.board_problems(dict(said, results_through=20261020)) == [
        "slate models: results_through is neither a date nor null"
    ]


def test_a_game_on_the_board_carries_elos_chance_and_a_frozen_forecast_or_null(predictions):
    frozen = first_game(predictions)["points_rest"]
    where = "slate game 'x'"

    assert validate.game_problems({"elo": {"p_home": 0.55}, "points_rest": frozen}, where) == []
    assert validate.game_problems({"elo": {"p_home": 0.55}, "points_rest": None}, where) == []
    assert validate.game_problems({"elo": None, "points_rest": None}, where) == []
    # A board of a sport that is forecast has both fields on every game.
    assert validate.game_problems({}, where) == [
        f"{where} elo: must be null or hold p_home, a number between 0 and 1",
        f"{where} points_rest: must be null or a forecast",
    ]
    assert validate.game_problems({"elo": {"p_home": 1}, "points_rest": None}, where) == [
        f"{where} elo: must be null or hold p_home, a number between 0 and 1"
    ]
    assert validate.game_problems({"elo": 0.55, "points_rest": None}, where) == [
        f"{where} elo: must be null or hold p_home, a number between 0 and 1"
    ]
    broken = dict(frozen, margin=9.99)
    assert validate.game_problems({"elo": None, "points_rest": broken}, where) == [
        f"{where} points_rest: margin is 9.99, and rating_edge, home_court "
        "and rest_edge add up to 2.83"
    ]
