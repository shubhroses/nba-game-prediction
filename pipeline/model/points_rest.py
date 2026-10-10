"""
Points and rest: a rating in points for every team, with its uncertainty,
and six terms for home court and rest.

Everything is in points. Every team has a rating and a variance, the league
has one home-court value, and one number, the spread, scales the forecast to
how far recent results were from what was expected. For a game on day d:

    variance     = the team's stored variance + drift x the days since its
                   last game, or since the first day of the season
    rating edge  = home rating - away rating
    home court   = league value + home constant + altitude x the kilometres
                   the home arena lies above the visitors' + the playoff term
                   after the regular season. All of it is 0 on a neutral floor.
    rest edge    = a term if the home team played yesterday + a term if the
                   away team did + a term x (home games - away games in the
                   seven days before d)
    margin       = rating edge + home court + rest edge
    sd           = scale x sqrt(spread x (home variance + away variance + noise))
    P(home)      = Phi(margin / sd), the normal distribution function

When the games of a day are over, for each of them:

    surprise     = the home margin, cut off at the cap in either direction,
                   minus (rating edge + league home court)
    total        = home variance + away variance + noise
    home rating += home variance / total x surprise
    away rating -= away variance / total x surprise
    each variance shrinks by its square / total
    league home court += a small share of the surprise, off a neutral floor
    spread      += a small share of (surprise squared / total - the spread
                   as it was at the start of the day)

A forecast for a day uses the state as it was before that day's first game.
The constants, the six coefficients, the scale and the opening state come
from the season's parameters file, which names the teams in full. This
module is a port of the reference implementation that the parameters file
was delivered with, and tests/test_pipeline_points_rest.py holds it to that
implementation's own expected values.
"""

import math
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import groupby

from pipeline.model.season import code_of

_SQRT_2 = math.sqrt(2.0)


@dataclass(frozen=True)
class Forecast:
    p_home: float  # the home team's chance of winning
    margin: float  # the expected home margin: rating_edge + home_court + rest_edge
    sd: float  # the standard deviation that turns the margin into a chance
    rating_edge: float
    home_court: float
    rest_edge: float
    rating_home: float
    rating_away: float


