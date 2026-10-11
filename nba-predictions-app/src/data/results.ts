/**
 * A result line: one game that is over, with the sportsbooks' line it is
 * graded against, what each model said on its morning, and the verdict on
 * each. The lines are in `results/YYYY-MM.ndjson` on the data branch, and the
 * board carries those of the last eight days. pipeline/README.md documents
 * them.
 */
import { marketLineOrNull, type MarketLine } from './forecasts';
import {
  at,
  count,
  expected,
  finite,
  object,
  oneOf,
  parsed,
  probability,
  teamCode,
  text,
  utcTime,
  type Parsed,
} from './shape';

/**
 * What became of a forecast. A source favors the side it puts at 52% or
 * more. `toss_up` means that it had neither side there. `not_graded` means
 * that there was nothing to grade, or that the forecast came too late to
 * count.
 */
export const VERDICTS = ['favorite_won', 'upset', 'toss_up', 'not_graded'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** What Elo said on the morning of a game that is over. */
export interface GradedElo {
  p_home: number;
  /** When the forecast was published. It counts only if that was before the start. */
  published_at: string;
}

/** What the points-and-rest model said on the morning of a game that is over. */
export interface GradedPointsRest extends GradedElo {
  /** Its expected margin for the home team, in points. */
  margin: number;
}

export interface ResultLine {
  id: string;
  /** The start as the scores give it, which can differ from the scheduled start that the board had. */
  commence_time: string;
  /** Three-letter team codes. */
  home: string;
  away: string;
  /** The final score: two whole numbers that are not equal. */
  home_pts: number;
  away_pts: number;
  recorded_at: string;
  /** The sportsbooks' last line from before the start. Null when the game has none. */
  market: MarketLine | null;
  market_verdict: Verdict;
  /** Null when Elo had no forecast for the game, and in a line that does not have the fields of the models. */
  elo: GradedElo | null;
  /** `not_graded` in a line that does not have the fields of the models, which is how the job reads such a line. */
  elo_verdict: Verdict;
  points_rest: GradedPointsRest | null;
  points_rest_verdict: Verdict;
}

/**
 * A line of a sport that is not forecast, and one from before the models,
 * has no field for a model: that counts as null.
 */
function gradedElo(value: unknown, path: string): GradedElo | null {
  if (value === undefined || value === null) return null;
  const fields = object(value, path);
  return {
    p_home: probability(fields.p_home, at(path, 'p_home')),
    published_at: utcTime(fields.published_at, at(path, 'published_at')),
  };
}

function gradedPointsRest(value: unknown, path: string): GradedPointsRest | null {
  const forecast = gradedElo(value, path);
  return forecast && { ...forecast, margin: finite(object(value, path).margin, at(path, 'margin')) };
}

function verdict(value: unknown, path: string): Verdict {
  return oneOf(VERDICTS, value, path);
}

function modelVerdict(value: unknown, path: string): Verdict {
  return value === undefined ? 'not_graded' : verdict(value, path);
}

export function resultLine(value: unknown, path: string): ResultLine {
  const fields = object(value, path || 'the result');
  const home_pts = count(fields.home_pts, at(path, 'home_pts'));
  const away_pts = count(fields.away_pts, at(path, 'away_pts'));
  if (home_pts === away_pts) expected('a game with two scores that are not equal', path || 'the result');

  return {
    id: text(fields.id, at(path, 'id')),
    commence_time: utcTime(fields.commence_time, at(path, 'commence_time')),
    home: teamCode(fields.home, at(path, 'home')),
    away: teamCode(fields.away, at(path, 'away')),
    home_pts,
    away_pts,
    recorded_at: utcTime(fields.recorded_at, at(path, 'recorded_at')),
    market: marketLineOrNull(fields.market, at(path, 'market')),
    market_verdict: verdict(fields.market_verdict, at(path, 'market_verdict')),
    elo: gradedElo(fields.elo, at(path, 'elo')),
    elo_verdict: modelVerdict(fields.elo_verdict, at(path, 'elo_verdict')),
    points_rest: gradedPointsRest(fields.points_rest, at(path, 'points_rest')),
    points_rest_verdict: modelVerdict(fields.points_rest_verdict, at(path, 'points_rest_verdict')),
  };
}

/**
 * Checks that a value has the shape of a result line and returns it with the
 * documented fields only. A line with the first nine fields and nothing of
 * the models is taken as well.
 */
export function parseResultLine(value: unknown): Parsed<ResultLine> {
  return parsed(() => resultLine(value, ''));
}
