/**
 * The invented season of nba-predictions-app/sample-data, read from the
 * files themselves and checked with the shape checks of the page: the board
 * of Sunday 8 November 2026, the record and the ratings that go with it, and
 * the forecasts of the nine days that the board shows a game of. Nothing in
 * it happened. sample-data/README.md says which game shows which state. Only
 * tests import this file.
 */
import { parseBoard, type Board } from './board';
import { parseModel, type ModelRatings } from './model';
import { parsePredictionsOf, predictionsPath, type DayPredictions } from './predictions';
import { parseRecord, type SeasonRecord } from './record';
import type { Parse } from './shape';

const PREFIX = '../../sample-data/v1/';

/**
 * The text of every file of the sample, by its path under the prefix, which
 * is how the page asks for a file: `slate.json`, `predictions/2026-11-08.json`.
 */
export const SAMPLE_FILES: ReadonlyMap<string, string> = new Map(
  Object.entries(
    import.meta.glob<string>('../../sample-data/v1/**/*', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.slice(PREFIX.length), text]),
);

/**
 * The moment the sample is looked at, twenty minutes after its last
 * snapshot. A build that previews the sample sets it as VITE_DATA_NOW, and a
 * test hands it to a view's logic as `now`.
 */
export const SAMPLE_NOW = Date.parse('2026-11-08T23:30:00Z');

/** A file of the sample as the page would hold it. It is read anew at every call, so a test may change what it gets. */
function read<T>(path: string, parse: Parse<T>): T {
  const text = SAMPLE_FILES.get(path);
  if (text === undefined) throw new Error(`The sample has no ${path}`);

  const parsed = parse(JSON.parse(text));
  if (!parsed.ok) throw new Error(`${path} of the sample: ${parsed.problem}`);
  return parsed.value;
}

/** The board of the last snapshot, of 18:10 in New York on Sunday 8 November. */
export function sampleBoard(): Board {
  return read('slate.json', parseBoard);
}

/** The record after the results of Saturday 7 November. */
export function sampleRecord(): SeasonRecord {
  return read('record.json', parseRecord);
}

/** Where the two models stand after the results of Saturday 7 November. */
export function sampleModel(): ModelRatings {
  return read('model.json', parseModel);
}

/** The forecasts that were frozen on the morning of one day, from 2026-10-31 to 2026-11-08. */
export function samplePredictions(day: string): DayPredictions {
  return read(predictionsPath(day), parsePredictionsOf(day));
}
