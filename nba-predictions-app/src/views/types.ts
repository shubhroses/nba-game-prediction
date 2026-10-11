import type { Board } from '../data/board';

/** What every view is given. A view is shown only once there is a board. */
export interface ViewProps {
  board: Board;
  /** The time by the page's clock, in milliseconds. It moves on every half minute. */
  now: number;
  /** True while a newer board is being checked for. */
  refreshing: boolean;
  /** What follows the view in the address, as in `#/results/2026-11-07`. Null when nothing does. */
  param: string | null;
}