class Model:
    """
    The state of a season: `rating` and `variance` by team code, the league's
    `home_court`, the `spread`, and `through`, the last day replayed.
    """

    def __init__(self, parameters: dict):
        constants = parameters["constants"]
        self._noise = constants["sigma"] ** 2
        self._drift = constants["q_per_day"]
        self._cap = constants["cap"]
        self._home_court_share = constants["alpha"]
        self._spread_share = constants["beta"]
        self._coefficient = parameters["coef"]
        self._scale = parameters["kappa"]
        self._first_day = date.fromisoformat(parameters["season_first_day"])
        self._last_regular_day = date.fromisoformat(parameters["regular_season_last_day"])
        self._altitude = {code_of(name): km for name, km in parameters["arena_altitude_km"].items()}
        self._opening = parameters["state"]
        self._start_over()

    def _start_over(self) -> None:
        opening = {code_of(name): team for name, team in self._opening["teams"].items()}
        self.rating = {team: values["rating"] for team, values in opening.items()}
        self.variance = {team: values["var"] for team, values in opening.items()}
        self.home_court = self._opening["home_court"]
        self.spread = self._opening["r"]
        self.through = None
        # The day of each team's last game, which is the first day of the
        # season until it has played, and every day it has played on.
        self._last_played = dict.fromkeys(self.rating, self._first_day)
        self._days_played = {team: [] for team in self.rating}

    def replay(self, games: list) -> "Model":
        """
        Takes the state from the opening of the season through the games
        that are over. It starts over each time it is called, so the whole
        season can be handed in every day.
        """
        self._start_over()
        for day, on_the_day in groupby(sorted(games, key=_day), key=_day):
            # What was expected of each game, before any of the day's
            # results is taken in.
            expected = []
            for game in on_the_day:
                home_variance, away_variance, home_court, edge = self._before(game)
                expected.append((game, home_variance, away_variance, edge + home_court))
            spread_at_the_start = self.spread
            for game, home_variance, away_variance, expected_margin in expected:
                margin = float(game.home_pts) - float(game.away_pts)
                surprise = max(-self._cap, min(self._cap, margin)) - expected_margin
                total = home_variance + away_variance + self._noise
                self.rating[game.home] += home_variance / total * surprise
                self.rating[game.away] -= away_variance / total * surprise
                self.variance[game.home] = home_variance - home_variance * home_variance / total
                self.variance[game.away] = away_variance - away_variance * away_variance / total
                for team in (game.home, game.away):
                    self._last_played[team] = day
                    self._days_played[team].append(day)
                if not game.neutral:
                    self.home_court += self._home_court_share * surprise
                self.spread += self._spread_share * (
                    surprise * surprise / total - spread_at_the_start
                )
            self.through = day
        return self

    def forecast(self, game) -> Forecast:
        """
        The forecast for a game from the present state. The game's day must
        be later than every day replayed: rest is counted from the games
        that were replayed, so a forecast made before the morning of the
        game does not know who plays the evening before.
        """
        home, away, day = game.home, game.away, game.day
        if self.through is not None and day <= self.through:
            raise ValueError(f"a game on {day} is not after the last replayed day, {self.through}")
        home_variance, away_variance, league_home_court, edge = self._before(game)
        coefficient = self._coefficient
        at_home = 0.0 if game.neutral else 1.0
        playoffs = 1.0 if day > self._last_regular_day else 0.0
        climb = at_home * max(0.0, self._altitude[home] - self._altitude[away])
        home_court = league_home_court + at_home * (
            coefficient["home"]
            + coefficient["altitude_km"] * climb
            + coefficient["playoff_home"] * playoffs
        )
        more_games = self._games_in_seven_days(home, day) - self._games_in_seven_days(away, day)
        rest_edge = (
            coefficient["b2b_home"] * self._played_yesterday(home, day)
            + coefficient["b2b_away"] * self._played_yesterday(away, day)
            + coefficient["games7_diff"] * more_games
        )
        margin = edge + home_court + rest_edge
        sd = self._scale * math.sqrt(self.spread * (home_variance + away_variance + self._noise))
        return Forecast(
            p_home=normal_cdf(margin / sd),
            margin=margin,
            sd=sd,
            rating_edge=edge,
            home_court=home_court,
            rest_edge=rest_edge,
            rating_home=self.rating[home],
            rating_away=self.rating[away],
        )

    def _before(self, game) -> tuple[float, float, float, float]:
        """
        For a game on its day, from the present state: the two variances,
        the league's home court as it applies to the game, and the rating
        edge of the home team.
        """
        if game.day < self._first_day:
            raise ValueError(
                f"a game on {game.day} is before the first day of the season, {self._first_day}"
            )
        home, away = game.home, game.away
        home_variance = self.variance[home] + self._drift * self._days_since(home, game.day)
        away_variance = self.variance[away] + self._drift * self._days_since(away, game.day)
        home_court = 0.0 if game.neutral else self.home_court
        edge = self.rating[home] - self.rating[away]
        return home_variance, away_variance, home_court, edge

    def _days_since(self, team: str, day: date) -> int:
        return (day - self._last_played[team]).days

    def _played_yesterday(self, team: str, day: date) -> float:
        """1 when the team's last game was the day before, which makes this one a back-to-back."""
        played = self._days_played[team]
        return 1.0 if played and played[-1] == day - timedelta(days=1) else 0.0

    def _games_in_seven_days(self, team: str, day: date) -> int:
        """The team's games on the seven days before the day."""
        week_before = day - timedelta(days=7)
        return sum(1 for played in self._days_played[team] if week_before <= played < day)


def normal_cdf(z: float) -> float:
    """Phi: the chance that a standard normal variable is below z."""
    return 0.5 * (1.0 + math.erf(z / _SQRT_2))


def next_season(
    parameters: dict,
    final: Model,
    *,
    season: str,
    first_day: str,
    last_regular_day: str,
    neutral_games: list,
) -> dict:
    """
    The parameters file of the next season, from the state after this
    season's last game: every rating keeps the share rho of its distance to
    the league's mean, and every variance becomes rho squared times itself
    plus tau2. The league's home court and the spread carry over. The six
    coefficients and the scale are copied; refitting them takes the results
    of earlier seasons, which are not in this repository.
    """
    constants = parameters["constants"]
    keep, added = constants["rho"], constants["tau2"]
    mean = sum(final.rating.values()) / len(final.rating)
    teams = {
        name: {
            "rating": mean + keep * (final.rating[code_of(name)] - mean),
            "var": keep**2 * final.variance[code_of(name)] + added,
        }
        for name in parameters["state"]["teams"]
    }
    return {
        **parameters,
        "season": season,
        "season_first_day": first_day,
        "regular_season_last_day": last_regular_day,
        "neutral_games": list(neutral_games),
        "state": {"home_court": final.home_court, "r": final.spread, "teams": teams},
    }


def _day(game) -> date:
    return game.day
