"""
Tests for pipeline/model/points_rest.py.

The module is a port. tests/fixtures/points_rest_golden.json was written by
the implementation it was ported from, for exactly this purpose: seven
results with invented scores, the state they lead to and five forecasts,
chosen to go through a blowout beyond the cap, both kinds of back-to-back, a
neutral floor, a game at altitude and a date in the playoffs. The file is
kept as it was delivered. `model2.py` and `params_2026_27.json` in its note
are that implementation and the file that is
pipeline/model/points_rest_2026_27.json here, and it names the teams in full.
"""

import copy
import json
import math
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline import teams
from pipeline.model import points_rest, season
from pipeline.model.season import Final, Game

GOLDEN = json.loads((Path(__file__).parent / "fixtures" / "points_rest_golden.json").read_text())
EXPECTED = GOLDEN["expected"]
OPENING_DAY = date(2026, 10, 20)


@pytest.fixture(scope="module")
def opening():
    return season.load("2026_27")


@pytest.fixture
def parameters(opening):
    return copy.deepcopy(opening.points_rest)


def start_of(game):
    return datetime.strptime(game["commence_time"], "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc
    )


def golden_results(opening):
    return [
        opening.final(
            start_of(game),
            teams.CODES[game["home_team"]],
            teams.CODES[game["away_team"]],
            game["home_score"],
            game["away_score"],
        )
        for game in GOLDEN["results"]
    ]


@pytest.fixture
def replayed(opening):
    return points_rest.Model(opening.points_rest).replay(golden_results(opening))


def game(home, away, day, neutral=False):
    return Game(day, home, away, neutral)


def final(home, away, home_pts, away_pts, day=OPENING_DAY, neutral=False):
    return Final(day, home, away, neutral, home_pts, away_pts)


def test_the_state_after_the_seven_results_is_the_expected_one_to_the_last_bit(replayed):
    after = EXPECTED["after_replay"]

    assert replayed.home_court == after["home_court"]
    assert replayed.spread == after["r"]
    assert len(after["ratings"]) == len(after["variances"]) == 8
    for name, rating in after["ratings"].items():
        assert replayed.rating[teams.CODES[name]] == rating, name
    for name, variance in after["variances"].items():
        assert replayed.variance[teams.CODES[name]] == variance, name
    assert replayed.through == date(2026, 11, 7)


def test_the_five_forecasts_are_the_expected_ones(opening, replayed):
    assert len(EXPECTED["forecasts"]) == 5
    for expected in EXPECTED["forecasts"]:
        asked = expected["game"]
        fixture = opening.game(
            start_of(asked), teams.CODES[asked["home_team"]], teams.CODES[asked["away_team"]]
        )

        forecast = replayed.forecast(fixture)

        assert fixture.neutral is expected["neutral"], asked
        # Sums, products, quotients and a square root: the same on every
        # machine, and equal to the last bit.
        for part in (
            "margin",
            "sd",
            "rating_edge",
            "home_court",
            "rest_edge",
            "rating_home",
            "rating_away",
        ):
            assert getattr(forecast, part) == expected[part], (asked, part)
        # The chance goes through the error function of the C library,
        # which is not rounded the same way everywhere. On macOS, where the
        # file was written, it is equal to the last bit. On Linux one of the
        # five differs by one unit in the last place.
        assert abs(forecast.p_home - expected["p_home"]) <= math.ulp(expected["p_home"]), asked


def test_the_three_lines_that_came_with_each_forecast_can_be_written_from_its_numbers(
    opening, replayed
):
    for expected in EXPECTED["forecasts"]:
        asked = expected["game"]
        home, away = asked["home_team"], asked["away_team"]
        fixture = opening.game(start_of(asked), teams.CODES[home], teams.CODES[away])
        forecast = replayed.forecast(fixture)

        court = "neutral floor" if fixture.neutral else f"home court {forecast.home_court:+.1f}"
        rest = f"rest edge {forecast.rest_edge:+.1f}"
        assert expected["explain"] == [
            f"Rating edge {forecast.rating_edge:+.1f}, {rest}, {court}",
            f"Expected margin {forecast.margin:+.1f}: {home} {100 * forecast.p_home:.0f}%, "
            f"{away} {100 * (1 - forecast.p_home):.0f}%",
            f"Ratings: {home} {forecast.rating_home:+.1f}, {away} {forecast.rating_away:+.1f} "
            "(points against an average team)",
        ]


