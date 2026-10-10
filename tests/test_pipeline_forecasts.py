"""
Tests for pipeline/forecasts.py: the model file and the forecasts of a day,
built from result lines and from the games the state knows.

Every game, line and score here is invented. The opening files are the real
ones of 2026-27.
"""

import copy
import random
from datetime import date, datetime, timedelta, timezone

import pytest

from pipeline import forecasts, store, teams, validate_forecasts
from pipeline.model import elo, points_rest, season

OPENING = season.load("2026_27")
OPENING_ELO = OPENING.elo["ratings"]

# Tuesday 20 October 2026, the first day of the season, and the mornings
# after it. A daily run comes at 05:10 in New York, which is 09:10 UTC.
TUESDAY, WEDNESDAY, THURSDAY = date(2026, 10, 20), date(2026, 10, 21), date(2026, 10, 22)
TUESDAY_MORNING = datetime(2026, 10, 20, 9, 10, 7, tzinfo=timezone.utc)
WEDNESDAY_MORNING = TUESDAY_MORNING + timedelta(days=1)
THURSDAY_MORNING = TUESDAY_MORNING + timedelta(days=2)
LINE = {"p_home": 0.6, "lo": 0.58, "hi": 0.61, "n": 3, "at": "2026-10-20T01:10:30Z"}

# Three games on Tuesday evening and one on Wednesday, in which Boston plays
# for the second evening in a row.
SAS_OKC, BOS_NYK, LAL_GSW, DET_BOS = "a" * 32, "b" * 32, "c" * 32, "d" * 32
GAMES = {
    SAS_OKC: ("SAS", "OKC", "2026-10-20T23:00:00Z"),
    BOS_NYK: ("BOS", "NYK", "2026-10-20T23:30:00Z"),
    LAL_GSW: ("LAL", "GSW", "2026-10-21T02:00:00Z"),
    DET_BOS: ("DET", "BOS", "2026-10-21T23:00:00Z"),
}


def game(home, away, start, line=None):
    """A game as the state holds it."""
    return {"commence_time": start, "home": home, "away": away, "first": None, "latest": line}


def known(*game_ids, lines=None):
    """The games of a state, by id. Each has the line given for it, or none."""
    return {game_id: game(*GAMES[game_id], (lines or {}).get(game_id)) for game_id in game_ids}


def result(game_id, home_pts, away_pts, recorded_at="2026-10-21T09:10:07Z", **changes):
    """A result line. The models read its id, its start, its teams and its score."""
    home, away, start = GAMES.get(game_id, (None, None, None))
    line = {
        "id": game_id,
        "commence_time": start,
        "home": home,
        "away": away,
        "home_pts": home_pts,
        "away_pts": away_pts,
        "recorded_at": recorded_at,
        "market": None,
        "market_verdict": "not_graded",
    }
    return {**line, **changes}


def build(lines=(), games=None, now=TUESDAY_MORNING, day=TUESDAY, frozen=None, commit=None):
    state = {"schema": 1, "games": known(*GAMES) if games is None else games, "results": None}
    return forecasts.build(
        list(lines),
        state,
        now,
        sport="basketball_nba",
        season=OPENING,
        day=day,
        frozen=frozen,
        commit=commit,
    )


# What two of Tuesday's games do to Elo, by hand.
#
# Boston, 1607, hosts New York, 1720, and wins 112 to 104.
#   edge 1607 + 40 - 1720 = -73, chance 1 / (1 + 10 ^ (73 / 400)) = 0.396464
#   multiplier 11 ^ 0.8 / (7.5 - 0.006 x 73) = 6.809483 / 7.062 = 0.964243
#   Boston gains 20 x 0.964243 x (1 - 0.396464) = 11.64: 1618.64 and 1708.36
#
# The Lakers, 1568, host Golden State, 1451, and lose 99 to 120.
#   edge 1568 + 40 - 1451 = 157, chance 0.711723
#   multiplier 24 ^ 0.8 / (7.5 - 0.006 x 157) = 12.710686 / 6.558 = 1.938196
#   the Lakers lose 20 x 1.938196 x 0.711723 = 27.59: 1540.41 and 1478.59
TUESDAY_NIGHT = [result(BOS_NYK, 112, 104), result(LAL_GSW, 99, 120)]
AFTER_TUESDAY = {"BOS": 1619, "NYK": 1708, "LAL": 1540, "GSW": 1479}
# The state on Wednesday morning, when those two were Tuesday's games.
WEDNESDAY_GAMES = known(BOS_NYK, LAL_GSW, DET_BOS)


