import type { Board } from '../data/board';

const DAY = { month: 'short', day: 'numeric' } as const;
const TIME = { hour: 'numeric', minute: '2-digit' } as const;

/**
 * A time of day, followed by the date when it is not on the same day as
 * `now`. Without a time zone the visitor's own is used.
 */
export function clockTime(at: number, now: number, timeZone?: string): string {
  const time = new Intl.DateTimeFormat('en-US', { ...TIME, timeZone }).format(at);
  const day = new Intl.DateTimeFormat('en-US', { ...DAY, timeZone });
  return day.format(at) === day.format(now) ? time : `${time} on ${day.format(at)}`;
}

/** How long ago something was, in the units a visitor would use. */
export function age(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min ago` : `${hours} h ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/** When the odds were taken and from how many sportsbooks, counting the games that have not started. */
export function snapshotNote(board: Board, now: number, timeZone?: string): string {
  const taken = Date.parse(board.generated_at);
  const most = Math.max(
    0,
    ...board.games.filter((game) => Date.parse(game.commence_time) > now).map((game) => game.line?.n ?? 0),
  );

  let source = '';
  if (most === 1) source = ', from 1 sportsbook';
  if (most >= 2) source = `, the median of up to ${most} sportsbooks`;
  return `Odds as of ${clockTime(taken, now, timeZone)} (${age(now - taken)})${source}.`;
}

/** When the next snapshot is due, or that it is overdue. */
export function nextUpdateNote(board: Board, now: number, timeZone?: string): string {
  const due = Date.parse(board.next_due);
  return due > now
    ? `Next update about ${clockTime(due, now, timeZone)}.`
    : `The next update was due at ${clockTime(due, now, timeZone)}.`;
}
