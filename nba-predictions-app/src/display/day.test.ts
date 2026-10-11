import { afterEach, describe, expect, it, vi } from 'vitest';
// The job's rule, read as text: the page must count a game's day the same way.
import season from '../../../pipeline/model/season.py?raw';
import { parseBoard, type Board } from '../data/board';
import { examplesOf } from '../data/pipelineExamples';
import { addDays, currentDay, dayLabel, dayName, daysFrom, dayStart, gameDay, pageDay, predictionDays } from './day';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('gameDay', () => {
  it('takes ten hours off the start, as the job does', () => {
    expect(season).toContain('_DAY_BEGINS = timedelta(hours=10)');
    expect(season).toContain('return (start.astimezone(timezone.utc) - _DAY_BEGINS).date()');
  });

  it('is the date of an evening game in New York', () => {
    // 19:00 in New York on Tuesday 20 October.
    expect(gameDay('2026-10-20T23:00:00Z')).toBe('2026-10-20');
  });

  it('keeps a late game with its evening, although it starts on the next date in UTC', () => {
    // 22:30 in New York and 19:30 in Los Angeles, both on Tuesday.
    expect(gameDay('2026-10-21T02:30:00Z')).toBe('2026-10-20');
    expect(gameDay('2026-10-21T09:59:59Z')).toBe('2026-10-20');
  });

  it('turns to the next day at 10:00 UTC', () => {
    expect(gameDay('2026-10-21T10:00:00Z')).toBe('2026-10-21');
    // An afternoon game: 15:00 in New York.
    expect(gameDay('2026-10-21T19:00:00Z')).toBe('2026-10-21');
  });

  it('is the same on both sides of the end of daylight saving time', () => {
    // 19:30 in New York on Saturday 31 October, and 18:00 there on Sunday 1 November.
    expect(gameDay('2026-10-31T23:30:00Z')).toBe('2026-10-31');
    expect(gameDay('2026-11-01T23:00:00Z')).toBe('2026-11-01');
  });

  it('crosses a month and a year', () => {
    expect(gameDay('2026-11-01T03:00:00Z')).toBe('2026-10-31');
    expect(gameDay('2027-01-01T01:00:00Z')).toBe('2026-12-31');
  });

  it('takes the start of a result, which is to the second', () => {
    expect(gameDay('2026-10-22T01:10:12Z')).toBe('2026-10-21');
  });

  it.each([
    ['America/Los_Angeles', 420],
    ['Europe/London', -60],
    ['Asia/Tokyo', -540],
    ['Pacific/Kiritimati', -840],
  ])('does not depend on the time zone of the visitor: %s', (timeZone, minutesBehindUtc) => {
    vi.stubEnv('TZ', timeZone);
    // The clock of the test is in that zone now.
    expect(new Date('2026-10-21T02:30:00Z').getTimezoneOffset()).toBe(minutesBehindUtc);

    expect(gameDay('2026-10-21T02:30:00Z')).toBe('2026-10-20');
    expect(currentDay(Date.parse('2026-10-21T09:59:00Z'))).toBe('2026-10-20');
    expect(dayName('2026-10-20')).toBe('Tue, Oct 20');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(dayLabel('2026-10-21', '2026-10-20')).toBe('Tomorrow');
  });
});

describe('currentDay', () => {
  it('is the day whose games are being played', () => {
    // Half past midnight in New York: the late games of Tuesday are still on.
    expect(currentDay(Date.parse('2026-10-21T04:30:00Z'))).toBe('2026-10-20');
  });

  it('turns at 10:00 UTC, early in the morning in North America', () => {
    expect(currentDay(Date.parse('2026-10-21T09:59:59Z'))).toBe('2026-10-20');
    expect(currentDay(Date.parse('2026-10-21T10:00:00Z'))).toBe('2026-10-21');
  });

  it('gives a game that is on at this moment the day it gives the moment', () => {
    const start = '2026-11-08T23:30:00Z';

    expect(currentDay(Date.parse(start))).toBe(gameDay(start));
  });
});

describe('dayStart', () => {
  it('is 10:00 UTC on the date of the day, where the day of a game turns', () => {
    expect(dayStart('2026-10-20')).toBe(Date.parse('2026-10-20T10:00:00Z'));
    expect(gameDay(new Date(dayStart('2026-10-20')).toISOString())).toBe('2026-10-20');
    expect(gameDay(new Date(dayStart('2026-10-20') - 1).toISOString())).toBe('2026-10-19');
  });
});

