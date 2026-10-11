"""
An invented stretch of the 2026-27 season, played through the real job.

    python -m tests.sample_season --out DIR
    python -m tests.sample_season --sample-data

With --out it writes a whole data directory: what the job would have left on
the evening of Sunday 8 November 2026 if the season had gone this way. With
--sample-data it copies the files that the web app reads out of such a
directory into nba-predictions-app/sample-data, which is how that directory
is rebuilt. tests/test_sample_season.py holds the files there to what this
module produces.

Nothing in it happened. The schedule, the final scores and the sportsbooks'
prices are invented, and so is how good each team is: the rating that the
points-and-rest model opens the season with, moved by an invented amount.
Whatever is invented comes from one seeded generator, so every run writes
the same bytes. The sportsbooks are Book A to Book F. What is real are the
30 teams, the opening files of the two models, which are the job's own, and
one fixture: Indiana against Denver on 7 November, which is on the list of
neutral floors in those files.

The command is the real one. pipeline.__main__.main is run once for each slot
from 05:10 on Tuesday 20 October to 18:10 on Sunday 8 November, New York
time, but for one that is left out on purpose, against the fake server in
fake_odds_api.py and with the clock set a little after the start of the
slot. At each run the server lists the games of the next days with the
prices of that moment, and the scores of the last three days.

The stretch is made to hold the states that the page has to show:

- The first run knows no game when it does its daily work, so the games of
  opening night have no forecast.
- On the morning of 27 October no run comes in the 05:10 slot. The games of
  that day have no forecast, and the next daily run records two evenings.
- On the morning of 2 November the last game of the evening before is
  missing from the scores. The points-and-rest model is left out that day,
  and the game is recorded a day later.
- The games of SCRIPT: a heavy favorite that loses, the game on a neutral
  floor, one that no sportsbook ever quotes, and the seven of the last day,
  of which two have started by the last snapshot and five are still to come.
"""

import argparse
import contextlib
import io
import itertools
import math
import os
import random
import shutil
import tempfile
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from unittest import mock

from pipeline import schedule, teams
from pipeline.__main__ import main as run_the_job
from pipeline.model import season
from pipeline.model.points_rest import normal_cdf
from pipeline.timestamps import format_utc

if __package__:  # run as python -m tests.sample_season, from the root of the repository
    from .fake_odds_api import FakeOddsApi, event, score_event
else:  # imported by the tests, which have this directory on their path
    from fake_odds_api import FakeOddsApi, event, score_event

REPOSITORY = Path(__file__).resolve().parent.parent
SAMPLE_DATA = REPOSITORY / "nba-predictions-app" / "sample-data"
# What the web app and its tests read, and so what is copied there. Of the
# forecasts, the page asks for those of the day that the board carries, which
# is the last day. Its tests also read those of each day that the board has a
# result of: the eight days before it.
SAMPLE_FILES = (
    "v1/slate.json",
    "v1/record.json",
    "v1/model.json",
    "v1/predictions/2026-10-31.json",
    "v1/predictions/2026-11-01.json",
    "v1/predictions/2026-11-02.json",
    "v1/predictions/2026-11-03.json",
    "v1/predictions/2026-11-04.json",
    "v1/predictions/2026-11-05.json",
    "v1/predictions/2026-11-06.json",
    "v1/predictions/2026-11-07.json",
    "v1/predictions/2026-11-08.json",
)

NBA = "basketball_nba"
# A made-up value. It is deliberately not shaped like a real key.
KEY = "fake-key-not-a-real-one"
# Picked from a handful for a stretch that is ordinary: the sportsbooks'
# favorites win about two games in three, and the two models are a little
# behind the sportsbooks, by no more than chance could account for in so
# few games. SCRIPT is written for the league that this seed gives.
SEED = 14

