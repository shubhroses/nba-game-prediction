/**
 * Why a game on the board has no forecast of the points-and-rest model. The
 * model forecasts a game on the morning of its day and not before, so most
 * games on the board have none yet, and the page says which of the reasons
 * it is.
 */
import type { Board, BoardGame } from '../data/board';
import { gameDay } from './day';

/**
 * - `not-built`: the models have not been built once, or the sport is not
 *   forecast. Elo has no chance for the game either.
 * - `not-yet`: the game is of a later day, whose morning is still to come.
 * - `left-out`: the forecasts of the game's day are frozen without this
 *   model, because the results did not pass the job's checks that morning.
 * - `none`: the morning of the game's day has come and the board holds no
 *   forecast for the game. The job did not know of the game that morning,
 *   or its daily work was not done.
 */
export type MissingPointsRest = 'not-built' | 'not-yet' | 'left-out' | 'none';

/** Null when the board holds the forecast. */
export function missingPointsRest(game: BoardGame, board: Board): MissingPointsRest | null {
  if (game.points_rest !== null) return null;
  if (board.models === null) return 'not-built';

  const day = gameDay(game.commence_time);
  if (board.models.predictions_day === day) return board.models.status === 'degraded' ? 'left-out' : 'none';

  // A slot is a New York time. The first slot of a date is the one of the
  // daily work, so the date of any slot is a day whose morning has come.
  const morningHasCome = day <= board.slot.slice(0, 10);
  return morningHasCome ? 'none' : 'not-yet';
}
