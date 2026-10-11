import type { Board } from './board';
import type { LoadError } from './fetchBoard';

/**
 * What the page knows about the board. `refreshing` is true while a check is
 * under way and something other than the first spinner is on screen.
 */
export type BoardState =
  | { status: 'loading'; refreshing: false }
  | { status: 'ready'; board: Board; fetchedAt: number; refreshing: boolean }
  | { status: 'error'; error: LoadError; refreshing: boolean };

export type BoardAction =
  | { type: 'check_started' }
  | { type: 'check_succeeded'; board: Board; at: number }
  | { type: 'check_failed'; error: LoadError };

export const INITIAL_STATE: BoardState = { status: 'loading', refreshing: false };

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'check_started':
      return state.status === 'loading' ? state : { ...state, refreshing: true };
    case 'check_succeeded':
      // The host keeps a copy of the board for five minutes in more than one place, and the copies are not of one age.
      // A check that is answered with an older board than the one on screen has learned nothing, and the newer one
      // stays. A time is written the same way in every board, so the later one is the greater text.
      if (state.status === 'ready' && action.board.generated_at < state.board.generated_at) return { ...state, refreshing: false };
      return { status: 'ready', board: action.board, fetchedAt: action.at, refreshing: false };
    case 'check_failed':
      // A board that is on screen stays there when a later check fails: odds
      // shown with their time are more use to a visitor than an error.
      return state.status === 'ready'
        ? { ...state, refreshing: false }
        : { status: 'error', error: action.error, refreshing: false };
  }
}
