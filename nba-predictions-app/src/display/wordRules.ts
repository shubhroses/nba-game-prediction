/**
 * The words that the page does without, for the tests that read a view as a
 * visitor does. One list serves every view, so that no view is held to less
 * than another. Only tests import this file.
 */

const UNWANTED: readonly RegExp[] = [
  // Betting advice, and words that promise what a forecast cannot.
  /\b(?:locks?|best bets?|values?|valued|edges?|sharp\w*|guarantee\w*|sure things?)\b/gi,
  /\b(?:bets?|betting|bettors?|wager\w*|gambl\w*)\b/gi,
  // A claim that a model does better than the sportsbooks, or picks more winners than they do.
  /\b(?:beats?|beating|outperform\w*)\b/gi,
  /\b(?:better|more winners) than the (?:sports)?books\b/gi,
  // The sportsbooks go by that name and no other.
  /\b(?:bookmakers?|bookies?|vegas|oddsmakers?)\b/gi,
  // The models are two small statistical models, and the page calls them nothing grander.
  /\bAI\b/g,
  /\b(?:artificial intelligence|machine learning|neural \w+|algorithm\w*)\b/gi,
  // A percentage is a chance, and an interval is a 95% interval.
  /\b(?:probabilit(?:y|ies)|confidence)\b/gi,
];

/**
 * Whatever a text holds of the words that the page does without, each as it
 * is found. Empty for a text that is worded as the page should be.
 */
export function unwantedWords(text: string): string[] {
  return UNWANTED.flatMap((pattern) => text.match(pattern) ?? []);
}
