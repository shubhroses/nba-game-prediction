import { describe, expect, it } from 'vitest';
import {
  IDLE,
  LOADING,
  NO_EXPECTATION,
  outOfStep,
  publishedReducer,
  shownState,
  type Expectation,
  type PublishedAction,
  type PublishedState,
} from './publishedState';

type File = { games: number };

const OLD: File = { games: 4 };
const NEW: File = { games: 9 };

const ready: PublishedState<File> = { status: 'ready', data: OLD, refreshing: false };
const missing: PublishedState<File> = { status: 'missing', refreshing: false };
const failed: PublishedState<File> = { status: 'error', error: { kind: 'network' }, refreshing: false };

const reduce = (state: PublishedState<File>, action: PublishedAction<File>) => publishedReducer(state, action);
const asked = (state: PublishedState<File>) => reduce(state, { type: 'asked' });

describe('publishedReducer', () => {
  it('starts with nothing asked for, or on the first spinner', () => {
    expect(IDLE).toEqual({ status: 'idle', refreshing: false });
    expect(LOADING).toEqual({ status: 'loading', refreshing: false });
    expect(asked(IDLE)).toEqual(LOADING);
  });

  it('stays on the first spinner while the first request runs', () => {
    expect(asked(LOADING)).toBe(LOADING);
  });

  it('shows the file of the first request', () => {
    expect(reduce(LOADING, { type: 'answered', fetched: { status: 'ok', value: OLD } })).toEqual(ready);
  });

  it('says that there is no such file, which is an answer and not a failure', () => {
    expect(reduce(LOADING, { type: 'answered', fetched: { status: 'missing' } })).toEqual(missing);
  });

  it('reports why the first request failed', () => {
    const fetched = { status: 'failed', error: { kind: 'http', status: 503 } } as const;

    expect(reduce(LOADING, { type: 'answered', fetched })).toEqual({
      status: 'error',
      error: { kind: 'http', status: 503 },
      refreshing: false,
    });
  });

  it('keeps the file on screen while it is asked for again', () => {
    expect(asked(ready)).toEqual({ status: 'ready', data: OLD, refreshing: true });
  });

  it('changes nothing when it is told twice that the file is asked for', () => {
    const refreshing = asked(ready);

    expect(asked(refreshing)).toBe(refreshing);
  });

  it('replaces the file when asking again brings a new one', () => {
    expect(reduce(asked(ready), { type: 'answered', fetched: { status: 'ok', value: NEW } })).toEqual({
      status: 'ready',
      data: NEW,
      refreshing: false,
    });
  });

  it.each([
    { status: 'failed', error: { kind: 'network' } },
    { status: 'failed', error: { kind: 'http', status: 503 } },
    { status: 'failed', error: { kind: 'shape', problem: 'schema should be 1' } },
    { status: 'missing' },
  ] as const)('keeps the last good file when asking again comes to $status', (fetched) => {
    expect(reduce(asked(ready), { type: 'answered', fetched })).toEqual(ready);
  });

  it('keeps saying that there is no such file when asking again fails', () => {
    expect(asked(missing)).toEqual({ status: 'missing', refreshing: true });
    expect(reduce(asked(missing), { type: 'answered', fetched: { status: 'failed', error: { kind: 'network' } } })).toEqual(missing);
  });

  it('shows a file that was not there before once it is', () => {
    expect(reduce(asked(missing), { type: 'answered', fetched: { status: 'ok', value: NEW } })).toEqual({
      status: 'ready',
      data: NEW,
      refreshing: false,
    });
  });

  it('keeps the error on screen while another attempt runs, and leaves it for the file when that succeeds', () => {
    expect(asked(failed)).toEqual({ status: 'error', error: { kind: 'network' }, refreshing: true });
    expect(reduce(asked(failed), { type: 'answered', fetched: { status: 'ok', value: OLD } })).toEqual(ready);
  });

  it('shows the latest reason when another attempt fails', () => {
    const fetched = { status: 'failed', error: { kind: 'http', status: 429 } } as const;

    expect(reduce(asked(failed), { type: 'answered', fetched })).toEqual({
      status: 'error',
      error: { kind: 'http', status: 429 },
      refreshing: false,
    });
  });
});

describe('outOfStep', () => {
  /** The board says that the file exists and that its latest copy has nine games. */
  const expected: Expectation<File> = { exists: true, behind: (file) => file.games !== NEW.games };

  it('is true of a copy of another run of the job than the board, and not of the copy that goes with it', () => {
    expect(outOfStep(ready, expected)).toBe(true);
    expect(outOfStep({ status: 'ready', data: NEW, refreshing: false }, expected)).toBe(false);
  });

  it('is true of "no such file" for a file that the board says exists', () => {
    expect(outOfStep(missing, expected)).toBe(true);
    expect(outOfStep(missing, { exists: false })).toBe(false);
  });

  it('is not true while nothing is known of the file, or of a failure, which has its own button', () => {
    expect(outOfStep(IDLE as PublishedState<File>, expected)).toBe(false);
    expect(outOfStep(LOADING as PublishedState<File>, expected)).toBe(false);
    expect(outOfStep(failed, expected)).toBe(false);
  });

  it('lets any answer stand where the board says nothing of the file', () => {
    expect(outOfStep(ready, NO_EXPECTATION)).toBe(false);
    expect(outOfStep(missing, NO_EXPECTATION)).toBe(false);
    // A file that never changes has no copy that is behind.
    expect(outOfStep(ready, { exists: true })).toBe(false);
  });
});

describe('shownState', () => {
  it('shows "no such file" for a file that the board says exists as the failure it is, with the status of the server', () => {
    expect(shownState(missing, { exists: true })).toEqual({ status: 'error', error: { kind: 'http', status: 404 }, refreshing: false });
    expect(shownState({ status: 'missing', refreshing: true }, { exists: true })).toMatchObject({ status: 'error', refreshing: true });
  });

  it('lets "no such file" stand as an answer where the board does not say that the file exists', () => {
    expect(shownState(missing, { exists: false })).toBe(missing);
    expect(shownState(missing, NO_EXPECTATION)).toBe(missing);
  });

  it('leaves every other state as it is', () => {
    for (const state of [ready, failed, IDLE as PublishedState<File>, LOADING as PublishedState<File>]) {
      expect(shownState(state, { exists: true })).toBe(state);
    }
  });
});
