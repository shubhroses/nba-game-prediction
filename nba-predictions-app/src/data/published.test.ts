import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPublished, fetchPublishedTwice, publishedUrl } from './published';
import type { Parse } from './shape';

const DATA_BRANCH = 'https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1';

/** A stand-in for the shape check of a file: it takes an object with a whole number of games. */
const parse: Parse<{ games: number }> = (value) =>
  typeof value === 'object' && value !== null && 'games' in value && Number.isInteger(value.games)
    ? { ok: true, value: { games: value.games as number } }
    : { ok: false, problem: 'games should be a whole number' };

const never = new AbortController().signal;

/** Stands in for the browser's fetch and answers every request with one response. */
function answerWith(body: string, status = 200) {
  const fetch = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** A fetch that gets no answer and fails when its request is aborted, as the browser's does. */
function neverAnswer() {
  const fetch = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(new DOMException('aborted', 'AbortError'));
        if (init.signal?.aborted) fail();
        init.signal?.addEventListener('abort', fail);
      }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** A fetch that fails on the network as often as told and answers after that. */
function failThenAnswer(failures: number, body: string) {
  let asked = 0;
  const fetch = vi.fn(async () => {
    asked += 1;
    if (asked <= failures) throw new TypeError('Failed to fetch');
    return new Response(body);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('publishedUrl', () => {
  it('is under the prefix of the data branch when the build sets nothing', () => {
    expect(publishedUrl('record.json')).toBe(`${DATA_BRANCH}/record.json`);
    expect(publishedUrl('predictions/2026-10-21.json')).toBe(`${DATA_BRANCH}/predictions/2026-10-21.json`);
  });

  it('follows VITE_DATA_BASE_URL, which can be a path on the page\'s own server', async () => {
    vi.stubEnv('VITE_DATA_BASE_URL', '/sample-data/v1/');
    vi.resetModules();
    const rebuilt = await import('./published');

    expect(rebuilt.publishedUrl('model.json')).toBe('/sample-data/v1/model.json');
  });
});

describe('fetchPublished', () => {
  it('makes one request for the file, without credentials or extra headers', async () => {
    const fetch = answerWith('{"games": 4}');

    await fetchPublished('record.json', parse, never);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${DATA_BRANCH}/record.json`, { signal: expect.any(AbortSignal) });
  });

  it('returns the file as the shape check gives it', async () => {
    answerWith('{"games": 4, "more": true}');

    expect(await fetchPublished('record.json', parse, never)).toEqual({ status: 'ok', value: { games: 4 } });
  });

  it('tells a file that is not there apart from a failure', async () => {
    answerWith('404: Not Found', 404);

    expect(await fetchPublished('predictions/2026-10-19.json', parse, never)).toEqual({ status: 'missing' });
  });

  it.each([400, 403, 429, 500, 503])('reports HTTP %i as an answer from the server', async (status) => {
    answerWith('no', status);

    expect(await fetchPublished('record.json', parse, never)).toEqual({ status: 'failed', error: { kind: 'http', status } });
  });

  it('reports a request that fails as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await fetchPublished('record.json', parse, never)).toEqual({ status: 'failed', error: { kind: 'network' } });
  });

  it('reports a body that is not JSON as a wrong shape', async () => {
    answerWith('<!doctype html>');

    expect(await fetchPublished('record.json', parse, never)).toEqual({
      status: 'failed',
      error: { kind: 'shape', problem: 'the file is not JSON' },
    });
  });

  it('reports JSON of another shape with what the check says is wrong', async () => {
    answerWith('{"games": "four"}');

    expect(await fetchPublished('record.json', parse, never)).toEqual({
      status: 'failed',
      error: { kind: 'shape', problem: 'games should be a whole number' },
    });
  });

  it('reports a check that throws as a failed load, and does not throw itself', async () => {
    answerWith('{"games": 4}');
    // What a shape check does in a browser that lacks a function it calls.
    const faulty: Parse<{ games: number }> = () => {
      throw new TypeError('Object.hasOwn is not a function');
    };

    expect(await fetchPublished('model.json', faulty, never)).toEqual({
      status: 'failed',
      error: { kind: 'shape', problem: 'the check of the file could not be run: Object.hasOwn is not a function' },
    });
  });

  it('asks past the copy of the browser when told to, and not otherwise', async () => {
    const fetch = answerWith('{"games": 4}');

    await fetchPublished('record.json', parse, never, true);
    await fetchPublished('record.json', parse, never);

    expect(fetch).toHaveBeenNthCalledWith(1, `${DATA_BRANCH}/record.json`, { signal: expect.any(AbortSignal), cache: 'no-cache' });
    expect(fetch).toHaveBeenNthCalledWith(2, `${DATA_BRANCH}/record.json`, { signal: expect.any(AbortSignal) });
  });

  it('gives the request up when the caller aborts', async () => {
    const fetch = neverAnswer();
    const caller = new AbortController();

    const result = fetchPublished('record.json', parse, caller.signal);
    caller.abort();

    expect(await result).toEqual({ status: 'failed', error: { kind: 'network' } });
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('does not wait for an answer when the caller has already aborted', async () => {
    neverAnswer();
    const caller = new AbortController();
    caller.abort();

    expect(await fetchPublished('record.json', parse, caller.signal)).toEqual({ status: 'failed', error: { kind: 'network' } });
  });

  it('gives the request up after 15 seconds', async () => {
    vi.useFakeTimers();
    neverAnswer();

    const result = fetchPublished('record.json', parse, never);
    await vi.advanceTimersByTimeAsync(14_999);
    const settled = vi.fn();
    void result.then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: 'failed', error: { kind: 'network' } });
  });
});

describe('fetchPublishedTwice', () => {
  it('asks once when the server answers', async () => {
    const fetch = answerWith('{"games": 4}');

    expect(await fetchPublishedTwice('record.json', parse, never)).toEqual({ status: 'ok', value: { games: 4 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks a second time two seconds after a request that failed on the network', async () => {
    vi.useFakeTimers();
    const fetch = failThenAnswer(1, '{"games": 4}');

    const result = fetchPublishedTwice('record.json', parse, never);
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ status: 'ok', value: { games: 4 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not ask a third time', async () => {
    vi.useFakeTimers();
    const fetch = failThenAnswer(5, '{"games": 4}');

    const result = fetchPublishedTwice('record.json', parse, never);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await result).toEqual({ status: 'failed', error: { kind: 'network' } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a file that is not there', '404: Not Found', 404, { status: 'missing' }],
    ['an HTTP error', 'slow down', 429, { status: 'failed', error: { kind: 'http', status: 429 } }],
    ['a file of another shape', '{}', 200, { status: 'failed', error: { kind: 'shape', problem: 'games should be a whole number' } }],
  ])('does not ask again after %s', async (_what, body, status, expected) => {
    vi.useFakeTimers();
    const fetch = answerWith(body, status);

    const result = fetchPublishedTwice('record.json', parse, never);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await result).toEqual(expected);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('asks past the copy of the browser both times when told to', async () => {
    vi.useFakeTimers();
    const fetch = failThenAnswer(1, '{"games": 4}');

    const result = fetchPublishedTwice('record.json', parse, never, true);
    await vi.advanceTimersByTimeAsync(2000);

    expect(await result).toEqual({ status: 'ok', value: { games: 4 } });
    expect(fetch.mock.calls.map((call: unknown[]) => (call[1] as RequestInit).cache)).toEqual(['no-cache', 'no-cache']);
  });

  it('does not ask again once the caller has aborted', async () => {
    vi.useFakeTimers();
    const fetch = failThenAnswer(1, '{"games": 4}');
    const caller = new AbortController();

    const result = fetchPublishedTwice('record.json', parse, caller.signal);
    await vi.advanceTimersByTimeAsync(500);
    caller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await result).toEqual({ status: 'failed', error: { kind: 'network' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