FIRST_DAY, LAST_DAY = date(2026, 10, 20), date(2026, 11, 8)
# The stretch ends with the 18:10 slot of its last day.
LAST_SLOT = time(18, 10)
# The morning on which no run comes in time for the day's first slot.
MISSED_MORNING = date(2026, 10, 27)
# The day on which the scores do not have the last game of the evening before.
SCORE_MISSING_ON = date(2026, 11, 2)

ONE_DAY = timedelta(days=1)
# The provider lists a game from the morning three days before its day.
LISTED_AHEAD = 3 * ONE_DAY
# Its scores reach back three days, and a game is over this long after its start.
SCORES_REACH = 3 * ONE_DAY
GAME_LENGTH = timedelta(hours=2, minutes=30)

# What is true of the invented league, in points. A final margin is the
# difference in strength, the home court and the rest, give or take SPREAD.
HOME_COURT = 2.2
TIRED = 1.6  # what a team that played the day before gives up
SPREAD = 12.5
# How far a team's strength is from the rating that the points-and-rest
# model opens the season with: about what that model takes its own ratings
# to be off by after a summer. The models have to find it out from results.
SUMMER = 3.0

# The sportsbooks: the margin each takes, and how many hours before the start
# it puts up its first prices, give or take OPENS_WITHIN.
BOOKS = (
    ("Book A", 0.045, 72),
    ("Book B", 0.048, 50),
    ("Book C", 0.052, 44),
    ("Book D", 0.041, 28),
    ("Book E", 0.058, 23),
    ("Book F", 0.050, 11),
)
OPENS_WITHIN = 8
# The first three quote every game. Each of the others passes on one game in seven.
ALWAYS_QUOTING = 3
PASSES = 1 / 7

# How many hours after 19:00 in New York an evening game starts in each home
# city: none in the east, three on the Pacific coast.
HOURS_WEST = {
    **dict.fromkeys(("ATL", "BOS", "BKN", "CHA", "CLE", "DET", "IND", "MIA"), 0),
    **dict.fromkeys(("NYK", "ORL", "PHI", "TOR", "WAS"), 0),
    **dict.fromkeys(("CHI", "DAL", "HOU", "MEM", "MIL", "MIN", "NOP", "OKC", "SAS"), 1),
    **dict.fromkeys(("DEN", "PHX", "UTA"), 2),
    **dict.fromkeys(("GSW", "LAC", "LAL", "POR", "SAC"), 3),
}
NAMES = {code: name for name, code in teams.CODES.items()}


@dataclass(frozen=True)
class Fixture:
    """
    Who plays whom, and when. A fixture of SCRIPT can also say what is
    drawn for any other game, for a state that the page has to show.
    """

    day: date
    tip: str  # the start, as a wall-clock time in New York
    home: str  # team codes
    away: str
    chance: float | None = None  # what the sportsbooks settle on for the home team
    books: int | None = None  # how many sportsbooks ever quote the game
    points: tuple | None = None  # the final score, home team first


SATURDAY, SUNDAY = date(2026, 11, 7), date(2026, 11, 8)
SCRIPT = (
    # A favorite at 88% that loses at home.
    Fixture(date(2026, 11, 5), "19:40", "MIA", "CHI", chance=0.88, points=(104, 109)),
    # The game in Mexico City, which is on the list of neutral floors.
    Fixture(SATURDAY, "20:10", "IND", "DEN"),
    # No sportsbook ever quotes this one.
    Fixture(SATURDAY, "19:40", "CHA", "ORL", books=0),
    # The last day. The first two have started when the last snapshot is taken.
    Fixture(SUNDAY, "15:30", "NYK", "WAS"),
    Fixture(SUNDAY, "18:00", "DET", "LAC"),
    # The sportsbooks have the visitors, and both models the home team: as
    # when a team loses a player, which no result shows yet.
    Fixture(SUNDAY, "19:10", "CLE", "POR", chance=0.41),
    # A line without a favorite.
    Fixture(SUNDAY, "19:40", "TOR", "BOS", chance=0.5),
    # One sportsbook quotes it, and no other.
    Fixture(SUNDAY, "20:40", "MIN", "MEM", books=1),
    # The visitors played the evening before.
    Fixture(SUNDAY, "21:10", "UTA", "CHA"),
    Fixture(SUNDAY, "22:40", "LAL", "PHI"),
)
# The days that have the games of the script and no other.
SCRIPT_ONLY = (SUNDAY,)