def test_the_order_the_results_are_given_in_does_not_matter(opening, replayed):
    backwards = points_rest.Model(opening.points_rest).replay(
        list(reversed(golden_results(opening)))
    )

    for team, rating in replayed.rating.items():
        assert backwards.rating[team] == pytest.approx(rating, abs=1e-12)
        assert backwards.variance[team] == pytest.approx(replayed.variance[team], abs=1e-12)
    assert backwards.spread == pytest.approx(replayed.spread, abs=1e-15)
    assert backwards.home_court == pytest.approx(replayed.home_court, abs=1e-15)


def test_a_replay_starts_over_from_the_opening_state(opening, parameters):
    model = points_rest.Model(parameters)
    results = golden_results(opening)

    model.replay(results)
    model.replay(results[:1])

    once = points_rest.Model(parameters).replay(results[:1])
    assert (model.rating, model.variance) == (once.rating, once.variance)
    assert (model.home_court, model.spread, model.through) == (
        once.home_court,
        once.spread,
        OPENING_DAY,
    )
    # And with nothing to replay it is the opening state itself.
    model.replay([])
    assert model.rating["NYK"] == parameters["state"]["teams"]["New York Knicks"]["rating"]
    assert model.home_court == parameters["state"]["home_court"]
    assert model.through is None


def test_on_opening_night_the_margin_is_the_rating_edge_and_the_home_court(parameters):
    model = points_rest.Model(parameters)
    state, coefficient = parameters["state"], parameters["coef"]

    forecast = model.forecast(game("DET", "BOS", OPENING_DAY))

    detroit, boston = (
        state["teams"][name]["rating"] for name in ("Detroit Pistons", "Boston Celtics")
    )
    assert forecast.rating_edge == detroit - boston
    # No team has played, so there is no rest to count. Detroit's arena is
    # 0.18 km above Boston's, which is worth an eighth of a point.
    assert forecast.rest_edge == 0
    assert forecast.home_court == pytest.approx(
        state["home_court"] + coefficient["home"] + coefficient["altitude_km"] * (0.19 - 0.01)
    )
    assert forecast.margin == forecast.rating_edge + forecast.home_court
    assert 1.2 < forecast.home_court < 1.3
    # A margin of a point and a half, with a standard deviation near twelve, is 55%.
    assert (round(forecast.margin, 1), round(forecast.sd, 1)) == (1.4, 11.9)
    assert round(forecast.p_home, 2) == 0.55


def test_the_chance_is_the_normal_distribution_function_of_the_margin_over_its_sd(parameters):
    forecast = points_rest.Model(parameters).forecast(game("NYK", "PHI", OPENING_DAY))

    assert forecast.p_home == points_rest.normal_cdf(forecast.margin / forecast.sd)
    assert points_rest.normal_cdf(0) == 0.5
    # 84.13% of a normal distribution lies below one standard deviation above its mean.
    assert points_rest.normal_cdf(1) == pytest.approx(0.841345, abs=1e-6)
    assert points_rest.normal_cdf(-1) == pytest.approx(1 - 0.841345, abs=1e-6)


def test_the_sd_comes_from_both_variances_the_noise_the_spread_and_the_scale(parameters):
    state = parameters["state"]
    forecast = points_rest.Model(parameters).forecast(game("NYK", "PHI", OPENING_DAY))

    variances = sum(
        state["teams"][name]["var"] for name in ("New York Knicks", "Philadelphia 76ers")
    )
    assert forecast.sd == pytest.approx(
        parameters["kappa"] * math.sqrt(state["r"] * (variances + 12.0**2))
    )


