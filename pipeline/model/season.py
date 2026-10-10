"""
What the two models share: the day a game belongs to, the games that are
played on a neutral floor, and the two files a season starts from.

Both files are in this directory, named after the season:

    elo_2026_27.json          the constants and the 30 opening ratings
    points_rest_2026_27.json  the constants, the six coefficients, the
                              opening state, the altitude of each arena and
                              the list of games on a neutral floor

The list of neutral floors and the first day of the season are kept in the
second file only, and Elo takes them from there.
"""

import functools
import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from pipeline import teams

# Where the opening files are.
_FILES = Path(__file__).parent

# A game's day is its tip-off time minus ten hours, as a UTC date. Ten hours
# after midnight UTC is five or six in the morning in New York, when no game
# is being played, so one evening's games share a day wherever they tip off.
_DAY_BEGINS = timedelta(hours=10)


@dataclass(frozen=True)
class Game:
    """A game as the models take it."""

    day: date
    home: str  # team codes
    away: str
    neutral: bool  # on a neutral floor, where neither model gives the home team anything


@dataclass(frozen=True)
class Final(Game):
    """A game that is over."""

    home_pts: int
    away_pts: int


@dataclass(frozen=True)
class Season:
    name: str  # as the files write it: "2026-27"
    first_day: date  # a result of an earlier day is not a result of this season
    elo: dict  # the Elo file, parsed
    points_rest: dict  # the points-and-rest file, parsed
    parameters: dict  # the SHA-256 of each file as it is on disk, by the name of its model
    neutral_floors: frozenset  # the day and the two team codes of each game on a neutral floor

    def game(self, start: datetime, home: str, away: str) -> Game:
        day = game_day(start)
        neutral = (day, frozenset((home, away))) in self.neutral_floors
        return Game(day=day, home=home, away=away, neutral=neutral)

    def final(self, start: datetime, home: str, away: str, home_pts: int, away_pts: int) -> Final:
        game = self.game(start, home, away)
        return Final(game.day, home, away, game.neutral, home_pts, away_pts)

    def elo_home_court(self, game: Game) -> float:
        """What Elo gives the home team of a game: nothing on a neutral floor."""
        return 0 if game.neutral else self.elo["constants"]["home_court"]


def game_day(start: datetime) -> date:
    """The day a game belongs to: its tip-off time minus ten hours, as a UTC date."""
    if start.tzinfo is None:
        raise ValueError("the start must carry a time zone")
    return (start.astimezone(timezone.utc) - _DAY_BEGINS).date()


def code_of(name: object) -> str:
    """
    The code of a team that the points-and-rest file names in full, as The
    Odds API does. Raises ValueError for a name that is not one of the 30.
    """
    code = teams.code(name)
    if code is None:
        raise ValueError(f"{name!r} is not one of the 30 team names")
    return code


@functools.cache
def load(name: str) -> Season:
    """
    The opening files of a season, by its name in the file names: "2026_27".
    Raises ValueError when the two files are not for the same season or the
    Elo file does not give each of the 30 teams a whole-number rating.
    """
    content = {
        model: (_FILES / f"{model}_{name}.json").read_bytes() for model in ("elo", "points_rest")
    }
    elo, points_rest = json.loads(content["elo"]), json.loads(content["points_rest"])
    if elo["season"] != points_rest["season"]:
        raise ValueError(
            f"the Elo file is for {elo['season']} and "
            f"the points-and-rest file is for {points_rest['season']}"
        )
    ratings = elo["ratings"]
    if set(ratings) != teams.ALL_CODES or not all(type(value) is int for value in ratings.values()):
        raise ValueError("the Elo file must give each of the 30 teams a whole-number rating")
    # Matched by day and by the pair of teams, whichever of the two the
    # schedule calls the home team.
    neutral_floors = frozenset(
        (
            date.fromisoformat(game["day"]),
            frozenset((code_of(game["home_team"]), code_of(game["away_team"]))),
        )
        for game in points_rest["neutral_games"]
    )
    return Season(
        name=elo["season"],
        first_day=date.fromisoformat(points_rest["season_first_day"]),
        elo=elo,
        points_rest=points_rest,
        parameters={model: hashlib.sha256(content[model]).hexdigest() for model in content},
        neutral_floors=neutral_floors,
    )
