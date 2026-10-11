/**
 * The teams a visitor follows, kept in the browser's storage under one key
 * as a JSON list of team codes. Nothing of it leaves the browser.
 */
import { TEAM_NAMES } from '../display/teams';

export const MY_TEAMS_KEY = 'nba-predictions.my-teams';

type Readable = Pick<Storage, 'getItem'>;
type Writable = Pick<Storage, 'setItem'>;

/** The team codes in a stored text, in the order of the alphabet. Anything that is not one of the 30 codes is left out. */
export function teamsIn(stored: string | null): string[] {
  if (stored === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const codes = value.filter((entry): entry is string => typeof entry === 'string' && TEAM_NAMES.has(entry));
  return [...new Set(codes)].sort();
}

/** What is stored, checked. Empty when there is no storage or reading it throws, as it can when the browser blocks it. */
export function readMyTeams(storage: Readable | null): string[] {
  try {
    return storage ? teamsIn(storage.getItem(MY_TEAMS_KEY)) : [];
  } catch {
    return [];
  }
}

/** Stores the teams and says whether that worked. Storage can be missing, full or blocked. */
export function writeMyTeams(storage: Writable | null, teams: Iterable<string>): boolean {
  try {
    storage?.setItem(MY_TEAMS_KEY, JSON.stringify([...teams].sort()));
    return storage !== null;
  } catch {
    return false;
  }
}

/** The teams with one more, or with one fewer when it was among them. */
export function withToggled(teams: ReadonlySet<string>, code: string): Set<string> {
  const next = new Set(teams);
  if (!next.delete(code)) next.add(code);
  return next;
}
