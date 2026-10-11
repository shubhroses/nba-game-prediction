import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { expectedModel, expectedPredictions, expectedRecord } from './expected';
import { sampleBoard, sampleModel, samplePredictions, sampleRecord } from './sampleData';

/** The board of the sample with what a test changes. */
function boardWith(changes: Partial<Board>): Board {
  return { ...sampleBoard(), ...changes };
}

describe('expectedRecord', () => {
  it('says that the record exists once the board carries one, and takes the record of the same run as it is', () => {
    const expected = expectedRecord(sampleBoard());

    expect(expected.exists).toBe(true);
    expect(expected.behind?.(sampleRecord())).toBe(false);
  });

  it('tells a record of another run by its picks won and lost, for any of the three sources', () => {
    // The board of the morning next to the record of the day before, which the host can still answer with.
    const record = sampleRecord();
    const morning = boardWith({ record: { market: { wins: 88, losses: 50 }, elo: { wins: 73, losses: 43 }, points_rest: { wins: 72, losses: 44 } } });
    const eloMoved = boardWith({ record: { market: { wins: 83, losses: 48 }, elo: { wins: 73, losses: 44 }, points_rest: { wins: 72, losses: 44 } } });
    const pointsRestMoved = boardWith({ record: { market: { wins: 83, losses: 48 }, elo: { wins: 73, losses: 43 }, points_rest: { wins: 73, losses: 44 } } });

    expect(expectedRecord(morning).behind?.(record)).toBe(true);
    expect(expectedRecord(eloMoved).behind?.(record)).toBe(true);
    expect(expectedRecord(pointsRestMoved).behind?.(record)).toBe(true);
  });

  it('does not expect a record before the first daily run, when the board carries none', () => {
    expect(expectedRecord(boardWith({ record: null }))).toEqual({ exists: false });
  });

  it('takes the record of a sport that is not forecast, which has the sportsbooks alone on both sides', () => {
    const board = boardWith({ record: { market: { wins: 83, losses: 48 }, elo: null, points_rest: null } });
    const record = { ...sampleRecord(), elo: null, points_rest: null };

    expect(expectedRecord(board).behind?.(record)).toBe(false);
    // A record with the models next to a board without them is not of the same run.
    expect(expectedRecord(board).behind?.(sampleRecord())).toBe(true);
  });
});

describe('expectedModel', () => {
  it('takes the ratings of the same daily run as the board', () => {
    const expected = expectedModel(sampleBoard());

    expect(expected.exists).toBe(true);
    expect(expected.behind?.(sampleModel())).toBe(false);
  });

  it('tells the ratings of another run by the day of the last result, and by what the checks on the results found', () => {
    const expected = expectedModel(sampleBoard());

    expect(expected.behind?.({ ...sampleModel(), results_through: '2026-11-06' })).toBe(true);
    expect(expected.behind?.({ ...sampleModel(), results_through: null })).toBe(true);
    expect(expected.behind?.({ ...sampleModel(), status: 'degraded' })).toBe(true);
  });

  it('expects no ratings while the board does not carry what its forecasts rest on', () => {
    expect(expectedModel(boardWith({ models: null }))).toEqual({ exists: false });
  });
});

describe('expectedPredictions', () => {
  it('says that the file exists for the day whose frozen forecasts the board carries, and for the days of its results', () => {
    expect(expectedPredictions(sampleBoard(), '2026-11-08')).toEqual({ exists: true });
    expect(expectedPredictions(sampleBoard(), '2026-11-07')).toEqual({ exists: true });
  });

  it('does not say it of a day that the board carries no forecast of, or of no day', () => {
    expect(expectedPredictions(sampleBoard(), '2026-11-09')).toEqual({ exists: false });
    expect(expectedPredictions(sampleBoard(), null)).toEqual({ exists: false });
    expect(expectedPredictions(boardWith({ models: null, recent_results: [] }), '2026-11-08')).toEqual({ exists: false });
  });

  it('never calls a forecasts file behind: it is written once', () => {
    expect(expectedPredictions(sampleBoard(), '2026-11-08').behind?.(samplePredictions('2026-11-08'))).toBeUndefined();
  });
});
