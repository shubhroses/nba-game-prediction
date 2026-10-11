/**
 * The board, `v1/slate.json` on the data branch: the upcoming games as of the
 * latest snapshot. The types follow schema 1 as pipeline/README.md documents
 * it, and parseBoard checks a value from the network against them.
 */

/** What the sportsbooks imply about one game. Every probability is the home team's. */
export interface Line {
  /** The median across the sportsbooks. */
  p_home: number;
  lo: number;
  hi: number;
  /** How many sportsbooks the median is taken over. */
  n: number;
  /** Their names, or an empty list when `lo` equals `hi`. */
  books: string[];
  captured_at: string;
}

export interface OpeningLine {
  p_home: number;
  at: string;
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
}

export interface Board {
  schema: 1;
  sport: string;
  /** When the snapshot was taken, in UTC. */
  generated_at: string;
  /** The slot of this snapshot and the next one: New York times with their UTC offset. */
  slot: string;
  next_due: string;
  games: BoardGame[];
}

export type ParsedBoard = { ok: true; board: Board } | { ok: false; problem: string };

class ShapeProblem extends Error {}

const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SLOT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const TEAM_CODE = /^[A-Z]{3}$/;

function expected(what: string, path: string): never {
  throw new ShapeProblem(`${path} should be ${what}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') expected('a string that is not empty', path);
  return value;
}

function teamCode(value: unknown, path: string): string {
  if (typeof value !== 'string' || !TEAM_CODE.test(value)) expected('three capital letters', path);
  return value;
}

function time(format: RegExp, example: string, value: unknown, path: string): string {
  if (typeof value !== 'string' || !format.test(value) || Number.isNaN(Date.parse(value))) {
    expected(`a time like ${example}`, path);
  }
  return value;
}

const utcTime = (value: unknown, path: string) => time(UTC_TIME, '2026-10-20T22:10:41Z', value, path);
const slotId = (value: unknown, path: string) => time(SLOT_ID, '2026-10-20T18:10-04:00', value, path);

function probability(value: unknown, path: string): number {
  if (typeof value !== 'number' || !(value > 0 && value < 1)) expected('a number between 0 and 1', path);
  return value;
}

function line(value: unknown, path: string): Line | null {
  if (value === null) return null;
  if (!isRecord(value)) expected('an object or null', path);

  const p_home = probability(value.p_home, `${path}.p_home`);
  const lo = probability(value.lo, `${path}.lo`);
  const hi = probability(value.hi, `${path}.hi`);
  if (lo > p_home || p_home > hi) expected('in the order lo, p_home, hi', path);

  const { n, books } = value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) expected('a whole number of at least 1', `${path}.n`);
  if (!Array.isArray(books) || !books.every((book) => typeof book === 'string')) {
    expected('a list of names', `${path}.books`);
  }

  return { p_home, lo, hi, n, books: [...books], captured_at: utcTime(value.captured_at, `${path}.captured_at`) };
}

function openingLine(value: unknown, path: string): OpeningLine | null {
  if (value === null) return null;
  if (!isRecord(value)) expected('an object or null', path);
  return { p_home: probability(value.p_home, `${path}.p_home`), at: utcTime(value.at, `${path}.at`) };
}

function game(value: unknown, path: string): BoardGame {
  if (!isRecord(value)) expected('an object', path);
  return {
    id: text(value.id, `${path}.id`),
    commence_time: utcTime(value.commence_time, `${path}.commence_time`),
    home: teamCode(value.home, `${path}.home`),
    away: teamCode(value.away, `${path}.away`),
    line: line(value.line, `${path}.line`),
    open: openingLine(value.open, `${path}.open`),
  };
}

function board(value: unknown): Board {
  if (!isRecord(value)) expected('an object', 'the board');
  if (value.schema !== 1) expected('1', 'schema');
  if (!Array.isArray(value.games)) expected('a list', 'games');
  return {
    schema: 1,
    sport: text(value.sport, 'sport'),
    generated_at: utcTime(value.generated_at, 'generated_at'),
    slot: slotId(value.slot, 'slot'),
    next_due: slotId(value.next_due, 'next_due'),
    games: value.games.map((entry, index) => game(entry, `games[${index}]`)),
  };
}

/**
 * Checks that a value has the shape of a schema 1 board and returns it with
 * the documented fields only. A field this page does not know is left out
 * without complaint, because the pipeline is free to add fields.
 */
export function parseBoard(value: unknown): ParsedBoard {
  try {
    return { ok: true, board: board(value) };
  } catch (error) {
    if (error instanceof ShapeProblem) return { ok: false, problem: error.message };
    throw error;
  }
}
