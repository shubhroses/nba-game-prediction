"""
Elo ratings for NBA teams, kept the way FiveThirtyEight kept them.

Every team has one number. Before a game the home team's chance of winning is

    P(home) = 1 / (1 + 10 ^ (-(home + home court - away) / 400))

and after it the winner takes from the loser

    K x multiplier x (1 - the chance the winner was given)

The multiplier grows with the margin of victory and shrinks with the edge
the winner had before the game, home court included:

    multiplier = (margin + 3) ^ 0.8 / (7.5 + 0.006 x the winner's edge)

On a neutral floor there is no home court. Between two seasons every rating
gives up a share of its distance to the mean.

K, the home court, the mean and that share are in the season's opening file.
The functions here read nothing and keep nothing: ratings go in as a mapping
from team to rating, and a new mapping comes out.
"""

from itertools import groupby

_SCALE = 400.0  # a team this many points ahead is given ten times its opponent's chance


def win_probability(home_rating: float, away_rating: float, home_court: float) -> float:
    """The home team's chance of winning. `home_court` is 0 on a neutral floor."""
    edge = home_rating + home_court - away_rating
    return 1.0 / (1.0 + 10.0 ** (-edge / _SCALE))


def margin_multiplier(margin: int, winner_edge: float) -> float:
    """
    How much more a win by this many points counts. A favorite's win counts
    for less than an underdog's by the same margin. Favorites win by more as
    a rule, and without the second term they would gain rating for doing
    what was expected of them.
    """
    return (margin + 3.0) ** 0.8 / (7.5 + 0.006 * winner_edge)


def home_gain(
    home_rating: float,
    away_rating: float,
    home_pts: int,
    away_pts: int,
    *,
    k: float,
    home_court: float,
) -> float:
    """
    What a game adds to the home team's rating and takes from the away
    team's. It is negative when the home team gives rating up. The two
    changes are equal and opposite, so a game leaves the sum of all ratings
    as it was.
    """
    edge = home_rating + home_court - away_rating
    home_won = home_pts > away_pts
    multiplier = margin_multiplier(abs(home_pts - away_pts), edge if home_won else -edge)
    expected = win_probability(home_rating, away_rating, home_court)
    return k * multiplier * ((1.0 if home_won else 0.0) - expected)


def replay(ratings: dict, games: list, *, k: float, home_court: float) -> dict:
    """
    The ratings after the games, which are taken day by day. Every game of a
    day is settled against the ratings as they stood before the day's first
    game, which is what a forecast made that morning was made from.
    """
    after = dict(ratings)
    for _, on_the_day in groupby(sorted(games, key=_day), key=_day):
        gains = [
            (
                game,
                home_gain(
                    after[game.home],
                    after[game.away],
                    game.home_pts,
                    game.away_pts,
                    k=k,
                    home_court=0.0 if game.neutral else home_court,
                ),
            )
            for game in on_the_day
        ]
        for game, gain in gains:
            after[game.home] += gain
            after[game.away] -= gain
    return after


def carried_over(ratings: dict, *, mean: float, reversion: float) -> dict:
    """
    The ratings that the next season starts from: each one gives up the
    share `reversion` of its distance to the mean. The opening file of a
    season holds these, rounded to whole numbers.
    """
    return {team: (1 - reversion) * rating + reversion * mean for team, rating in ratings.items()}


def _day(game) -> object:
    return game.day
