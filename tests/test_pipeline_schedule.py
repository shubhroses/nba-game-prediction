"""
Tests for pipeline/schedule.py.

The slot table is checked on 31 October, 1 November and 2 November 2026.
Daylight saving time ends in New York on 1 November at 02:00, so the offset
changes from -04:00 to -05:00 between the first day's last slot and the
second day's first.
"""

from datetime import datetime, timedelta, timezone

import pytest

from pipeline import schedule

# Each slot's id and the UTC time it starts at.
SLOTS = [
    ("2026-10-31T05:10-04:00", "2026-10-31 09:10"),
    ("2026-10-31T09:10-04:00", "2026-10-31 13:10"),
    ("2026-10-31T12:10-04:00", "2026-10-31 16:10"),
    ("2026-10-31T15:10-04:00", "2026-10-31 19:10"),
    ("2026-10-31T18:10-04:00", "2026-10-31 22:10"),
    ("2026-10-31T21:10-04:00", "2026-11-01 01:10"),
    ("2026-11-01T05:10-05:00", "2026-11-01 10:10"),
    ("2026-11-01T09:10-05:00", "2026-11-01 14:10"),
    ("2026-11-01T12:10-05:00", "2026-11-01 17:10"),
    ("2026-11-01T15:10-05:00", "2026-11-01 20:10"),
    ("2026-11-01T18:10-05:00", "2026-11-01 23:10"),
    ("2026-11-01T21:10-05:00", "2026-11-02 02:10"),
    ("2026-11-02T05:10-05:00", "2026-11-02 10:10"),
    ("2026-11-02T09:10-05:00", "2026-11-02 14:10"),
    ("2026-11-02T12:10-05:00", "2026-11-02 17:10"),
    ("2026-11-02T15:10-05:00", "2026-11-02 20:10"),
    ("2026-11-02T18:10-05:00", "2026-11-02 23:10"),
    ("2026-11-02T21:10-05:00", "2026-11-03 02:10"),
]


