import { describe, expect, it } from 'vitest';
import { VERDICTS, type ResultLine } from '../data/results';
import { outcomeOf, outcomeWords, publishedTooLate, winningSide } from './verdict';

const LINE: ResultLine = {
  id: 'game-1',
  commence_time: '2026-10-22T01:10:12Z',
  home: 'DEN',
  away: 'DAL',
  home_pts: 101,
  away_pts: 110,
  recorded_at: '2026-10-22T09:10:07Z',
  market: null,
  market_verdict: 'not_graded',
  elo: { p_home: 0.802, published_at: '2026-10-21T09:10:07Z' },
  elo_verdict: 'upset',
  points_rest: null,
  points_rest_verdict: 'not_graded',
};

describe('outcomeOf', () => {
  it('words each of the four verdicts', () => {
    expect(VERDICTS.map((verdict) => outcomeWords(outcomeOf(verdict)))).toEqual(['Right', 'Wrong', 'No pick', 'Not graded']);
  });
});

describe('winningSide', () => {
  it('is the side with more points', () => {
    expect(winningSide(LINE)).toBe('away');
    expect(winningSide({ home_pts: 112, away_pts: 104 })).toBe('home');
  });
});

describe('publishedTooLate', () => {
  it('is true for a forecast that the line carries and that was not graded', () => {
    const late: ResultLine = {
      ...LINE,
      elo: { p_home: 0.802, published_at: '2026-10-22T01:30:00Z' },
      elo_verdict: 'not_graded',
    };

    expect(publishedTooLate(late, 'elo')).toBe(true);
  });

  it('is false for a forecast that was graded', () => {
    expect(publishedTooLate(LINE, 'elo')).toBe(false);
  });

  it('is false for a game the model had no forecast for', () => {
    expect(publishedTooLate(LINE, 'points_rest')).toBe(false);
  });
});
