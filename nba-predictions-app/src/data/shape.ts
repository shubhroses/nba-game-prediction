/**
 * What the shape checks of the published files are made of. A check takes a
 * value and the path of the field it came from. It returns the value with its
 * type, or throws a ShapeProblem that names the path and says what the field
 * should be. pipeline/README.md documents the files.
 */

/** A file with the documented fields only, or what is wrong with it. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

/** The shape check of one kind of file. */
export type Parse<T> = (value: unknown) => Parsed<T>;

type Check<T> = (value: unknown, path: string) => T;

export class ShapeProblem extends Error {}

const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SLOT_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TEAM_CODE = /^[A-Z]{3}$/;

export function expected(what: string, path: string): never {
  throw new ShapeProblem(`${path} should be ${what}`);
}

/** The path of a field of the object at `path`. At the top of a file a field goes by its name alone. */
export function at(path: string, field: string): string {
  return path === '' ? field : `${path}.${field}`;
}

/**
 * Runs the check of a whole file. A ShapeProblem becomes the result. Any
 * other error is a fault of this page and is thrown on.
 */
export function parsed<T>(check: () => T): Parsed<T> {
  try {
    return { ok: true, value: check() };
  } catch (error) {
    if (error instanceof ShapeProblem) return { ok: false, problem: error.message };
    throw error;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether a table has a row of its own under a key, such as a team's code.
 * It is written the long way: `Object.hasOwn` is not in the browsers of
 * before March 2022, which the built page otherwise runs in.
 */
export function hasRow(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) expected('an object', path);
  return value;
}

/** Null as it is. A field that is missing is not null: the files write null out. */
export function objectOrNull(value: unknown, path: string): Record<string, unknown> | null {
  if (value === null) return null;
  if (!isRecord(value)) expected('an object or null', path);
  return value;
}

/**
 * For a field that a sport without forecasts does not have at all: missing
 * counts as null.
 */
export function objectIfThere(value: unknown, path: string): Record<string, unknown> | null {
  return value === undefined ? null : objectOrNull(value, path);
}

export function list<T>(value: unknown, path: string, item: Check<T>): T[] {
  if (!Array.isArray(value)) expected('a list', path);
  return value.map((entry, index) => item(entry, `${path}[${index}]`));
}

/** Null as it is, and anything else through `check`, whose complaint then allows for null. */
export function orNull<T>(value: unknown, path: string, check: Check<T>): T | null {
  if (value === null) return null;
  try {
    return check(value, path);
  } catch (error) {
    // Only the complaint about this field itself. One about a field inside it stays as it is.
    if (error instanceof ShapeProblem && error.message.startsWith(`${path} should be `)) {
      throw new ShapeProblem(`${error.message} or null`);
    }
    throw error;
  }
}

export function schemaOne(value: unknown): 1 {
  if (value !== 1) expected('1', 'schema');
  return 1;
}

export function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') expected('a string that is not empty', path);
  return value;
}

export function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') expected('true or false', path);
  return value;
}

export function oneOf<T extends string>(options: readonly T[], value: unknown, path: string): T {
  const found = options.find((option) => option === value);
  if (found === undefined) expected(`one of ${options.join(', ')}`, path);
  return found;
}

export function teamCode(value: unknown, path: string): string {
  if (typeof value !== 'string' || !TEAM_CODE.test(value)) expected('three capital letters', path);
  return value;
}

function time(format: RegExp, example: string, value: unknown, path: string): string {
  if (typeof value !== 'string' || !format.test(value) || Number.isNaN(Date.parse(value))) {
    expected(`a time like ${example}`, path);
  }
  return value;
}

/** A time in UTC, to the second. */
export const utcTime: Check<string> = (value, path) => time(UTC_TIME, '2026-10-20T22:10:41Z', value, path);

/** The id of a slot: a New York time with its UTC offset. */
export const slotId: Check<string> = (value, path) => time(SLOT_ID, '2026-10-20T18:10-04:00', value, path);

/**
 * Whether a text is a calendar date written as 2026-10-20. Engines differ on
 * what Date.parse makes of 30 February, so the date is built and read back.
 */
export function isDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const [year, month, date] = match.slice(1).map(Number);
  const built = new Date(Date.UTC(year, month - 1, date));
  return built.getUTCFullYear() === year && built.getUTCMonth() === month - 1 && built.getUTCDate() === date;
}

/** A calendar date, which is what the files call a day. */
export function day(value: unknown, path: string): string {
  if (typeof value !== 'string' || !isDay(value)) expected('a date like 2026-10-20', path);
  return value;
}

/** A chance: strictly between 0 and 1, as the files write every probability. */
export function probability(value: unknown, path: string): number {
  if (typeof value !== 'number' || !(value > 0 && value < 1)) expected('a number between 0 and 1', path);
  return value;
}

/** A share of games, which can be none of them or all of them. */
export function share(value: unknown, path: string): number {
  if (typeof value !== 'number' || !(value >= 0 && value <= 1)) expected('a number from 0 to 1', path);
  return value;
}

/** Any number that can be written down: points, a rating in points, a difference between two scores. */
export function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) expected('a number', path);
  return value;
}

/** A score that is zero or more, lower being better: a Brier score or a log loss. */
export function score(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) expected('a number that is not negative', path);
  return value;
}

export function wholeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) expected('a whole number', path);
  return value;
}

/** How many of something: games, wins, points scored. */
export function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    expected('a whole number that is not negative', path);
  }
  return value;
}

/** The two ends of an interval, the lower one first. */
export function bounds(value: unknown, path: string, bound: Check<number>): [number, number] {
  const what = 'a lower bound and an upper bound that is not below it';
  if (!Array.isArray(value) || value.length !== 2) expected(what, path);
  const lower = bound(value[0], `${path}[0]`);
  const upper = bound(value[1], `${path}[1]`);
  if (lower > upper) expected(what, path);
  return [lower, upper];
}

/**
 * A table with one row for each team, keyed by the team's code. The rows are
 * copied into an object that has nothing but them.
 */
export function teamTable<T>(value: unknown, path: string, row: Check<T>): Record<string, T> {
  const table: Record<string, T> = {};
  for (const [code, entry] of Object.entries(object(value, path))) {
    if (!TEAM_CODE.test(code)) expected('a table keyed by three capital letters', path);
    table[code] = row(entry, `${path}.${code}`);
  }
  return table;
}
