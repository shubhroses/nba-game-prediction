/**
 * The record day by day: the latest days that have a game, the latest first,
 * each with its games and the picks that each source won and lost on it.
 */
import type { Board } from '../data/board';
import type { DayTally, SeasonRecord } from '../data/record';
import { dayName, gameDay } from './day';
import { countOf, winsLosses } from './numbers';
import { sourceCards } from './record';
import { hrefOf } from './route';
import type { Source } from './sources';

/** How many days the table shows. */
export const DAYS_SHOWN = 14;

/** What one source did on one day. */
export interface DayCell {
  source: Source;
  /** Picks won and lost as "3–1", or in words why there is no such number: "Not graded", "No pick". */
  text: string;
  /** False when the cell holds words in place of a tally. */
  tallied: boolean;
  /** The day in full for this source: "3 won, 1 lost, 1 toss-up, 2 not graded". */
  words: string;
}

export interface DayRow {
  /** The New York date that the games started on, as the record gives it. */
  day: string;
  /** "Sat, Nov 7". */
  label: string;
  games: number;
  /** One cell for each source that the record has, in the order of the page. */
  cells: DayCell[];
  /** The address of the results of that day. Null when the board no longer holds a result of it. */
  href: string | null;
}

function words(tally: DayTally): string {
  const parts = [`${tally.wins} won`, `${tally.losses} lost`];
  if (tally.toss_ups > 0) parts.push(countOf(tally.toss_ups, 'toss-up'));
  if (tally.not_graded > 0) parts.push(`${tally.not_graded} not graded`);
  return parts.join(', ');
}

/** A source that the day's entry does not have was not graded on any of its games. */
function cell(source: Source, tally: DayTally | null): DayCell {
  if (tally === null) return { source, text: 'Not graded', tallied: false, words: 'not graded' };
  if (tally.wins + tally.losses > 0) {
    return { source, text: winsLosses(tally.wins, tally.losses), tallied: true, words: words(tally) };
  }
  // No pick was graded that day. With a toss-up among the games the source had a chance and no pick.
  return { source, text: tally.toss_ups > 0 ? 'No pick' : 'Not graded', tallied: false, words: words(tally) };
}

/**
 * The rows of the table, the latest day first. A day links to its results
 * while the board holds one of them, which it does for eight days.
 */
export function dayRows(record: SeasonRecord, board: Board, limit = DAYS_SHOWN): DayRow[] {
  const sources = sourceCards(record).map((entry) => entry.source);
  const withResults = new Set(board.recent_results.map((line) => gameDay(line.commence_time)));

  return record.by_day
    .slice(-limit)
    .reverse()
    .map((entry) => ({
      day: entry.day,
      label: dayName(entry.day),
      games: entry.games,
      cells: sources.map((source) => cell(source, entry[source.key])),
      href: withResults.has(entry.day) ? hrefOf('results', entry.day) : null,
    }));
}

/** What stands next to the title of the table: how many of the days it shows. */
export function daysShown(record: SeasonRecord, limit = DAYS_SHOWN): string {
  const days = record.by_day.length;
  if (days > limit) return `The latest ${limit} of ${days} days`;
  return days === 1 ? '1 day' : `All ${days} days`;
}
