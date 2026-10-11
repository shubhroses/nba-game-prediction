import { describe, expect, it } from 'vitest';
import type { BoardGame, Line } from '../data/board';
import { gameCardView, outlookLabel, sportsbooksNote, upcomingCards } from './gameCard';

/** Invented numbers: the example of the pipeline documentation, changed as each test needs. */
function line(changes: Partial<Line> = {}): Line {
  return {
    p_home: 0.6429,
    lo: 0.6265,
    hi: 0.6542,
    n: 3,
    books: ['Book A', 'Book B', 'Book C'],
    captured_at: '2026-10-20T16:12:00Z',
    ...changes,
  };
}

function game(changes: Partial<BoardGame> = {}): BoardGame {
  return {
    id: 'game-1',
    commence_time: '2026-10-20T23:00:00Z',
    home: 'BOS',
    away: 'NYK',
    line: line(),
    open: { p_home: 0.6143, at: '2026-10-19T13:10:22Z' },
    ...changes,
  };
}

/** A game on which every sportsbook gives the home team this chance. */
const priced = (p_home: number) => game({ line: line({ p_home, lo: p_home, hi: p_home, books: [] }) });

describe('gameCardView', () => {
  it('names both teams in full and gives the start time', () => {
    const card = gameCardView(game());

    expect(card.id).toBe('game-1');
    expect(card.home.name).toBe('Boston Celtics');
    expect(card.away.name).toBe('New York Knicks');
    expect(card.startsAt).toEqual(new Date('2026-10-20T23:00:00Z'));
  });

  it('favors the home team when its chance is above an even one', () => {
    const card = gameCardView(game());

    expect(card.outlook).toEqual({ kind: 'favorite', side: 'home', team: 'Boston Celtics', chance: 64 });
    expect(card.home.chance).toBe(64);
    expect(card.away.chance).toBe(36);
  });

  it('favors the away team with the rest of the home chance', () => {
    const card = gameCardView(game({ line: line({ p_home: 0.3571, lo: 0.3458, hi: 0.3735 }) }));

    expect(card.outlook).toEqual({ kind: 'favorite', side: 'away', team: 'New York Knicks', chance: 64 });
    expect(card.home.chance).toBe(36);
    expect(card.away.chance).toBe(64);
  });

  it.each([0.48, 0.4999, 0.5, 0.5113, 0.52])('names no favorite at %f, within 2 points of even', (p_home) => {
    expect(gameCardView(priced(p_home)).outlook).toEqual({ kind: 'toss-up' });
  });

  it.each([
    [0.5201, 'home', 52],
    [0.4799, 'away', 52],
  ] as const)('names a favorite at %f, just outside 2 points of even', (p_home, side, chance) => {
    expect(gameCardView(priced(p_home)).outlook).toMatchObject({ kind: 'favorite', side, chance });
  });

  it('still gives both chances of a toss-up', () => {
    const card = gameCardView(priced(0.5113));

    expect(card.home.chance).toBe(51);
    expect(card.away.chance).toBe(49);
  });

  it('gives no chance and no favorite for a game without a line', () => {
    const card = gameCardView(game({ line: null, open: null }));

    expect(card.outlook).toEqual({ kind: 'no-line' });
    expect(card.home).toEqual({ name: 'Boston Celtics', chance: null, range: null });
    expect(card.away).toEqual({ name: 'New York Knicks', chance: null, range: null });
    expect(card.sportsbooks).toBe(0);
  });

  it.each([
    [0.9999, 99, 1],
    [0.996, 99, 1],
    [0.0001, 1, 99],
  ])('never shows 0%% or 100%%: %f is %i%% and %i%%', (p_home, home, away) => {
    const card = gameCardView(priced(p_home));

    expect(card.home.chance).toBe(home);
    expect(card.away.chance).toBe(away);
  });

  it('makes the two chances add up to 100 when the line is on a half point', () => {
    const card = gameCardView(priced(0.575));

    expect(card.home.chance).toBe(58);
    expect(card.away.chance).toBe(42);
  });

  it('counts the sportsbooks and gives each team its range between them', () => {
    const card = gameCardView(game());

    expect(card.sportsbooks).toBe(3);
    expect(card.home.range).toEqual({ low: 63, high: 65 });
    expect(card.away.range).toEqual({ low: 35, high: 37 });
  });

  it('gives no range for a single sportsbook', () => {
    const card = gameCardView(game({ line: line({ n: 1, lo: 0.6429, hi: 0.6429, books: [] }) }));

    expect(card.sportsbooks).toBe(1);
    expect(card.home.range).toBeNull();
    expect(card.away.range).toBeNull();
  });

  it('gives no range when the sportsbooks agree to the whole percent', () => {
    const card = gameCardView(game({ line: line({ lo: 0.6391, hi: 0.6448, n: 4, books: ['A', 'B', 'C', 'D'] }) }));

    expect(card.sportsbooks).toBe(4);
    expect(card.home.range).toBeNull();
  });

  it('shows the code of a team it does not know', () => {
    expect(gameCardView(game({ home: 'SEA' })).home.name).toBe('SEA');
  });
});

