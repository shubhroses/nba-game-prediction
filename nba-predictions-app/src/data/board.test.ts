import { describe, expect, it } from 'vitest';
import { parseBoard } from './board';
import { copyOf, examplesOf, type Json } from './pipelineExamples';

/**
 * The example in pipeline/README.md: a game of the day with a line and both
 * forecasts, a game of the next day that has Elo's chance only, the record
 * and one recent result. The numbers are invented.
 */
const [EXAMPLE] = examplesOf('slate.json') as [Json];

/** The problem parseBoard reports for the example after one change to it. */
function problemAfter(change: (board: Json, game: Json, line: Json, open: Json) => void): string {
  const board = copyOf(EXAMPLE);
  const game = (board.games as Json[])[0];
  change(board, game, game.line as Json, game.open as Json);

  const parsed = parseBoard(board);
  return parsed.ok ? 'no problem' : parsed.problem;
}

/**
 * A game as the board lists it before the season: a line, Elo's chance and
 * no forecast of the other model yet. The game and its numbers are invented.
 */
const PRESEASON_GAME = {
  away: 'ATL',
  commence_time: '2026-10-22T00:00:00Z',
  elo: { p_home: 0.6104 },
  home: 'CHI',
  id: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
  line: {
    books: ['Book A', 'Book B'],
    captured_at: '2026-10-12T22:11:07Z',
    hi: 0.5816,
    lo: 0.5644,
    n: 2,
    p_home: 0.573,
  },
  open: { at: '2026-10-11T16:10:52Z', p_home: 0.5694 },
  points_rest: null,
};

/**
 * The board as it is shaped before the first game of the season: the models
 * are built and have replayed no result, no forecast is frozen, and the
 * record stands at nothing. The data branch held a board of this shape on
 * 10 October 2026. Only the shape is from there: the times are invented,
 * like the game.
 */
const PRESEASON = {
  games: [PRESEASON_GAME],
  generated_at: '2026-10-12T22:11:07Z',
  models: { predictions_day: null, results_through: null, status: 'ok' },
  next_due: '2026-10-12T21:10-04:00',
  recent_results: [],
  record: { elo: { losses: 0, wins: 0 }, market: { losses: 0, wins: 0 }, points_rest: { losses: 0, wins: 0 } },
  schema: 1,
  slot: '2026-10-12T18:10-04:00',
  sport: 'basketball_nba',
};

/**
 * The shape of the board of a sport that is not forecast, as the preseason
 * rehearsal publishes it: nothing of the models anywhere. The two games,
 * the score and every number are invented.
 */
const NOT_FORECAST = {
  games: [
    {
      away: 'UTA',
      commence_time: '2026-10-13T01:00:00Z',
      home: 'DEN',
      id: '1b2c3d4e5f60718293a4b5c6d7e8f90a',
      line: { books: [], captured_at: '2026-10-12T22:11:07Z', hi: 0.6417, lo: 0.6417, n: 5, p_home: 0.6417 },
      open: { at: '2026-10-11T16:10:52Z', p_home: 0.6203 },
    },
  ],
  generated_at: '2026-10-12T22:11:07Z',
  next_due: '2026-10-12T21:10-04:00',
  recent_results: [
    {
      away: 'CHA',
      away_pts: 107,
      commence_time: '2026-10-11T23:40:17Z',
      home: 'ATL',
      home_pts: 112,
      id: '2c3d4e5f60718293a4b5c6d7e8f90a1b',
      market: null,
      market_verdict: 'not_graded',
      recorded_at: '2026-10-12T09:11:26Z',
    },
  ],
  record: { market: { losses: 0, wins: 0 } },
  schema: 1,
  slot: '2026-10-12T18:10-04:00',
  sport: 'basketball_nba_preseason',
};

