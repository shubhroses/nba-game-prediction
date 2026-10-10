"""
How a line is graded once its game is over.

A line is the home team's chance of winning. It favors the side it puts at
52% or more. When neither side is there, which is between 48% and 52% for
the home team, the game is a toss-up: the line has no favorite, and the game
counts neither as a win nor as a loss.
"""

FAVORITE_WON, UPSET, TOSS_UP, NOT_GRADED = "favorite_won", "upset", "toss_up", "not_graded"
VERDICTS = (FAVORITE_WON, UPSET, TOSS_UP, NOT_GRADED)

# Probabilities are published with four decimals, and the rules compare them
# as whole numbers of ten-thousandths. As binary fractions they would not do:
# 1 - 0.41 is 0.59 on paper and 0.5900000000000001 in floating point.
_UNIT = 10_000
_FAVORITE_FROM = 5_200  # 52%


def favorite(p_home: float) -> tuple[str, float] | None:
    """
    The side a line favors, "home" or "away", and the probability the line
    gives that side. None for a toss-up.

    The probability is a whole number of ten-thousandths divided by 10,000,
    so it is the number that a literal such as 0.6 stands for and can be
    compared with one.
    """
    home = round(p_home * _UNIT)
    away = _UNIT - home
    if home >= _FAVORITE_FROM:
        return "home", home / _UNIT
    if away >= _FAVORITE_FROM:
        return "away", away / _UNIT
    return None


def winner(home_pts: int, away_pts: int) -> str:
    """Which side won, "home" or "away". The two scores of a finished game are never equal."""
    return "home" if home_pts > away_pts else "away"


def verdict(p_home: float | None, home_pts: int, away_pts: int) -> str:
    """
    What became of a line: its favorite won, or lost, which is an upset, or
    it had no favorite. A game without a line is not graded.
    """
    if p_home is None:
        return NOT_GRADED
    favored = favorite(p_home)
    if favored is None:
        return TOSS_UP
    side, _ = favored
    return FAVORITE_WON if side == winner(home_pts, away_pts) else UPSET
