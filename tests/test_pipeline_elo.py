"""
Tests for pipeline/model/elo.py: the rule against updates worked out by
hand. The games are invented.
"""

from datetime import date, timedelta

import pytest

from pipeline.model import elo
from pipeline.model.season import Final

OPENING_DAY = date(2026, 10, 20)


def final(home, away, home_pts, away_pts, day=OPENING_DAY, neutral=False):
    return Final(day, home, away, neutral, home_pts, away_pts)


def test_two_even_teams_at_a_home_court_of_40():
    # 10 ^ (-40 / 400) = 0.794328, and 1 / 1.794328 = 0.557312.
    assert elo.win_probability(1500, 1500, 40) == pytest.approx(0.557312, abs=1e-6)
    # Any two ratings that are as far apart give the same chance.
    assert elo.win_probability(1620, 1620, 40) == pytest.approx(0.557312, abs=1e-6)


def test_without_a_home_court_two_even_teams_are_at_one_half():
    assert elo.win_probability(1500, 1500, 0) == 0.5


def test_400_points_ahead_is_ten_to_one():
    assert elo.win_probability(1900, 1500, 0) == pytest.approx(10 / 11)
    assert elo.win_probability(1500, 1900, 0) == pytest.approx(1 / 11)
    # The home court counts as rating: 360 points and a home court of 40 are 400.
    assert elo.win_probability(1860, 1500, 40) == pytest.approx(10 / 11)


def test_the_multiplier_grows_with_the_margin_and_shrinks_with_the_winners_edge():
    # 13 ^ 0.8 = 7.783137, and 7.5 + 0.006 x 40 = 7.74.
    assert elo.margin_multiplier(10, 40) == pytest.approx(7.783137 / 7.74, abs=1e-6)
    assert elo.margin_multiplier(20, 40) > elo.margin_multiplier(10, 40)
    assert elo.margin_multiplier(10, 140) < elo.margin_multiplier(10, 40)
    # A win against the odds: the winner's edge is negative and the multiplier larger.
    assert elo.margin_multiplier(10, -140) > elo.margin_multiplier(10, 140)


# Two even teams at 1500, K 20 and a home court of 40. The home team wins 110 to 100.
#
#   chance of the home team     1 / (1 + 10 ^ -0.1)            = 0.557312
#   multiplier                  13 ^ 0.8 / (7.5 + 0.006 x 40)  = 1.005573
#   change                      20 x 1.005573 x (1 - 0.557312) = 8.9031
def test_a_home_win_by_ten_between_two_even_teams_moves_8_9_points():
    gain = elo.home_gain(1500, 1500, 110, 100, k=20, home_court=40)

    assert gain == pytest.approx(8.9031, abs=1e-4)


# The home team at 1600 hosts a team at 1500 and loses 100 to 103.
#
#   chance of the home team     1 / (1 + 10 ^ -0.35)            = 0.691236
#   the winner's edge           -(1600 + 40 - 1500)             = -140
#   multiplier                  6 ^ 0.8 / (7.5 - 0.006 x 140)   = 0.629574
#   change for the home team    20 x 0.629574 x (0 - 0.691236)  = -8.7037
def test_a_home_loss_by_three_as_a_favorite_costs_8_7_points():
    gain = elo.home_gain(1600, 1500, 100, 103, k=20, home_court=40)

    assert gain == pytest.approx(-8.7037, abs=1e-4)


def test_the_same_favorite_winning_by_three_gains_far_less_than_it_would_have_lost():
    # The multiplier is 6 ^ 0.8 / (7.5 + 0.84) = 0.502753, and the change
    # 20 x 0.502753 x (1 - 0.691236) = 3.1046.
    gain = elo.home_gain(1600, 1500, 103, 100, k=20, home_court=40)

    assert gain == pytest.approx(3.1046, abs=1e-4)


def test_k_scales_the_change():
    assert elo.home_gain(1500, 1500, 110, 100, k=40, home_court=40) == pytest.approx(
        2 * elo.home_gain(1500, 1500, 110, 100, k=20, home_court=40)
    )


