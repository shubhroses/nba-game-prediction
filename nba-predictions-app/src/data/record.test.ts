import { describe, expect, it } from 'vitest';
import { copyOf, examplesOf, type Json } from './pipelineExamples';
import { parseRecord } from './record';

/**
 * The examples in pipeline/README.md: the record after one game, an entry of
 * a list of upsets and an entry of a list of differing picks. The record
 * there leaves `points_rest` out, which has the fields of `elo`. The numbers
 * are invented.
 */
const [EXAMPLE, UPSET, DIFFERENT_PICK] = examplesOf('record.json') as Json[];

/** The example with the part it leaves out, as the job writes the record of a sport that is forecast. */
const FULL = { ...EXAMPLE, points_rest: EXAMPLE.elo };

/** The problem parseRecord reports for the full record after one change to it. */
function problemAfter(change: (record: Json, market: Json, elo: Json) => void): string {
  const record = copyOf(FULL);
  change(record, record.market as Json, record.elo as Json);

  const parsed = parseRecord(record);
  return parsed.ok ? 'no problem' : parsed.problem;
}

const NO_BANDS = ['52-59', '60-69', '70-79', '80-89', '90+'].map((band) => ({ band, games: 0, mean_p_favorite: null, wins: 0 }));

const NOTHING_YET = {
  accuracy: null,
  accuracy_interval: null,
  bands: NO_BANDS,
  biggest_upsets: [],
  brier: null,
  games: 0,
  log_loss: null,
  losses: 0,
  not_graded: 0,
  toss_ups: 0,
  wins: 0,
  with_line: 0,
};

const NOTHING_YET_OF_A_MODEL = {
  ...NOTHING_YET,
  brier_against_market: { difference: null, games: 0, interval: null },
  late: 0,
  picks_against_market: { differ: 0, latest: [], market_right: 0, model_right: 0 },
};

/** The shape of the record as it was on the data branch on 10 October 2026, before the first game. */
const PRESEASON = {
  baseline_home: { games: 0, wins: 0 },
  by_day: [],
  elo: NOTHING_YET_OF_A_MODEL,
  games: 0,
  market: NOTHING_YET,
  points_rest: NOTHING_YET_OF_A_MODEL,
  schema: 1,
  since: null,
  sport: 'basketball_nba',
};

/** The shape of the record of a sport that is not forecast: games that no sportsbook had a line for. */
const NOT_FORECAST = {
  baseline_home: { games: 4, wins: 2 },
  by_day: [{ day: '2026-10-07', games: 4, market: { losses: 0, not_graded: 4, toss_ups: 0, wins: 0 } }],
  games: 4,
  market: { ...NOTHING_YET, not_graded: 4 },
  schema: 1,
  since: '2026-10-07',
  sport: 'basketball_nba_preseason',
};

