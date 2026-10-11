import { parseBoard, type Board } from './board';

const PUBLISHED_DATA = 'https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1';

/**
 * Where the published files are read from. The build variable is not a
 * secret: it points the page at another copy of the files, such as the
 * preseason rehearsal under v1-dryrun.
 */
export const DATA_BASE_URL = (import.meta.env.VITE_DATA_BASE_URL || PUBLISHED_DATA).replace(/\/+$/, '');

export const BOARD_URL = `${DATA_BASE_URL}/slate.json`;

/** Why the board could not be loaded. */
export type LoadError =
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'shape'; problem: string };

export type LoadResult = { ok: true; board: Board } | { ok: false; error: LoadError };

const TIMEOUT_MS = 15_000;

const failed = (error: LoadError): LoadResult => ({ ok: false, error });

function readBoard(body: string): LoadResult {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return failed({ kind: 'shape', problem: 'the file is not JSON' });
  }
  const parsed = parseBoard(value);
  return parsed.ok ? parsed : failed({ kind: 'shape', problem: parsed.problem });
}

/**
 * Requests the board once and never throws. The request is given up when
 * `signal` aborts or after 15 seconds, and both count as a network error.
 */
export async function fetchBoard(signal: AbortSignal): Promise<LoadResult> {
  const request = new AbortController();
  const giveUp = () => request.abort();
  const timer = setTimeout(giveUp, TIMEOUT_MS);
  signal.addEventListener('abort', giveUp);
  if (signal.aborted) giveUp();

  let body: string;
  try {
    const response = await fetch(BOARD_URL, { signal: request.signal });
    if (!response.ok) return failed({ kind: 'http', status: response.status });
    body = await response.text();
  } catch {
    return failed({ kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', giveUp);
  }
  return readBoard(body);
}