def test_a_team_that_has_not_played_for_a_while_is_less_certain(parameters):
    model = points_rest.Model(parameters)

    on_opening_night = model.forecast(game("NYK", "PHI", OPENING_DAY))
    ten_days_later = model.forecast(game("NYK", "PHI", OPENING_DAY + timedelta(days=10)))

    # Each variance has grown by 0.06 a day, so the sum under the root by 1.2.
    assert ten_days_later.sd > on_opening_night.sd
    assert (ten_days_later.sd / parameters["kappa"]) ** 2 / parameters["state"]["r"] == (
        pytest.approx(
            (on_opening_night.sd / parameters["kappa"]) ** 2 / parameters["state"]["r"] + 1.2
        )
    )
    assert ten_days_later.rating_edge == on_opening_night.rating_edge


def test_the_home_team_that_played_yesterday_is_given_less_and_the_visitor_that_did_more(
    parameters,
):
    coefficient = parameters["coef"]
    # Indiana and Denver play on Monday. On Tuesday Indiana hosts Boston,
    # and Denver visits New York.
    monday, tuesday = OPENING_DAY + timedelta(days=6), OPENING_DAY + timedelta(days=7)
    model = points_rest.Model(parameters).replay([final("IND", "DEN", 100, 110, day=monday)])

    tired_hosts = model.forecast(game("IND", "BOS", tuesday))
    tired_visitors = model.forecast(game("NYK", "DEN", tuesday))
    both_rested = model.forecast(game("NYK", "BOS", tuesday))

    # The team that played has also one game more in the last seven days.
    assert tired_hosts.rest_edge == pytest.approx(
        coefficient["b2b_home"] + coefficient["games7_diff"]
    )
    assert tired_visitors.rest_edge == pytest.approx(
        coefficient["b2b_away"] - coefficient["games7_diff"]
    )
    assert both_rested.rest_edge == 0
    assert tired_hosts.rest_edge < -1.6 and tired_visitors.rest_edge > 2.0


def test_a_game_two_days_ago_is_no_back_to_back_but_still_a_game_of_the_last_seven_days(parameters):
    coefficient = parameters["coef"]
    played = OPENING_DAY
    model = points_rest.Model(parameters).replay([final("IND", "DEN", 100, 110, day=played)])

    two_days_on = model.forecast(game("IND", "BOS", played + timedelta(days=2)))
    a_week_on = model.forecast(game("IND", "BOS", played + timedelta(days=7)))
    eight_days_on = model.forecast(game("IND", "BOS", played + timedelta(days=8)))

    assert two_days_on.rest_edge == pytest.approx(coefficient["games7_diff"])
    assert a_week_on.rest_edge == pytest.approx(coefficient["games7_diff"])
    assert eight_days_on.rest_edge == 0


def test_when_both_teams_played_yesterday_the_two_terms_are_both_counted(parameters):
    coefficient = parameters["coef"]
    monday = OPENING_DAY + timedelta(days=6)
    played = [final("IND", "DEN", 100, 110, day=monday), final("BOS", "NYK", 100, 110, day=monday)]
    model = points_rest.Model(parameters).replay(played)

    forecast = model.forecast(game("IND", "BOS", monday + timedelta(days=1)))

    assert forecast.rest_edge == pytest.approx(coefficient["b2b_home"] + coefficient["b2b_away"])


def test_denver_is_given_more_at_home_against_a_team_from_sea_level_and_no_less_on_the_road(
    parameters,
):
    model = points_rest.Model(parameters)
    usual = parameters["state"]["home_court"] + parameters["coef"]["home"]

    in_denver = model.forecast(game("DEN", "BOS", OPENING_DAY))
    in_boston = model.forecast(game("BOS", "DEN", OPENING_DAY))

    # Denver's arena is 1.609 km up and Boston's 0.01.
    assert in_denver.home_court == pytest.approx(
        usual + parameters["coef"]["altitude_km"] * (1.609 - 0.01)
    )
    assert in_denver.home_court - usual == pytest.approx(1.186, abs=1e-3)
    assert in_boston.home_court == pytest.approx(usual)