def on_wednesday(lines=TUESDAY_NIGHT, games=WEDNESDAY_GAMES):
    return build(lines, games, WEDNESDAY_MORNING, WEDNESDAY)


def test_before_the_first_result_both_models_are_at_their_opening_state():
    built = build().model

    assert {name: built[name] for name in list(built)[:8]} == {
        "schema": 1,
        "sport": "basketball_nba",
        "season": "2026-27",
        "built_at": "2026-10-20T09:10:07Z",
        "results_through": None,
        "games": 0,
        "status": "ok",
        "reasons": [],
    }
    assert built["elo"]["constants"] == {"k": 20, "home_court": 40, "mean": 1505, "reversion": 0.25}
    assert built["elo"]["ratings"] == {
        team: {"rating": rating, "week_ago": rating} for team, rating in OPENING_ELO.items()
    }
    assert built["teams"] == {team: {"wins": 0, "losses": 0} for team in teams.ALL_CODES}
    assert list(built["teams"]) == sorted(teams.ALL_CODES)


def test_the_points_and_rest_ratings_have_the_leagues_mean_taken_off():
    built = build().model["points_rest"]
    opening = OPENING.points_rest["state"]
    mean = sum(team["rating"] for team in opening["teams"].values()) / 30

    # The opening ratings average a quarter of a point. A rating that is
    # published is in points against an average team.
    assert mean == pytest.approx(0.2471, abs=1e-4)
    assert built["ratings"]["SAS"] == {
        "rating": round(opening["teams"]["San Antonio Spurs"]["rating"] - mean, 2),
        "uncertainty": 3.15,
    }
    assert built["ratings"]["SAS"]["rating"] == 8.3
    assert sum(team["rating"] for team in built["ratings"].values()) == pytest.approx(0, abs=0.05)
    assert set(built["ratings"]) == teams.ALL_CODES
    # The league's home court, before the home constant of a forecast is added to it.
    assert built["home_court"] == 1.73


def test_the_model_file_names_the_two_parameter_files_and_the_commit_of_the_code():
    commit = "0123456789abcdef0123456789abcdef01234567"

    built = build(commit=commit)

    assert built.model["parameters"] == OPENING.parameters
    assert built.model["code_commit"] == commit
    assert (built.predictions["parameters"], built.predictions["code_commit"]) == (
        OPENING.parameters,
        commit,
    )
    assert build().model["code_commit"] is None


def test_each_game_of_the_day_that_has_not_started_gets_a_forecast():
    built = build(games=known(*GAMES, lines={SAS_OKC: LINE})).predictions

    assert {name: value for name, value in built.items() if name != "games"} == {
        "schema": 1,
        "sport": "basketball_nba",
        "day": "2026-10-20",
        "published_at": "2026-10-20T09:10:07Z",
        "results_through": None,
        "status": "ok",
        "reasons": [],
        "parameters": OPENING.parameters,
        "code_commit": None,
    }
    # In order of start. Wednesday's game is not one of the day.
    assert [forecast["id"] for forecast in built["games"]] == [SAS_OKC, BOS_NYK, LAL_GSW]
    assert built["games"][0] == {
        "id": SAS_OKC,
        "commence_time": "2026-10-20T23:00:00Z",
        "home": "SAS",
        "away": "OKC",
        "neutral": False,
        # 10 ^ (-(1702 + 40 - 1684) / 400) = 0.716143, and 1 / 1.716143 = 0.5827.
        "elo": {"p_home": 0.5827, "home_rating": 1702, "away_rating": 1684, "home_court": 40},
        # The opening ratings are 8.55 and 7.97. The league's home court of
        # 1.73 and the home constant of -0.63 make 1.09, and San Antonio's
        # arena is lower than Oklahoma City's. No team has played yet.
        "points_rest": {
            "p_home": 0.5559,
            "margin": 1.67,
            "rating_edge": 0.58,
            "home_court": 1.09,
            "rest_edge": 0.0,
        },
        "market": LINE,
    }
    # A game that no sportsbook has quoted yet is forecast all the same.
    assert built["games"][1]["market"] is None


