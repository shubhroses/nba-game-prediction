/**
 * The results view by day: the games that the board carries a result of,
 * grouped by the day of the game with the newest day first, and for each day
 * how many of each source's picks won. The page counts the job's verdicts
 * and does not grade anything itself.
 */
import type { Board } from '../data/board';
import type { ResultLine, Verdict } from '../data/results';
import { addDays, dayName, daysFrom, dayStart, gameDay, isDay, pageDay } from './day';
import { countOf } from './numbers';
import { gameRow, missingOf, type GameRow, type Missing } from './resultsGame';
import { hrefOf } from './route';
import { resultVerdict, SOURCES, type SourceKey } from './sources';

const HOUR_MS = 60 * 60 * 1000;

/** The board keeps a result until eight days after the start of its game. */
const KEPT_MS = 8 * 24 * HOUR_MS;

/**
 * No game starts in the first six hours of its day, which end at noon or at
 * eleven in the morning in New York. A cut that falls there has cut nothing.
 */
const NO_GAME_YET_MS = 6 * HOUR_MS;

/** What became of one source's forecasts for the games of one day. */
export interface SourceTally {
  source: SourceKey;
  /** The picks that won and the picks that lost. */
  wins: number;
  losses: number;
  /** The games in which it had no pick. */
  tossUps: number;
  /** The games it is not graded on: it said nothing of them, or its forecast came too late. */
  notGraded: number;
  /** Why it said nothing of any game of the day. Null when it said something of at least one. */
  absent: Missing | null;
}

export interface ResultDay {
  /** The day of the games, as 2026-11-07. */
  day: string;
  /** By start. */
  games: GameRow[];
  /** One for each source, in the order of the page. */
  tallies: SourceTally[];
  /**
   * The time before which a game of this day has left the board, when that
   * may have cut the day short. Null for a day that is whole.
   */
  cutAt: number | null;
}

function absence(lines: readonly ResultLine[], key: SourceKey): Missing | null {
  const reasons = lines.map((line) => missingOf(line, key));
  if (reasons.includes(null)) return null;
  // One game with Elo's forecast alone shows that the other model was left out on the day.
  return reasons.includes('left-out') ? 'left-out' : (reasons[0] ?? null);
}

function tally(lines: readonly ResultLine[], key: SourceKey): SourceTally {
  const count = (verdict: Verdict) => lines.filter((line) => resultVerdict(line, key) === verdict).length;
  return {
    source: key,
    wins: count('favorite_won'),
    losses: count('upset'),
    tossUps: count('toss_up'),
    notGraded: count('not_graded'),
    absent: absence(lines, key),
  };
}

function cutAt(day: string, board: Board): number | null {
  const cut = Date.parse(board.generated_at) - KEPT_MS;
  const firstStart = dayStart(day) + NO_GAME_YET_MS;
  return cut > firstStart ? cut : null;
}

function byStart(a: ResultLine, b: ResultLine): number {
  return Date.parse(a.commence_time) - Date.parse(b.commence_time) || (a.id < b.id ? -1 : 1);
}

/** The days that the board has a result of, the newest first, each with its games and its counts. */
export function resultDays(board: Board): ResultDay[] {
  const linesOf = new Map<string, ResultLine[]>();
  for (const line of board.recent_results) {
    const day = gameDay(line.commence_time);
    linesOf.set(day, [...(linesOf.get(day) ?? []), line]);
  }

  return [...linesOf.entries()]
    .sort(([day], [other]) => (day < other ? 1 : -1))
    .map(([day, lines]) => ({
      day,
      games: [...lines].sort(byStart).map(gameRow),
      tallies: SOURCES.map(({ key }) => tally(lines, key)),
      cutAt: cutAt(day, board),
    }));
}

/** The count of one source for one day, in the words of the page. */
export interface TallyWords {
  /** How many of its picks won, of how many it had: "7 of 9". Null when none of its picks was graded. */
  count: string | null;
  /** What the count is, or why there is none: "picks won", "Left out that day". */
  what: string;
  /** The games without a pick and the games not graded, when there are any: "1 toss-up", "2 not graded". */
  rest: string[];
}

const ABSENT_WORDS: Record<Missing, string> = {
  'no-line': 'No line that day',
  'left-out': 'Left out that day',
  'no-forecast': 'No forecast that day',
};

export function tallyWords(tally: SourceTally): TallyWords {
  const picks = tally.wins + tally.losses;
  const rest: string[] = [];
  if (tally.tossUps > 0) rest.push(countOf(tally.tossUps, 'toss-up'));
  if (tally.notGraded > 0) rest.push(`${tally.notGraded} not graded`);

  if (picks > 0) return { count: `${tally.wins} of ${picks}`, what: 'picks won', rest };
  return { count: null, what: tally.absent === null ? 'No pick that day' : ABSENT_WORDS[tally.absent], rest };
}

/** What a day of results is called on `today`: "Last night" for the day before, and otherwise as "Sat, Nov 7". */
export function nightName(day: string, today: string): string {
  return daysFrom(today, day) === -1 ? 'Last night' : dayName(day);
}

/** The title of a day's results, and what stands at the far end of its line. */
export interface DayHeading {
  title: string;
  /** How many games the board has of the day, after the date when the title is not the date. */
  aside: string;
}

