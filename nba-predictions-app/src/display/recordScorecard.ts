/**
 * What the scorecard of one source shows: its picks won and lost, the share
 * of them that won with its 95% interval, the games it had no pick for, and
 * its two scores. Under the scorecards stands the baseline, which is the home
 * team every time.
 */
import type { ModelScorecard, Scorecard, SeasonRecord } from '../data/record';
import { countOf, onePlacePercent, scoreText, shareOf, winsLosses, written } from './numbers';
import { sourceCards } from './record';
import type { Source } from './sources';

/** What one half for every game scores, as pipeline/README.md gives it: the Brier score and the log loss of a coin. */
export const COIN_SCORES = 'a coin flip for every game scores 0.25 and 0.6931';

/** The two ends of an interval of a share: "53.0% to 70.4%". */
export function shareInterval([low, high]: readonly [number, number]): string {
  return `${onePlacePercent(low)} to ${onePlacePercent(high)}`;
}

/** The share of a source's picks that won. */
export interface WonShare {
  /** From 0 to 1, as the file gives it. */
  share: number;
  /** "62.1%". */
  text: string;
  /** The Wilson 95% interval of the share. */
  interval: [number, number] | null;
  /** "53.0% to 70.4%". */
  intervalText: string | null;
}

/** One line of the small print of a scorecard. */
export interface DetailRow {
  label: string;
  /** A few words that say what is counted. */
  hint: string | null;
  value: string;
}

export interface ScorecardView {
  source: Source;
  /** Picks won and lost, as "72–44". */
  tally: string;
  /** The picks that were graded, which are the games that the share is of: "of 116 picks". */
  picksText: string;
  /** Null when no pick has been graded. */
  won: WonShare | null;
  /** What the track of the interval says, for a visitor who cannot see it. */
  trackLabel: string;
  /** The games without a pick, and the two scores. */
  rows: DetailRow[];
  /** Which games the two scores are of, and how to read them. */
  scoresNote: string;
}

function isModel(card: Scorecard): card is ModelScorecard {
  return 'late' in card;
}

function wonShare(card: Scorecard): WonShare | null {
  if (card.accuracy === null || card.games === 0) return null;
  const interval = card.accuracy_interval;
  return {
    share: card.accuracy,
    // The file holds the two counts next to the share it rounded, and the text is of the counts.
    text: shareOf(card.wins, card.games),
    interval,
    intervalText: interval && shareInterval(interval),
  };
}

function trackLabel(won: WonShare | null, picksText: string): string {
  if (won === null) return 'No pick has been graded yet';
  const share = `${won.text} ${picksText} won`;
  return won.intervalText === null ? share : `${share}, 95% interval ${won.intervalText}`;
}

/** A score that the file does not hold yet is said to be missing. It is never written as a number. */
function scoreOrNone(score: number | null): string {
  return score === null ? 'None yet' : scoreText(score);
}

/**
 * Why a game was not graded. For a model that is a game without a forecast
 * in time, and the hint says how many of those had one that was published
 * too late. The sportsbooks' line is the last one from before the start, so
 * it cannot be late.
 */
function notGradedHint(card: Scorecard): string {
  return isModel(card) ? `no forecast in time, ${written(card.late)} published too late` : 'no line before the start';
}

function rows(card: Scorecard): DetailRow[] {
  return [
    { label: 'Toss-ups', hint: 'neither team at 52%', value: written(card.toss_ups) },
    { label: 'Not graded', hint: notGradedHint(card), value: written(card.not_graded) },
    { label: 'Brier score', hint: null, value: scoreOrNone(card.brier) },
    { label: 'Log loss', hint: null, value: scoreOrNone(card.log_loss) },
  ];
}

/**
 * Each card scores the games that its own source had a chance for, and those
 * are not the same games from card to card. Read across, a lower score on one
 * card says nothing: the section under the scorecards has the difference
 * over the games that a model and the sportsbooks both have a chance for.
 */
export const NOT_THE_SAME_GAMES =
  'The cards are not over the same games, so their scores are not to be compared with each other. ' +
  '"Against the sportsbooks" below sets each model next to the sportsbooks over the same games.';

function scoresNote(card: Scorecard, alone: boolean): string {
  const chance = isModel(card) ? 'forecast' : 'line';
  const games =
    card.with_line === 0
      ? `and there is none before the first game with a ${chance}`
      : `over ${countOf(card.with_line, 'game')} with a ${chance}`;
  const reading = `Both scores say how far the chances were from what happened, ${games}. Lower is better, and ${COIN_SCORES}.`;
  return alone ? reading : `${reading} ${NOT_THE_SAME_GAMES}`;
}

/** The scorecard of one source. `alone` is true when the record has no other source to set it next to. */
export function scorecardView(source: Source, card: Scorecard, alone = false): ScorecardView {
  const won = wonShare(card);
  const picksText = `of ${countOf(card.games, 'pick')}`;
  return {
    source,
    tally: winsLosses(card.wins, card.losses),
    picksText,
    won,
    trackLabel: trackLabel(won, picksText),
    rows: rows(card),
    scoresNote: scoresNote(card, alone),
  };
}

/** The scorecards of the record in the order of the page: Points & Rest, Elo, Sportsbooks. */
export function scorecards(record: SeasonRecord): ScorecardView[] {
  const cards = sourceCards(record);
  return cards.map(({ source, card }) => scorecardView(source, card, cards.length === 1));
}

/** What picking the home team every time would have won. */
export interface Baseline {
  /** "81 of 143 games". */
  count: string;
  /** The share of the recorded games that the home team won: "56.6%". */
  share: string;
}

/**
 * The baseline is counted over every recorded game, graded or not, so it is
 * not over the same games as the picks of a source. Null before the first
 * game.
 */
export function baseline(record: SeasonRecord): Baseline | null {
  const { games, wins } = record.baseline_home;
  if (games === 0) return null;
  return { count: `${written(wins)} of ${countOf(games, 'game')}`, share: shareOf(wins, games) };
}
