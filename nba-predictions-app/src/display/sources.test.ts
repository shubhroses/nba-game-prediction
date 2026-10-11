import { describe, expect, it } from 'vitest';
import type { BoardGame } from '../data/board';
import type { ResultLine } from '../data/results';
import { boardChance, MODELS, resultChance, resultVerdict, source, SOURCES } from './sources';

/** A game on its morning, with all three sources. The numbers are invented. */
const GAME: BoardGame = {
  id: 'game-1',
  commence_time: '2026-10-22T02:00:00Z',
  home: 'LAL',
  away: 'GSW',
  line: { p_home: 0.4275, lo: 0.4177, hi: 0.4359, n: 3, books: ['Book A', 'Book B', 'Book C'], captured_at: '2026-10-22T01:10:35Z' },
  open: { p_home: 0.4359, at: '2026-10-20T22:10:41Z' },
  elo: { p_home: 0.7117 },
  points_rest: { p_home: 0.6675, margin: 5.14, rating_edge: 3.98, home_court: 1.16, rest_edge: 0 },
};

const RESULT: ResultLine = {
  id: 'game-1',
  commence_time: '2026-10-22T02:00:21Z',
  home: 'LAL',
  away: 'GSW',
  home_pts: 99,
  away_pts: 120,
  recorded_at: '2026-10-22T09:10:07Z',
  market: { p_home: 0.4275, lo: 0.4177, hi: 0.4359, n: 3, at: '2026-10-22T01:10:35Z' },
  market_verdict: 'favorite_won',
  elo: { p_home: 0.7117, published_at: '2026-10-21T09:10:07Z' },
  elo_verdict: 'upset',
  points_rest: null,
  points_rest_verdict: 'not_graded',
};

describe('SOURCES', () => {
  it('lists the two models first and the sportsbooks last, by the names the page uses', () => {
    expect(SOURCES.map((entry) => entry.name)).toEqual(['Points & Rest', 'Elo', 'Sportsbooks']);
    expect(SOURCES.map((entry) => entry.key)).toEqual(['points_rest', 'elo', 'market']);
    expect(MODELS.map((entry) => entry.name)).toEqual(['Points & Rest', 'Elo']);
  });

  it('gives each source a color of its own and writes its classes out', () => {
    expect(new Set(SOURCES.map((entry) => entry.token)).size).toBe(3);
    for (const { token, text, bg, soft, border, fill, stroke } of SOURCES) {
      expect([text, bg, soft, border, fill, stroke]).toEqual([
        `text-${token}`,
        `bg-${token}`,
        `bg-${token}-soft`,
        `border-${token}`,
        `fill-${token}`,
        `stroke-${token}`,
      ]);
    }
  });

  it('says in one sentence what each source is, and calls the sportsbooks by that name', () => {
    for (const { description } of SOURCES) {
      expect(description).toMatch(/^[A-Z][^.]+\.$/);
      expect(description.length).toBeLessThan(110);
    }
    expect(source('market').description).toContain('sportsbooks');
  });

  it('finds a source by its key', () => {
    expect(source('market').name).toBe('Sportsbooks');
    expect(source('points_rest').token).toBe('pr');
  });
});

describe('boardChance', () => {
  it('reads the chance of each source for the home team', () => {
    expect(boardChance(GAME, 'points_rest')).toBe(0.6675);
    expect(boardChance(GAME, 'elo')).toBe(0.7117);
    expect(boardChance(GAME, 'market')).toBe(0.4275);
  });

  it('is null for a source the board holds nothing of', () => {
    const later: BoardGame = { ...GAME, line: null, elo: null, points_rest: null };

    expect(SOURCES.map((entry) => boardChance(later, entry.key))).toEqual([null, null, null]);
  });
});

describe('resultChance and resultVerdict', () => {
  it('read what each source said of a game that is over, and what became of it', () => {
    expect(resultChance(RESULT, 'market')).toBe(0.4275);
    expect(resultVerdict(RESULT, 'market')).toBe('favorite_won');
    expect(resultChance(RESULT, 'elo')).toBe(0.7117);
    expect(resultVerdict(RESULT, 'elo')).toBe('upset');
  });

  it('is null for a source that said nothing', () => {
    expect(resultChance(RESULT, 'points_rest')).toBeNull();
    expect(resultVerdict(RESULT, 'points_rest')).toBe('not_graded');
  });
});
