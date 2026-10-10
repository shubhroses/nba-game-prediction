"""
The record: what the result lines add up to.

build() reads nothing, writes nothing and does not look at the clock, and the
order the lines are given in does not matter. The same lines always give the
same record, which is why it is rebuilt from all of them at every daily run
instead of being added to.
"""

import math

from pipeline import grading, schedule
from pipeline.snapshot import SCHEMA
from pipeline.timestamps import parse_utc

# The bands a favorite's probability is sorted into, each with its lower bound.
BANDS = (("52-59", 0.52), ("60-69", 0.6), ("70-79", 0.7), ("80-89", 0.8), ("90+", 0.9))

UPSETS_LISTED = 3

# The 97.5th percentile of the standard normal distribution, which makes a
# two-sided interval one of 95%.
_Z = 1.959963984540054

# What an upset in the list says about its game.
_GAME_FIELDS = ("id", "commence_time", "home", "away", "home_pts", "away_pts")

_TALLIED_AS = {
    grading.FAVORITE_WON: "wins",
    grading.UPSET: "losses",
    grading.TOSS_UP: "toss_ups",
    grading.NOT_GRADED: "not_graded",
}


def build(lines: list[dict], *, sport: str) -> dict:
    """The record of a sport, as written to record.json, from every result line there is."""
    games = sorted(lines, key=lambda line: (line["commence_time"], line["id"]))
    return {
        "schema": SCHEMA,
        "sport": sport,
        "since": day_of(games[0]) if games else None,
        "games": len(games),
        "market": scorecard(games, "market"),
        "baseline_home": {"games": len(games), "wins": sum(_home_won(game) for game in games)},
        "by_day": _by_day(games, "market"),
    }


def headline(record: dict) -> dict:
    """The part of a record that the board carries: the wins and the losses."""
    return {"market": {count: record["market"][count] for count in ("wins", "losses")}}


def scorecard(games: list[dict], source: str) -> dict:
    """
    How the lines of one source did. `source` names the field of a result
    line that holds the line, and the verdict on it is in the field of that
    name with "_verdict" added. The sportsbooks' line is under "market".
    """
    verdicts = [game[f"{source}_verdict"] for game in games]
    wins, losses = verdicts.count(grading.FAVORITE_WON), verdicts.count(grading.UPSET)
    decided = [
        game for game in games if game[f"{source}_verdict"] in (grading.FAVORITE_WON, grading.UPSET)
    ]
    forecasts = [
        (game[source]["p_home"], _home_won(game)) for game in games if game[source] is not None
    ]
    return {
        "games": wins + losses,
        "wins": wins,
        "losses": losses,
        "accuracy": _rounded(wins / (wins + losses)) if decided else None,
        "accuracy_interval": (
            [_rounded(bound) for bound in wilson(wins, wins + losses)] if decided else None
        ),
        "toss_ups": verdicts.count(grading.TOSS_UP),
        "not_graded": verdicts.count(grading.NOT_GRADED),
        "with_line": len(forecasts),
        "brier": _rounded(brier(forecasts)) if forecasts else None,
        "log_loss": _rounded(log_loss(forecasts)) if forecasts else None,
        "bands": _bands(decided, source),
        "biggest_upsets": _biggest_upsets(decided, source),
    }


def wilson(wins: int, games: int) -> tuple[float, float]:
    """
    The Wilson score interval at 95% for a share of wins: the lowest and the
    highest true share that so many wins in so many games fit. It never
    leaves the range from 0 to 1, and it does not shrink to a point when
    every game so far was won.
    """
    share = wins / games
    z2 = _Z * _Z
    centre = share + z2 / (2 * games)
    reach = _Z * math.sqrt(share * (1 - share) / games + z2 / (4 * games * games))
    scale = 1 + z2 / games
    return max(0.0, (centre - reach) / scale), min(1.0, (centre + reach) / scale)


def brier(forecasts: list[tuple[float, bool]]) -> float:
    """
    The mean squared distance between the home team's probability and what
    happened, which counts as 1 for a home win and as 0 for a loss. 0 is
    perfect, and saying one half every time scores 0.25.
    """
    return math.fsum((p_home - home_won) ** 2 for p_home, home_won in forecasts) / len(forecasts)


def log_loss(forecasts: list[tuple[float, bool]]) -> float:
    """
    The mean of minus the logarithm of the probability that was given to
    what happened. 0 is perfect, and saying one half every time scores 0.6931.
    """
    given = (p_home if home_won else 1 - p_home for p_home, home_won in forecasts)
    return -math.fsum(math.log(probability) for probability in given) / len(forecasts)


def band_of(p_favorite: float) -> str:
    """The band of a favorite's probability: the highest one whose lower bound it reaches."""
    return [label for label, lower in BANDS if p_favorite >= lower][-1]


def day_of(game: dict) -> str:
    """
    The day a game belongs to: the New York calendar date of its start. A
    game that starts at half past ten in the evening there starts on the
    next date in UTC, and it is still a game of that evening.
    """
    return parse_utc(game["commence_time"]).astimezone(schedule.ZONE).date().isoformat()


def _home_won(game: dict) -> bool:
    return grading.winner(game["home_pts"], game["away_pts"]) == "home"


def _bands(decided: list[dict], source: str) -> list[dict]:
    """
    For each band: the games whose favorite was in it, how many of those
    favorites won, and the mean of their probabilities.
    """
    members = {label: [] for label, _ in BANDS}
    for game in decided:
        _, p_favorite = grading.favorite(game[source]["p_home"])
        won = game[f"{source}_verdict"] == grading.FAVORITE_WON
        members[band_of(p_favorite)].append((p_favorite, won))
    return [
        {
            "band": label,
            "games": len(found),
            "wins": sum(won for _, won in found),
            "mean_p_favorite": _rounded(_mean(p for p, _ in found)) if found else None,
        }
        for label, found in members.items()
    ]


def _biggest_upsets(decided: list[dict], source: str) -> list[dict]:
    """The lost games whose favorite had the highest probability, the highest first."""
    upsets = []
    for game in decided:
        if game[f"{source}_verdict"] == grading.UPSET:
            side, p_favorite = grading.favorite(game[source]["p_home"])
            about = {key: game[key] for key in _GAME_FIELDS}
            upsets.append({**about, "favorite": game[side], "p_favorite": p_favorite})
    # The games come in order of start and the sort keeps that order among
    # upsets of the same size.
    upsets.sort(key=lambda upset: -upset["p_favorite"])
    return upsets[:UPSETS_LISTED]


def _by_day(games: list[dict], source: str) -> list[dict]:
    """One tally for each day that has a game, in order of day."""
    days = {}
    for game in games:
        tally = days.setdefault(
            day_of(game), {"games": 0, source: dict.fromkeys(_TALLIED_AS.values(), 0)}
        )
        tally["games"] += 1
        tally[source][_TALLIED_AS[game[f"{source}_verdict"]]] += 1
    return [{"day": day, **tally} for day, tally in sorted(days.items())]


def _mean(numbers) -> float:
    numbers = list(numbers)
    return math.fsum(numbers) / len(numbers)


def _rounded(number: float) -> float:
    """Four decimals, as the probabilities are written."""
    return round(number, 4)
