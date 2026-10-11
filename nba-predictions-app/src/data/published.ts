/**
 * The request for one of the files that the job publishes on the data
 * branch: the board, the record, the model file, the forecasts of a day.
 */
import type { Parse } from './shape';

const PUBLISHED_DATA = 'https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1';

/**
 * Where the published files are read from. The build variable is not a
 * secret: it points the page at another copy of the files, such as the
 * preseason rehearsal under v1-dryrun.
 */
export const DATA_BASE_URL = (import.meta.env.VITE_DATA_BASE_URL || PUBLISHED_DATA).replace(/\/+$/, '');

/** The address of a file, from its path under the prefix: `record.json`, `predictions/2026-10-21.json`. */
export function publishedUrl(path: string): string {
  return `${DATA_BASE_URL}/${path}`;
}

/** Why a file could not be loaded. */
export type LoadError =
  | { kind: 'network' }
  | { kind: 'http'; status: number }
  | { kind: 'shape'; problem: string };

/**
 * What a request came to. `missing` is the answer HTTP 404. It is told apart
 * from the failures because it is an answer: a day without a game to
 * forecast has no predictions file, and a sport that is not forecast has no
 * model file.
 */
export type Fetched<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'failed'; error: LoadError };

const TIMEOUT_MS = 15_000;
const NETWORK_RETRY_MS = 2000;

const failed = (error: LoadError): Fetched<never> => ({ status: 'failed', error });

function read<T>(body: string, parse: Parse<T>): Fetched<T> {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return failed({ kind: 'shape', problem: 'the file is not JSON' });
  }
  try {
    const parsed = parse(value);
    return parsed.ok ? { status: 'ok', value: parsed.value } : failed({ kind: 'shape', problem: parsed.problem });
  } catch (error) {
    // A check that throws anything but its own complaint has met a fault of this page, such as a function that the
    // browser does not have. The file is not on the page either way, and a load that ends as a failure has its
    // sentence and its button, where one that threw would leave the spinner turning for good.
    const fault = error instanceof Error ? error.message : String(error);
    return failed({ kind: 'shape', problem: `the check of the file could not be run: ${fault}` });
  }
}

/**
 * Requests a published file once and never throws. The request is given up
 * when `signal` aborts or after 15 seconds, and both count as a network
 * error.
 *
 * `fresh` has the browser ask the server whether its own copy of the file is
 * still the latest one, in place of using a copy that it may keep for five
 * minutes. It is for a file that is asked for a second time because the
 * first answer was not the one the page needs.
 */
export async function fetchPublished<T>(path: string, parse: Parse<T>, signal: AbortSignal, fresh = false): Promise<Fetched<T>> {
  const request = new AbortController();
  const giveUp = () => request.abort();
  const timer = setTimeout(giveUp, TIMEOUT_MS);
  signal.addEventListener('abort', giveUp);
  if (signal.aborted) giveUp();

  let body: string;
  try {
    const init: RequestInit = fresh ? { signal: request.signal, cache: 'no-cache' } : { signal: request.signal };
    const response = await fetch(publishedUrl(path), init);
    if (response.status === 404) return { status: 'missing' };
    if (!response.ok) return failed({ kind: 'http', status: response.status });
    body = await response.text();
  } catch {
    return failed({ kind: 'network' });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', giveUp);
  }
  return read(body, parse);
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}

/**
 * As fetchPublished, with a second request two seconds after one that failed
 * on the network, which is what the page does for the board as well. An
 * answer from the server, whatever it says, is not asked for again.
 */
export async function fetchPublishedTwice<T>(
  path: string,
  parse: Parse<T>,
  signal: AbortSignal,
  fresh = false,
): Promise<Fetched<T>> {
  const first = await fetchPublished(path, parse, signal, fresh);
  if (first.status !== 'failed' || first.error.kind !== 'network' || signal.aborted) return first;

  await pause(NETWORK_RETRY_MS, signal);
  return signal.aborted ? first : fetchPublished(path, parse, signal, fresh);
}
