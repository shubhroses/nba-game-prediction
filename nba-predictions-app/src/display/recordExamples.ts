/**
 * Small records for the tests of the record view: the record as it is before
 * the first game, which is the shape of the file on the data branch on 10
 * October 2026, and ways to change one part of it. The numbers a test puts
 * in are invented. Only tests import this file.
 */
import type { Band, ModelScorecard, RecordDay, RecordedGame, Scorecard, SeasonRecord } from '../data/record';

const BANDS = ['52-59', '60-69', '70-79', '80-89', '90+'];

/** The five bands without a game. */
export function noBands(): Band[] {
  return BANDS.map((band) => ({ band, games: 0, wins: 0, mean_p_favorite: null }));
}

/** The five bands, each with the games, the wins and the mean chance that a test gives it. */
export function bandsOf(rows: readonly (readonly [games: number, wins: number, mean: number | null])[]): Band[] {
  return BANDS.map((band, index) => {
    const [games, wins, mean_p_favorite] = rows[index] ?? [0, 0, null];
    return { band, games, wins, mean_p_favorite };
  });
}

/** The scorecard of the sportsbooks' line before the first game, with the changes of a test. */
export function scorecard(changes: Partial<Scorecard> = {}): Scorecard {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    accuracy: null,
    accuracy_interval: null,
    toss_ups: 0,
    not_graded: 0,
    with_line: 0,
    brier: null,
    log_loss: null,
    bands: noBands(),
    biggest_upsets: [],
    ...changes,
  };
}

/** The scorecard of a model before the first game, with the changes of a test. */
export function modelScorecard(changes: Partial<ModelScorecard> = {}): ModelScorecard {
  return {
    ...scorecard(),
    late: 0,
    picks_against_market: { differ: 0, model_right: 0, market_right: 0, latest: [] },
    brier_against_market: { games: 0, difference: null, interval: null },
    ...changes,
  };
}

/** The record before the first game, with the changes of a test. */
export function seasonRecord(changes: Partial<SeasonRecord> = {}): SeasonRecord {
  return {
    schema: 1,
    sport: 'basketball_nba',
    since: null,
    games: 0,
    market: scorecard(),
    elo: modelScorecard(),
    points_rest: modelScorecard(),
    baseline_home: { games: 0, wins: 0 },
    by_day: [],
    ...changes,
  };
}

/** A game that is over: Dallas won in Denver, 110 to 101, on the evening of Wednesday 21 October. */
export function recordedGame(changes: Partial<RecordedGame> = {}): RecordedGame {
  return {
    id: '3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c',
    commence_time: '2026-10-22T01:10:12Z',
    home: 'DEN',
    away: 'DAL',
    home_pts: 101,
    away_pts: 110,
    ...changes,
  };
}

/** One day of the record, on which every source was graded on every game unless a test says otherwise. */
export function recordDay(day: string, games: number, changes: Partial<RecordDay> = {}): RecordDay {
  const tally = { wins: games, losses: 0, toss_ups: 0, not_graded: 0 };
  return { day, games, market: { ...tally }, elo: { ...tally }, points_rest: { ...tally }, ...changes };
}
