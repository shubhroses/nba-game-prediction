/**
 * What the board lets the page expect of the record, the ratings and a
 * forecasts file: whether the file exists, and how a copy of another run of
 * the job is told from one that goes with the board.
 *
 * The job commits all of its files at once. The host of the data branch then
 * keeps a copy of each file by itself, for five minutes, and it keeps "no
 * such file" as long. So in the minutes after a daily run the page can get
 * the new board next to yesterday's record, or be told that the forecasts of
 * the morning do not exist.
 */
import { predictionDays } from '../display/day';
import type { Board, Tally } from './board';
import type { ModelRatings } from './model';
import type { DayPredictions } from './predictions';
import type { Expectation } from './publishedState';
import type { SeasonRecord } from './record';

function sameTally(onBoard: Tally | null, inRecord: Tally | null): boolean {
  if (onBoard === null || inRecord === null) return onBoard === inRecord;
  return onBoard.wins === inRecord.wins && onBoard.losses === inRecord.losses;
}

/**
 * The record is rebuilt by every daily run, which notes the picks won and
 * lost of each source on the board as well. A record with other counts than
 * the board's is of another run. The file exists from the first daily run
 * on, which is when the board first carries a record.
 */
export function expectedRecord(board: Board): Expectation<SeasonRecord> {
  const { record } = board;
  if (record === null) return { exists: false };
  return {
    exists: true,
    behind: (file) =>
      !sameTally(record.market, file.market) || !sameTally(record.elo, file.elo) || !sameTally(record.points_rest, file.points_rest),
  };
}

/**
 * The ratings are rebuilt by every daily run, which notes on the board the
 * day of the last result it replayed and whether the results passed its
 * checks. A file that says otherwise of either is of another run. The file
 * exists whenever the board carries what its forecasts rest on.
 */
export function expectedModel(board: Board): Expectation<ModelRatings> {
  const { models } = board;
  if (models === null) return { exists: false };
  return {
    exists: true,
    behind: (file) => file.results_through !== models.results_through || file.status !== models.status,
  };
}

/**
 * A forecasts file is written once and never changed, so a copy of it cannot
 * be behind. It exists for the days that the board carries a forecast of.
 */
export function expectedPredictions(board: Board, day: string | null): Expectation<DayPredictions> {
  return { exists: day !== null && predictionDays(board).includes(day) };
}
