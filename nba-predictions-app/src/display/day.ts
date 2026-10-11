/**
 * The day a game belongs to, as the job counts it: `game_day` in
 * pipeline/model/season.py. A day is written as a date, 2026-10-20.
 *
 * Nothing here reads the visitor's time zone. An evening's games are one day
 * for every visitor, wherever they tip off and wherever the page is read.
 */
import type { Board } from '../data/board';
import { isDay } from '../data/shape';

/**
 * A game's day is its tip-off time minus ten hours, as a UTC date. Ten hours
 * after midnight UTC is five or six in the morning in New York, when no game
 * is being played.
 */
const DAY_BEGINS_MS = 10 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayAt(time: number): string {
  return new Date(time - DAY_BEGINS_MS).toISOString().slice(0, 10);
}

function midnight(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

/** The day of a game, from its start as the files write it: 2026-10-21T02:30:00Z is a game of 2026-10-20. */
export function gameDay(commenceTime: string): string {
  return dayAt(Date.parse(commenceTime));
}

/** The day that is being played at `now`: it turns at 10:00 UTC, early in the morning in North America. */
export function currentDay(now: number): string {
  return dayAt(now);
}

/** The moment a day begins, in milliseconds: 10:00 UTC on its date. */
export function dayStart(day: string): number {
  return midnight(day) + DAY_BEGINS_MS;
}

/**
 * The day that the page calls today. It is the day by the clock, with one
 * exception. While New York is on daylight saving time the job does its
 * daily work at 09:10 UTC, fifty minutes before the day by the clock turns.
 * From then on the board carries the frozen forecasts of the day that is
 * about to begin and the results of the evening before. Such a board is of
 * that morning, and the page goes by it: a day whose forecasts read "made
 * this morning" is not called tomorrow.
 */
export function pageDay(board: Board, now: number): string {
  const byClock = currentDay(now);
  const next = addDays(byClock, 1);
  return board.models?.predictions_day === next ? next : byClock;
}

/** The day that many days after `day`, or before it when `days` is below zero. */
export function addDays(day: string, days: number): string {
  return new Date(midnight(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** How many days `day` is after `from`. Below zero when it is before. */
export function daysFrom(from: string, day: string): number {
  return Math.round((midnight(day) - midnight(from)) / DAY_MS);
}

/** A day as "Tue, Oct 20". */
export function dayName(day: string): string {
  const date = new Date(midnight(day));
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/** A day as a visitor would call it on `today`: Today, Tomorrow, Yesterday, and otherwise as "Tue, Oct 20". */
export function dayLabel(day: string, today: string): string {
  switch (daysFrom(today, day)) {
    case 0:
      return 'Today';
    case 1:
      return 'Tomorrow';
    case -1:
      return 'Yesterday';
    default:
      return dayName(day);
  }
}

/**
 * The days that are known to have a predictions file, in order: the day
 * whose frozen forecasts the board carries, and the day of every recent
 * result that carries a forecast, which the job took from the file of that
 * day. A day without a game to forecast has no file. Asking for one is
 * answered with "no such file", and a browser writes every such answer to
 * its console as an error, so the page asks for these days only.
 */
export function predictionDays(board: Board): string[] {
  const days = new Set(board.recent_results.filter((line) => line.elo !== null).map((line) => gameDay(line.commence_time)));
  if (board.models?.predictions_day) days.add(board.models.predictions_day);
  return [...days].sort();
}

export { isDay };
