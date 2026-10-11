/**
 * The shapes that more than one of the published files carry: the
 * sportsbooks' consensus, the forecast of the points-and-rest model, and what
 * a file says of how the models were built.
 */
import { at, expected, finite, object, objectOrNull, oneOf, probability, text, utcTime } from './shape';

/** The median, the lowest and the highest home share among the sportsbooks. */
export interface Consensus {
  p_home: number;
  lo: number;
  hi: number;
  /** How many sportsbooks the median is taken over. */
  n: number;
}

/** The consensus as the job held it at one moment: in a result line and in a predictions file. */
export interface MarketLine extends Consensus {
  /** When the snapshot it comes from was taken. */
  at: string;
}

/**
 * What the points-and-rest model says of one game. The margin is in points
 * for the home team, and it is the sum of the three parts as they are written.
 */
export interface PointsRestForecast {
  p_home: number;
  margin: number;
  rating_edge: number;
  home_court: number;
  rest_edge: number;
}

/** `degraded` when the results did not pass the job's checks. The points-and-rest model is then left out. */
export const MODEL_STATUSES = ['ok', 'degraded'] as const;
export type ModelStatus = (typeof MODEL_STATUSES)[number];

/** Which opening file each model was built from, as the SHA-256 of the file. */
export interface Parameters {
  elo: string;
  points_rest: string;
}

/** The four numbers of a consensus. `fields` is the object that holds them, and `path` is its path. */
export function consensus(fields: Record<string, unknown>, path: string): Consensus {
  const p_home = probability(fields.p_home, at(path, 'p_home'));
  const lo = probability(fields.lo, at(path, 'lo'));
  const hi = probability(fields.hi, at(path, 'hi'));
  if (lo > p_home || p_home > hi) expected('in the order lo, p_home, hi', path);

  const { n } = fields;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) expected('a whole number of at least 1', at(path, 'n'));
  return { p_home, lo, hi, n };
}

export function marketLineOrNull(value: unknown, path: string): MarketLine | null {
  const fields = objectOrNull(value, path);
  return fields && { ...consensus(fields, path), at: utcTime(fields.at, at(path, 'at')) };
}

export function pointsRestOrNull(value: unknown, path: string): PointsRestForecast | null {
  const fields = objectOrNull(value, path);
  return (
    fields && {
      p_home: probability(fields.p_home, at(path, 'p_home')),
      margin: finite(fields.margin, at(path, 'margin')),
      rating_edge: finite(fields.rating_edge, at(path, 'rating_edge')),
      home_court: finite(fields.home_court, at(path, 'home_court')),
      rest_edge: finite(fields.rest_edge, at(path, 'rest_edge')),
    }
  );
}

export function modelStatus(value: unknown, path: string): ModelStatus {
  return oneOf(MODEL_STATUSES, value, path);
}

/** One sentence for each thing the job found in the results. Empty when the status is `ok`. */
export function reasons(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((reason) => typeof reason === 'string')) {
    expected('a list of sentences', path);
  }
  return [...value];
}

export function parameters(value: unknown, path: string): Parameters {
  const fields = object(value, path);
  return { elo: text(fields.elo, at(path, 'elo')), points_rest: text(fields.points_rest, at(path, 'points_rest')) };
}
