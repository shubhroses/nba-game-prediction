import { useCallback, useEffect, useReducer, useRef } from 'react';
import { boardReducer, INITIAL_STATE, type BoardState } from '../data/boardState';
import { fetchBoard } from '../data/fetchBoard';

/** The host of the data branch caches a file for five minutes, so asking more often gains nothing. */
const RECHECK_MS = 5 * 60 * 1000;
const NETWORK_RETRY_MS = 2000;

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
 * Loads the board when the page opens and checks for a newer one every five
 * minutes while the tab is visible. A check that came due while the tab was
 * hidden is made when the tab is shown again.
 */
export function useBoard(): { state: BoardState; checkNow: () => void } {
  const [state, dispatch] = useReducer(boardReducer, INITIAL_STATE);
  const check = useRef(() => {});

  useEffect(() => {
    const unmounted = new AbortController();
    const { signal } = unmounted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let checking = false;
    let dueWhileHidden = false;

    async function runCheck() {
      if (checking) return;
      checking = true;
      clearTimeout(timer);
      dispatch({ type: 'check_started' });

      let result = await fetchBoard(signal);
      if (!result.ok && result.error.kind === 'network' && !signal.aborted) {
        await pause(NETWORK_RETRY_MS, signal);
        if (!signal.aborted) result = await fetchBoard(signal);
      }
      if (signal.aborted) return;

      checking = false;
      dispatch(
        result.ok
          ? { type: 'check_succeeded', board: result.board, at: Date.now() }
          : { type: 'check_failed', error: result.error },
      );
      timer = setTimeout(recheck, RECHECK_MS);
    }

    function recheck() {
      if (document.visibilityState === 'visible') void runCheck();
      else dueWhileHidden = true;
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && dueWhileHidden) {
        dueWhileHidden = false;
        void runCheck();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    check.current = () => void runCheck();
    void runCheck();

    return () => {
      unmounted.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const checkNow = useCallback(() => check.current(), []);
  return { state, checkNow };
}
