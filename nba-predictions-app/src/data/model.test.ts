import { describe, expect, it } from 'vitest';
import { parseModel } from './model';
import { copyOf, examplesOf, type Json } from './pipelineExamples';

/**
 * The example in pipeline/README.md: the model file after four results, with
 * its three tables cut to three of the 30 teams. The numbers are invented.
 */
const [EXAMPLE] = examplesOf('model.json') as [Json];

/** The problem parseModel reports for the example after one change to it. */
function problemAfter(change: (model: Json, elo: Json, points: Json) => void): string {
  const model = copyOf(EXAMPLE);
  change(model, model.elo as Json, model.points_rest as Json);

  const parsed = parseModel(model);
  return parsed.ok ? 'no problem' : parsed.problem;
}

describe('parseModel', () => {
  it('accepts the example of the pipeline documentation as it is', () => {
    expect(parseModel(EXAMPLE)).toEqual({ ok: true, value: EXAMPLE });
  });

  it('accepts the model file as it is before the first result of the season', () => {
    // The shape of the file on the data branch on 10 October 2026: nothing replayed, and every team without a game.
    const opening = copyOf(EXAMPLE);
    Object.assign(opening, { games: 0, results_through: null });
    opening.teams = { ATL: { losses: 0, wins: 0 }, BKN: { losses: 0, wins: 0 }, BOS: { losses: 0, wins: 0 } };

    expect(parseModel(opening)).toEqual({ ok: true, value: opening });
  });

  it('accepts a day on which the points-and-rest model was left out', () => {
    const degraded = copyOf(EXAMPLE);
    Object.assign(degraded, {
      status: 'degraded',
      reasons: ['no result for GSW at LAL, which started at 2026-10-21T02:00:00Z (game 7c2e4a6b8d0f1a3c5e7a9b1d3f5a7c9e)'],
      points_rest: null,
    });

    expect(parseModel(degraded)).toEqual({ ok: true, value: degraded });
  });

  it('accepts a file of a run that was not told its commit', () => {
    expect(parseModel({ ...EXAMPLE, code_commit: null })).toMatchObject({ ok: true, value: { code_commit: null } });
  });

  it('leaves out fields it does not know', () => {
    const extended = copyOf(EXAMPLE);
    extended.spread = 0.963;
    ((extended.elo as Json).ratings as Record<string, Json>).BOS.month_ago = 1611;
    ((extended.elo as Json).constants as Json).scale = 400;
    ((extended.points_rest as Json).ratings as Record<string, Json>).BOS.games = 1;
    (extended.teams as Record<string, Json>).BOS.streak = -1;

    expect(parseModel(extended)).toEqual({ ok: true, value: EXAMPLE });
  });

  it.each([null, undefined, [], 'model', 1])('refuses %j in place of the file', (value) => {
    expect(parseModel(value)).toEqual({ ok: false, problem: 'the model file should be an object' });
  });

  it('refuses another schema', () => {
    expect(problemAfter((model) => (model.schema = 2))).toBe('schema should be 1');
  });

  it('refuses what says how the file was made when it is not as documented', () => {
    expect(problemAfter((model) => (model.built_at = '22 October'))).toBe('built_at should be a time like 2026-10-20T22:10:41Z');
    expect(problemAfter((model) => (model.results_through = '2026-10-21T00:00:00Z'))).toBe(
      'results_through should be a date like 2026-10-20 or null',
    );
    expect(problemAfter((model) => (model.games = 4.5))).toBe('games should be a whole number that is not negative');
    expect(problemAfter((model) => (model.status = 'fine'))).toBe('status should be one of ok, degraded');
    expect(problemAfter((model) => (model.reasons = 'none'))).toBe('reasons should be a list of sentences');
    expect(problemAfter((model) => (model.reasons = [404]))).toBe('reasons should be a list of sentences');
    expect(problemAfter((model) => delete model.season)).toBe('season should be a string that is not empty');
    expect(problemAfter((model) => delete (model.parameters as Json).points_rest)).toBe(
      'parameters.points_rest should be a string that is not empty',
    );
    expect(problemAfter((model) => (model.code_commit = 4))).toBe('code_commit should be a string that is not empty or null');
  });

  it('refuses an Elo rating that is not a whole number', () => {
    expect(problemAfter((_model, elo) => ((elo.ratings as Record<string, Json>).BOS.rating = 1602.4))).toBe(
      'elo.ratings.BOS.rating should be a whole number',
    );
    expect(problemAfter((_model, elo) => delete (elo.ratings as Record<string, Json>).ATL.week_ago)).toBe(
      'elo.ratings.ATL.week_ago should be a whole number',
    );
    expect(problemAfter((_model, elo) => (elo.ratings = [1531, 1324, 1602]))).toBe('elo.ratings should be an object');
    expect(problemAfter((_model, elo) => delete (elo.constants as Json).k)).toBe('elo.constants.k should be a number');
  });

  it('refuses a table that is keyed by anything but team codes', () => {
    expect(problemAfter((_model, elo) => ((elo.ratings as Json)['Boston Celtics'] = { rating: 1602, week_ago: 1607 }))).toBe(
      'elo.ratings should be a table keyed by three capital letters',
    );
  });

  it('refuses a points-and-rest rating without a number of points or with an uncertainty of nothing', () => {
    expect(problemAfter((_model, _elo, points) => ((points.ratings as Record<string, Json>).BKN.rating = '-7.31'))).toBe(
      'points_rest.ratings.BKN.rating should be a number',
    );
    expect(problemAfter((_model, _elo, points) => ((points.ratings as Record<string, Json>).BKN.uncertainty = 0))).toBe(
      'points_rest.ratings.BKN.uncertainty should be a number above 0',
    );
    expect(problemAfter((_model, _elo, points) => delete points.home_court)).toBe('points_rest.home_court should be a number');
    expect(problemAfter((model) => delete model.points_rest)).toBe('points_rest should be an object or null');
  });

  it('refuses tables that do not have the same teams, because they are read side by side', () => {
    expect(problemAfter((_model, _elo, points) => delete (points.ratings as Json).BOS)).toBe(
      'points_rest.ratings should be a table of the teams in elo.ratings',
    );
    expect(problemAfter((model) => ((model.teams as Json).NYK = { losses: 0, wins: 1 }))).toBe(
      'teams should be a table of the teams in elo.ratings',
    );
    expect(
      problemAfter((model) => {
        const teams = model.teams as Json;
        teams.NYK = teams.BOS;
        delete teams.BOS;
      }),
    ).toBe('teams should be a table of the teams in elo.ratings');
  });

  it('refuses wins and losses that are not counts', () => {
    expect(problemAfter((model) => ((model.teams as Record<string, Json>).BOS.losses = -1))).toBe(
      'teams.BOS.losses should be a whole number that is not negative',
    );
  });
});
