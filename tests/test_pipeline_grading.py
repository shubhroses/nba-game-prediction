"""
Tests for pipeline/grading.py: which side a line favors, and what became of
the line once the game is over. Every line and every score is invented.
"""

import pytest

from pipeline import grading


def test_a_home_share_of_0_532_and_a_112_to_104_home_win_is_a_favorite_that_won():
    assert grading.favorite(0.532) == ("home", 0.532)
    assert grading.verdict(0.532, 112, 104) == "favorite_won"


def test_the_same_line_and_a_home_loss_is_an_upset():
    assert grading.verdict(0.532, 104, 112) == "upset"


def test_a_line_below_one_half_favors_the_away_team():
    assert grading.favorite(0.468) == ("away", 0.532)
    assert grading.verdict(0.468, 104, 112) == "favorite_won"
    assert grading.verdict(0.468, 112, 104) == "upset"


def test_the_away_teams_probability_is_the_number_as_it_is_written():
    # The home team at 0.41 puts the away team at 0.59. Taken from 1 in
    # floating point it would come out as 0.5900000000000001.
    assert 1 - 0.41 != 0.59
    assert grading.favorite(0.41) == ("away", 0.59)
    # The same holds for every probability the files can hold.
    for k in range(1, 4801):
        assert grading.favorite(k / 10_000) == ("away", (10_000 - k) / 10_000)


def test_0_505_is_a_toss_up_whoever_wins():
    assert grading.favorite(0.505) is None
    assert grading.verdict(0.505, 112, 104) == "toss_up"
    assert grading.verdict(0.505, 104, 112) == "toss_up"


@pytest.mark.parametrize(
    ("p_home", "favored"),
    [
        (0.9999, ("home", 0.9999)),
        (0.52, ("home", 0.52)),  # 52% is a favorite
        (0.5199, None),
        (0.5, None),
        (0.4801, None),
        (0.48, ("away", 0.52)),  # and so is the away team when the home team is at 48%
        (0.0001, ("away", 0.9999)),
    ],
)
def test_a_side_is_the_favorite_from_52_percent_on(p_home, favored):
    assert grading.favorite(p_home) == favored


def test_every_line_between_48_and_52_percent_is_a_toss_up_and_no_other():
    # Every probability the files can hold, from 0.0001 to 0.9999.
    toss_ups = [k for k in range(1, 10_000) if grading.favorite(k / 10_000) is None]

    assert toss_ups == list(range(4801, 5200))


def test_a_game_without_a_line_is_not_graded():
    assert grading.verdict(None, 112, 104) == "not_graded"


def test_the_winner_is_the_side_with_more_points():
    assert grading.winner(112, 104) == "home"
    assert grading.winner(104, 112) == "away"


def test_there_are_four_verdicts():
    assert grading.VERDICTS == ("favorite_won", "upset", "toss_up", "not_graded")
    assert {grading.verdict(p_home, 112, 104) for p_home in (0.532, 0.468, 0.505, None)} == set(
        grading.VERDICTS
    )