@dataclass(frozen=True)
class Quote:
    """One sportsbook's part in a game."""

    title: str
    margin: float
    opens: datetime  # from when it quotes the game
    lean: float  # how far its view of the home team's chance is from the others'


@dataclass(frozen=True)
class Game:
    id: str
    day: date
    start: datetime  # as the schedule has it
    tipped: datetime  # as the scores give it once the game is played, to the second
    home: str  # team names, as the provider spells them
    away: str
    chance: float  # the home team's chance that the sportsbooks settle on by the start
    drift: float  # how far from it they are three days before
    quotes: tuple[Quote, ...]  # the sportsbooks that quote the game
    points: tuple[int, int]  # the final score, home team first

    def prices_at(self, now: datetime) -> dict:
        """What each sportsbook that quotes the game by now asks for the home and the away team."""
        left = min(1.0, (self.start - now) / LISTED_AHEAD)
        prices = {}
        for quote in self.quotes:
            if quote.opens <= now:
                view = min(0.96, max(0.04, self.chance + self.drift * left + quote.lean))
                prices[quote.title] = (_price(view, quote.margin), _price(1 - view, quote.margin))
        return prices


@dataclass(frozen=True)
class Stretch:
    """The invented stretch: its games, and the runs of the command it is played through."""

    games: list[Game]  # in order of start, with those of the three days after the last run
    # When each run begins, in order: some seconds after the start of its
    # slot. The run of the missed morning is not among them.
    runs: list[datetime]

    def odds_at(self, now: datetime) -> list[dict]:
        """The games to come as the provider's odds list them at a moment, at the prices of then."""
        return [
            event(game.id, game.home, game.away, format_utc(game.start), game.prices_at(now))
            for game in self.games
            if game.start > now and game.day <= _listed_until(now)
        ]

    def scores_at(self, now: datetime) -> list[dict]:
        """
        The games as the provider's scores list them at a moment: the ones
        of the last three days that are over, with their final scores, and
        the ones still to come, without any.
        """
        missing = self._missing_from_the_scores(now)
        found = []
        for game in self.games:
            if game is missing or game.start < now - SCORES_REACH or game.day > _listed_until(now):
                continue
            over = game.tipped + GAME_LENGTH <= now
            # The provider gives a start to the second from the moment a game is played.
            start = game.tipped if game.tipped <= now else game.start
            found.append(
                score_event(
                    game.id,
                    game.home,
                    game.away,
                    format_utc(start),
                    game.points if over else None,
                    completed=over,
                )
            )
        return found

    def _missing_from_the_scores(self, now: datetime) -> Game | None:
        """The game that the provider is a day late with: the last one of the evening before."""
        if now.astimezone(schedule.ZONE).date() != SCORE_MISSING_ON:
            return None
        return [game for game in self.games if game.day == SCORE_MISSING_ON - ONE_DAY][-1]


class _Draws:
    """
    A fixed number of draws from the one generator, taken at once and handed
    out one by one. Every day and every game has draws of its own, so a
    change to one game of the script moves no number of another.

    Nothing but random() is asked of the generator. Python promises to keep
    that sequence the same for a seed from version to version, and promises
    it of no other method. For the same reason the draws are added up with
    math.fsum wherever they are: sum() rounds differently before Python 3.12.
    """

    def __init__(self, generator: random.Random, count: int):
        self._left = [generator.random() for _ in range(count)][::-1]

    def uniform(self) -> float:
        return self._left.pop()

    def below(self, count: int) -> int:
        """A whole number from 0 to count - 1."""
        return int(self.uniform() * count)

    def normal(self) -> float:
        """Close to a standard normal deviate: the sum of twelve uniform draws, less its mean."""
        return math.fsum(self.uniform() for _ in range(12)) - 6.0