def utc(text):
    return datetime.strptime(text, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


def slot_at(now):
    current, following = schedule.current_and_next(now)
    return schedule.slot_id(current), schedule.slot_id(following)


@pytest.mark.parametrize("index", range(1, len(SLOTS) - 1))
def test_each_slot_runs_from_its_start_until_the_next_one(index):
    (previous_id, _), (this_id, start), (next_id, next_start) = SLOTS[index - 1 : index + 2]
    start, next_start = utc(start), utc(next_start)

    assert slot_at(start - timedelta(seconds=1)) == (previous_id, this_id)
    assert slot_at(start) == (this_id, next_id)
    assert slot_at(start + timedelta(minutes=29)) == (this_id, next_id)
    assert slot_at(next_start - timedelta(seconds=1)) == (this_id, next_id)
    assert schedule.current_and_next(start) == (start, next_start)
    assert [moment.utcoffset() for moment in schedule.current_and_next(start)] == [timedelta(0)] * 2


def length_of_the_slot_at(now):
    current, following = schedule.current_and_next(now)
    return following - current


def test_the_night_the_clocks_go_back_is_one_hour_longer():
    # 03:00 UTC is late evening in New York, in the day's last slot.
    assert length_of_the_slot_at(utc("2026-10-31 03:00")) == timedelta(hours=8)
    # The night of 31 October runs from 21:10 at -04:00 to 05:10 at -05:00.
    assert length_of_the_slot_at(utc("2026-11-01 03:00")) == timedelta(hours=9)
    assert length_of_the_slot_at(utc("2026-11-02 03:00")) == timedelta(hours=8)


def test_both_passes_through_the_repeated_hour_are_in_the_same_slot():
    # 01:30 happens twice on 1 November: at 05:30 UTC and again at 06:30 UTC.
    for now in (utc("2026-11-01 05:30"), utc("2026-11-01 06:30")):
        assert slot_at(now) == ("2026-10-31T21:10-04:00", "2026-11-01T05:10-05:00")


def test_the_answer_does_not_depend_on_the_zone_now_is_given_in():
    in_utc = utc("2026-11-01 05:30")
    in_new_york = in_utc.astimezone(schedule.ZONE)
    in_tokyo = in_utc.astimezone(timezone(timedelta(hours=9)))

    assert schedule.current_and_next(in_new_york) == schedule.current_and_next(in_utc)
    assert schedule.current_and_next(in_tokyo) == schedule.current_and_next(in_utc)


def test_a_time_without_a_zone_is_refused():
    with pytest.raises(ValueError, match="time zone"):
        schedule.current_and_next(datetime(2026, 11, 1, 5, 30))


def test_the_morning_after_the_clocks_go_forward():
    # 14 March 2027: 02:00 becomes 03:00 and the offset goes from -05:00 to -04:00.
    assert slot_at(utc("2027-03-14 02:10")) == ("2027-03-13T21:10-05:00", "2027-03-14T05:10-04:00")
    assert slot_at(utc("2027-03-14 09:10")) == ("2027-03-14T05:10-04:00", "2027-03-14T09:10-04:00")
    # That night is an hour shorter.
    assert length_of_the_slot_at(utc("2027-03-14 02:10")) == timedelta(hours=7)


def test_the_cron_triggers_find_every_slot_due_exactly_once_and_at_its_start():
    # The workflow is triggered at minute 10 and minute 40 of every hour, UTC.
    # Walk those triggers across the three days the way the job does: a slot
    # is due when its id is not the one recorded last.
    trigger = utc("2026-10-31 09:10")
    captured, last_slot = [], None
    while trigger < utc("2026-11-03 09:10"):
        slot, _ = slot_at(trigger)
        if schedule.is_due(slot, last_slot):
            captured.append((slot, trigger))
            last_slot = slot
        trigger += timedelta(minutes=30)

    assert captured == [(slot, utc(start)) for slot, start in SLOTS]


def test_a_late_trigger_still_takes_the_slot_once():
    # GitHub starts scheduled runs late and sometimes skips one. The 22:10
    # run is missing here; the 22:40 run takes the slot, and 23:10 does not.
    last_slot = "2026-10-31T15:10-04:00"

    slot, _ = slot_at(utc("2026-10-31 22:47"))
    assert slot == "2026-10-31T18:10-04:00"
    assert schedule.is_due(slot, last_slot)

    slot_again, _ = slot_at(utc("2026-10-31 23:12"))
    assert not schedule.is_due(slot_again, slot)


def test_a_slot_may_be_asked_for_until_75_minutes_after_its_start():
    assert schedule.ATTEMPT_WINDOW == timedelta(minutes=75)
    start = utc("2026-10-31 22:10")

    assert schedule.in_time(start, start)
    assert schedule.in_time(start, start + timedelta(minutes=74, seconds=59))
    assert not schedule.in_time(start, start + timedelta(minutes=75))
    assert not schedule.in_time(start, start + timedelta(hours=7, minutes=59))


def test_three_triggers_of_every_slot_start_in_time_and_no_more():
    # The same walk as above, this time noting how long after the start of
    # its slot each trigger comes that may still ask for it.
    trigger = utc("2026-10-31 09:10")
    in_time = {slot: [] for slot, _ in SLOTS}
    while trigger < utc("2026-11-03 09:10"):
        current, _ = schedule.current_and_next(trigger)
        if schedule.in_time(current, trigger):
            in_time[schedule.slot_id(current)].append(trigger - current)
        trigger += timedelta(minutes=30)

    on_the_slot_and_30_and_60_minutes_later = [timedelta(minutes=late) for late in (0, 30, 60)]
    assert in_time == {slot: on_the_slot_and_30_and_60_minutes_later for slot, _ in SLOTS}


def test_the_second_trigger_of_a_slot_is_in_time_when_it_starts_less_than_45_minutes_late():
    # GitHub starts scheduled runs late. That is why the window is 75 minutes
    # and not 60: the trigger half an hour after the slot's start must still
    # be able to take it.
    start = utc("2026-10-31 22:10")
    second_trigger = start + timedelta(minutes=30)

    for minutes_late in (0, 13, 21, 44):
        assert schedule.in_time(start, second_trigger + timedelta(minutes=minutes_late))
    assert not schedule.in_time(start, second_trigger + timedelta(minutes=45))
    # The fourth trigger never is, however punctual.
    assert not schedule.in_time(start, start + timedelta(minutes=90))


def test_the_first_run_is_due():
    assert schedule.is_due("2026-10-31T18:10-04:00", None)


def test_due_means_different_from_the_recorded_slot_not_later_than_it():
    # If the state names a slot that is still to come, the current one is taken all the same.
    assert schedule.is_due("2026-10-31T18:10-04:00", "2026-11-02T05:10-05:00")
    assert not schedule.is_due("2026-10-31T18:10-04:00", "2026-10-31T18:10-04:00")
