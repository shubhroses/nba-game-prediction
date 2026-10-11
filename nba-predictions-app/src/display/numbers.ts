/** How the page writes the numbers that are not chances: counts, shares of games, points and scores. */

/** A whole number with a comma at every thousand: "1,230". */
export function written(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+$)/g, ',');
}

/** "1 game", "2 games", "1,230 games". */
export function countOf(count: number, one: string, many = `${one}s`): string {
  return `${written(count)} ${count === 1 ? one : many}`;
}

/** Wins and losses as "12–5". */
export function winsLosses(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}

/**
 * A share of games with one decimal, as the record shows it: 0.6667 is
 * "66.7%". The files give a share to four decimals, and half a tenth goes up.
 * A share can be none of the games or all of them, which a chance cannot:
 * display/pick.ts writes a chance.
 *
 * This is for a share that the files give without its two counts, such as
 * an end of an interval. Where the page has the counts, `shareOf` rounds
 * once.
 */
export function onePlacePercent(share: number): string {
  const tenths = Math.round(Math.round(share * 10_000) / 10);
  return `${(tenths / 10).toFixed(1)}%`;
}

/**
 * The share that `wins` are of `games`, with one decimal: 12 of 22 is
 * "54.5%". It is worked out from the two counts and rounded once, with half
 * a tenth going up. Taken from a share that was rounded to four decimals
 * first, one share in twenty comes out a tenth too high: 12 of 22 is 0.5455
 * there, which is 54.6% to one decimal. `games` is not zero.
 */
export function shareOf(wins: number, games: number): string {
  return `${(Math.round((1000 * wins) / games) / 10).toFixed(1)}%`;
}

/**
 * A number of points with its sign, as in a margin: "+5.1", "−3.0", "0.0".
 * The minus is the minus sign and not a hyphen. The files give points to two
 * decimals, so the hundredths are counted first and half of the last digit
 * goes away from zero, for a margin on either side alike.
 */
export function signedPoints(points: number, decimals: 0 | 1 | 2 = 1): string {
  const hundredths = Math.round(Math.abs(points) * 100);
  const step = 10 ** (2 - decimals);
  const size = ((Math.round(hundredths / step) * step) / 100).toFixed(decimals);
  if (Number(size) === 0) return size;
  return `${points > 0 ? '+' : '−'}${size}`;
}

/** A Brier score or a log loss, to the four decimals that the files give: "0.2174". */
export function scoreText(score: number): string {
  return score.toFixed(4);
}

/**
 * A difference between two scores with its sign, to four decimals: "+0.0067",
 * "−0.0128", "0.0000". The minus is the minus sign and not a hyphen.
 */
export function signedScore(difference: number): string {
  const size = scoreText(Math.abs(difference));
  if (Number(size) === 0) return size;
  return `${difference > 0 ? '+' : '−'}${size}`;
}
