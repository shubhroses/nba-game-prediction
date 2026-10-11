import { useMemo } from 'react';
import type { Board } from '../data/board';
import { expectedModel } from '../data/expected';
import { parseModel, type ModelRatings } from '../data/model';
import { usePublished, type Published } from './usePublished';

/**
 * The ratings of the two models, `model.json`. It is asked for again when the
 * board has a newer snapshot, and while it is of another daily run than the
 * board.
 *
 * A board without `models` has no such file to go with it: the models were
 * never built, or the sport is not forecast. Asking all the same would be
 * answered with "no such file", which a browser writes to its console as an
 * error, so nothing is asked for then and the state stays `idle`.
 */
export function useModel(board: Board): Published<ModelRatings> {
  const expected = useMemo(() => expectedModel(board), [board]);
  return usePublished(board.models === null ? null : 'model.json', parseModel, board, expected);
}
