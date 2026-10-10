"""
The two models that forecast a game from the schedule and the final scores
of the season so far, and the files a season starts them from.

    elo.py          Elo ratings, kept the way FiveThirtyEight kept them
    points_rest.py  a rating in points for every team, with its uncertainty,
                    and six terms for home court and rest
    season.py       what the two share: the day a game belongs to, the games
                    on a neutral floor, and the opening files of a season
"""

# The models by the names they have in the published files, in the order
# they are written in.
NAMES = ("elo", "points_rest")

# What the model file and the forecasts of a day say of themselves: that both
# models were built, or that the results of the season did not pass the
# checks and Elo is published alone.
OK, DEGRADED = "ok", "degraded"
