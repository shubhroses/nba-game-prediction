/**
 * Elo's arithmetic, as pipeline/model/README.md gives it and
 * pipeline/model/elo.py does it. With it the page works a chance out for
 * itself from two ratings of the model file, and goes through the worked
 * game of that document with sums of its own.
 */

/** A team that is this many points ahead is given ten times its opponent's chance. */
export const ELO_SCALE = 400;

/**
 * How far the home team is ahead before a game: its rating, plus the home
 * court, minus the visitors' rating. The home court is 0 on a neutral floor.
 */
export function eloGap(homeRating: number, awayRating: number, homeCourt: number): number {
  return homeRating + homeCourt - awayRating;
}

/** The home team's chance of winning, with all its decimals. */
export function eloChanceExact(homeRating: number, awayRating: number, homeCourt: number): number {
  return 1 / (1 + 10 ** (-eloGap(homeRating, awayRating, homeCourt) / ELO_SCALE));
}

/**
 * A chance as the files write it: to four decimals, and never exactly 0 or
 * 1. This is `published` in pipeline/snapshot.py.
 */
export function asPublished(chance: number): number {
  return Math.min(0.9999, Math.max(0.0001, Math.round(chance * 10_000) / 10_000));
}

/**
 * The home team's chance as the job publishes it. The job works it out from
 * the two whole-number ratings that it publishes, so the same three numbers
 * give here the chance that is written in the files.
 */
export function eloChance(homeRating: number, awayRating: number, homeCourt: number): number {
  return asPublished(eloChanceExact(homeRating, awayRating, homeCourt));
}

/**
 * How much more a win by `margin` points counts. `winnerGap` is how far the
 * winner was ahead before the game, home court included, so a win that was
 * expected counts for less than one that was not.
 */
export function eloMultiplier(margin: number, winnerGap: number): number {
  return (margin + 3) ** 0.8 / (7.5 + 0.006 * winnerGap);
}

/** A game that is over, with the ratings the two teams went into it with. */
export interface EloGame {
  homeRating: number;
  awayRating: number;
  homePts: number;
  awayPts: number;
  /** 0 on a neutral floor. */
  homeCourt: number;
  k: number;
}

/**
 * What a game adds to the home team's rating and takes from the away
 * team's. It is below zero when the home team gives rating up.
 */
export function eloHomeGain({ homeRating, awayRating, homePts, awayPts, homeCourt, k }: EloGame): number {
  const gap = eloGap(homeRating, awayRating, homeCourt);
  const homeWon = homePts > awayPts;
  const multiplier = eloMultiplier(Math.abs(homePts - awayPts), homeWon ? gap : -gap);
  return k * multiplier * ((homeWon ? 1 : 0) - eloChanceExact(homeRating, awayRating, homeCourt));
}
