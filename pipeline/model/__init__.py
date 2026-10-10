"""
The models that forecast a game from the schedule and the final scores of
the season so far, and the files a season starts them from.

    elo.py          Elo ratings, kept the way FiveThirtyEight kept them
    season.py       what the models share: the day a game belongs to, the
                    games on a neutral floor, and the opening files of a season
"""

# The models by the names they have in the published files, in the order
# they are written in.
NAMES = ("elo", "points_rest")
