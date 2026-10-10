import { describe, expect, it } from 'vitest';
import type { Board, BoardGame } from '../data/board';
import { age, clockTime, nextUpdateNote, snapshotNote } from './statusLine';

const NEW_YORK = 'America/New_York';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A game that starts on the evening of 20 October 2026, with a line from this many sportsbooks. */
function game(sportsbooks: number, commence_time = '2026-10-20T23:00:00Z'): BoardGame {
  const line =
    sportsbooks === 0
      ? null
      : { p_home: 0.6, lo: 0.6, hi: 0.6, n: sportsbooks, books: [], captured_at: '2026-10-20T16:12:00Z' };
  return { id: `game-${sportsbooks}`, commence_time, home: 'BOS', away: 'NYK', line, open: null };
}

/** The snapshot of the 12:10 slot in New York, taken at 12:12, with the next one due at 15:10. */
function board(games: BoardGame[]): Board {
  return {
    schema: 1,
    sport: 'basketball_nba',
    generated_at: '2026-10-20T16:12:00Z',
    slot: '2026-10-20T12:10-04:00',
    next_due: '2026-10-20T15:10-04:00',
    games,
  };
}

const AT_1502 = Date.parse('2026-10-20T19:02:00Z');

describe('clockTime', () => {
  it('gives the time of day in the time zone asked for', () => {
    const at = Date.parse('2026-10-20T16:12:00Z');

    expect(clockTime(at, AT_1502, NEW_YORK)).toBe('12:12 PM');
    expect(clockTime(at, AT_1502, 'America/Los_Angeles')).toBe('9:12 AM');
  });

  it('adds the date when the time is on another day', () => {
    const yesterday = Date.parse('2026-10-19T19:12:00Z');
    const tomorrow = Date.parse('2026-10-21T09:10:00Z');

    expect(clockTime(yesterday, AT_1502, NEW_YORK)).toBe('3:12 PM on Oct 19');
    expect(clockTime(tomorrow, AT_1502, NEW_YORK)).toBe('5:10 AM on Oct 21');
  });

  it('goes by the day in that time zone, not in UTC', () => {
    // 21:30 in New York on the 20th is already the 21st in UTC.
    const lateEvening = Date.parse('2026-10-21T01:30:00Z');

    expect(clockTime(lateEvening, AT_1502, NEW_YORK)).toBe('9:30 PM');
  });
});

describe('age', () => {
  it.each([
    [0, 'less than a minute ago'],
    [59_999, 'less than a minute ago'],
    [MINUTE, '1 min ago'],
    [59 * MINUTE, '59 min ago'],
    [HOUR, '1 h ago'],
    [2 * HOUR + 50 * MINUTE, '2 h 50 min ago'],
    [23 * HOUR + 59 * MINUTE, '23 h 59 min ago'],
    [24 * HOUR, '1 day ago'],
    [3 * 24 * HOUR + 5 * HOUR, '3 days ago'],
  ])('%i ms is "%s"', (milliseconds, text) => {
    expect(age(milliseconds)).toBe(text);
  });

  it('does not go below zero when the clock of the visitor is behind', () => {
    expect(age(-5 * MINUTE)).toBe('less than a minute ago');
  });
});

describe('snapshotNote', () => {
  it('says when the odds were taken, how long ago and from how many sportsbooks at most', () => {
    const note = snapshotNote(board([game(6), game(1), game(0)]), AT_1502, NEW_YORK);

    expect(note).toBe('Odds as of 12:12 PM (2 h 50 min ago), the median of up to 6 sportsbooks.');
  });

  it('says so when no game has more than one sportsbook', () => {
    expect(snapshotNote(board([game(1), game(0)]), AT_1502, NEW_YORK)).toBe(
      'Odds as of 12:12 PM (2 h 50 min ago), from 1 sportsbook.',
    );
  });

  it('counts no sportsbooks when no game has a line', () => {
    expect(snapshotNote(board([game(0)]), AT_1502, NEW_YORK)).toBe('Odds as of 12:12 PM (2 h 50 min ago).');
    expect(snapshotNote(board([]), AT_1502, NEW_YORK)).toBe('Odds as of 12:12 PM (2 h 50 min ago).');
  });

  it('does not count a game that has started', () => {
    const started = game(6, '2026-10-20T19:00:00Z');

    expect(snapshotNote(board([started, game(4)]), AT_1502, NEW_YORK)).toBe(
      'Odds as of 12:12 PM (2 h 50 min ago), the median of up to 4 sportsbooks.',
    );
  });

  it('gives the date of odds that are from another day', () => {
    const twoDaysLater = Date.parse('2026-10-22T17:12:00Z');

    expect(snapshotNote(board([]), twoDaysLater, NEW_YORK)).toBe('Odds as of 12:12 PM on Oct 20 (2 days ago).');
  });
});

describe('nextUpdateNote', () => {
  it('says when the next snapshot is due', () => {
    expect(nextUpdateNote(board([]), AT_1502, NEW_YORK)).toBe('Next update about 3:10 PM.');
  });

  it('says that the snapshot is overdue once its time has passed', () => {
    const at1525 = Date.parse('2026-10-20T19:25:00Z');

    expect(nextUpdateNote(board([]), at1525, NEW_YORK)).toBe('The next update was due at 3:10 PM.');
  });

  it('gives the date of a snapshot that is due on another day', () => {
    const evening = { ...board([]), next_due: '2026-10-21T05:10-04:00' };
    const at2130 = Date.parse('2026-10-21T01:30:00Z');

    expect(nextUpdateNote(evening, at2130, NEW_YORK)).toBe('Next update about 5:10 AM on Oct 21.');
  });
});