def invent() -> Stretch:
    """The stretch. It is the same every time, because everything comes from the one seed."""
    generator = random.Random(SEED)
    opening = season.load("2026_27")
    strength = _strengths(_Draws(generator, 12 * len(NAMES)), opening)
    playing = {code: set() for code in sorted(NAMES)}  # the days each team has a game on
    hosted = dict.fromkeys(playing, 0)  # the home games of each team so far
    met = set()  # the pairs of teams that play each other, in a game made so far or in the script
    for fixture in SCRIPT:
        playing[fixture.home].add(fixture.day)
        playing[fixture.away].add(fixture.day)
        met.add(frozenset((fixture.home, fixture.away)))

    games = []
    day = FIRST_DAY
    while day <= LAST_DAY + LISTED_AHEAD:
        draws = _Draws(generator, 200)
        # Fifteen games would have every team playing. The draws of each are
        # taken whether the day has that many or not.
        of_each_game = [_Draws(generator, 160) for _ in range(15)]
        fixtures = [fixture for fixture in SCRIPT if fixture.day == day]
        for fixture in fixtures:
            hosted[fixture.home] += 1
        drawn = 0 if day in SCRIPT_ONLY else max(0, 5 + draws.below(6) - len(fixtures))
        fixtures += _fixtures(draws, day, drawn, playing, hosted, met)
        for fixture, own in zip(fixtures, of_each_game):
            games.append(_game(own, fixture, strength, playing, opening))
        day += ONE_DAY
    games.sort(key=lambda game: (game.start, game.id))

    slots = _slot_starts()
    late = _Draws(generator, len(slots))
    missed = datetime.combine(MISSED_MORNING, schedule.DAILY_SLOT, tzinfo=schedule.ZONE)
    begins = [(start, start + timedelta(seconds=8 + late.below(50))) for start in slots]
    return Stretch(games, [began for start, began in begins if start != missed])


def play(data_dir: Path) -> None:
    """
    Plays the stretch into a data directory, which must be empty or not
    there yet: one run of the command for each slot, in order, as the
    workflow would have started them.
    """
    if _holds_files(data_dir):
        raise ValueError(f"{data_dir} is not empty, and the job would continue from what is in it")
    stretch = invent()
    with FakeOddsApi() as api, _environment(api.url):
        for began in stretch.runs:
            api.events = {NBA: stretch.odds_at(began)}
            api.scores = {NBA: stretch.scores_at(began)}
            _run(data_dir, began)


