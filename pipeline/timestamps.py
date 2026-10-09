"""
The one timestamp format used in the published files and in the request:
UTC, to the second, ending in Z. For example 2026-10-20T22:10:41Z.

Strings in this format sort in time order.
"""

from datetime import datetime, timezone

_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def format_utc(moment: datetime) -> str:
    """The moment in UTC. Fractions of a second are cut off."""
    if moment.tzinfo is None:
        raise ValueError("the datetime must carry a time zone")
    return moment.astimezone(timezone.utc).strftime(_FORMAT)


def parse_utc(text: object) -> datetime:
    """The reverse of format_utc. Raises ValueError for anything not written exactly that way."""
    if not isinstance(text, str):
        raise ValueError("not a timestamp")
    moment = datetime.strptime(text, _FORMAT).replace(tzinfo=timezone.utc)
    if format_utc(moment) != text:  # strptime also accepts "2026-1-5T1:2:3Z"
        raise ValueError("not a timestamp in the form YYYY-MM-DDTHH:MM:SSZ")
    return moment
