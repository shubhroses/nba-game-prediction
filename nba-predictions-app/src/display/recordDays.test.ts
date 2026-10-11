import { describe, expect, it } from 'vitest';
import { sampleBoard, sampleRecord } from '../data/sampleData';
import { DAYS_SHOWN, dayRows, daysShown } from './recordDays';
import { recordDay, seasonRecord } from './recordExamples';

describe('dayRows', () => {
  const record = sampleRecord();
  const board = sampleBoard();
  const rows = dayRows(record, board);
  const rowOf = (day: string) => {
    const row = rows.find((entry) => entry.day === day);
    if (!row) throw new Error(`No row for ${day}`);
    return row;
  };
  const texts = (day: string) => rowOf(day).cells.map((cell) => cell.text);

  it('shows the latest 14 days that have a game, the latest first', () => {
    expect(DAYS_SHOWN).toBe(14);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toMatchObject({ day: '2026-11-07', label: 'Sat, Nov 7', games: 6 });
    expect(rows[13]).toMatchObject({ day: '2026-10-25', label: 'Sun, Oct 25', games: 7 });
    expect(rows.map((row) => row.day)).toEqual([...rows.map((row) => row.day)].sort().reverse());
  });

  it('gives the picks won and lost of each source, in the order of the page', () => {
    expect(rowOf('2026-11-07').cells.map((cell) => cell.source.name)).toEqual(['Points & Rest', 'Elo', 'Sportsbooks']);
    expect(texts('2026-11-07')).toEqual(['2–4', '2–4', '3–1']);
    expect(texts('2026-11-05')).toEqual(['7–3', '7–3', '7–3']);
    expect(rowOf('2026-11-07').cells.every((cell) => cell.tallied)).toBe(true);
  });

  it('says in full what a day came to for a source, with the toss-ups and the games not graded', () => {
    // Saturday 7 November: Orlando at Charlotte was never quoted, and the line of Golden State at Phoenix was a toss-up.
    expect(rowOf('2026-11-07').cells.map((cell) => cell.words)).toEqual([
      '2 won, 4 lost',
      '2 won, 4 lost',
      '3 won, 1 lost, 1 toss-up, 1 not graded',
    ]);
    expect(rowOf('2026-10-31').cells[2].words).toBe('2 won, 3 lost, 4 toss-ups');
  });

  it('says "Not graded" and no tally for a model on a day it was left out of or had no forecast for', () => {
    // On 2 November the points-and-rest model was left out, and on 27 October the job did not run in the morning.
    expect(texts('2026-11-02')).toEqual(['Not graded', '3–1', '4–2']);
    expect(texts('2026-10-27')).toEqual(['Not graded', 'Not graded', '6–4']);
    expect(rowOf('2026-11-02').cells[0]).toMatchObject({ tallied: false, words: '0 won, 0 lost, 6 not graded' });
  });

  it('links a day to its results while the board holds one of them', () => {
    expect(rowOf('2026-11-07').href).toBe('#/results/2026-11-07');
    // The board keeps a result for eight days: six of the nine games of 31 October are still on it.
    expect(rowOf('2026-10-31').href).toBe('#/results/2026-10-31');
    expect(rowOf('2026-10-30').href).toBeNull();
    expect(rows.filter((row) => row.href !== null)).toHaveLength(8);
  });

  it('shows every day of a record that has fewer than 14, and none before the first game', () => {
    const three = seasonRecord({
      games: 20,
      by_day: [recordDay('2026-10-20', 6), recordDay('2026-10-21', 6), recordDay('2026-10-22', 8)],
    });

    expect(dayRows(three, board).map((row) => row.day)).toEqual(['2026-10-22', '2026-10-21', '2026-10-20']);
    expect(dayRows(seasonRecord(), board)).toEqual([]);
  });

  it('says "No pick" for a day on which a source had a chance for a game and no pick for any', () => {
    const tossUps = seasonRecord({
      games: 2,
      by_day: [recordDay('2026-10-20', 2, { elo: { wins: 0, losses: 0, toss_ups: 1, not_graded: 1 } })],
    });
    const [row] = dayRows(tossUps, board);

    expect(row.cells[1]).toMatchObject({ text: 'No pick', tallied: false, words: '0 won, 0 lost, 1 toss-up, 1 not graded' });
  });

  it('has a column for the sportsbooks alone in a sport that is not forecast', () => {
    const day = { day: '2026-10-07', games: 4, market: { wins: 0, losses: 0, toss_ups: 0, not_graded: 4 }, elo: null, points_rest: null };
    const [row] = dayRows(seasonRecord({ games: 4, elo: null, points_rest: null, by_day: [day] }), board);

    expect(row.cells.map((cell) => [cell.source.key, cell.text])).toEqual([['market', 'Not graded']]);
  });

  it('calls a model that an entry of a day does not have not graded', () => {
    const day = { ...recordDay('2026-10-20', 3), points_rest: null };
    const [row] = dayRows(seasonRecord({ games: 3, by_day: [day] }), board);

    expect(row.cells.map((cell) => cell.text)).toEqual(['Not graded', '3–0', '3–0']);
  });
});

describe('daysShown', () => {
  it('says how many of the days the table shows', () => {
    expect(daysShown(sampleRecord())).toBe('The latest 14 of 19 days');
  });

  it('says so when it shows all of them', () => {
    const days = (count: number) =>
      seasonRecord({ by_day: Array.from({ length: count }, (_, index) => recordDay(`2026-10-${20 + index}`, 5)) });

    expect(daysShown(days(1))).toBe('1 day');
    expect(daysShown(days(3))).toBe('All 3 days');
  });
});