def test_after_the_regular_season_the_home_team_is_given_the_playoff_term(parameters):
    model = points_rest.Model(parameters)
    usual = parameters["state"]["home_court"] + parameters["coef"]["home"]

    last_day = model.forecast(game("NYK", "BOS", date(2027, 4, 11)))
    play_in = model.forecast(game("NYK", "BOS", date(2027, 4, 12)))

    assert last_day.home_court == pytest.approx(usual)
    assert play_in.home_court == pytest.approx(usual + parameters["coef"]["playoff_home"])


def test_on_a_neutral_floor_there_is_no_home_court_of_any_kind(parameters):
    model = points_rest.Model(parameters)

    in_the_playoffs_in_denver = model.forecast(game("DEN", "BOS", date(2027, 5, 1), neutral=True))

    assert in_the_playoffs_in_denver.home_court == 0
    assert in_the_playoffs_in_denver.margin == in_the_playoffs_in_denver.rating_edge


def test_a_result_moves_the_two_ratings_by_their_share_of_the_surprise(parameters):
    state = parameters["state"]
    home, away = state["teams"]["Detroit Pistons"], state["teams"]["Boston Celtics"]
    model = points_rest.Model(parameters).replay([final("DET", "BOS", 110, 101)])

    # Detroit won by 9. The ratings and the league's home court had it ahead by 1.86.
    surprise = 9 - (home["rating"] - away["rating"] + state["home_court"])
    total = home["var"] + away["var"] + 144
    assert surprise == pytest.approx(7.135, abs=1e-3)
    assert model.rating["DET"] == pytest.approx(home["rating"] + home["var"] / total * surprise)
    assert model.rating["BOS"] == pytest.approx(away["rating"] - away["var"] / total * surprise)
    # About 6% of the surprise each, and both are known a little better than before.
    assert model.rating["DET"] - home["rating"] == pytest.approx(0.427, abs=1e-3)
    assert model.variance["DET"] == pytest.approx(home["var"] - home["var"] ** 2 / total)
    assert model.variance["BOS"] == pytest.approx(away["var"] - away["var"] ** 2 / total)
    assert model.variance["DET"] < home["var"]
    # The teams that did not play are where they were.
    assert model.rating["NYK"] == state["teams"]["New York Knicks"]["rating"]
    assert model.variance["NYK"] == state["teams"]["New York Knicks"]["var"]


def test_a_result_moves_the_leagues_home_court_and_the_spread_a_little(parameters):
    state = parameters["state"]
    home, away = state["teams"]["Detroit Pistons"], state["teams"]["Boston Celtics"]
    surprise = 9 - (home["rating"] - away["rating"] + state["home_court"])
    total = home["var"] + away["var"] + 144

    model = points_rest.Model(parameters).replay([final("DET", "BOS", 110, 101)])

    assert model.home_court == pytest.approx(state["home_court"] + surprise / 3000)
    assert model.spread == pytest.approx(state["r"] + (surprise**2 / total - state["r"]) / 1000)


def test_a_result_on_a_neutral_floor_is_held_against_the_ratings_alone(parameters):
    state = parameters["state"]
    home, away = state["teams"]["Detroit Pistons"], state["teams"]["Boston Celtics"]
    total = home["var"] + away["var"] + 144

    model = points_rest.Model(parameters).replay([final("DET", "BOS", 110, 101, neutral=True)])

    surprise = 9 - (home["rating"] - away["rating"])
    assert model.rating["DET"] == pytest.approx(home["rating"] + home["var"] / total * surprise)
    # And it says nothing about the league's home court.
    assert model.home_court == state["home_court"]


