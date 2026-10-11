/**
 * A predictions file, `v1/predictions/YYYY-MM-DD.json` on the data branch:
 * the forecasts of the two models for the games of one day. The job writes
 * it once, on the morning of that day, and nothing changes it afterwards. A
 * day without a game to forecast has no file, and neither has a sport that
 * is not forecast. The types follow schema 1 as pipeline/README.md documents
 * it.
 */
import {
  marketLineOrNull,
  modelStatus,
  parameters,
  pointsRestOrNull,
  reasons,
  type MarketLine,
  type ModelStatus,
  type Parameters,
  type PointsRestForecast,
} from './forecasts';
import {
  day,
  expected,
  finite,
  flag,
  list,
  object,
  orNull,
  parsed,
  probability,
  schemaOne,
  teamCode,
  text,
  utcTime,
  wholeNumber,
  type Parse,
  type Parsed,
} from './shape';

/**
 * Elo's chance with the three numbers it comes from. `p_home` is
 * `1 / (1 + 10 ^ (-(home_rating + home_court - away_rating) / 400))`.
 */
export interface EloForecast {
  p_home: number;
  home_rating: number;
  away_rating: number;
  /** 40, or 0 on a neutral floor. */
  home_court: number;
}

export interface PredictedGame {
  id: string;
  /** The scheduled start as the job knew it that morning. */
  commence_time: string;
  home: string;
  away: string;
  /** Whether the game is on a neutral floor, where neither model gives the home team anything. */
  neutral: boolean;
  elo: EloForecast;
  /** Null on a day on which the model was left out. */
  points_rest: PointsRestForecast | null;
  /** The sportsbooks' consensus as the job held it that morning. Null when the game had no line yet. */
  market: MarketLine | null;
}

export interface DayPredictions {
  schema: 1;
  sport: string;
  /** The day whose games are forecast. */
  day: string;
  /** Every game in the file starts after this. */
  published_at: string;
  /** The day of the last result that the forecasts were made from. Null before the first result of the season. */
  results_through: string | null;
  status: ModelStatus;
  /** One sentence for each thing found in the results. Empty when the status is `ok`. */
  reasons: string[];
  parameters: Parameters;
  /** The commit of the code the job ran from. Null when the run was not told. */
  code_commit: string | null;
  /** The games of the day that had not started at `published_at`, by start. */
  games: PredictedGame[];
}

function eloForecast(value: unknown, path: string): EloForecast {
  const fields = object(value, path);
  return {
    p_home: probability(fields.p_home, `${path}.p_home`),
    home_rating: wholeNumber(fields.home_rating, `${path}.home_rating`),
    away_rating: wholeNumber(fields.away_rating, `${path}.away_rating`),
    home_court: finite(fields.home_court, `${path}.home_court`),
  };
}

function game(value: unknown, path: string): PredictedGame {
  const fields = object(value, path);
  return {
    id: text(fields.id, `${path}.id`),
    commence_time: utcTime(fields.commence_time, `${path}.commence_time`),
    home: teamCode(fields.home, `${path}.home`),
    away: teamCode(fields.away, `${path}.away`),
    neutral: flag(fields.neutral, `${path}.neutral`),
    elo: eloForecast(fields.elo, `${path}.elo`),
    points_rest: pointsRestOrNull(fields.points_rest, `${path}.points_rest`),
    market: marketLineOrNull(fields.market, `${path}.market`),
  };
}

function predictions(value: unknown): DayPredictions {
  const fields = object(value, 'the predictions');
  return {
    schema: schemaOne(fields.schema),
    sport: text(fields.sport, 'sport'),
    day: day(fields.day, 'day'),
    published_at: utcTime(fields.published_at, 'published_at'),
    results_through: orNull(fields.results_through, 'results_through', day),
    status: modelStatus(fields.status, 'status'),
    reasons: reasons(fields.reasons, 'reasons'),
    parameters: parameters(fields.parameters, 'parameters'),
    code_commit: orNull(fields.code_commit, 'code_commit', text),
    games: list(fields.games, 'games', game),
  };
}

/**
 * Checks that a value has the shape of a schema 1 predictions file and
 * returns it with the documented fields only.
 */
export function parsePredictions(value: unknown): Parsed<DayPredictions> {
  return parsed(() => predictions(value));
}

/** Where the file of a day is, under the prefix. */
export function predictionsPath(day: string): string {
  return `predictions/${day}.json`;
}

/**
 * The check for the file that was asked for by its day. A file is named
 * after the day it is of, so one that says another day is not that file.
 */
export function parsePredictionsOf(day: string): Parse<DayPredictions> {
  return (value) =>
    parsed(() => {
      const file = predictions(value);
      if (file.day !== day) expected(day, 'day');
      return file;
    });
}
