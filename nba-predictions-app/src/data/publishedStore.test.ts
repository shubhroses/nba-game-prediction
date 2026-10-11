import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublishedStore } from './publishedStore';
import type { Parse } from './shape';

type File = { games: number };

const RECORD = 'record.json';
const MORNING = '2026-10-21T09:10:07Z';
const NOON = '2026-10-21T16:10:12Z';

/** A stand-in for the shape check of a file: it takes an object with a whole number of games. */
const parse: Parse<File> = (value) =>
  typeof value === 'object' && value !== null && 'games' in value && Number.isInteger(value.games)
    ? { ok: true, value: { games: value.games as number } }
    : { ok: false, problem: 'games should be a whole number' };

/** Lets everything that is ready to run do so. The answer of a request reaches the store within a few turns. */
async function settle() {
  for (let turn = 0; turn < 5; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Stands in for the browser's fetch. Each request waits until the test
 * answers it, so that the test can look at the store while it is under way.
 */
function heldRequests() {
  const waiting: ((response: Response) => void)[] = [];
  /** The files that were asked for, by their names. */
  const asked: string[] = [];
  /** For each request, whether it was made past the copy that the browser keeps. */
  const fresh: boolean[] = [];
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    asked.push(url.slice(url.lastIndexOf('/') + 1));
    fresh.push(init?.cache === 'no-cache');
    return new Promise<Response>((resolve) => waiting.push(resolve));
  });
  vi.stubGlobal('fetch', fetch);

  /** Answers the oldest request that is waiting and lets the store take the answer in. */
  async function answer(body: unknown, status = 200) {
    const respond = waiting.shift();
    if (!respond) throw new Error('no request is waiting');
    respond(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
    await settle();
  }

  return { fetch, asked, fresh, answer };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a published store', () => {
  it('shows the first spinner for a file until its first answer', async () => {
    const { answer } = heldRequests();
    const store = createPublishedStore();

    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'loading', refreshing: false });
    store.want(RECORD, parse, MORNING);
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'loading', refreshing: false });

    await answer({ games: 4 });
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: false });
  });

  it('hands out the same state object until something changes', async () => {
    const { answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });

    const state = store.stateOf<File>(RECORD);
    store.want(RECORD, parse, MORNING);

    expect(store.stateOf<File>(RECORD)).toBe(state);
  });

  it('makes one request, however many components ask for the file', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();

    store.want(RECORD, parse, MORNING);
    store.want(RECORD, parse, MORNING);
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not ask again for a file it has under the same refresh key', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });

    store.want(RECORD, parse, MORNING);
    await settle();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not ask again for a file that is not there, under the same refresh key', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    store.want('predictions/2026-10-19.json', parse, MORNING);
    await answer('404: Not Found', 404);

    store.want('predictions/2026-10-19.json', parse, MORNING);
    await settle();

    expect(store.stateOf<File>('predictions/2026-10-19.json')).toEqual({ status: 'missing', refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks again when the refresh key changes, and keeps the file on screen meanwhile', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });

    store.want(RECORD, parse, NOON);
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: true });

    await answer({ games: 9 });
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 9 }, refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good file when asking again fails, and asks once more when the file is wanted again', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });

    store.want(RECORD, parse, NOON);
    await answer('busy', 503);
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: false });

    // The view is opened again: the file was not answered under this key, so it is asked for.
    store.want(RECORD, parse, NOON);
    await answer({ games: 9 });
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 9 }, refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports a failure, and tries again when asked to', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 'four' });
    expect(store.stateOf<File>(RECORD)).toEqual({
      status: 'error',
      error: { kind: 'shape', problem: 'games should be a whole number' },
      refreshing: false,
    });

    store.want(RECORD, parse, MORNING, true);
    expect(store.stateOf<File>(RECORD)).toMatchObject({ status: 'error', refreshing: true });
    await answer({ games: 4 });

    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks again on "Try again" even for a file it has', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });

    store.want(RECORD, parse, MORNING, true);
    await answer({ games: 5 });

    expect(store.stateOf<File>(RECORD)).toMatchObject({ data: { games: 5 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks past the copy of the browser when it asks again, and not the first time or for a newer snapshot', async () => {
    const { fresh, answer } = heldRequests();
    const store = createPublishedStore();

    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });
    // The answer was of another run of the job than the board: the browser's own copy of it must not answer again.
    store.want(RECORD, parse, MORNING, true);
    await answer({ games: 9 });
    store.want(RECORD, parse, NOON);
    await answer({ games: 9 });

    expect(fresh).toEqual([false, true, false]);
  });

  it('asks again for a file that was not there, when told to, and takes the file in', async () => {
    const { fetch, fresh, answer } = heldRequests();
    const store = createPublishedStore();
    store.want(RECORD, parse, MORNING);
    await answer('404: Not Found', 404);
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'missing', refreshing: false });

    store.want(RECORD, parse, MORNING, true);
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'missing', refreshing: true });
    await answer({ games: 4 });

    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fresh).toEqual([false, true]);
  });

  it('ends a request whose check throws as a failure that can be tried again, and not as a spinner for good', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();
    let faulty = true;
    const check: Parse<File> = (value) => {
      if (faulty) throw new TypeError('Object.hasOwn is not a function');
      return parse(value);
    };

    store.want('model.json', check, MORNING);
    await answer({ games: 4 });
    expect(store.stateOf<File>('model.json')).toEqual({
      status: 'error',
      error: { kind: 'shape', problem: 'the check of the file could not be run: Object.hasOwn is not a function' },
      refreshing: false,
    });

    // The store is not left with a request that it believes to be under way.
    faulty = false;
    store.want('model.json', check, MORNING, true);
    await answer({ games: 4 });
    expect(store.stateOf<File>('model.json')).toEqual({ status: 'ready', data: { games: 4 }, refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks under the newer refresh key once a request that was under way is answered', async () => {
    const { fetch, answer } = heldRequests();
    const store = createPublishedStore();

    store.want(RECORD, parse, MORNING);
    store.want(RECORD, parse, NOON);
    expect(fetch).toHaveBeenCalledTimes(1);

    await answer({ games: 4 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: true });

    await answer({ games: 9 });
    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 9 }, refreshing: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the files apart', async () => {
    const { asked, answer } = heldRequests();
    const store = createPublishedStore();

    store.want(RECORD, parse, MORNING);
    store.want('model.json', parse, MORNING);
    expect(asked).toEqual(['record.json', 'model.json']);

    await answer({ games: 4 });
    expect(store.stateOf<File>(RECORD)).toMatchObject({ status: 'ready' });
    expect(store.stateOf<File>('model.json')).toEqual({ status: 'loading', refreshing: false });
  });

  it('tells its listeners of every change, and no longer once they have stopped', async () => {
    const { answer } = heldRequests();
    const store = createPublishedStore();
    const seen: string[] = [];
    const stop = store.subscribe(RECORD, () => seen.push(store.stateOf<File>(RECORD).status));
    const other = vi.fn();
    store.subscribe('model.json', other);

    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });
    store.want(RECORD, parse, NOON);
    await answer({ games: 9 });
    expect(seen).toEqual(['ready', 'ready', 'ready']);

    stop();
    store.want(RECORD, parse, MORNING);
    await answer({ games: 4 });
    expect(seen).toHaveLength(3);
    expect(other).not.toHaveBeenCalled();
  });

  it('takes an answer in when nobody is listening any more, for whoever shows the file next', async () => {
    const { answer } = heldRequests();
    const store = createPublishedStore();
    const stop = store.subscribe(RECORD, () => {});

    store.want(RECORD, parse, MORNING);
    stop();
    await answer({ games: 4 });

    expect(store.stateOf<File>(RECORD)).toEqual({ status: 'ready', data: { games: 4 }, refreshing: false });
  });
});
