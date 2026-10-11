import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_URL, fetchBoard } from './fetchBoard';

const BOARD = {
  schema: 1,
  sport: 'basketball_nba',
  generated_at: '2026-10-20T16:12:00Z',
  slot: '2026-10-20T12:10-04:00',
  next_due: '2026-10-20T15:10-04:00',
  games: [],
};

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** The address the module works out when it is loaded with this value of the build variable. */
async function boardUrlBuiltWith(dataBaseUrl: string): Promise<string> {
  vi.stubEnv('VITE_DATA_BASE_URL', dataBaseUrl);
  vi.resetModules();
  return (await import('./fetchBoard')).BOARD_URL;
}

describe('BOARD_URL', () => {
  it('is the board on the data branch when the build sets nothing', async () => {
    expect(await boardUrlBuiltWith('')).toBe(
      'https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1/slate.json',
    );
  });

  it('follows VITE_DATA_BASE_URL, with or without a slash at its end', async () => {
    const rehearsal = 'https://raw.githubusercontent.com/shubhroses/nba-game-prediction/data/v1-dryrun';

    expect(await boardUrlBuiltWith(rehearsal)).toBe(`${rehearsal}/slate.json`);
    expect(await boardUrlBuiltWith('http://127.0.0.1:8000/v1/')).toBe('http://127.0.0.1:8000/v1/slate.json');
  });
});

describe('fetchBoard', () => {
  it('makes one request, without credentials or extra headers', async () => {
    const fetch = answerWith(JSON.stringify(BOARD));

    await fetchBoard(never);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(BOARD_URL, { signal: expect.any(AbortSignal) });
  });

  it('returns the board', async () => {
    answerWith(JSON.stringify(BOARD));

    expect(await fetchBoard(never)).toEqual({ ok: true, board: BOARD });
  });

  it.each([404, 429, 503])('reports HTTP %i as an answer from the server', async (status) => {
    answerWith('Not Found', status);

    expect(await fetchBoard(never)).toEqual({ ok: false, error: { kind: 'http', status } });
  });

  it('reports a request that fails as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await fetchBoard(never)).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('reports a body that is not JSON as a wrong shape', async () => {
    answerWith('<!doctype html>');

    expect(await fetchBoard(never)).toEqual({ ok: false, error: { kind: 'shape', problem: 'the file is not JSON' } });
  });

  it('reports JSON that is not a board as a wrong shape, with what is wrong', async () => {
    answerWith(JSON.stringify({ ...BOARD, schema: 2 }));

    expect(await fetchBoard(never)).toEqual({ ok: false, error: { kind: 'shape', problem: 'schema should be 1' } });
  });

  it('gives the request up when the caller aborts', async () => {
    const fetch = neverAnswer();
    const caller = new AbortController();

    const result = fetchBoard(caller.signal);
    caller.abort();

    expect(await result).toEqual({ ok: false, error: { kind: 'network' } });
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
  });

  it('does not wait for an answer when the caller has already aborted', async () => {
    neverAnswer();
    const caller = new AbortController();
    caller.abort();

    expect(await fetchBoard(caller.signal)).toEqual({ ok: false, error: { kind: 'network' } });
  });

  it('gives the request up after 15 seconds', async () => {
    vi.useFakeTimers();
    neverAnswer();

    const result = fetchBoard(never);
    await vi.advanceTimersByTimeAsync(14_999);
    const settled = vi.fn();
    void result.then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ok: false, error: { kind: 'network' } });
  });
});