def test_elos_chance_is_the_one_its_whole_number_ratings_give():
    # After Tuesday the ratings have decimals: Boston is at 1618.64 and
    # Detroit, which did not play, at 1614. What is published is worked out
    # from 1619.
    (forecast,) = on_wednesday().predictions["games"]

    assert forecast["elo"] == {
        "p_home": round(elo.win_probability(1614, 1619, 40), 4),
        "home_rating": 1614,
        "away_rating": 1619,
        "home_court": 40,
    }
    assert forecast["elo"]["p_home"] != round(elo.win_probability(1614, 1618.64, 40), 4)


def test_the_three_parts_that_are_written_add_up_to_the_margin_that_is_written():
    # Thirty games on opening night: every team at home once.
    visitors = ["NYK"] * 19 + ["ATL"] * 11
    games = {
        f"{number:032x}": game(home, away, "2026-10-20T23:00:00Z")
        for number, (home, away) in enumerate(zip(sorted(teams.ALL_CODES), visitors))
    }
    exact = points_rest.Model(OPENING.points_rest)
    tip_off = datetime(2026, 10, 20, 23, 0, tzinfo=timezone.utc)

    built = build(games=games).predictions["games"]

    assert len(built) == 30
    off_by_a_hundredth = 0
    for forecast in built:
        written = forecast["points_rest"]
        parts = [written[name] for name in ("rating_edge", "home_court", "rest_edge")]
        assert round(written["margin"] * 100) == sum(round(part * 100) for part in parts)
        unrounded = exact.forecast(OPENING.game(tip_off, forecast["home"], forecast["away"]))
        assert parts == [
            round(unrounded.rating_edge, 2),
            round(unrounded.home_court, 2),
            round(unrounded.rest_edge, 2),
        ]
        assert written["p_home"] == round(unrounded.p_home, 4)
        off_by_a_hundredth += written["margin"] != round(unrounded.margin, 2)
    # The sum of the rounded parts is not always the rounded sum.
    assert off_by_a_hundredth > 0


def test_a_part_just_below_zero_is_written_as_zero_without_a_minus_sign():
    # Two teams that the model rates the same to within a hundredth of a
    # point, with the home team the lower one by a hair.
    forecast = points_rest.Forecast(
        p_home=0.4999,
        margin=-0.004,
        sd=11.9,
        rating_edge=-0.004,
        home_court=0.0,
        rest_edge=-0.0,
        rating_home=1.0,
        rating_away=1.004,
    )

    written = forecasts._points_rest_forecast(forecast)

    assert written == {
        "p_home": 0.4999,
        "margin": 0.0,
        "rating_edge": 0.0,
        "home_court": 0.0,
        "rest_edge": 0.0,
    }
    assert "-0.0" not in store.to_json(written)
    assert "-0.0" not in store.to_json(build().model)


def test_a_game_on_a_neutral_floor_gets_no_home_court_from_either_model():
    # Indiana and Denver in Mexico City on 7 November, which is on the list.
    mexico_city = {"e" * 32: game("IND", "DEN", "2026-11-07T22:00:00Z")}
    morning = datetime(2026, 11, 7, 10, 10, 5, tzinfo=timezone.utc)

    (forecast,) = build([], mexico_city, morning, date(2026, 11, 7)).predictions["games"]

    assert forecast["neutral"] is True
    # 1 / (1 + 10 ^ ((1597 - 1379) / 400)) = 0.2219. At home it would be 0.2641.
    assert forecast["elo"] == {
        "p_home": 0.2219,
        "home_rating": 1379,
        "away_rating": 1597,
        "home_court": 0,
    }
    assert forecast["points_rest"]["home_court"] == 0.0
    assert forecast["points_rest"]["margin"] == forecast["points_rest"]["rating_edge"]


