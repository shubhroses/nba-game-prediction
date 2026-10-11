/**
 * The curve that the How it works view draws of Elo's formula: the home
 * team's chance for every gap between two teams, from far behind to far
 * ahead. Everything is given as a share of the drawing, so that a component
 * can stretch it to any width.
 */
import { eloChance, eloChanceExact } from './methodElo';
import { signedPoints } from './numbers';
import { pickedSide, wholePercent } from './pick';

/** The largest gap the drawing shows, to either side: ten to one against, and ten to one on. */
export const CURVE_REACH = 400;

/** A place in the drawing: how far from its left end and how far from its top, each from 0 to 1. */
export interface CurvePoint {
  x: number;
  y: number;
}

/** Where a gap and the chance that goes with it lie in the drawing. No chance is at the very top or bottom. */
export function curvePoint(gap: number): CurvePoint {
  return { x: (gap + CURVE_REACH) / (2 * CURVE_REACH), y: 1 - eloChanceExact(gap, 0, 0) };
}

/** The curve as points at even steps of the gap, from the left end to the right end. */
export function eloCurve(steps = 40): CurvePoint[] {
  return Array.from({ length: steps + 1 }, (_, step) => curvePoint(-CURVE_REACH + (step * 2 * CURVE_REACH) / steps));
}

/**
 * The points as the path of an SVG drawing that is 100 wide and 100 high.
 * Two decimals are far finer than a screen shows.
 */
export function curvePath(points: readonly CurvePoint[]): string {
  return points.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`).join(' ');
}

/** The gaps that the drawing labels, from the left end to the right end. */
export const CURVE_GAPS = [-CURVE_REACH, -CURVE_REACH / 2, 0, CURVE_REACH / 2, CURVE_REACH] as const;

/**
 * The smallest gap that makes a pick: with fewer points between two teams,
 * the chance of the one ahead is short of 52%, and the game is a toss-up.
 */
export function smallestPickGap(): number {
  let gap = 0;
  while (pickedSide(eloChance(gap, 0, 0)) === null) gap += 1;
  return gap;
}

/** A gap as the drawing labels it: "−200", "0", "+400". */
export function gapLabel(gap: number): string {
  return signedPoints(gap, 0);
}

/**
 * What the drawing shows, in a sentence, for a visitor who cannot see it:
 * the chance in whole percent at each gap that is labeled.
 */
export function curveSummary(): string {
  const stops = CURVE_GAPS.map((gap) => `${wholePercent(eloChance(gap, 0, 0))}% at a gap of ${gapLabel(gap)}`);
  return `The home team's chance for every gap: ${stops.slice(0, -1).join(', ')} and ${stops[stops.length - 1]}.`;
}
