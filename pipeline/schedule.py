"""
When snapshots are taken: six slots a day, in New York time.

The job is triggered far more often than six times a day. Each trigger works
out which slot it is in and compares that slot's id with the last one recorded
in the state file. Only the first trigger of a slot makes a request, so a
trigger that comes late, twice or by hand costs nothing.
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ZONE = ZoneInfo("America/New_York")

# Wall-clock times in ZONE. None of them lies between 01:00 and 03:00, the
# hours that a change to or from daylight saving time repeats or skips.
SLOT_TIMES = (time(5, 10), time(9, 10), time(12, 10), time(15, 10), time(18, 10), time(21, 10))


def current_and_next(now: datetime) -> tuple[datetime, datetime]:
    """
    The start of the most recent slot (at or before now) and the start of the
    next one, both in UTC.
    """
    if now.tzinfo is None:
        raise ValueError("now must carry a time zone")
    today = now.astimezone(ZONE).date()
    # Yesterday's, today's and tomorrow's slots always include both answers.
    # They are converted to UTC so that the comparisons below are between
    # instants: Python compares two datetimes of the same zone by their
    # wall-clock time, which is not the same thing when the clocks change.
    starts = sorted(
        datetime.combine(today + timedelta(days=day), slot, tzinfo=ZONE).astimezone(timezone.utc)
        for day in (-1, 0, 1)
        for slot in SLOT_TIMES
    )
    current = max(start for start in starts if start <= now)
    following = min(start for start in starts if start > now)
    return current, following


def slot_id(start: datetime) -> str:
    """A slot's id: its start in New York time with the UTC offset, as in 2026-10-20T18:10-04:00."""
    return start.astimezone(ZONE).isoformat(timespec="minutes")


def is_due(slot: str, last_slot: str | None) -> bool:
    """
    Whether a snapshot should be taken: the current slot is not the one the
    state file already records. With no state file yet, last_slot is None.
    """
    return slot != last_slot