describe('pageDay', () => {
  /** A board whose frozen forecasts are those of one day. */
  function boardOf(predictionsDay: string | null): Board {
    const parsed = parseBoard(examplesOf('slate.json')[0]);
    if (!parsed.ok) throw new Error(parsed.problem);
    return { ...parsed.value, models: { results_through: null, status: 'ok', predictions_day: predictionsDay } };
  }

  it('is the day by the clock while the board carries the forecasts of that day, or of an earlier one', () => {
    const evening = Date.parse('2026-10-21T01:00:00Z');

    expect(pageDay(boardOf('2026-10-20'), evening)).toBe('2026-10-20');
    expect(pageDay(boardOf('2026-10-19'), evening)).toBe('2026-10-20');
    expect(pageDay(boardOf(null), evening)).toBe('2026-10-20');
    expect(pageDay({ ...boardOf(null), models: null }, evening)).toBe('2026-10-20');
  });

  it('goes by the board in the fifty minutes between the daily work and the turn of the day, while New York is on daylight saving time', () => {
    // 05:30 in New York on Wednesday 21 October: the daily work of 05:10 is done, and the day by the clock is still Tuesday.
    const morning = Date.parse('2026-10-21T09:30:00Z');

    expect(currentDay(morning)).toBe('2026-10-20');
    expect(pageDay(boardOf('2026-10-21'), morning)).toBe('2026-10-21');
    // A board from before the daily work still carries the forecasts of Tuesday.
    expect(pageDay(boardOf('2026-10-20'), morning)).toBe('2026-10-20');
  });

  it('is the day by the clock again once that day has turned', () => {
    expect(pageDay(boardOf('2026-10-21'), Date.parse('2026-10-21T10:00:00Z'))).toBe('2026-10-21');
  });

  it('follows the board one day and no further', () => {
    expect(pageDay(boardOf('2026-10-23'), Date.parse('2026-10-21T09:30:00Z'))).toBe('2026-10-20');
  });
});

describe('addDays and daysFrom', () => {
  it('count calendar days', () => {
    expect(addDays('2026-10-20', 1)).toBe('2026-10-21');
    expect(addDays('2026-10-20', -1)).toBe('2026-10-19');
    expect(addDays('2026-10-20', 0)).toBe('2026-10-20');
    expect(daysFrom('2026-10-20', '2026-10-27')).toBe(7);
    expect(daysFrom('2026-10-27', '2026-10-20')).toBe(-7);
  });

  it('cross months, years and a leap day', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysFrom('2026-12-25', '2027-01-01')).toBe(7);
  });

  it('are not thrown by the weeks in which the clocks change', () => {
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(daysFrom('2027-03-13', '2027-03-15')).toBe(2);
  });
});

describe('dayName', () => {
  it.each([
    ['2026-10-20', 'Tue, Oct 20'],
    ['2026-11-01', 'Sun, Nov 1'],
    ['2026-12-25', 'Fri, Dec 25'],
    ['2027-01-14', 'Thu, Jan 14'],
    ['2027-04-11', 'Sun, Apr 11'],
  ])('%s is "%s"', (day, name) => {
    expect(dayName(day)).toBe(name);
  });
});

describe('dayLabel', () => {
  const TODAY = '2026-10-20';

  it('calls the three days around now by their names', () => {
    expect(dayLabel('2026-10-20', TODAY)).toBe('Today');
    expect(dayLabel('2026-10-21', TODAY)).toBe('Tomorrow');
    expect(dayLabel('2026-10-19', TODAY)).toBe('Yesterday');
  });

  it('gives any other day its weekday and date', () => {
    expect(dayLabel('2026-10-22', TODAY)).toBe('Thu, Oct 22');
    expect(dayLabel('2026-10-18', TODAY)).toBe('Sun, Oct 18');
    expect(dayLabel('2026-12-25', TODAY)).toBe('Fri, Dec 25');
  });

  it('goes by the day and not by the hours between', () => {
    const lateEvening = currentDay(Date.parse('2026-10-21T09:00:00Z'));

    expect(dayLabel(gameDay('2026-10-21T23:00:00Z'), lateEvening)).toBe('Tomorrow');
    expect(dayLabel(gameDay('2026-10-21T02:30:00Z'), lateEvening)).toBe('Today');
  });
});

describe('predictionDays', () => {
  /** The board of the example in pipeline/README.md: the forecasts of 21 October, and a result of the 20th. */
  function exampleBoard(): Board {
    const parsed = parseBoard(examplesOf('slate.json')[0]);
    if (!parsed.ok) throw new Error(parsed.problem);
    return parsed.value;
  }

  it('lists the day whose forecasts the board carries and the day of a result that was graded for a model', () => {
    expect(predictionDays(exampleBoard())).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('lists a day once, however many of its games are on the board', () => {
    const board = exampleBoard();
    const [result] = board.recent_results;
    board.recent_results = [result, { ...result, id: 'another-game-of-the-evening', commence_time: '2026-10-21T02:40:11Z' }];

    expect(predictionDays(board)).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('leaves out the day of a result that no forecast was on file for', () => {
    const board = exampleBoard();
    board.recent_results = board.recent_results.map((line) => ({ ...line, elo: null, elo_verdict: 'not_graded' }));

    expect(predictionDays(board)).toEqual(['2026-10-21']);
  });

  it('is empty before the first forecast is frozen, as it is before the season', () => {
    const board = exampleBoard();
    board.recent_results = [];
    board.models = { results_through: null, status: 'ok', predictions_day: null };

    expect(predictionDays(board)).toEqual([]);
    expect(predictionDays({ ...board, models: null })).toEqual([]);
  });
});
