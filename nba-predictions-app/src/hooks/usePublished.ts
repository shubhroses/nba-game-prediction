import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Board } from '../data/board';
import { IDLE, NO_EXPECTATION, outOfStep, shownState, type Expectation, type PublishedState } from '../data/publishedState';
import { publishedStore } from '../data/publishedStore';
import type { Parse } from '../data/shape';

/** The state of a published file, and a way to ask for it again after a failure. */
export type Published<T> = PublishedState<T> & { retry: () => void };

const nothingToFollow = () => () => {};

/**
 * Loads one published file other than the board, by its path under the
 * prefix, and checks it with `parse`. A null path asks for nothing.
 *
 * The file is asked for again when the board has a newer snapshot: the files
 * change when the job runs, and a new snapshot is how the page learns that
 * it has. When asking again fails, the file that is on screen stays there.
 *
 * `expected` says what the board lets the page expect of the file. An answer
 * that does not go with it, a copy of an earlier run of the job or "no such
 * file" for a file that the board says exists, is asked for again past the
 * browser's own copy: once when it arrives, and then with every check of the
 * board until the two go together. "No such file" for a file that exists is
 * shown as the failure it is.
 *
 * Every component that asks for a path shares its state and its request, and
 * a view that is opened a second time has the file at once.
 */
export function usePublished<T>(
  path: string | null,
  parse: Parse<T>,
  board: Board,
  expected: Expectation<T> = NO_EXPECTATION,
): Published<T> {
  const refreshKey = board.generated_at;

  // The check may be a new function at every render, and that alone is no reason to ask again.
  const latest = useRef(parse);
  useEffect(() => {
    latest.current = parse;
  });
  const check = useCallback<Parse<T>>((value) => latest.current(value), []);

  const subscribe = useMemo(
    () => (path === null ? nothingToFollow : (listener: () => void) => publishedStore.subscribe(path, listener)),
    [path],
  );
  const held = useSyncExternalStore(subscribe, () => (path === null ? IDLE : publishedStore.stateOf<T>(path)));

  useEffect(() => {
    if (path !== null) publishedStore.want(path, check, refreshKey);
  }, [path, check, refreshKey]);

  // Every check of the board hands the page a new board, also when nothing in it has changed. So this runs when an
  // answer turns out not to go with the board, and once more for each check while that lasts.
  const again = outOfStep(held, expected);
  useEffect(() => {
    if (path !== null && again) publishedStore.want(path, check, refreshKey, true);
  }, [path, check, refreshKey, again, board]);

  const retry = useCallback(() => {
    if (path !== null) publishedStore.want(path, check, refreshKey, true);
  }, [path, check, refreshKey]);

  const { exists } = expected;
  return useMemo(() => ({ ...shownState(held, { exists }), retry }), [held, exists, retry]);
}
