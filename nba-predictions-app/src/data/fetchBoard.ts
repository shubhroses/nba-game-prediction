import { parseBoard, type Board } from './board';
import { DATA_BASE_URL, fetchPublished, publishedUrl, type LoadError } from './published';

export { DATA_BASE_URL, type LoadError };

const BOARD_PATH = 'slate.json';

export const BOARD_URL = publishedUrl(BOARD_PATH);

export type LoadResult = { ok: true; board: Board } | { ok: false; error: LoadError };

/**
 * Requests the board once and never throws. The request is given up when
 * `signal` aborts or after 15 seconds, and both count as a network error.
 * There is always a board, so HTTP 404 is an error like any other status.
 */
export async function fetchBoard(signal: AbortSignal): Promise<LoadResult> {
  const fetched = await fetchPublished(BOARD_PATH, parseBoard, signal);
  switch (fetched.status) {
    case 'ok':
      return { ok: true, board: fetched.value };
    case 'missing':
      return { ok: false, error: { kind: 'http', status: 404 } };
    case 'failed':
      return { ok: false, error: fetched.error };
  }
}
