/**
 * How the page words what became of a forecast. A verdict is the job's, from
 * a result line, and the page does not grade anything itself.
 */
import type { ResultLine, Verdict } from '../data/results';
import type { Side } from './pick';

/** What a verdict comes to for a visitor. */
export type Outcome = 'right' | 'wrong' | 'no-pick' | 'not-graded';

const OUTCOMES: Record<Verdict, Outcome> = {
  favorite_won: 'right',
  upset: 'wrong',
  toss_up: 'no-pick',
  not_graded: 'not-graded',
};

const WORDS: Record<Outcome, string> = {
  right: 'Right',
  wrong: 'Wrong',
  'no-pick': 'No pick',
  'not-graded': 'Not graded',
};

export function outcomeOf(verdict: Verdict): Outcome {
  return OUTCOMES[verdict];
}

/** The outcome in a word or two: Right, Wrong, No pick, Not graded. */
export function outcomeWords(outcome: Outcome): string {
  return WORDS[outcome];
}

/** The side that won a game that is over. The two scores of such a game are never equal. */
export function winningSide(game: { home_pts: number; away_pts: number }): Side {
  return game.home_pts > game.away_pts ? 'home' : 'away';
}

/**
 * Whether a model's forecast for a game came too late to count: the line
 * carries the forecast, and it was not graded. That happens when the
 * forecast was published at or after the start of the game.
 */
export function publishedTooLate(line: ResultLine, model: 'elo' | 'points_rest'): boolean {
  return line[model] !== null && line[`${model}_verdict`] === 'not_graded';
}