describe('parseRecord', () => {
  it('accepts the example of the pipeline documentation, which leaves one model out', () => {
    expect(parseRecord(EXAMPLE)).toEqual({ ok: true, value: { ...EXAMPLE, points_rest: null } });
  });

  it('accepts the record of both models as it is', () => {
    expect(parseRecord(FULL)).toEqual({ ok: true, value: FULL });
  });

  it('accepts the documented entries of the two lists as they are', () => {
    const record = copyOf(FULL);
    (record.market as Json).biggest_upsets = [UPSET];
    ((record.elo as Json).picks_against_market as Json).latest = [DIFFERENT_PICK];

    expect(parseRecord(record)).toEqual({ ok: true, value: record });
  });

  it('accepts the record as it is before the first game of the season', () => {
    expect(parseRecord(PRESEASON)).toEqual({ ok: true, value: PRESEASON });
  });

  it('reads the fields that a sport without forecasts does not have as null', () => {
    expect(parseRecord(NOT_FORECAST)).toEqual({
      ok: true,
      value: {
        ...NOT_FORECAST,
        elo: null,
        points_rest: null,
        by_day: [{ ...NOT_FORECAST.by_day[0], elo: null, points_rest: null }],
      },
    });
  });

  it('accepts an interval of a difference in Brier score, which can lie on both sides of zero', () => {
    const record = copyOf(FULL);
    (record.elo as Json).brier_against_market = { difference: 0.0042, games: 31, interval: [-0.0105, 0.0191] };

    expect(parseRecord(record)).toMatchObject({
      ok: true,
      value: { elo: { brier_against_market: { interval: [-0.0105, 0.0191] } } },
    });
  });

  it('leaves out fields it does not know', () => {
    const extended = copyOf(FULL);
    extended.built_at = '2026-10-21T09:10:07Z';
    (extended.market as Json).streak = 1;
    ((extended.market as Json).bands as Json[])[0].share = null;
    ((extended.by_day as Json[])[0].market as Json).late = 0;
    (extended.baseline_home as Json).losses = 0;

    expect(parseRecord(extended)).toEqual({ ok: true, value: FULL });
  });

  it.each([null, undefined, [], 'record', 1])('refuses %j in place of the record', (value) => {
    expect(parseRecord(value)).toEqual({ ok: false, problem: 'the record should be an object' });
  });

  it('refuses another schema', () => {
    expect(problemAfter((record) => (record.schema = 2))).toBe('schema should be 1');
  });

  it('refuses a first day that is not a date', () => {
    expect(problemAfter((record) => (record.since = '2026-10-20T23:10:38Z'))).toBe(
      'since should be a date like 2026-10-20 or null',
    );
    expect(problemAfter((record) => delete record.since)).toBe('since should be a date like 2026-10-20 or null');
  });

  it.each(['games', 'wins', 'losses', 'toss_ups', 'not_graded', 'with_line'])('refuses %s that is not a count', (field) => {
    const problem = 'should be a whole number that is not negative';
    expect(problemAfter((_record, market) => (market[field] = 0.5))).toBe(`market.${field} ${problem}`);
    expect(problemAfter((_record, market) => (market[field] = -1))).toBe(`market.${field} ${problem}`);
    expect(problemAfter((_record, _market, elo) => delete elo[field])).toBe(`elo.${field} ${problem}`);
  });

  it('refuses a share of wins outside 0 to 1, and takes both ends', () => {
    expect(problemAfter((_record, market) => (market.accuracy = 1.2))).toBe('market.accuracy should be a number from 0 to 1 or null');
    expect(problemAfter((_record, market) => (market.accuracy = '100%'))).toBe(
      'market.accuracy should be a number from 0 to 1 or null',
    );
    expect(problemAfter((_record, market) => (market.accuracy = 0))).toBe('no problem');
    expect(problemAfter((_record, market) => (market.accuracy = 1))).toBe('no problem');
  });

  it('refuses an interval that is not a lower and an upper bound', () => {
    const problem = 'market.accuracy_interval should be a lower bound and an upper bound that is not below it or null';
    expect(problemAfter((_record, market) => (market.accuracy_interval = [0.9, 0.2]))).toBe(problem);
    expect(problemAfter((_record, market) => (market.accuracy_interval = [0.2]))).toBe(problem);
    expect(problemAfter((_record, market) => delete market.accuracy_interval)).toBe(problem);
    expect(problemAfter((_record, market) => (market.accuracy_interval = [0.2, 1.4]))).toBe(
      'market.accuracy_interval[1] should be a number from 0 to 1',
    );
    expect(problemAfter((_record, _market, elo) => ((elo.brier_against_market as Json).interval = [0.01, 'wide']))).toBe(
      'elo.brier_against_market.interval[1] should be a number',
    );
  });

  it('refuses a score that is negative or not a number', () => {
    expect(problemAfter((_record, market) => (market.brier = -0.1))).toBe('market.brier should be a number that is not negative or null');
    expect(problemAfter((_record, _market, elo) => (elo.log_loss = '0.35'))).toBe(
      'elo.log_loss should be a number that is not negative or null',
    );
  });

  it('refuses bands and upsets that are not as documented', () => {
    expect(problemAfter((_record, market) => (market.bands = null))).toBe('market.bands should be a list');
    expect(problemAfter((_record, market) => ((market.bands as Json[])[1].band = 60))).toBe(
      'market.bands[1].band should be a string that is not empty',
    );
    expect(problemAfter((_record, market) => ((market.bands as Json[])[1].mean_p_favorite = 64))).toBe(
      'market.bands[1].mean_p_favorite should be a number from 0 to 1 or null',
    );
    expect(problemAfter((_record, market) => (market.biggest_upsets = [{ ...UPSET, favorite: 'BOS' }]))).toBe(
      'market.biggest_upsets[0].favorite should be one of the two teams of the game',
    );
    expect(problemAfter((_record, market) => (market.biggest_upsets = [{ ...UPSET, p_favorite: 1 }]))).toBe(
      'market.biggest_upsets[0].p_favorite should be a number between 0 and 1',
    );
  });

  it('refuses a model without what sets it next to the sportsbooks', () => {
    expect(problemAfter((_record, _market, elo) => delete elo.late)).toBe('elo.late should be a whole number that is not negative');
    expect(problemAfter((_record, _market, elo) => delete elo.picks_against_market)).toBe(
      'elo.picks_against_market should be an object',
    );
    expect(problemAfter((_record, _market, elo) => ((elo.picks_against_market as Json).model_right = null))).toBe(
      'elo.picks_against_market.model_right should be a whole number that is not negative',
    );
    expect(problemAfter((_record, _market, elo) => ((elo.brier_against_market as Json).difference = 'better'))).toBe(
      'elo.brier_against_market.difference should be a number or null',
    );
    expect(problemAfter((record) => (record.points_rest = null))).toBe('points_rest should be an object');
  });

  it('refuses a differing pick that names a team outside the game or no winner of the two', () => {
    const withPick = (pick: Json) => (_record: Json, _market: Json, elo: Json) =>
      ((elo.picks_against_market as Json).latest = [pick]);

    expect(problemAfter(withPick({ ...DIFFERENT_PICK, pick: 'BOS' }))).toBe(
      'elo.picks_against_market.latest[0].pick should be one of the two teams of the game',
    );
    expect(problemAfter(withPick({ ...DIFFERENT_PICK, market_pick: undefined }))).toBe(
      'elo.picks_against_market.latest[0].market_pick should be one of the two teams of the game',
    );
    expect(problemAfter(withPick({ ...DIFFERENT_PICK, right: 'both' }))).toBe(
      'elo.picks_against_market.latest[0].right should be one of model, market',
    );
  });

  it('refuses a baseline and days that are not as documented', () => {
    expect(problemAfter((record) => delete record.baseline_home)).toBe('baseline_home should be an object');
    expect(problemAfter((record) => ((record.baseline_home as Json).wins = '1'))).toBe(
      'baseline_home.wins should be a whole number that is not negative',
    );
    expect(problemAfter((record) => (record.by_day = {}))).toBe('by_day should be a list');
    expect(problemAfter((record) => ((record.by_day as Json[])[0].day = 'Tuesday'))).toBe(
      'by_day[0].day should be a date like 2026-10-20',
    );
    expect(problemAfter((record) => delete ((record.by_day as Json[])[0].elo as Json).toss_ups)).toBe(
      'by_day[0].elo.toss_ups should be a whole number that is not negative',
    );
    expect(problemAfter((record) => delete (record.by_day as Json[])[0].market)).toBe('by_day[0].market should be an object');
  });
});
