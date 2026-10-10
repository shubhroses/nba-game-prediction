import { describe, expect, it } from 'vitest';
import { parseBoard } from './board';

/** The example in pipeline/README.md: one game with a line and one without. The prices behind it are invented. */
const EXAMPLE = {
  games: [
    {
      away: 'NYK',
      commence_time: '2026-10-20T23:00:00Z',
      home: 'BOS',
      id: '5f0c2a9e7b1d4c3e8a6f0b2d4c6e8a10',
      line: {
        books: ['Book A', 'Book B', 'Book C'],
        captured_at: '2026-10-20T22:10:41Z',
        hi: 0.6542,
        lo: 0.6265,
        n: 3,
        p_home: 0.6429,
      },
      open: { at: '2026-10-19T13:10:22Z', p_home: 0.6143 },
    },
    {
      away: 'CHI',
      commence_time: '2026-10-22T23:30:00Z',
      home: 'MIA',
      id: '9a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d',
      line: null,
      open: null,
    },
  ],
  generated_at: '2026-10-20T22:10:41Z',
  next_due: '2026-10-20T21:10-04:00',
  schema: 1,
  slot: '2026-10-20T18:10-04:00',
  sport: 'basketball_nba',
};

type Json = Record<string, unknown>;

/** The problem parseBoard reports for the example after one change to it. */
function problemAfter(change: (board: Json, game: Json, line: Json, open: Json) => void): string {
  const board = structuredClone(EXAMPLE) as Json;
  const game = (board.games as Json[])[0];
  change(board, game, game.line as Json, game.open as Json);

  const parsed = parseBoard(board);
  return parsed.ok ? 'no problem' : parsed.problem;
}

describe('parseBoard', () => {
  it('accepts the example of the pipeline documentation as it is', () => {
    expect(parseBoard(EXAMPLE)).toEqual({ ok: true, board: EXAMPLE });
  });

  it('accepts a board without games', () => {
    expect(parseBoard({ ...EXAMPLE, games: [] })).toMatchObject({ ok: true, board: { games: [] } });
  });

  it('leaves out fields it does not know', () => {
    const extended = structuredClone(EXAMPLE) as Json;
    extended.results = [{ id: 'x', home_points: 101 }];
    const [first] = extended.games as Json[];
    first.forecasts = { elo: { p_home: 0.58 } };
    (first.line as Json).spread = 0.0277;

    expect(parseBoard(extended)).toEqual({ ok: true, board: EXAMPLE });
  });

  it.each([null, undefined, [], 'slate', 1])('refuses %j in place of the board', (value) => {
    expect(parseBoard(value)).toEqual({ ok: false, problem: 'the board should be an object' });
  });

  it('refuses another schema', () => {
    expect(problemAfter((board) => (board.schema = 2))).toBe('schema should be 1');
    expect(problemAfter((board) => delete board.schema)).toBe('schema should be 1');
  });

  it('refuses a board whose games are not a list', () => {
    expect(problemAfter((board) => delete board.games)).toBe('games should be a list');
    expect(problemAfter((board) => (board.games = {}))).toBe('games should be a list');
    expect(problemAfter((board) => (board.games = [null]))).toBe('games[0] should be an object');
  });

  it('refuses a time that is not in the UTC format of the files', () => {
    const problem = 'generated_at should be a time like 2026-10-20T22:10:41Z';
    expect(problemAfter((board) => (board.generated_at = '2026-10-20 22:10:41'))).toBe(problem);
    expect(problemAfter((board) => (board.generated_at = '2026-10-20T22:10:41+00:00'))).toBe(problem);
    expect(problemAfter((board) => (board.generated_at = '2026-13-45T22:10:41Z'))).toBe(problem);
    expect(problemAfter((board) => (board.generated_at = 1792534241))).toBe(problem);
    expect(problemAfter((_, game) => (game.commence_time = 'tonight'))).toBe(
      'games[0].commence_time should be a time like 2026-10-20T22:10:41Z',
    );
  });

  it('refuses a slot that is not a New York time with its offset', () => {
    expect(problemAfter((board) => (board.next_due = '2026-10-21T01:10:00Z'))).toBe(
      'next_due should be a time like 2026-10-20T18:10-04:00',
    );
    expect(problemAfter((board) => delete board.slot)).toBe('slot should be a time like 2026-10-20T18:10-04:00');
  });

  it('refuses a team that is not a three-letter code', () => {
    expect(problemAfter((_, game) => (game.home = 'Boston Celtics'))).toBe('games[0].home should be three capital letters');
    expect(problemAfter((_, game) => (game.away = 'nyk'))).toBe('games[0].away should be three capital letters');
  });

  it('refuses a game without an id', () => {
    expect(problemAfter((_, game) => (game.id = ''))).toBe('games[0].id should be a string that is not empty');
  });

  it.each([0, 1, 1.2, -0.3, '0.64', null, Number.NaN])('refuses %j as a probability', (value) => {
    const problem = 'should be a number between 0 and 1';
    expect(problemAfter((_board, _game, line) => (line.p_home = value))).toBe(`games[0].line.p_home ${problem}`);
    expect(problemAfter((_board, _game, _line, open) => (open.p_home = value))).toBe(`games[0].open.p_home ${problem}`);
  });

  it('refuses a median outside the range of the sportsbooks', () => {
    const problem = 'games[0].line should be in the order lo, p_home, hi';
    expect(problemAfter((_board, _game, line) => (line.lo = 0.65))).toBe(problem);
    expect(problemAfter((_board, _game, line) => (line.hi = 0.64))).toBe(problem);
  });

  it.each([0, 2.5, '3', undefined])('refuses %j as a number of sportsbooks', (value) => {
    expect(problemAfter((_board, _game, line) => (line.n = value))).toBe(
      'games[0].line.n should be a whole number of at least 1',
    );
  });

  it('refuses sportsbooks that are not a list of names', () => {
    const problem = 'games[0].line.books should be a list of names';
    expect(problemAfter((_board, _game, line) => (line.books = 'Book A'))).toBe(problem);
    expect(problemAfter((_board, _game, line) => (line.books = ['Book A', 2]))).toBe(problem);
  });

  it('wants null, not a missing field, for a game without a line', () => {
    expect(problemAfter((_, game) => delete game.line)).toBe('games[0].line should be an object or null');
    expect(problemAfter((_, game) => delete game.open)).toBe('games[0].open should be an object or null');
    expect(problemAfter((_, game) => (game.line = 0))).toBe('games[0].line should be an object or null');
  });

  it('names the game that is wrong', () => {
    const board = structuredClone(EXAMPLE) as Json;
    (board.games as Json[])[1].away = 7;

    expect(parseBoard(board)).toEqual({ ok: false, problem: 'games[1].away should be three capital letters' });
  });
});
