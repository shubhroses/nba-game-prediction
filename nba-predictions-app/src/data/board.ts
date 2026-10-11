/**
 * The board, `v1/slate.json` on the data branch: the upcoming games as of the
 * latest snapshot with the forecasts for them, the record so far and the
 * results of the last days. The types follow schema 1 as pipeline/README.md
 * documents it, and parseBoard checks a value from the network against them.
 */
import { consensus, modelStatus, pointsRestOrNull, type Consensus, type ModelStatus, type PointsRestForecast } from './forecasts';
import { resultLine, type ResultLine } from './results';
import {
  count,
  day,
  expected,
  list,
  object,
  objectIfThere,
  objectOrNull,
  orNull,
  parsed,
  probability,
  schemaOne,
  slotId,
  teamCode,
  text,
  utcTime,
  type Parsed,
} from './shape';

/** What the sportsbooks imply about one game. Every probability is the home team's. */
export interface Line extends Consensus {
  /** Their names, or an empty list when `lo` equals `hi`. */
  books: string[];
  captured_at: string;
}

export interface OpeningLine {
  p_home: number;
  at: string;
}

/** Elo's chance for the home team. */
export interface EloChance {
  p_home: number;
}

export interface BoardGame {
  id: string;
  /** The scheduled start, in UTC. */
  commence_time: string;
  /** Three-letter team codes. */
  home: string;
  away: string;
  /** Null when no sportsbook quoted both teams in this snapshot. */
  line: Line | null;
  /** The first line the game had. Null if it never had one. */
  open: OpeningLine | null;
  /**
   * For a game of the day whose forecasts are frozen, the frozen chance. For
   * any other game, what the ratings of the last daily run make of it, which
   * can still move. Null until the models have been built once, and in a
   * sport that is not forecast.
   */
  elo: EloChance | null;
  /**
   * The frozen forecast of the points-and-rest model, which is made on the
   * morning of the game. Null for a game of a later day, for a game without
   * a forecast, on a day on which the model was left out, and in a sport
   * that is not forecast.
   */
  points_rest: PointsRestForecast | null;
}

/** What the forecasts of the board rest on. */
export interface BoardModels {
  /** The day of the last result that the models have replayed. Null before the first one. */
  results_through: string | null;
  status: ModelStatus;
  /** The day whose frozen forecasts the board carries. Null when there is none. */
  predictions_day: string | null;
}

/** The favorites of one source that won, and the ones that lost. */
export interface Tally {
  wins: number;
  losses: number;
}

export interface BoardRecord {
  /** The sportsbooks' favorite. */
  market: Tally;
  /** Null in a sport that is not forecast. */
  elo: Tally | null;
  points_rest: Tally | null;
}

export interface Board {
  schema: 1;
  sport: string;
  /** When the snapshot was taken, in UTC. */
  generated_at: string;
  /** The slot of this snapshot and the next one: New York times with their UTC offset. */
  slot: string;
  next_due: string;
  /** The games that had not started at `generated_at`, by start. */
  games: BoardGame[];
  /** Null until the models have been built once, and in a sport that is not forecast. */
  models: BoardModels | null;
  /** Null until the daily work has been recorded once. */
  record: BoardRecord | null;
  /** The games that started less than eight days before `generated_at`, by start. */
  recent_results: ResultLine[];
}

function line(value: unknown, path: string): Line | null {
  const fields = objectOrNull(value, path);
  if (fields === null) return null;

  const numbers = consensus(fields, path);
  const { books } = fields;
  if (!Array.isArray(books) || !books.every((book) => typeof book === 'string')) {
    expected('a list of names', `${path}.books`);
  }
  return { ...numbers, books: [...books], captured_at: utcTime(fields.captured_at, `${path}.captured_at`) };
}

function openingLine(value: unknown, path: string): OpeningLine | null {
  const fields = objectOrNull(value, path);
  return fields && { p_home: probability(fields.p_home, `${path}.p_home`), at: utcTime(fields.at, `${path}.at`) };
}

function eloChance(value: unknown, path: string): EloChance | null {
  const fields = objectIfThere(value, path);
  return fields && { p_home: probability(fields.p_home, `${path}.p_home`) };
}

function game(value: unknown, path: string): BoardGame {
  const fields = object(value, path);
  return {
    id: text(fields.id, `${path}.id`),
    commence_time: utcTime(fields.commence_time, `${path}.commence_time`),
    home: teamCode(fields.home, `${path}.home`),
    away: teamCode(fields.away, `${path}.away`),
    line: line(fields.line, `${path}.line`),
    open: openingLine(fields.open, `${path}.open`),
    elo: eloChance(fields.elo, `${path}.elo`),
    // A sport that is not forecast does not have the field, and that counts as null.
    points_rest: fields.points_rest === undefined ? null : pointsRestOrNull(fields.points_rest, `${path}.points_rest`),
  };
}

function models(value: unknown): BoardModels | null {
  const fields = objectIfThere(value, 'models');
  return (
    fields && {
      results_through: orNull(fields.results_through, 'models.results_through', day),
      status: modelStatus(fields.status, 'models.status'),
      predictions_day: orNull(fields.predictions_day, 'models.predictions_day', day),
    }
  );
}

function tally(value: unknown, path: string): Tally {
  const fields = object(value, path);
  return { wins: count(fields.wins, `${path}.wins`), losses: count(fields.losses, `${path}.losses`) };
}

function record(value: unknown): BoardRecord | null {
  const fields = objectOrNull(value, 'record');
  return (
    fields && {
      market: tally(fields.market, 'record.market'),
      elo: fields.elo === undefined ? null : tally(fields.elo, 'record.elo'),
      points_rest: fields.points_rest === undefined ? null : tally(fields.points_rest, 'record.points_rest'),
    }
  );
}

function board(value: unknown): Board {
  const fields = object(value, 'the board');
  return {
    schema: schemaOne(fields.schema),
    sport: text(fields.sport, 'sport'),
    generated_at: utcTime(fields.generated_at, 'generated_at'),
    slot: slotId(fields.slot, 'slot'),
    next_due: slotId(fields.next_due, 'next_due'),
    games: list(fields.games, 'games', game),
    models: models(fields.models),
    record: record(fields.record),
    recent_results: list(fields.recent_results, 'recent_results', resultLine),
  };
}

/**
 * Checks that a value has the shape of a schema 1 board and returns it with
 * the documented fields only. A field this page does not know is left out
 * without complaint, because the pipeline is free to add fields. The fields
 * of the models, which the board of a sport that is not forecast does not
 * have, come out as null.
 */
export function parseBoard(value: unknown): Parsed<Board> {
  return parsed(() => board(value));
}
