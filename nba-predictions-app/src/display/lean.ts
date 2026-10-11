/**
 * The lean bar: one source's view of one game on an axis that all three
 * sources share. The left end is the away team, the right end is the home
 * team and the middle is an even game. The bar is filled from the middle
 * toward the side the source leans to, as far as its chance is from even.
 */
import { chances, leaningSide, pickedSide, tenThousandths, type Side } from './pick';
import { teamName } from './teams';

export interface Lean {
  /** The side the fill runs toward. Null at exactly even, where nothing is filled. */
  side: Side | null;
  /** How much of that side's half is filled, from 0 to 1: 50% is 0, 75% is one half, 100% would be 1. */
  share: number;
}

export function lean(pHome: number): Lean {
  const fromEven = tenThousandths(pHome) - 5000;
  return { side: leaningSide(pHome), share: Math.abs(fromEven) / 5000 };
}

/**
 * What a lean bar says, in words, for a visitor who cannot see it: "Elo:
 * Detroit Pistons 57%". A toss-up is called one, with the side it leans to.
 * The percent is the one the card writes, so a toss-up never reads 52%.
 * `home` and `away` are team codes.
 */
export function leanLabel(sourceName: string, pHome: number | null, home: string, away: string): string {
  if (pHome === null) return `${sourceName}: no chance published`;

  const side = leaningSide(pHome);
  if (side === null) return `${sourceName}: toss-up, 50% each`;

  const leaning = `${teamName(side === 'home' ? home : away)} ${chances(pHome)[side]}%`;
  return pickedSide(pHome) === null ? `${sourceName}: toss-up, ${leaning}` : `${sourceName}: ${leaning}`;
}
