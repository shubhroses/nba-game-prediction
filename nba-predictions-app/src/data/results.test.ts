import { describe, expect, it } from 'vitest';
import { copyOf, examplesOf, type Json } from './pipelineExamples';
import { parseResultLine, VERDICTS } from './results';

/**
 * The three lines of the example in pipeline/README.md: one that every
 * source got right, one that every source got wrong, and one that the job
 * had neither a line nor a forecast for. The numbers are invented.
 */
const [LINES] = examplesOf('results/YYYY-MM.ndjson') as [Json[]];
const [RIGHT, UPSET, NOT_GRADED] = LINES;

/** The problem parseResultLine reports for the first line after one change to it. */
function problemAfter(change: (line: Json) => void): string {
  const line = copyOf(RIGHT);
  change(line);

  const parsed = parseResultLine(line);
  return parsed.ok ? 'no problem' : parsed.problem;
}

const NINE_FIELDS = ['id', 'commence_time', 'home', 'away', 'home_pts', 'away_pts', 'recorded_at', 'market', 'market_verdict'];

describe('parseResultLine', () => {
  it('finds the three lines of the pipeline documentation', () => {
    expect(LINES).toHaveLength(3);
  });

  it.each(LINES)('accepts line %# of the pipeline documentation as it is', (line) => {
    expect(parseResultLine(line)).toEqual({ ok: true, value: line });
  });

  it('knows the four verdicts', () => {
    expect(VERDICTS).toEqual(['favorite_won', 'upset', 'toss_up', 'not_graded']);
    expect([RIGHT, UPSET, NOT_GRADED].map((line) => line.market_verdict)).toEqual(['favorite_won', 'upset', 'not_graded']);
  });

  it('reads a line without the fields of the models as one the models did not grade', () => {
    // A line of a sport that is not forecast, as the preseason rehearsal writes them.
    const nine = Object.fromEntries(NINE_FIELDS.map((field) => [field, NOT_GRADED[field]]));

    expect(parseResultLine(nine)).toEqual({
      ok: true,
      value: { ...nine, elo: null, elo_verdict: 'not_graded', points_rest: null, points_rest_verdict: 'not_graded' },
    });
  });

  it('leaves out fields it does not know', () => {
    const extended = copyOf(RIGHT);
    extended.attendance = 19_812;
    (extended.market as Json).books = ['Book A'];
    (extended.elo as Json).home_rating = 1720;

    expect(parseResultLine(extended)).toEqual({ ok: true, value: RIGHT });
  });

  it.each([null, undefined, [], 'line', 1])('refuses %j in place of the line', (value) => {
    expect(parseResultLine(value)).toEqual({ ok: false, problem: 'the result should be an object' });
  });

  it('refuses a score that is not a whole number, and a game without a winner', () => {
    expect(problemAfter((line) => (line.home_pts = 112.5))).toBe('home_pts should be a whole number that is not negative');
    expect(problemAfter((line) => (line.away_pts = -1))).toBe('away_pts should be a whole number that is not negative');
    expect(problemAfter((line) => delete line.away_pts)).toBe('away_pts should be a whole number that is not negative');
    expect(problemAfter((line) => (line.away_pts = line.home_pts))).toBe(
      'the result should be a game with two scores that are not equal',
    );
  });

  it('refuses a game without an id, a team that is not a code and a time in another format', () => {
    expect(problemAfter((line) => (line.id = ''))).toBe('id should be a string that is not empty');
    expect(problemAfter((line) => (line.home = 'Knicks'))).toBe('home should be three capital letters');
    expect(problemAfter((line) => (line.commence_time = '2026-10-20 23:10'))).toBe(
      'commence_time should be a time like 2026-10-20T22:10:41Z',
    );
    expect(problemAfter((line) => delete line.recorded_at)).toBe('recorded_at should be a time like 2026-10-20T22:10:41Z');
  });

  it.each(['favorite', 'FAVORITE_WON', '', null, undefined, 1])('refuses %j as the verdict on the sportsbooks', (value) => {
    expect(problemAfter((line) => (line.market_verdict = value))).toBe(
      'market_verdict should be one of favorite_won, upset, toss_up, not_graded',
    );
  });

  it('refuses a verdict on a model that is not one of the four, null included', () => {
    const problem = 'should be one of favorite_won, upset, toss_up, not_graded';
    expect(problemAfter((line) => (line.elo_verdict = 'won'))).toBe(`elo_verdict ${problem}`);
    expect(problemAfter((line) => (line.points_rest_verdict = null))).toBe(`points_rest_verdict ${problem}`);
  });

  it('wants null, not a missing field, for a game without a line', () => {
    expect(problemAfter((line) => delete line.market)).toBe('market should be an object or null');
    expect(problemAfter((line) => (line.market = 0.6429))).toBe('market should be an object or null');
  });

  it('holds the line a game was graded against to the rules of a line', () => {
    expect(problemAfter((line) => ((line.market as Json).p_home = 1))).toBe('market.p_home should be a number between 0 and 1');
    expect(problemAfter((line) => ((line.market as Json).lo = 0.65))).toBe('market should be in the order lo, p_home, hi');
    expect(problemAfter((line) => ((line.market as Json).n = 0))).toBe('market.n should be a whole number of at least 1');
    expect(problemAfter((line) => delete (line.market as Json).at)).toBe('market.at should be a time like 2026-10-20T22:10:41Z');
  });

  it('refuses a forecast without its chance, its margin or the time it was published at', () => {
    expect(problemAfter((line) => ((line.elo as Json).p_home = 0))).toBe('elo.p_home should be a number between 0 and 1');
    expect(problemAfter((line) => delete (line.elo as Json).published_at)).toBe(
      'elo.published_at should be a time like 2026-10-20T22:10:41Z',
    );
    expect(problemAfter((line) => ((line.points_rest as Json).margin = '4.03'))).toBe('points_rest.margin should be a number');
    expect(problemAfter((line) => (line.points_rest = 0.63))).toBe('points_rest should be an object');
  });
});
