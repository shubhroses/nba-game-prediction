/**
 * What a chance says about a game: which side a source picks, the whole
 * percent a card shows and the one decimal of the record. The rule is the one
 * the job grades by, in pipeline/grading.py, so the page never calls a pick
 * what the record counts as a toss-up.
 */

export type Side = 'home' | 'away';

// The files write a chance with four decimals, and the rule compares whole
// numbers of ten-thousandths. As binary fractions the chances would not do:
// 1 - 0.41 is 0.59 on paper and 0.5900000000000001 in floating point.
const UNIT = 10_000;
const PICK_FROM = 5_200;

/** A chance as a whole number of ten-thousandths. */
export function tenThousandths(chance: number): number {
  return Math.round(chance * UNIT);
}

/**
 * The side a source picks, from its chance for the home team: the side it
 * puts at 52% or more. Null between 48% and 52%, where it has no pick and the
 * page says "Toss-up". 0.52 is a pick and 0.5199 is not.
 */
export function pickedSide(pHome: number): Side | null {
  const home = tenThousandths(pHome);
  if (home >= PICK_FROM) return 'home';
  if (UNIT - home >= PICK_FROM) return 'away';
  return null;
}

/** The side a chance is on, however slightly. Null at exactly even. */
export function leaningSide(pHome: number): Side | null {
  const home = tenThousandths(pHome);
  if (home === UNIT / 2) return null;
  return home > UNIT / 2 ? 'home' : 'away';
}

/**
 * Whole percent, kept between 1 and 99: no source says that a team cannot
 * lose. For the two teams of a game as a card writes them, see `chances`.
 */
export function wholePercent(chance: number): number {
  return Math.min(99, Math.max(1, Math.round(tenThousandths(chance) / 100)));
}

/**
 * Both teams' chances in whole percent, as a card writes them. The away
 * team's is the home team's taken from 100, so that the two always add up.
 *
 * Without a pick neither team reads 52%. A chance from 51.5% up to the 52%
 * that makes a pick would round to 52, and the page says everywhere that a
 * pick is the side at 52% or more. Such a chance is written as 51%, and the
 * other team's as 49%.
 */
export function chances(pHome: number): Record<Side, number> {
  const rounded = wholePercent(pHome);
  const home = pickedSide(pHome) === null ? Math.min(51, Math.max(49, rounded)) : rounded;
  return { home, away: 100 - home };
}

/**
 * A chance with one decimal, as the record and the details of a result write
 * it: 0.5816 is "58.2%". One decimal can say what the files do not: 0.9996
 * would read as 100.0%, and 0.5199, which is short of a pick, as 52.0%. Such
 * a chance is written with the two decimals that the files give it.
 */
export function onePlaceChance(chance: number): string {
  const units = tenThousandths(chance);
  const tenths = Math.round(units / 10);
  const readsAsAnother = tenths <= 0 || tenths >= 1000 || pickedSide(tenths / 1000) !== pickedSide(chance);
  return readsAsAnother ? `${(units / 100).toFixed(2)}%` : `${(tenths / 10).toFixed(1)}%`;
}

/** The side a source picks, and that side's chance in whole percent. */
export interface Favorite {
  side: Side;
  chance: number;
}

/** The favorite of a source, from its chance for the home team. Null for a toss-up. */
export function favorite(pHome: number): Favorite | null {
  const side = pickedSide(pHome);
  return side && { side, chance: chances(pHome)[side] };
}

/** What the page writes for a chance that picks neither side. */
export const TOSS_UP = 'Toss-up';

/**
 * What a chance for the home team says in a few letters, on the card of a
 * game and in the results alike: the code of the team it picks with that
 * team's whole percent, as in "DET 57%", or "Toss-up".
 */
export function pickLabel(pHome: number, teams: { home: string; away: string }): string {
  const pick = favorite(pHome);
  return pick === null ? TOSS_UP : `${teams[pick.side]} ${pick.chance}%`;
}

/**
 * Whether two sources pick different sides, each from its chance for the home
 * team. A source without a chance or without a pick differs from nobody,
 * which is how the record counts the games in which a model and the
 * sportsbooks picked different winners.
 */
export function picksDiffer(pHome: number | null, otherPHome: number | null): boolean {
  const one = pHome === null ? null : pickedSide(pHome);
  const other = otherPHome === null ? null : pickedSide(otherPHome);
  return one !== null && other !== null && one !== other;
}