def test_a_game_that_has_started_or_belongs_to_another_day_gets_no_forecast():
    # 19:30 in New York on Tuesday: the first game has started, the second
    # starts this second, the third is still to come.
    evening = datetime(2026, 10, 20, 23, 30, 0, tzinfo=timezone.utc)

    built = build(now=evening).predictions

    assert [forecast["id"] for forecast in built["games"]] == [LAL_GSW]
    assert built["published_at"] == "2026-10-20T23:30:00Z"


def test_a_day_without_a_game_to_forecast_has_no_predictions_file():
    built = build(games=known(DET_BOS))

    assert built.predictions is None
    assert built.state["models"]["predictions"] is None
    # The model file is built all the same.
    assert built.model["games"] == 0


def test_the_results_move_the_ratings_of_exactly_the_teams_that_played():
    built = on_wednesday().model

    ratings = built["elo"]["ratings"]
    assert {team: ratings[team]["rating"] for team in AFTER_TUESDAY} == AFTER_TUESDAY
    moved = {team for team in ratings if ratings[team]["rating"] != OPENING_ELO[team]}
    assert moved == {"BOS", "NYK", "LAL", "GSW"}
    before = build().model["points_rest"]["ratings"]
    after = built["points_rest"]["ratings"]
    # A result moves the league's mean a little, and with it every rating
    # that has the mean taken off: by less than a tenth of a point here.
    far = {team for team in after if abs(after[team]["rating"] - before[team]["rating"]) > 0.1}
    assert far == {"BOS", "NYK", "LAL", "GSW"}
    # A team that has played is known a little better than one that has not.
    assert after["BOS"]["uncertainty"] < before["BOS"]["uncertainty"]
    assert after["DET"]["uncertainty"] == before["DET"]["uncertainty"]
    assert (built["games"], built["results_through"]) == (2, "2026-10-20")


def test_the_whole_number_ratings_of_elo_add_up_to_what_they_added_up_to():
    ratings = on_wednesday().model["elo"]["ratings"]

    assert sum(OPENING_ELO.values()) == 45149
    # Two games moved 11.64 and 27.59 points from one team to another.
    assert sum(team["rating"] for team in ratings.values()) == 45149


def test_every_team_has_its_wins_and_losses():
    lines = [*TUESDAY_NIGHT, result(SAS_OKC, 88, 93), result(DET_BOS, 110, 101)]

    built = build(lines, {}, THURSDAY_MORNING, THURSDAY).model["teams"]

    played = {
        "BOS": {"wins": 1, "losses": 1},
        "NYK": {"wins": 0, "losses": 1},
        "LAL": {"wins": 0, "losses": 1},
        "GSW": {"wins": 1, "losses": 0},
        "SAS": {"wins": 0, "losses": 1},
        "OKC": {"wins": 1, "losses": 0},
        "DET": {"wins": 1, "losses": 0},
    }
    assert {team: built[team] for team in played} == played
    assert all(built[team] == {"wins": 0, "losses": 0} for team in set(built) - set(played))


def test_the_rating_of_a_week_ago_is_the_one_seven_days_before_the_last_day_of_results():
    # Boston beats New York on the 20th, and New York beats Boston on the
    # 26th and on the 27th. With the 27th as the last day of results, a week
    # ago is the evening of the 20th, after the first game.
    first = result(BOS_NYK, 112, 104)
    second = result(
        "1" * 32, 101, 100, home="NYK", away="BOS", commence_time="2026-10-26T23:30:00Z"
    )
    third = result("2" * 32, 101, 100, home="NYK", away="BOS", commence_time="2026-10-27T23:30:00Z")
    morning = datetime(2026, 10, 28, 9, 10, 7, tzinfo=timezone.utc)

    built = build([first, second, third], {}, morning, date(2026, 10, 28)).model

    assert built["results_through"] == "2026-10-27"
    boston = built["elo"]["ratings"]["BOS"]
    assert boston["week_ago"] == AFTER_TUESDAY["BOS"]
    assert boston["rating"] < boston["week_ago"]
    # A day earlier the results reached the 26th, and a week before that no
    # game of the season had been played.
    a_day_earlier = build([first, second], {}, morning - timedelta(days=1), date(2026, 10, 27))
    boston = a_day_earlier.model["elo"]["ratings"]["BOS"]
    assert boston["week_ago"] == OPENING_ELO["BOS"]
    assert OPENING_ELO["BOS"] < boston["rating"] < AFTER_TUESDAY["BOS"]