export function dayHeading(day: ResultDay, today: string): DayHeading {
  const title = nightName(day.day, today);
  const date = dayName(day.day);
  const games = countOf(day.games.length, 'game');
  return { title, aside: title === date ? games : `${date} · ${games}` };
}

/** The key of the link that shows every day. No day is written like it. */
export const ALL_DAYS = 'all';

/** A link to the results of one day, or of every day. */
export interface DayTab {
  key: string;
  label: string;
  /** How many games the board has a result of on the day, or on all of them. */
  games: number;
  href: string;
}

/** The links of the view: every day at once, and then each day alone, the newest first. */
export function dayTabs(days: readonly ResultDay[], today: string): DayTab[] {
  const all = days.reduce((games, day) => games + day.games.length, 0);
  return [
    { key: ALL_DAYS, label: 'All days', games: all, href: hrefOf('results') },
    ...days.map(({ day, games }) => ({ key: day, label: nightName(day, today), games: games.length, href: hrefOf('results', day) })),
  ];
}

/** The days on either side of a day that is shown alone. Null where the board has no such day. */
export interface Neighbors {
  earlier: DayTab | null;
  later: DayTab | null;
}

/** The links at the end of one day's results, which lead on to the day before it and to the day after. */
export function neighbors(days: readonly ResultDay[], day: string, today: string): Neighbors {
  // The first tab shows every day, and the days follow it with the newest first.
  const tabs = dayTabs(days, today).slice(1);
  const index = tabs.findIndex((tab) => tab.key === day);
  if (index < 0) return { earlier: null, later: null };
  return { earlier: tabs[index + 1] ?? null, later: tabs[index - 1] ?? null };
}

/** What the address after the view asks for. */
export interface Selection {
  /** The day to show alone, when the board has results of it. Null shows every day. */
  day: string | null;
  /** What to tell a visitor whose address asks for something that the board does not have. */
  problem: string | null;
}

/**
 * Reads the part of the address after the view, as in `#/results/2026-11-07`.
 * It is whatever the visitor typed, so anything but a day with results on the
 * board shows every day and says why.
 */
export function selection(param: string | null, days: readonly ResultDay[]): Selection {
  if (param === null) return { day: null, problem: null };
  if (!isDay(param)) return { day: null, problem: 'The address does not name a day, so every day is shown.' };
  if (days.some((entry) => entry.day === param)) return { day: param, problem: null };

  const name = dayName(param);
  const newest = days[0]?.day;
  const oldest = days[days.length - 1]?.day;
  if (newest === undefined || param > newest) {
    return { day: null, problem: `There is no result of ${name} yet. A result is recorded on the morning after its game.` };
  }
  if (oldest !== undefined && param < oldest) {
    return { day: null, problem: `The results of ${name} are no longer shown here. This view keeps a result for eight days, and the record counts every game.` };
  }
  return { day: null, problem: `There is no result of ${name}.` };
}

/** The first day after `after` that the board knows a game of. With null, the first day of all. */
function nextGameDay(board: Board, after: string | null): string | null {
  const days = board.games.map((game) => gameDay(game.commence_time));
  if (board.models?.predictions_day) days.push(board.models.predictions_day);
  return days.filter((day) => after === null || day > after).sort()[0] ?? null;
}

/**
 * When the games of a day get their results: on the morning after, which is
 * when the job records them. A day that is over without them is said to
 * have none yet. `first` is for a board that has never had a result.
 */
function dueWords(day: string, today: string, first: boolean): string {
  if (day < today) return `The games of ${dayName(day)} have no result yet.`;

  const morning = dayName(addDays(day, 1));
  return first
    ? `The first games to come are those of ${dayName(day)}, and their results are due on the morning of ${morning}.`
    : `Next: the games of ${dayName(day)}, whose results are due on the morning of ${morning}.`;
}

/**
 * Which results come next, for a board that has some: the games of the first
 * day after its newest result. Null when the board knows no later game.
 */
export function nextResults(board: Board, now: number): string | null {
  const days = board.recent_results.map((line) => gameDay(line.commence_time)).sort();
  const newest = days[days.length - 1] ?? null;
  const next = nextGameDay(board, newest);
  return next && dueWords(next, pageDay(board, now), false);
}

/** What stands in place of the results when the board has none. */
export interface EmptyResults {
  title: string;
  text: string;
}

function recordedBefore(board: Board): boolean {
  if (board.models?.results_through) return true;
  const { record } = board;
  if (record === null) return false;
  return [record.market, record.elo, record.points_rest].some((tally) => tally !== null && tally.wins + tally.losses > 0);
}

/**
 * Says that there is no result, and when the first one is due. Before the
 * season that is the morning after the first games on the board.
 */
export function emptyResults(board: Board, now: number): EmptyResults {
  const next = nextGameDay(board, null);
  if (recordedBefore(board)) {
    const due = next === null ? '' : ` ${dueWords(next, pageDay(board, now), false)}`;
    return { title: 'No results in the last eight days', text: `This view keeps a result for eight days after its game.${due}` };
  }

  const due = next === null ? '' : ` ${dueWords(next, pageDay(board, now), true)}`;
  return { title: 'No result yet', text: `A result appears here on the morning after its game.${due}` };
}
