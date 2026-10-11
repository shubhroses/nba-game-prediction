import { useMemo } from 'react';
import type { Board } from '../data/board';
import { expectedRecord } from '../data/expected';
import { parseRecord, type SeasonRecord } from '../data/record';
import { usePublished, type Published } from './usePublished';

/**
 * The record so far, `record.json`. It is asked for again when the board has
 * a newer snapshot, and while its counts of picks won and lost are not the
 * ones that the board carries.
 */
export function useRecord(board: Board): Published<SeasonRecord> {
  const expected = useMemo(() => expectedRecord(board), [board]);
  return usePublished('record.json', parseRecord, board, expected);
}
