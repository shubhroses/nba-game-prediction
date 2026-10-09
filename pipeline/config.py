"""Which sports are captured, and the directory each one is written under."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Sport:
    key: str  # the sport's key in The Odds API
    prefix: str  # the directory in the data branch that its files go under
    last_day: date | None = None  # the last New York calendar day on which --all captures it


SPORTS = (
    Sport(key="basketball_nba", prefix="v1"),
    # Rehearsal only. The regular season starts on 20 October 2026, and the
    # grading step has to be tried on real games before opening night. The
    # only real games before then are preseason games, so they are captured
    # under a prefix of their own, apart from the real record. Delete this
    # entry after opening night. Nothing else refers to it.
    Sport(key="basketball_nba_preseason", prefix="v1-dryrun", last_day=date(2026, 10, 17)),
)


def sports_on(day: date) -> tuple[Sport, ...]:
    """The sports that --all captures on a New York calendar day."""
    return tuple(sport for sport in SPORTS if sport.last_day is None or day <= sport.last_day)
