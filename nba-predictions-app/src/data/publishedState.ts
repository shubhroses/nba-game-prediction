import type { Fetched, LoadError } from './published';

/**
 * What the page knows about one published file other than the board.
 * `refreshing` is true while a file that is on screen is asked for again.
 *
 * - `idle`: no file is asked for.
 * - `loading`: the first request for the file is under way.
 * - `ready`: the file is here.
 * - `missing`: the server answered that there is no such file, which for a
 *   predictions file means that the day has none.
 * - `error`: the file could not be loaded, and no earlier copy is on hand.
 */
export type PublishedState<T> =
  | { status: 'idle'; refreshing: false }
  | { status: 'loading'; refreshing: false }
  | { status: 'ready'; data: T; refreshing: boolean }
  | { status: 'missing'; refreshing: boolean }
  | { status: 'error'; error: LoadError; refreshing: boolean };

export type PublishedAction<T> = { type: 'asked' } | { type: 'answered'; fetched: Fetched<T> };

export const IDLE = { status: 'idle', refreshing: false } as const;
export const LOADING = { status: 'loading', refreshing: false } as const;

/**
 * What the board lets the page expect of one of the other files. The host
 * keeps a copy of every file by itself, for five minutes, and it keeps "no
 * such file" as long. So in the minutes after the job has run, a file can
 * arrive older than the board that sent the page for it, or not at all.
 */
export interface Expectation<T> {
  /** True when the board says that the file exists. */
  exists: boolean;
  /** Whether a copy of the file is of another run of the job than the board. Left out for a file that never changes. */
  behind?: (file: T) => boolean;
}

/** Nothing is known of the file from the board: any answer stands. */
export const NO_EXPECTATION: Expectation<unknown> = { exists: false };

/**
 * Whether what the page holds of a file does not go with the board: "no such
 * file" for a file that the board says exists, or a copy of another run of
 * the job. Such a file is asked for again, and not only when the next
 * snapshot comes, which can be eight hours away.
 */
export function outOfStep<T>(state: PublishedState<T>, expected: Expectation<T>): boolean {
  if (state.status === 'missing') return expected.exists;
  return state.status === 'ready' && (expected.behind?.(state.data) ?? false);
}

/**
 * The state as a view is shown it. "No such file" for a file that the board
 * says exists is not the answer that the file is not published yet. It is a
 * failure, with the status that the server gave and a button to try again.
 */
export function shownState<T>(state: PublishedState<T>, expected: Expectation<T>): PublishedState<T> {
  if (state.status !== 'missing' || !expected.exists) return state;
  return { status: 'error', error: { kind: 'http', status: 404 }, refreshing: state.refreshing };
}

export function publishedReducer<T>(state: PublishedState<T>, action: PublishedAction<T>): PublishedState<T> {
  switch (action.type) {
    case 'asked':
      // The first request shows the spinner. A later one leaves on screen what is there.
      if (state.status === 'idle' || state.status === 'loading') return LOADING;
      return state.refreshing ? state : { ...state, refreshing: true };
    case 'answered': {
      const { fetched } = action;
      if (fetched.status === 'ok') return { status: 'ready', data: fetched.value, refreshing: false };
      // The file that is on screen stays there when asking again fails. A
      // published file is never taken away, so "no such file" after the file
      // itself is a failure of the server as well.
      if (state.status === 'ready') return { ...state, refreshing: false };
      if (fetched.status === 'missing') return { status: 'missing', refreshing: false };
      // "No such file" was an answer, and it stands until a better one arrives.
      if (state.status === 'missing') return { ...state, refreshing: false };
      return { status: 'error', error: fetched.error, refreshing: false };
    }
  }
}