describe('parseBoard', () => {
  it('accepts the example of the pipeline documentation as it is', () => {
    expect(parseBoard(EXAMPLE)).toEqual({ ok: true, value: EXAMPLE });
  });

  it('accepts the board as it is before the first game of the season', () => {
    expect(parseBoard(PRESEASON)).toEqual({ ok: true, value: PRESEASON });
  });

  it('accepts a board whose daily work has never been recorded', () => {
    const first = { ...PRESEASON, models: null, record: null, games: [{ ...PRESEASON_GAME, elo: null }] };

    expect(parseBoard(first)).toEqual({ ok: true, value: first });
  });

  it('accepts a board without games', () => {
    expect(parseBoard({ ...EXAMPLE, games: [] })).toMatchObject({ ok: true, value: { games: [] } });
  });

  it('reads the fields that a sport without forecasts does not have as null', () => {
    const [game] = NOT_FORECAST.games;
    const [result] = NOT_FORECAST.recent_results;

    expect(parseBoard(NOT_FORECAST)).toEqual({
      ok: true,
      value: {
        ...NOT_FORECAST,
        games: [{ ...game, elo: null, points_rest: null }],
        models: null,
        record: { market: { losses: 0, wins: 0 }, elo: null, points_rest: null },
        recent_results: [
          { ...result, elo: null, elo_verdict: 'not_graded', points_rest: null, points_rest_verdict: 'not_graded' },
        ],
      },
    });
  });

  it('leaves out fields it does not know', () => {
    const extended = copyOf(EXAMPLE);
    extended.standings = [{ team: 'BOS', wins: 3 }];
    const [first] = extended.games as Json[];
    first.injuries = ['a starter'];
    (first.line as Json).spread = 0.0277;
    (first.elo as Json).home_rating = 1568;
    (first.points_rest as Json).sd = 12.4;
    (extended.models as Json).built_at = '2026-10-21T09:10:07Z';
    ((extended.record as Json).elo as Json).toss_ups = 2;
    (extended.recent_results as Json[])[0].attendance = 19_812;

    expect(parseBoard(extended)).toEqual({ ok: true, value: EXAMPLE });
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
    expect(problemAfter((_board, game) => ((game.elo as Json).p_home = value))).toBe(`games[0].elo.p_home ${problem}`);
    expect(problemAfter((_board, game) => ((game.points_rest as Json).p_home = value))).toBe(
      `games[0].points_rest.p_home ${problem}`,
    );
  });

  it('refuses a median outside the range of the sportsbooks', () => {
    const problem = 'games[0].line should be in the order lo, p_home, hi';
    expect(problemAfter((_board, _game, line) => (line.lo = 0.43))).toBe(problem);
    expect(problemAfter((_board, _game, line) => (line.hi = 0.42))).toBe(problem);
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
    const board = copyOf(EXAMPLE);
    (board.games as Json[])[1].away = 7;

    expect(parseBoard(board)).toEqual({ ok: false, problem: 'games[1].away should be three capital letters' });
  });

  it('refuses a forecast that is not an object', () => {
    expect(problemAfter((_, game) => (game.elo = 0.7117))).toBe('games[0].elo should be an object or null');
    expect(problemAfter((_, game) => (game.points_rest = 'later'))).toBe('games[0].points_rest should be an object or null');
  });

  it.each(['margin', 'rating_edge', 'home_court', 'rest_edge'])(
    'refuses a points-and-rest forecast whose %s is not a number of points',
    (field) => {
      const problem = `games[0].points_rest.${field} should be a number`;
      expect(problemAfter((_, game) => delete (game.points_rest as Json)[field])).toBe(problem);
      expect(problemAfter((_, game) => ((game.points_rest as Json)[field] = '1.16'))).toBe(problem);
      expect(problemAfter((_, game) => ((game.points_rest as Json)[field] = Number.POSITIVE_INFINITY))).toBe(problem);
    },
  );

  it('takes a margin below zero and a rest edge of nothing', () => {
    const board = copyOf(EXAMPLE);
    Object.assign((board.games as Json[])[0].points_rest as Json, { margin: -2.82, rating_edge: -3.98, rest_edge: 0 });

    expect(parseBoard(board)).toMatchObject({ ok: true });
  });

  it('refuses what the forecasts rest on when it is not as documented', () => {
    expect(problemAfter((board) => (board.models = 'ok'))).toBe('models should be an object or null');
    expect(problemAfter((board) => ((board.models as Json).status = 'stale'))).toBe('models.status should be one of ok, degraded');
    expect(problemAfter((board) => ((board.models as Json).predictions_day = '21 October'))).toBe(
      'models.predictions_day should be a date like 2026-10-20 or null',
    );
    expect(problemAfter((board) => delete (board.models as Json).results_through)).toBe(
      'models.results_through should be a date like 2026-10-20 or null',
    );
  });

  it('takes a day on which the points-and-rest model was left out', () => {
    const board = copyOf(EXAMPLE);
    (board.models as Json).status = 'degraded';
    (board.games as Json[])[0].points_rest = null;

    expect(parseBoard(board)).toMatchObject({ ok: true, value: { models: { status: 'degraded' } } });
  });

  it('wants null, not a missing field, for a record that does not exist yet', () => {
    expect(problemAfter((board) => delete board.record)).toBe('record should be an object or null');
    expect(problemAfter((board) => (board.record = []))).toBe('record should be an object or null');
  });

  it('refuses a record whose counts are not whole numbers', () => {
    const problem = 'should be a whole number that is not negative';
    expect(problemAfter((board) => (((board.record as Json).market as Json).wins = 1.5))).toBe(`record.market.wins ${problem}`);
    expect(problemAfter((board) => (((board.record as Json).elo as Json).losses = -1))).toBe(`record.elo.losses ${problem}`);
    expect(problemAfter((board) => delete ((board.record as Json).points_rest as Json).wins)).toBe(
      `record.points_rest.wins ${problem}`,
    );
    expect(problemAfter((board) => delete (board.record as Json).market)).toBe('record.market should be an object');
    expect(problemAfter((board) => ((board.record as Json).elo = null))).toBe('record.elo should be an object');
  });

  it('refuses recent results that are not a list of result lines', () => {
    expect(problemAfter((board) => delete board.recent_results)).toBe('recent_results should be a list');
    expect(problemAfter((board) => (board.recent_results = [7]))).toBe('recent_results[0] should be an object');
    expect(problemAfter((board) => ((board.recent_results as Json[])[0].market_verdict = 'won'))).toBe(
      'recent_results[0].market_verdict should be one of favorite_won, upset, toss_up, not_graded',
    );
    expect(problemAfter((board) => ((board.recent_results as Json[])[0].away_pts = 112))).toBe(
      'recent_results[0] should be a game with two scores that are not equal',
    );
  });
});
