"""Which sports are captured, the directory each is written under, and which are forecast."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Sport:
    key: str  # the sport's key in The Odds API
    prefix: str  # the directory in the data branch that its files go under
    last_day: date | None = None  # the last New York calendar day on which --all captures it
    # The season whose opening files in pipeline/model/ the two models start
    # from, as the file names have it. None for a sport that is recorded and
    # graded against the sportsbooks and not forecast.
    season: str | None = None


SPORTS = (
    # The season is to be changed together with the opening files, before
    # the first game of 2027-28.
    Sport(key="basketball_nba", prefix="v1", season="2026_27"),
    # Rehearsal only. The regular season starts on 20 October 2026, and the
    # daily work, which records results and grades them, has to be tried on
    # real games before opening night. The only real games before then are
    # preseason games, so they are captured under a prefix of their own,
    # apart from the real record. Preseason games are not games of the
    # season, so the models are never run on them. Delete this entry after
    # opening night. No code and no test depends on it. The READMEs mention
    # it.
    Sport(key="basketball_nba_preseason", prefix="v1-dryrun", last_day=date(2026, 10, 17)),
)


def sports_on(day: date) -> tuple[Sport, ...]:
    """The sports that --all captures on a New York calendar day."""
    return tuple(sport for sport in SPORTS if sport.last_day is None or day <= sport.last_day)
