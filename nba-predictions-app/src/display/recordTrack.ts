/**
 * Where an interval and the number it is around lie on a track. The record
 * view draws two kinds: the track under a share of wins, which runs from 0%
 * to 100%, and the track under a difference between two scores, which has
 * zero in its middle.
 */

/** A track is drawn this many units long and stretched to the width of its container. */
export const TRACK_LENGTH = 200;

export interface TrackMarks {
  /** Where the interval starts and how long it is. Null when there is none. */
  span: { x: number; width: number } | null;
  /** Where the number itself lies. Null when there is none. */
  point: number | null;
}

const hundredth = (units: number) => Math.round(units * 100) / 100;

/**
 * The place of a number on a track that runs from `from` to `to`, to a
 * hundredth of a unit. A number beyond an end is put at that end.
 */
export function onTrack(value: number, from: number, to: number): number {
  const share = (value - from) / (to - from);
  return hundredth(Math.min(1, Math.max(0, share)) * TRACK_LENGTH);
}

/** The marks of a number and its interval on a track that runs from `from` to `to`. */
export function trackMarks(
  from: number,
  to: number,
  point: number | null,
  interval: readonly [number, number] | null,
): TrackMarks {
  let span: TrackMarks['span'] = null;
  if (interval !== null) {
    const x = onTrack(interval[0], from, to);
    span = { x, width: hundredth(onTrack(interval[1], from, to) - x) };
  }
  return { span, point: point === null ? null : onTrack(point, from, to) };
}

/** The two parts of a bar that is shared out between two counts. */
export interface SharedBar {
  left: { x: number; width: number };
  right: { x: number; width: number };
}

// What is left open between the two parts, so that they are told apart by more than their colors, and the
// least that a part is long, so that a count of one among hundreds can still be seen.
const BAR_GAP = 2;
const LEAST_PART = 2;

/**
 * A bar of the length of a track, shared out between two counts: the left
 * part is as long as the first count's share of the two. A count of none has
 * a part of no length, and the other part is then the whole bar. Null when
 * both counts are none.
 */
export function sharedBar(first: number, second: number): SharedBar | null {
  if (first + second <= 0) return null;

  const share = (first / (first + second)) * TRACK_LENGTH;
  if (first === 0 || second === 0) {
    return { left: { x: 0, width: share }, right: { x: share, width: TRACK_LENGTH - share } };
  }

  const nearest = BAR_GAP / 2 + LEAST_PART;
  const boundary = Math.min(TRACK_LENGTH - nearest, Math.max(nearest, share));
  const start = hundredth(boundary + BAR_GAP / 2);
  return {
    left: { x: 0, width: hundredth(boundary - BAR_GAP / 2) },
    right: { x: start, width: hundredth(TRACK_LENGTH - start) },
  };
}

// The files write a score with four decimals, so the reach is counted in whole ten-thousandths.
const UNIT = 10_000;
const LEAST_REACH = 100;

/**
 * How far from zero the track of a difference has to reach to hold every
 * number it is given: the largest of them, rounded up to one digit, so that
 * the two ends of the track are numbers that can be read. 0.027 gives 0.03.
 * It is never less than 0.01, so that a difference of next to nothing is
 * drawn next to zero.
 */
export function reachOf(values: readonly (number | null)[]): number {
  const largest = Math.max(0, ...values.filter((value) => value !== null).map((value) => Math.round(Math.abs(value) * UNIT)));
  if (largest <= LEAST_REACH) return LEAST_REACH / UNIT;

  const digit = 10 ** (String(largest).length - 1);
  return (Math.ceil(largest / digit) * digit) / UNIT;
}
