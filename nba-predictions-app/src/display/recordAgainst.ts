/**
 * How a model did next to the sportsbooks' line, which is the yardstick for
 * both: the difference between the two Brier scores with its 95% interval,
 * read out in words that say what the numbers say and no more, and the games
 * in which the two picked different winners.
 */
import type { DifferentPick, ModelScorecard } from '../data/record';
import { countOf, signedScore, written } from './numbers';
import { finalScore, recordedDate } from './record';
import type { Source } from './sources';

/**
 * The record gives the difference an interval from this many games on. Below
 * it, resamples of the games would repeat the same few.
 */
export const INTERVAL_FROM = 30;

/** How many of the games with different picks the view lists. The record holds up to ten. */
export const LATEST_SHOWN = 5;

/**
 * What the difference and its interval come to.
 *
 * - `nothing`: no game has a chance from both.
 * - `too-few`: there is a difference and no interval, because the games are fewer than 30.
 * - `no-difference`: the interval includes zero.
 * - `model-lower`: the whole interval is below zero, where the model's chances were the better ones.
 * - `model-higher`: the whole interval is above zero, where the line was the better one.
 */
export type Reading = 'nothing' | 'too-few' | 'no-difference' | 'model-lower' | 'model-higher';

export interface BrierView {
  reading: Reading;
  /** What the numbers come to, in a few words. */
  headline: string;
  /** Why, in a sentence or two that claim no more than the numbers do. */
  detail: string;
  /** The model's Brier score minus the sportsbooks', as "+0.0028". Null without a game that both have a chance for. */
  difference: string | null;
  /** Its 95% interval, as "−0.0168 to +0.0229". Null below 30 games. */
  interval: string | null;
  /** The games that the difference is of: "120 games with a chance from both". */
  games: string;
  /** The same numbers as the file gives them, for the track. */
  point: number | null;
  span: [number, number] | null;
  /** What the track says, for a visitor who cannot see it. */
  trackLabel: string;
  /** Which way the difference reads. */
  axisNote: string;
}

function readingOf({ difference, interval }: ModelScorecard['brier_against_market']): Reading {
  if (difference === null) return 'nothing';
  if (interval === null) return 'too-few';
  if (interval[1] < 0) return 'model-lower';
  if (interval[0] > 0) return 'model-higher';
  return 'no-difference';
}

function headline(reading: Reading): string {
  switch (reading) {
    case 'nothing':
      return 'Nothing to compare yet';
    case 'too-few':
      return 'Too few games to tell';
    case 'no-difference':
      return 'No difference can be told';
    case 'model-lower':
      return "Lower than the sportsbooks' score";
    case 'model-higher':
      return "Higher than the sportsbooks' score";
  }
}

// A whole interval on one side of zero is a statement about the games that were played, and the page says so.
// It says which of the two scores was the lower one, and leaves it at that. The record is rebuilt every morning,
// so the interval is read some 170 times in a season, and a 95% interval of two equal sources leaves zero out
// on some of those mornings.
const OF_THESE_GAMES =
  'That is said of these games, not of the ones to come. ' +
  'A 95% interval that is read every day lies on one side of zero now and then by chance alone.';

function detail(reading: Reading, name: string, games: number): string {
  const these = `these ${countOf(games, 'game')}`;
  switch (reading) {
    case 'nothing':
      return `No game has a chance from both ${name} and the sportsbooks yet.`;
    case 'too-few':
      return (
        `The record gives the difference a 95% interval from ${INTERVAL_FROM} games on, ` +
        `and ${countOf(games, 'game')} ${games === 1 ? 'has' : 'have'} a chance from both so far.`
      );
    case 'no-difference':
      return `The 95% interval includes zero, so over ${these} the two cannot be told apart.`;
    case 'model-lower':
      return (
        `The whole 95% interval is below zero: over ${these} ${name} had the lower Brier score of the two. ` + OF_THESE_GAMES
      );
    case 'model-higher':
      return (
        `The whole 95% interval is above zero: over ${these} the sportsbooks had the lower Brier score of the two. ` + OF_THESE_GAMES
      );
  }
}