def test_the_two_changes_of_a_game_are_equal_and_opposite():
    before = {"BOS": 1607, "NYK": 1720, "LAL": 1568}

    after = elo.replay(before, [final("BOS", "NYK", 112, 104)], k=20, home_court=40)

    gain = elo.home_gain(1607, 1720, 112, 104, k=20, home_court=40)
    assert gain > 0
    assert after["BOS"] - 1607 == pytest.approx(gain, abs=1e-9)
    assert after["NYK"] - 1720 == pytest.approx(-gain, abs=1e-9)
    # A team that did not play keeps its rating, and the mapping handed in is not changed.
    assert after["LAL"] == 1568
    assert before == {"BOS": 1607, "NYK": 1720, "LAL": 1568}


def test_a_game_leaves_the_sum_of_the_ratings_as_it_was():
    before = {"BOS": 1607, "NYK": 1720, "LAL": 1568, "GSW": 1451}
    games = [
        final("BOS", "NYK", 112, 104),
        final("LAL", "GSW", 99, 120),
        final("NYK", "LAL", 101, 100, day=OPENING_DAY + timedelta(days=1)),
        final("GSW", "BOS", 131, 98, day=OPENING_DAY + timedelta(days=2)),
    ]

    after = elo.replay(before, games, k=20, home_court=40)

    assert after != before
    assert sum(after.values()) == pytest.approx(sum(before.values()), abs=1e-9)


def test_on_a_neutral_floor_the_home_team_is_given_nothing():
    even = {"SAS": 1500, "NOP": 1500}

    at_home = elo.replay(even, [final("SAS", "NOP", 101, 100)], k=20, home_court=40)
    in_paris = elo.replay(even, [final("SAS", "NOP", 101, 100, neutral=True)], k=20, home_court=40)

    # On a neutral floor the winner of an even game was given one half:
    # 20 x (4 ^ 0.8 / 7.5) x 0.5 = 4.0419. At home it was given more, and gains less.
    assert in_paris["SAS"] - 1500 == pytest.approx(4.0419, abs=1e-4)
    assert at_home["SAS"] < in_paris["SAS"]


def test_every_game_of_a_day_is_settled_against_the_ratings_before_the_day():
    # A schedule that cannot happen, to tell the two ways of counting apart:
    # one team wins two games on the same day.
    before = {"BOS": 1500, "NYK": 1500, "LAL": 1500}
    first = elo.home_gain(1500, 1500, 110, 100, k=20, home_court=40)

    same_day = elo.replay(
        before, [final("BOS", "NYK", 110, 100), final("BOS", "LAL", 110, 100)], k=20, home_court=40
    )
    two_days = elo.replay(
        before,
        [
            final("BOS", "NYK", 110, 100),
            final("BOS", "LAL", 110, 100, day=OPENING_DAY + timedelta(days=1)),
        ],
        k=20,
        home_court=40,
    )

    assert same_day["BOS"] == pytest.approx(1500 + 2 * first)
    # A day later the winner of the first game is rated higher, is given a
    # better chance in the second and so gains less from it.
    assert two_days["BOS"] < same_day["BOS"]


def test_the_days_are_taken_in_order_whatever_order_the_games_are_given_in():
    before = {"BOS": 1607, "NYK": 1720, "LAL": 1568}
    games = [
        final("BOS", "NYK", 112, 104),
        final("NYK", "LAL", 101, 100, day=OPENING_DAY + timedelta(days=1)),
        final("LAL", "BOS", 95, 99, day=OPENING_DAY + timedelta(days=2)),
    ]

    in_order = elo.replay(before, games, k=20, home_court=40)

    assert elo.replay(before, list(reversed(games)), k=20, home_court=40) == in_order


def test_without_games_the_ratings_are_the_ones_handed_in():
    before = {"BOS": 1607, "NYK": 1720}

    assert elo.replay(before, [], k=20, home_court=40) == before


def test_between_seasons_a_rating_gives_up_a_quarter_of_its_distance_to_1505():
    carried = elo.carried_over({"NYK": 1705, "WAS": 1305, "MIA": 1505}, mean=1505, reversion=0.25)

    assert carried == {"NYK": 1655.0, "WAS": 1355.0, "MIA": 1505.0}
