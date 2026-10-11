import { useMemo } from 'react';
import type { Board } from '../data/board';
import { expectedPredictions } from '../data/expected';
import { parsePredictions, parsePredictionsOf, predictionsPath, type DayPredictions } from '../data/predictions';
import { isDay } from '../data/shape';
import { usePublished, type Published } from './usePublished';

/**
 * The forecasts that were frozen on the morning of one day,
 * `predictions/YYYY-MM-DD.json`. The day is the day of its games, as
 * display/day.ts works it out. Null, or anything that is not a date, asks
 * for nothing. A day without a game to forecast has no file, and the state
 * is then `missing`. For a day that the board carries a forecast of, the
 * file exists: "no such file" is then a failure, and the file is asked for
 * again with every check of the board. The file is also asked for again
 * when the board has a newer snapshot.
 */
export function usePredictions(board: Board, day: string | null): Published<DayPredictions> {
  const asked = day !== null && isDay(day) ? day : null;
  const parse = useMemo(() => (asked === null ? parsePredictions : parsePredictionsOf(asked)), [asked]);
  const expected = useMemo(() => expectedPredictions(board, asked), [board, asked]);
  return usePublished(asked === null ? null : predictionsPath(asked), parse, board, expected);
}