def test_a_blowout_counts_as_22_points(parameters):
    by_22 = points_rest.Model(parameters).replay([final("NYK", "PHI", 122, 100)])
    by_40 = points_rest.Model(parameters).replay([final("NYK", "PHI", 140, 100)])
    by_21 = points_rest.Model(parameters).replay([final("NYK", "PHI", 121, 100)])

    assert by_40.rating == by_22.rating
    assert by_21.rating["NYK"] < by_22.rating["NYK"]
    # The same in the other direction.
    lost_by_22 = points_rest.Model(parameters).replay([final("NYK", "PHI", 100, 122)])
    lost_by_40 = points_rest.Model(parameters).replay([final("NYK", "PHI", 100, 140)])
    assert lost_by_40.rating == lost_by_22.rating
    assert lost_by_22.rating["NYK"] < by_22.rating["NYK"]


def test_every_game_of_a_day_is_held_against_the_state_before_the_day(parameters):
    # Two games of opening night. Whichever is taken first, the second is
    # held against the league's home court as it was that morning.
    first = final("DET", "BOS", 130, 100)
    second = final("NYK", "PHI", 101, 100)
    alone = points_rest.Model(parameters).replay([second])

    together = points_rest.Model(parameters).replay([first, second])

    assert together.rating["NYK"] == alone.rating["NYK"]
    assert together.rating["PHI"] == alone.rating["PHI"]
    assert together.home_court > alone.home_court


def test_a_forecast_for_a_day_that_has_results_is_refused(replayed):
    with pytest.raises(ValueError, match="2026-11-07 is not after the last replayed day"):
        replayed.forecast(game("NYK", "BOS", date(2026, 11, 7)))
    with pytest.raises(ValueError, match="2026-10-25 is not after the last replayed day"):
        replayed.forecast(game("NYK", "BOS", date(2026, 10, 25)))

    assert 0 < replayed.forecast(game("NYK", "BOS", date(2026, 11, 8))).p_home < 1


def test_a_game_before_the_first_day_of_the_season_is_refused(parameters):
    model = points_rest.Model(parameters)
    preseason = date(2026, 10, 19)

    with pytest.raises(ValueError, match="2026-10-19 is before the first day of the season"):
        model.forecast(game("NYK", "BOS", preseason))
    with pytest.raises(ValueError, match="2026-10-19 is before the first day of the season"):
        model.replay([final("NYK", "BOS", 100, 90, day=preseason)])


def test_parameters_for_a_team_that_is_not_one_of_the_30_are_refused(parameters):
    parameters["state"]["teams"]["LA Clippers"] = parameters["state"]["teams"].pop(
        "Los Angeles Clippers"
    )

    with pytest.raises(ValueError, match="'LA Clippers' is not one of the 30 team names"):
        points_rest.Model(parameters)


def test_the_next_season_starts_nearer_the_mean_and_less_certain(opening, parameters, replayed):
    following = points_rest.next_season(
        parameters,
        replayed,
        season="2027-28",
        first_day="2027-10-19",
        last_regular_day="2028-04-09",
        neutral_games=[],
    )

    mean = sum(replayed.rating.values()) / 30
    knicks = following["state"]["teams"]["New York Knicks"]
    # Four fifths of the distance to the mean are kept.
    assert knicks["rating"] == pytest.approx(mean + 0.8 * (replayed.rating["NYK"] - mean))
    assert knicks["var"] == pytest.approx(0.64 * replayed.variance["NYK"] + 7.0)
    assert knicks["var"] > replayed.variance["NYK"]
    assert list(following["state"]["teams"]) == list(parameters["state"]["teams"])
    # The mean of the league is where it was.
    ratings = [team["rating"] for team in following["state"]["teams"].values()]
    assert sum(ratings) / 30 == pytest.approx(mean)
    assert following["state"]["home_court"] == replayed.home_court
    assert following["state"]["r"] == replayed.spread
    assert (following["season"], following["season_first_day"]) == ("2027-28", "2027-10-19")
    assert (following["regular_season_last_day"], following["neutral_games"]) == ("2028-04-09", [])
    # What is fitted is copied, and the file handed in is left as it was.
    for kept in ("constants", "coef", "kappa", "arena_altitude_km"):
        assert following[kept] == parameters[kept]
    assert parameters == opening.points_rest
    # The new file is one the model can start from.
    assert points_rest.Model(following).rating["NYK"] == knicks["rating"]