def test_a_result_from_before_the_season_is_not_a_result_of_the_season():
    preseason = result(
        "9" * 32, 120, 80, home="DET", away="BOS", commence_time="2026-10-19T23:00:00Z"
    )

    built = on_wednesday([preseason, *TUESDAY_NIGHT]).model

    assert built == on_wednesday().model
    assert built["teams"]["DET"] == {"wins": 0, "losses": 0}
    assert built["games"] == 2


def test_the_forecasts_of_the_day_come_from_the_results_of_the_days_before():
    built = on_wednesday().predictions

    (forecast,) = built["games"]
    assert (forecast["id"], built["results_through"]) == (DET_BOS, "2026-10-20")
    assert built["published_at"] == "2026-10-21T09:10:07Z"
    # Detroit did not play on Tuesday. Boston did, and won.
    assert (forecast["elo"]["home_rating"], forecast["elo"]["away_rating"]) == (1614, 1619)
    # The visitors played yesterday, which is worth 1.71 points to the home
    # team, and they have one game more in the last seven days, which is
    # worth another 0.32.
    assert forecast["points_rest"]["rest_edge"] == 2.02
    # On opening night Detroit's home court was 1.23. The Lakers' loss at
    # home by 21 took a hundredth off the league's.
    assert forecast["points_rest"]["home_court"] == 1.22


def test_a_result_of_the_same_day_does_not_enter_the_days_forecasts():
    # The daily work is done late, by hand, when an afternoon game of
    # Tuesday is already over. Its winner plays again that evening, which no
    # schedule has, but it shows what a forecast is made from.
    late = datetime(2026, 10, 21, 1, 45, 0, tzinfo=timezone.utc)
    afternoon_game = result(
        "f" * 32,
        90,
        120,
        home="DET",
        away="LAL",
        commence_time="2026-10-20T19:00:00Z",
        recorded_at="2026-10-21T01:45:00Z",
    )

    built = build([afternoon_game], known(LAL_GSW), late, TUESDAY)

    # The model file has the result. The forecast is the one of that morning.
    assert built.model["results_through"] == "2026-10-20"
    assert built.model["elo"]["ratings"]["LAL"]["rating"] > OPENING_ELO["LAL"]
    (evening_game,) = built.predictions["games"]
    assert (evening_game["home"], evening_game["elo"]["home_rating"]) == ("LAL", OPENING_ELO["LAL"])
    assert built.predictions["results_through"] is None
    assert evening_game == build([], known(LAL_GSW), late, TUESDAY).predictions["games"][0]


def test_the_same_lines_give_the_same_bytes():
    # Tuesday's two results and one of Wednesday.
    lines = [*TUESDAY_NIGHT, result(DET_BOS, 99, 98, recorded_at="2026-10-22T09:10:07Z")]

    def written(lines):
        built = build(lines, {}, THURSDAY_MORNING, THURSDAY)
        return store.to_json(built.model)

    first = written(lines)

    assert '"results_through": "2026-10-21"' in first
    assert written(lines) == first
    assert written(list(reversed(lines))) == first


def test_the_models_are_handed_the_results_in_order_of_start_however_they_were_recorded(
    monkeypatch,
):
    # Within a day the order of the games does not change a rating by more
    # than the last digits of its decimals. Handing the games over in one
    # order every time keeps even those the same.
    handed_over = []
    replay = elo.replay

    def recording_replay(ratings, games, **constants):
        handed_over.append([(game.home, game.away) for game in games])
        return replay(ratings, games, **constants)

    monkeypatch.setattr(elo, "replay", recording_replay)
    early = result(SAS_OKC, 101, 99)

    build([*TUESDAY_NIGHT, early], {}, WEDNESDAY_MORNING, WEDNESDAY)
    in_order = handed_over[0]
    handed_over.clear()
    build([early, *reversed(TUESDAY_NIGHT)], {}, WEDNESDAY_MORNING, WEDNESDAY)

    assert in_order == [("SAS", "OKC"), ("BOS", "NYK"), ("LAL", "GSW")]
    assert handed_over[0] == in_order