/** What the view says of the difference between a model's Brier score and the sportsbooks'. */
export function brierView(source: Source, against: ModelScorecard['brier_against_market']): BrierView {
  const reading = readingOf(against);
  const difference = against.difference === null ? null : signedScore(against.difference);
  const interval = against.interval && `${signedScore(against.interval[0])} to ${signedScore(against.interval[1])}`;

  let trackLabel = 'No difference yet';
  if (difference !== null) {
    trackLabel = `Difference ${difference}, ${interval === null ? 'no interval yet' : `95% interval ${interval}`}`;
  }
  const { name } = source;
  return {
    reading,
    headline: headline(reading),
    detail: detail(reading, name, against.games),
    difference,
    interval,
    games: `${countOf(against.games, 'game')} with a chance from both`,
    point: against.difference,
    span: against.interval,
    trackLabel,
    axisNote:
      `${name}'s Brier score minus the sportsbooks'. Lower is better for a Brier score: ` +
      `below zero ${name} had the lower one, and above zero the sportsbooks had.`,
  };
}

/** A game in which a model and the sportsbooks picked different winners. */
export interface DifferentPickRow {
  id: string;
  /** The day of the game, as "Nov 7". */
  dayText: string;
  /** The final score with the winner first: "DAL 130, CHI 119". */
  final: string;
  /** The team code that each of the two picked. */
  modelPick: string;
  marketPick: string;
  /** True when the model's pick won. The sportsbooks' pick won otherwise: one of the two was right in every such game. */
  modelRight: boolean;
}

export interface DifferentPicksView {
  /** The games in which both had a pick and the two were not the same team. */
  differ: number;
  modelRight: number;
  marketRight: number;
  /** How many there are and how often each was right, in a sentence or two. */
  summary: string;
  /** What the bar of the two counts says, for a visitor who cannot see it. */
  barLabel: string;
  /** What stands over the list: "The latest 5 of the 15". Null when the list is empty. */
  listTitle: string | null;
  /** The latest of those games, the latest first. */
  latest: DifferentPickRow[];
}

function row(game: DifferentPick): DifferentPickRow {
  return {
    id: game.id,
    dayText: recordedDate(game),
    final: finalScore(game),
    modelPick: game.pick,
    marketPick: game.market_pick,
    // Who was right is the job's word, like every verdict. The page does not grade a game itself.
    modelRight: game.right === 'model',
  };
}

function summary(name: string, differ: number, modelRight: number, marketRight: number): string {
  if (differ === 0) return 'The two have not picked different winners in a game yet.';

  const games = `In ${countOf(differ, 'game')} the two picked different winners.`;
  if (differ === 1) return `${games} ${modelRight === 1 ? `${name}'s pick` : "The sportsbooks' pick"} won it.`;
  return `${games} ${name}'s pick won ${written(modelRight)} of them and the sportsbooks' pick ${written(marketRight)}.`;
}

function listTitle(shown: number, differ: number): string | null {
  if (shown === 0) return null;
  if (shown < differ) return `The latest ${shown} of the ${written(differ)}`;
  return shown === 1 ? 'That game' : `All ${shown} of them`;
}

/** What the view says of the games in which a model and the sportsbooks picked different winners. */
export function differentPicks(source: Source, picks: ModelScorecard['picks_against_market']): DifferentPicksView {
  const latest = picks.latest.slice(0, LATEST_SHOWN).map(row);
  const { differ, model_right: modelRight, market_right: marketRight } = picks;
  return {
    differ,
    modelRight,
    marketRight,
    summary: summary(source.name, differ, modelRight, marketRight),
    barLabel:
      `${source.name}'s pick won ${written(modelRight)} of ${countOf(differ, 'game')}, ` +
      `the sportsbooks' pick ${written(marketRight)}`,
    listTitle: listTitle(latest.length, differ),
    latest,
  };
}
