"""Tests for pipeline/timestamps.py, the one time format of the published files."""

from datetime import datetime, timedelta, timezone

import pytest

from pipeline.timestamps import format_utc, parse_utc

MOMENT = datetime(2026, 10, 20, 22, 10, 41, tzinfo=timezone.utc)


def test_a_time_is_written_in_utc_to_the_second():
    new_york = timezone(timedelta(hours=-4))

    assert format_utc(MOMENT) == "2026-10-20T22:10:41Z"
    assert format_utc(MOMENT.astimezone(new_york)) == "2026-10-20T22:10:41Z"
    assert format_utc(MOMENT.replace(microsecond=999_999)) == "2026-10-20T22:10:41Z"


def test_a_time_without_a_zone_is_not_written():
    with pytest.raises(ValueError, match="time zone"):
        format_utc(datetime(2026, 10, 20, 22, 10, 41))


def test_parsing_is_the_reverse_of_writing():
    assert parse_utc("2026-10-20T22:10:41Z") == MOMENT
    assert parse_utc(format_utc(MOMENT)).utcoffset() == timedelta(0)


@pytest.mark.parametrize(
    "text",
    [
        "2026-10-20T22:10:41",
        "2026-10-20T22:10:41+00:00",
        "2026-10-20T18:10:41-04:00",
        "2026-10-20T22:10:41.000Z",
        "2026-10-20T22:10Z",
        "2026-10-20 22:10:41Z",
        "2026-1-5T1:2:3Z",
        "2026-13-01T00:00:00Z",
        "",
        None,
        1792534241,
    ],
)
def test_anything_not_written_exactly_that_way_is_refused(text):
    with pytest.raises(ValueError):
        parse_utc(text)


def test_the_strings_sort_in_time_order():
    moments = [MOMENT + timedelta(hours=hours) for hours in (30, -3, 0, 2000)]

    assert sorted(format_utc(moment) for moment in moments) == [
        format_utc(moment) for moment in sorted(moments)
    ]