describe('upcomingCards', () => {
  const NOW = Date.parse('2026-10-20T23:30:00Z');
  const at = (id: string, commence_time: string) => game({ id, commence_time });

  it('orders the games by start time, soonest first', () => {
    const games = [
      at('next-week', '2026-10-27T23:00:00Z'),
      at('tonight', '2026-10-21T02:00:00Z'),
      at('tomorrow', '2026-10-21T23:00:00Z'),
    ];

    expect(upcomingCards(games, NOW).map((card) => card.id)).toEqual(['tonight', 'tomorrow', 'next-week']);
  });

  it('does not order by how sure the sportsbooks are', () => {
    const games = [
      { ...priced(0.9), id: 'sure-but-later', commence_time: '2026-10-22T23:00:00Z' },
      { ...priced(0.51), id: 'even-but-sooner', commence_time: '2026-10-21T23:00:00Z' },
    ];

    expect(upcomingCards(games, NOW).map((card) => card.id)).toEqual(['even-but-sooner', 'sure-but-later']);
  });

  it('keeps games that start at the same time in the order of the board', () => {
    const games = [at('b', '2026-10-21T23:00:00Z'), at('a', '2026-10-21T23:00:00Z')];

    expect(upcomingCards(games, NOW).map((card) => card.id)).toEqual(['b', 'a']);
  });

  it('leaves out a game that has started', () => {
    const games = [
      at('started-half-an-hour-ago', '2026-10-20T23:00:00Z'),
      at('starting-now', '2026-10-20T23:30:00Z'),
      at('in-a-minute', '2026-10-20T23:31:00Z'),
    ];

    expect(upcomingCards(games, NOW).map((card) => card.id)).toEqual(['in-a-minute']);
  });

  it('is empty for a board without games', () => {
    expect(upcomingCards([], NOW)).toEqual([]);
  });
});

describe('outlookLabel', () => {
  it('gives the favorite its chance and calls it implied', () => {
    expect(outlookLabel(gameCardView(game()).outlook)).toBe('64% implied');
  });

  it('says toss-up and names no team', () => {
    expect(outlookLabel(gameCardView(priced(0.5113)).outlook)).toBe('Toss-up');
  });

  it('says that there is no line yet', () => {
    expect(outlookLabel(gameCardView(game({ line: null })).outlook)).toBe('No line yet');
  });
});

describe('sportsbooksNote', () => {
  it('says how many sportsbooks the chances are the median of', () => {
    expect(sportsbooksNote(gameCardView(game()))).toBe('Median of 3 sportsbooks');
  });

  it('says so when there is one sportsbook', () => {
    const single = game({ line: line({ n: 1, lo: 0.6429, hi: 0.6429, books: [] }) });

    expect(sportsbooksNote(gameCardView(single))).toBe('1 sportsbook');
  });

  it('says so when the sportsbooks agree to the whole percent', () => {
    expect(sportsbooksNote(gameCardView(priced(0.6429)))).toBe('3 sportsbooks within a point of each other');
  });

  it('says nothing for a game without a line', () => {
    expect(sportsbooksNote(gameCardView(game({ line: null })))).toBeNull();
  });
});
