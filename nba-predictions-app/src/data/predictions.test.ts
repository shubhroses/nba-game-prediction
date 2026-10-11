import { describe, expect, it } from 'vitest';
import { copyOf, examplesOf, type Json } from './pipelineExamples';
import { parsePredictions, parsePredictionsOf, predictionsPath } from './predictions';

/**
 * The example in pipeline/README.md: the forecasts of both models for a game
 * in Denver and one in Los Angeles. The numbers are invented.
 */
const [EXAMPLE] = examplesOf('predictions/YYYY-MM-DD.json') as [Json];

/** The problem parsePredictions reports for the example after one change to it. */
function problemAfter(change: (file: Json, game: Json) => void): string {
  const file = copyOf(EXAMPLE);
  change(file, (file.games as Json[])[0]);

  const parsed = parsePredictions(file);
  return parsed.ok ? 'no problem' : parsed.problem;
}

describe('parsePredictions', () => {
  it('accepts the example of the pipeline documentation as it is', () => {
    expect(parsePredictions(EXAMPLE)).toEqual({ ok: true, value: EXAMPLE });
  });

  it('accepts the file of opening day, which rests on no result', () => {
    expect(parsePredictions({ ...EXAMPLE, results_through: null })).toMatchObject({ ok: true, value: { results_through: null } });
  });

  it('accepts a day on which the points-and-rest model was left out, a game without a line and one on a neutral floor', () => {
    const degraded = copyOf(EXAMPLE);
    Object.assign(degraded, { status: 'degraded', reasons: ['BOS has 2 results on 2026-10-20'], code_commit: null });
    const [first, second] = degraded.games as Json[];
    Object.assign(first, { points_rest: null, market: null });
    Object.assign(second, { points_rest: null, neutral: true });
    Object.assign(second.elo as Json, { home_court: 0, p_home: 0.6623 });

    expect(parsePredictions(degraded)).toEqual({ ok: true, value: degraded });
  });

  it('leaves out fields it does not know', () => {
    const extended = copyOf(EXAMPLE);
    extended.built_by = 'the daily run';
    const [first] = extended.games as Json[];
    first.venue = 'Denver';
    (first.elo as Json).k = 20;
    (first.points_rest as Json).sd = 12.6;
    (first.market as Json).books = ['Book A'];

    expect(parsePredictions(extended)).toEqual({ ok: true, value: EXAMPLE });
  });

  it.each([null, undefined, [], 'predictions', 1])('refuses %j in place of the file', (value) => {
    expect(parsePredictions(value)).toEqual({ ok: false, problem: 'the predictions should be an object' });
  });

  it('refuses another schema', () => {
    expect(problemAfter((file) => (file.schema = '1'))).toBe('schema should be 1');
  });

  it('refuses what says how the file was made when it is not as documented', () => {
    expect(problemAfter((file) => (file.day = '2026-10-21T09:10:07Z'))).toBe('day should be a date like 2026-10-20');
    expect(problemAfter((file) => (file.day = null))).toBe('day should be a date like 2026-10-20');
    expect(problemAfter((file) => (file.published_at = '2026-10-21'))).toBe(
      'published_at should be a time like 2026-10-20T22:10:41Z',
    );
    expect(problemAfter((file) => (file.results_through = 20))).toBe('results_through should be a date like 2026-10-20 or null');
    expect(problemAfter((file) => (file.status = null))).toBe('status should be one of ok, degraded');
    expect(problemAfter((file) => delete file.reasons)).toBe('reasons should be a list of sentences');
    expect(problemAfter((file) => (file.parameters = []))).toBe('parameters should be an object');
    expect(problemAfter((file) => (file.games = null))).toBe('games should be a list');
  });

  it('refuses a game that is not as documented, and names it', () => {
    expect(problemAfter((_file, game) => (game.id = 7))).toBe('games[0].id should be a string that is not empty');
    expect(problemAfter((_file, game) => (game.home = 'Denver'))).toBe('games[0].home should be three capital letters');
    expect(problemAfter((_file, game) => (game.commence_time = '01:00'))).toBe(
      'games[0].commence_time should be a time like 2026-10-20T22:10:41Z',
    );
    expect(problemAfter((_file, game) => (game.neutral = 'no'))).toBe('games[0].neutral should be true or false');
    expect(problemAfter((file) => ((file.games as Json[])[1].away = 'gsw'))).toBe('games[1].away should be three capital letters');
  });

  it('wants the chance of Elo with the three numbers it comes from', () => {
    expect(problemAfter((_file, game) => (game.elo = null))).toBe('games[0].elo should be an object');
    expect(problemAfter((_file, game) => ((game.elo as Json).p_home = 80.2))).toBe(
      'games[0].elo.p_home should be a number between 0 and 1',
    );
    expect(problemAfter((_file, game) => ((game.elo as Json).home_rating = 1597.3))).toBe(
      'games[0].elo.home_rating should be a whole number',
    );
    expect(problemAfter((_file, game) => delete (game.elo as Json).away_rating)).toBe(
      'games[0].elo.away_rating should be a whole number',
    );
    expect(problemAfter((_file, game) => ((game.elo as Json).home_court = '40'))).toBe('games[0].elo.home_court should be a number');
  });

  it('wants null, not a missing field, for a model that was left out and for a game without a line', () => {
    expect(problemAfter((_file, game) => delete game.points_rest)).toBe('games[0].points_rest should be an object or null');
    expect(problemAfter((_file, game) => delete game.market)).toBe('games[0].market should be an object or null');
  });

  it('holds the forecast of the points-and-rest model and the line of the morning to their rules', () => {
    expect(problemAfter((_file, game) => delete (game.points_rest as Json).rest_edge)).toBe(
      'games[0].points_rest.rest_edge should be a number',
    );
    expect(problemAfter((_file, game) => ((game.market as Json).hi = 0.5))).toBe(
      'games[0].market should be in the order lo, p_home, hi',
    );
    expect(problemAfter((_file, game) => ((game.market as Json).at = 'last night'))).toBe(
      'games[0].market.at should be a time like 2026-10-20T22:10:41Z',
    );
  });
});

describe('predictionsPath', () => {
  it('is the file of the day under the prefix', () => {
    expect(predictionsPath('2026-10-21')).toBe('predictions/2026-10-21.json');
  });
});

describe('parsePredictionsOf', () => {
  it('accepts the file of the day that was asked for', () => {
    expect(parsePredictionsOf('2026-10-21')(EXAMPLE)).toEqual({ ok: true, value: EXAMPLE });
  });

  it('refuses the file of another day', () => {
    expect(parsePredictionsOf('2026-10-22')(EXAMPLE)).toEqual({ ok: false, problem: 'day should be 2026-10-22' });
  });

  it('refuses whatever parsePredictions refuses', () => {
    expect(parsePredictionsOf('2026-10-21')({ ...EXAMPLE, schema: 2 })).toEqual({ ok: false, problem: 'schema should be 1' });
  });
});