def copy_sample(data_dir: Path, sample_dir: Path = SAMPLE_DATA) -> None:
    """Copies the files that the web app reads from a data directory to the sample directory."""
    shutil.rmtree(sample_dir / "v1", ignore_errors=True)
    for path in SAMPLE_FILES:
        (sample_dir / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(data_dir / path, sample_dir / path)


def _run(data_dir: Path, began: datetime) -> None:
    """One run of the command. The clock reads a second later each time it is looked at."""
    readings = itertools.count()
    printed = io.StringIO()
    with contextlib.redirect_stdout(printed), contextlib.redirect_stderr(printed):
        status = run_the_job(
            ["snapshot", "--all", "--data-dir", str(data_dir)],
            clock=lambda: began + timedelta(seconds=next(readings)),
        )
    if status != 0:
        raise RuntimeError(
            f"The run of {format_utc(began)} ended with status {status}:\n{printed.getvalue()}"
        )


@contextlib.contextmanager
def _environment(url: str):
    """
    What the command reads from the environment, for the length of the
    block: the dummy key and the fake server, and neither a commit, which
    would be stamped on the files, nor a file for step outputs.
    """
    with mock.patch.dict(os.environ, {"ODDS_API_KEY": KEY, "ODDS_API_BASE_URL": url}):
        for name in ("PIPELINE_COMMIT", "GITHUB_OUTPUT"):
            os.environ.pop(name, None)
        yield


def _holds_files(directory: Path) -> bool:
    return directory.exists() and any(directory.iterdir())


def _slot_starts() -> list[datetime]:
    """The start of every slot of the stretch, in UTC."""
    starts = [
        datetime.combine(FIRST_DAY + days * ONE_DAY, slot, tzinfo=schedule.ZONE)
        for days in range((LAST_DAY - FIRST_DAY).days + 1)
        for slot in schedule.SLOT_TIMES
    ]
    last = datetime.combine(LAST_DAY, LAST_SLOT, tzinfo=schedule.ZONE)
    return [start.astimezone(timezone.utc) for start in starts if start <= last]


def _listed_until(now: datetime) -> date:
    """The last day whose games the provider lists at a moment."""
    return now.astimezone(schedule.ZONE).date() + LISTED_AHEAD


def _strengths(draws: _Draws, opening: season.Season) -> dict:
    """Each team's strength in points against an average team."""
    rated = {
        teams.CODES[name]: team["rating"]
        for name, team in opening.points_rest["state"]["teams"].items()
    }
    mean = math.fsum(rated.values()) / len(rated)
    return {code: rated[code] - mean + SUMMER * draws.normal() for code in sorted(rated)}


def _fixtures(
    draws: _Draws, day: date, count: int, playing: dict, hosted: dict, met: set
) -> list[Fixture]:
    """
    The games of a day that are drawn: who plays whom, where and when. No
    team plays twice on a day or on three days running, a team that played
    the day before is seldom picked, a team that has played less than the
    others is picked sooner, and two teams that have met are not paired
    again while either can be given another opponent.

    The teams of a game of the script are left out the day before it and the
    day after, so that what the models make of that game does not hang on
    whom the draws send out tired.
    """
    resting = {
        code
        for fixture in SCRIPT
        if abs(fixture.day - day) == ONE_DAY
        for code in (fixture.home, fixture.away)
    }

    def weight(code):
        on = playing[code]
        the_day_before = day - ONE_DAY in on
        if day in on or code in resting or (the_day_before and day - 2 * ONE_DAY in on):
            return 0.0
        most = max(sum(played < day for played in days) for days in playing.values())
        return (0.15 if the_day_before else 1.0) * (1 + most - sum(played < day for played in on))

    picked = []
    for _ in range(2 * count):
        code = _weighted(draws, {code: weight(code) for code in playing})
        if code is None:
            break
        picked.append(code)
        playing[code].add(day)
    if len(picked) % 2:
        playing[picked.pop()].discard(day)

    fixtures = []
    while picked:
        one = picked.pop(0)
        fresh = [code for code in picked if frozenset((one, code)) not in met]
        other = (fresh or picked)[draws.below(len(fresh or picked))]
        picked.remove(other)
        met.add(frozenset((one, other)))
        # The one that has hosted less is at home, and a draw decides between equals.
        at_home = (hosted[one], draws.uniform()) < (hosted[other], 0.5)
        home, away = (one, other) if at_home else (other, one)
        hosted[home] += 1
        fixtures.append(Fixture(day, _tip(draws, day, home), home, away))
    return fixtures


def _weighted(draws: _Draws, weights: dict) -> str | None:
    """One of the keys, drawn in proportion to its weight. None when no weight is above zero."""
    aim = draws.uniform() * math.fsum(weights.values())
    drawn = None
    for key, share in weights.items():
        if share > 0:
            drawn = key
            aim -= share
            if aim < 0:
                break
    return drawn


def _tip(draws: _Draws, day: date, home: str) -> str:
    """
    When a game starts, in New York time: in the evening of the home city,
    or now and then in the afternoon at the weekend.
    """
    minute = (10, 40)[draws.below(2)]
    afternoon = draws.uniform() < 0.3
    if day.weekday() >= 5 and HOURS_WEST[home] <= 1 and afternoon:
        return f"{15 + draws.below(3)}:{minute}"
    return f"{19 + HOURS_WEST[home]}:{minute}"


def _game(
    draws: _Draws, fixture: Fixture, strength: dict, playing: dict, opening: season.Season
) -> Game:
    """
    A fixture with everything that is invented about its game. The draws are
    taken in the same order for every game, whatever the script says of it.
    """
    hour, minute = map(int, fixture.tip.split(":"))
    start = datetime.combine(fixture.day, time(hour, minute), tzinfo=schedule.ZONE).astimezone(
        timezone.utc
    )
    game_id = "".join(f"{draws.below(1 << 32):08x}" for _ in range(4))
    tipped = start + timedelta(minutes=6 + draws.below(8), seconds=draws.below(60))

    the_day_before = fixture.day - ONE_DAY
    neutral = opening.game(start, fixture.home, fixture.away).neutral
    expected = (
        strength[fixture.home]
        - strength[fixture.away]
        + (0 if neutral else HOME_COURT)
        - TIRED * (the_day_before in playing[fixture.home])
        + TIRED * (the_day_before in playing[fixture.away])
    )
    likely = normal_cdf(expected / SPREAD)
    # The sportsbooks know the strengths, and are a little off all the same.
    settled, drift = likely + 0.015 * draws.normal(), 0.02 * draws.normal()
    chance = min(0.94, max(0.06, settled)) if fixture.chance is None else fixture.chance

    quotes = []
    for number, (title, margin, hours) in enumerate(BOOKS):
        opens = start - timedelta(hours=hours - OPENS_WITHIN + 2 * OPENS_WITHIN * draws.uniform())
        passes, lean = draws.uniform() < PASSES, 0.008 * draws.normal()
        asked = number < fixture.books if fixture.books is not None else True
        if asked and (number < ALWAYS_QUOTING or not passes):
            quotes.append(Quote(title, margin, opens, lean))

    margin = round(expected + SPREAD * draws.normal())
    total = min(256, max(196, round(226 + 13 * draws.normal())))
    home_wins_overtime, by = draws.uniform() < likely, 1 + draws.below(6)
    if margin == 0:
        # No game ends level. This one went to overtime.
        margin, total = (by if home_wins_overtime else -by), total + 18
    home_pts = (total + margin + 1) // 2
    points = (home_pts, home_pts - margin) if fixture.points is None else fixture.points

    return Game(
        id=game_id,
        day=fixture.day,
        start=start,
        tipped=tipped,
        home=NAMES[fixture.home],
        away=NAMES[fixture.away],
        chance=chance,
        drift=drift,
        quotes=tuple(quotes),
        points=points,
    )


def _price(chance: float, margin: float) -> float:
    """The decimal price a sportsbook asks for a side it gives this chance, its margin included."""
    return max(1.01, round(1 / (chance * (1 + margin)), 2))


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m tests.sample_season",
        description=(
            "Plays an invented stretch of the 2026-27 season through the real job. "
            "Every game, price and score in it is made up."
        ),
    )
    parser.add_argument(
        "--out",
        type=Path,
        metavar="DIR",
        help="write the whole data directory here; it must be empty or not there yet",
    )
    parser.add_argument(
        "--sample-data",
        action="store_true",
        help=f"rebuild {SAMPLE_DATA.relative_to(REPOSITORY)} from the files that the web app reads",
    )
    args = parser.parse_args()
    if not args.out and not args.sample_data:
        parser.error("give --out DIR, --sample-data or both")
    if args.out and _holds_files(args.out):
        parser.error(f"{args.out} is not empty")

    with tempfile.TemporaryDirectory() as scratch:
        data_dir = args.out or Path(scratch) / "data"
        play(data_dir)
        if args.out:
            print(f"Wrote the data directory of the invented stretch to {data_dir}.")
        if args.sample_data:
            copy_sample(data_dir)
            print(f"Copied {len(SAMPLE_FILES)} files to {SAMPLE_DATA.relative_to(REPOSITORY)}.")


if __name__ == "__main__":
    main()
