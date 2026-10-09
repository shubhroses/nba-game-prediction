"""
Tests for pipeline/consensus.py.

Every price here is invented. The events are built with the helper of the
fake server, so they have the shape of the provider's response.
"""

import pytest

from fake_odds_api import event
from pipeline import consensus

HOME, AWAY = "Boston Celtics", "New York Knicks"


def game(prices):
    return event("0" * 32, HOME, AWAY, "2026-10-20T23:00:00Z", prices)


def prices_for(home_share, margin=1.05):
    """The two decimal prices of a sportsbook that implies this home share and takes this margin."""
    return 1 / (home_share * margin), 1 / ((1 - home_share) * margin)


def test_home_share_is_the_implied_probability_without_the_margin():
    share = consensus.home_share(1.50, 2.70)

    assert round(share, 4) == 0.6429
    # The raw implied probabilities add up to more than 1. That excess is the margin.
    assert 1 / 1.50 + 1 / 2.70 == pytest.approx(1.037, abs=0.0005)
    # Normalising them, as the web app does, gives the same number.
    assert share == pytest.approx((1 / 1.50) / (1 / 1.50 + 1 / 2.70))
    # The two sides of one quote add up to 1.
    assert share + consensus.home_share(2.70, 1.50) == pytest.approx(1)


def test_equal_prices_give_one_half():
    assert consensus.home_share(1.91, 1.91) == 0.5


def test_the_margin_does_not_change_the_share():
    for margin in (1.0, 1.02, 1.05, 1.10):
        assert consensus.home_share(*prices_for(0.7, margin)) == pytest.approx(0.7)


def test_six_sportsbooks_give_their_median_range_and_count():
    shares = {
        "Book F": 0.643,
        "Book A": 0.609,
        "Book D": 0.636,
        "Book B": 0.625,
        "Book E": 0.642,
        "Book C": 0.627,
    }

    line = consensus.game_line(game({title: prices_for(share) for title, share in shares.items()}))

    # With an even count the median is the mean of the two in the middle: 0.627 and 0.636.
    assert round(line.p_home, 4) == 0.6315
    assert round(line.lo, 4) == 0.609
    assert round(line.hi, 4) == 0.643
    assert line.n == 6
    assert line.books == ("Book A", "Book B", "Book C", "Book D", "Book E", "Book F")


def test_an_odd_count_gives_the_sportsbook_in_the_middle():
    line = consensus.game_line(
        game(
            {
                "Book A": prices_for(0.60),
                "Book B": prices_for(0.61),
                "Book C": prices_for(
                    0.95
                ),  # far from the others: it widens the range, not the median
            }
        )
    )

    assert line.p_home == pytest.approx(0.61)
    assert (line.lo, line.hi) == (pytest.approx(0.60), pytest.approx(0.95))


def test_one_sportsbook_is_enough_for_a_line():
    line = consensus.game_line(game({"Book A": (1.50, 2.70)}))

    assert line.n == 1
    assert line.books == ("Book A",)
    assert line.p_home == line.lo == line.hi == pytest.approx(0.642857)


def test_a_sportsbook_that_quotes_one_team_only_is_not_used():
    line = consensus.game_line(game({"Book A": (1.50, None), "Book B": (1.60, 2.40)}))

    assert line.n == 1
    assert line.books == ("Book B",)
    assert line.p_home == pytest.approx(0.6)


def test_a_missing_price_alone_gives_no_line():
    assert consensus.game_line(game({"Book A": (1.50, None)})) is None
    assert consensus.game_line(game({"Book A": (None, 2.70)})) is None


def test_no_sportsbook_gives_no_line():
    assert consensus.game_line(game({})) is None
    assert consensus.game_line({"home_team": HOME, "away_team": AWAY}) is None


@pytest.mark.parametrize(
    "price", [1, 1.0, 0.5, 0, -2.5, "1.50", None, True, float("nan"), float("inf"), 10**400]
)
def test_a_price_that_is_not_a_number_above_1_is_not_used(price):
    assert consensus.game_line(game({"Book A": (price, 2.70)})) is None
    assert consensus.game_line(game({"Book A": (1.50, price)})) is None


def test_only_the_head_to_head_market_counts():
    spreads_only = game({"Book A": (1.50, 2.70)})
    spreads_only["bookmakers"][0]["markets"][0]["key"] = "spreads"

    assert consensus.game_line(spreads_only) is None


def test_prices_of_other_teams_are_not_used():
    other_game = game({"Book A": (1.50, 2.70)})
    for outcome in other_game["bookmakers"][0]["markets"][0]["outcomes"]:
        outcome["name"] = outcome["name"].upper()

    assert consensus.game_line(other_game) is None


@pytest.mark.parametrize(
    "bookmakers",
    [
        None,
        "not a list",
        [None, 7, "text"],
        [{"title": "Book A"}],
        [{"title": "Book A", "markets": "not a list"}],
        [{"title": "Book A", "markets": [{"key": "h2h"}]}],
        [{"title": "Book A", "markets": [{"key": "h2h", "outcomes": [None, {"name": HOME}]}]}],
        [{"title": "", "markets": [{"key": "h2h", "outcomes": []}]}],
    ],
)
def test_a_malformed_sportsbook_entry_is_skipped_without_an_error(bookmakers):
    assert (
        consensus.game_line({"home_team": HOME, "away_team": AWAY, "bookmakers": bookmakers})
        is None
    )