def test_a_day_that_was_skipped_leaves_the_same_ratings_as_one_that_was_not():
    # Twelve games on four evenings. Run every morning, each night's results
    # are recorded the morning after. With mornings skipped, one run records
    # all four nights at once, in whatever order the provider lists them.
    shuffle = random.Random(7).shuffle
    codes = sorted(teams.ALL_CODES)
    every_morning, caught_up = [], []
    for night in range(4):
        tonight = [
            result(
                f"{night * 10 + n:032x}",
                100 + 7 * n + night,
                96 + 5 * night + n,
                home=codes[(n * 2 + night * 6) % 30],
                away=codes[(n * 2 + night * 6 + 1) % 30],
                commence_time=f"2026-10-2{night}T23:{n}0:00Z",
                recorded_at=f"2026-10-2{night + 1}T09:10:07Z",
            )
            for n in range(3)
        ]
        every_morning += tonight
        caught_up += [dict(line, recorded_at="2026-10-24T09:10:07Z") for line in tonight]
    shuffle(caught_up)
    morning = datetime(2026, 10, 24, 9, 10, 7, tzinfo=timezone.utc)

    daily = build(every_morning, {}, morning, date(2026, 10, 24)).model
    after_a_gap = build(caught_up, {}, morning, date(2026, 10, 24)).model

    assert (daily["games"], daily["status"]) == (12, "ok")
    assert [line["id"] for line in caught_up] != [line["id"] for line in every_morning]
    assert store.to_json(after_a_gap) == store.to_json(daily)


def test_a_result_that_is_recorded_twice_leaves_elo_alone():
    built = on_wednesday([*TUESDAY_NIGHT, TUESDAY_NIGHT[0]])

    assert built.reasons == [
        f"game {BOS_NYK} is recorded 2 times",
        "BOS has 2 results on 2026-10-20",
        "NYK has 2 results on 2026-10-20",
    ]
    assert (built.model["status"], built.model["reasons"]) == ("degraded", built.reasons)
    assert built.model["points_rest"] is None
    # Elo is published from the results as they are.
    assert built.model["elo"]["ratings"]["BOS"]["rating"] > AFTER_TUESDAY["BOS"]
    (forecast,) = built.predictions["games"]
    assert forecast["points_rest"] is None
    assert (forecast["id"], forecast["elo"]["home_rating"]) == (DET_BOS, 1614)
    assert (built.predictions["status"], built.predictions["reasons"]) == (
        "degraded",
        built.reasons,
    )
    assert built.state["models"]["status"] == "degraded"


def test_a_team_with_two_results_on_one_day_leaves_elo_alone():
    # The same evening, under another id: Boston is said to have played in Detroit as well.
    doubled = result("7" * 32, 99, 98, home="DET", away="BOS", commence_time="2026-10-21T00:00:00Z")

    built = on_wednesday([*TUESDAY_NIGHT, doubled])

    assert built.reasons == ["BOS has 2 results on 2026-10-20"]
    assert built.model["points_rest"] is None


def test_two_results_of_one_team_on_two_days_are_no_reason_for_doubt():
    built = build([*TUESDAY_NIGHT, result(DET_BOS, 99, 98)], {}, THURSDAY_MORNING, THURSDAY)

    assert (built.reasons, built.model["status"]) == ([], "ok")
    assert built.model["points_rest"] is not None


def test_a_game_that_the_state_knows_and_that_has_no_result_leaves_elo_alone():
    # San Antonio against Oklahoma City started on Tuesday at 19:00 in New
    # York, ten hours before the daily run, and there is no result for it.
    built = on_wednesday(games=known(*GAMES))

    assert built.reasons == [
        f"no result for OKC at SAS, which started at 2026-10-20T23:00:00Z (game {SAS_OKC})"
    ]
    assert built.model["status"] == "degraded"
    assert built.model["points_rest"] is None
    assert [forecast["points_rest"] for forecast in built.predictions["games"]] == [None]
    # With the result there, nothing is left out.
    complete = on_wednesday([*TUESDAY_NIGHT, result(SAS_OKC, 110, 101)], known(*GAMES))
    assert (complete.reasons, complete.model["status"]) == ([], "ok")
    assert complete.predictions["games"][0]["points_rest"] is not None


@pytest.mark.parametrize(
    ("started_ago", "expected"),
    [
        (timedelta(hours=5, minutes=59, seconds=59), "ok"),
        (timedelta(hours=6), "degraded"),
        (timedelta(days=2, hours=23, minutes=59, seconds=59), "degraded"),
        (timedelta(days=3), "ok"),
    ],
    ids=["just under six hours", "six hours", "just under three days", "three days"],
)
def test_a_result_is_expected_from_six_hours_after_the_start_until_three_days_after_it(
    started_ago, expected
):
    # A morning in November, well into the season.
    morning = datetime(2026, 11, 10, 10, 10, 7, tzinfo=timezone.utc)
    start = (morning - started_ago).strftime("%Y-%m-%dT%H:%M:%SZ")

    built = build([], {"e" * 32: game("DET", "BOS", start)}, morning, date(2026, 11, 10))

    assert built.model["status"] == expected


def test_a_game_from_before_the_season_is_not_expected_to_have_a_result():
    preseason = {SAS_OKC: game("SAS", "OKC", "2026-10-19T23:00:00Z")}

    assert build([], preseason).model["status"] == "ok"
    # The same game a day later is one of the season, and its result is missed.
    assert on_wednesday([], known(SAS_OKC)).model["status"] == "degraded"


def test_a_game_from_before_the_season_is_not_forecast():
    # Monday 19 October, the day before the season starts.
    monday_morning = TUESDAY_MORNING - timedelta(days=1)
    preseason = {SAS_OKC: game("SAS", "OKC", "2026-10-19T23:00:00Z")}

    built = build([], preseason, monday_morning, TUESDAY - timedelta(days=1))

    assert built.predictions is None
    assert (built.model["status"], built.model["games"]) == ("ok", 0)


def test_forecasts_that_are_published_are_not_made_again():
    morning = build(games=known(SAS_OKC, BOS_NYK))
    frozen = copy.deepcopy(morning.predictions)
    # A second run of the daily work that day knows one game more and has a line by now.
    later = TUESDAY_MORNING + timedelta(minutes=30)

    again = build([], known(*GAMES, lines={SAS_OKC: LINE}), later, TUESDAY, frozen=frozen)

    assert again.predictions is None
    assert again.state["models"]["predictions"] == frozen == morning.predictions
    # The model file is built again, and it says when.
    assert again.model["built_at"] == "2026-10-20T09:40:07Z"
    assert again.state["models"]["built_at"] == "2026-10-20T09:40:07Z"


def test_the_state_notes_elos_ratings_and_the_days_forecasts_for_the_board():
    state = {"schema": 1, "games": WEDNESDAY_GAMES, "results": {"last_slot": "x"}, "credits": {}}
    untouched = copy.deepcopy(state)

    built = forecasts.build(
        TUESDAY_NIGHT,
        state,
        WEDNESDAY_MORNING,
        sport="basketball_nba",
        season=OPENING,
        day=WEDNESDAY,
        frozen=None,
        commit=None,
    )

    assert built.state == {
        **untouched,
        "models": {
            "built_at": "2026-10-21T09:10:07Z",
            "results_through": "2026-10-20",
            "status": "ok",
            "elo": {**OPENING_ELO, **AFTER_TUESDAY},
            "predictions": built.predictions,
        },
    }
    assert state == untouched
    # What is noted is a copy: the board is not handed the file's own objects.
    assert built.state["models"]["predictions"] is not built.predictions


def test_what_is_built_passes_the_checks():
    built = on_wednesday()

    assert validate_forecasts.model_problems(built.model, TUESDAY_NIGHT, OPENING) == []
    assert validate_forecasts.forecasts_problems(built.predictions, "predictions") == []
    assert validate_forecasts.note_problems(built.state["models"]) == []
