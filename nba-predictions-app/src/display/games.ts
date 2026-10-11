/**
 * What the games view shows under its introduction, as plain data: one chip
 * for each day that has a game, the day that is selected, its cards, and the
 * games of the current day that have started. The view hands in the board,
 * the clock, the other files it has and what the visitor has chosen, and
 * draws what comes back.
 */
import type { Board, BoardGame } from '../data/board';
import type { PredictedGame } from '../data/predictions';
import { addDays, dayLabel, dayName, gameDay, pageDay } from './day';
import { boardGame, forecastGame, gameCardView, type CardGame, type FilesAtHand, type GameCardView } from './gameCard';
import { countOf } from './numbers';

/** The two ways to narrow the games down. Both can be on at once. */
export interface Filters {
  /** Only the games of the teams the visitor follows. */
  myTeams: boolean;
  /** Only the games in which a model and the sportsbooks pick different sides. */
  differentPicks: boolean;
}

export const NO_FILTERS: Filters = { myTeams: false, differentPicks: false };

function startOf(game: { commence_time: string }): number {
  return Date.parse(game.commence_time);
}

/** By start, soonest first. Games that start at the same time keep the order they came in. */
function byStart<Game extends { commence_time: string }>(games: readonly Game[]): Game[] {
  return [...games].sort((a, b) => startOf(a) - startOf(b));
}

/** The games on the board that have not started at `now`, soonest first. */
export function upcomingGames(board: Board, now: number): BoardGame[] {
  return byStart(board.games.filter((game) => startOf(game) > now));
}

/**
 * The games of the current day's forecasts file that the board neither lists
 * nor has a result of. Empty while that file is not on the page.
 */
function offBoard(board: Board, now: number, files: FilesAtHand): PredictedGame[] {
  const today = pageDay(board, now);
  if (files.predictions?.day !== today) return [];

  const listed = new Set(board.games.map((game) => game.id));
  const recorded = new Set(board.recent_results.map((line) => line.id));
  return files.predictions.games.filter(
    (game) => gameDay(game.commence_time) === today && !listed.has(game.id) && !recorded.has(game.id),
  );
}

/**
 * Whether the board was taken before the scheduled start of a game. A board
 * lists every game of the response that had not started when it was taken,
 * so a game that such a board does not list was not in the response.
 */
function takenBefore(board: Board, game: { commence_time: string }): boolean {
  return Date.parse(board.generated_at) < startOf(game);
}

/**
 * The games of the current day that have started and have no result yet,
 * by start. A result is recorded on the next morning, so until then such a
 * game is in one of two places. A late game is still on the board, because
 * the last snapshot of the day is taken at 21:10 in New York. An earlier one
 * left the board with the first snapshot after its start, and is then only
 * in the forecasts file of the day, with the forecasts of its morning.
 */
export function startedGames(board: Board, now: number, files: FilesAtHand): CardGame[] {
  const today = pageDay(board, now);
  const started = (game: { commence_time: string }) => startOf(game) <= now && gameDay(game.commence_time) === today;

  const onBoard = board.games.filter(started).map((game) => boardGame(game, board, files));
  const left = offBoard(board, now, files)
    .filter((game) => started(game) && !takenBefore(board, game))
    .map(forecastGame);

  return byStart([...left, ...onBoard]);
}

/**
 * The games of the current day that had a forecast in the morning and that
 * the latest snapshot does not list, although it was taken before their
 * scheduled start. The odds provider no longer had such a game, which is
 * what a game that was put off or moved looks like from here. It is not
 * called started, at its scheduled time or after it.
 */
export function unlistedGames(board: Board, now: number, files: FilesAtHand): CardGame[] {
  return byStart(offBoard(board, now, files).filter((game) => takenBefore(board, game))).map(forecastGame);
}

/** One day of the rail. */
export interface DayChip {
  day: string;
  /** "Today", "Tomorrow", or the day as "Tue, Oct 20". */
  label: string;
  /** How many games of the day the page shows with the filters as they are. */
  games: number;
  selected: boolean;
}

export interface GamesOptions {
  board: Board;
  /** The time by the page's clock, in milliseconds. */
  now: number;
  /** What follows the view in the address: the day to show, or anything else a visitor typed. */
  param: string | null;
  files: FilesAtHand;
  /** The codes of the teams the visitor follows. */
  myTeams: ReadonlySet<string>;
  /** The filters the visitor has switched on. */
  filters: Filters;
  /** For the times on the cards. Without one the visitor's own zone is used. */
  timeZone?: string;
}

export interface GamesView {
  /** One chip for each day that has a game to show, in order. Empty when there is no game at all. */
  days: DayChip[];
  /** The day whose games are shown. Null when no day has one. */
  selected: string | null;
  /** The heading over the games of the selected day: "Today · Sun, Nov 8". */
  heading: string | null;
  /** The games of the selected day that are still to start and pass the filters, soonest first. */
  upcoming: GameCardView[];
  /** The games that have started and pass the filters. Empty unless the selected day is the current day. */
  started: GameCardView[];
  /** The games of the morning's forecasts that the latest snapshot no longer lists, and that pass the filters. Empty unless the selected day is the current day. */
  unlisted: GameCardView[];
  /** How many games the selected day has before the filters. */
  total: number;
  /**
   * True while the forecasts file of the current day is not on the page
   * although the board carries its forecasts. That file alone lists the games
   * of the day that have started and left the board, so until it is here the
   * current day can have games that the page does not know of.
   */
  awaitingStarted: boolean;
  /** Which filters can do something: a filter that cannot is not offered. */
  offered: Filters;
  /** Which filters are at work: the ones that are switched on and offered. */
  applied: Filters;
}

/** A day as the heading over its games names it. */
export function dayHeading(day: string, today: string): string {
  const label = dayLabel(day, today);
  const name = dayName(day);
  return label === name ? name : `${label} · ${name}`;
}

/** How many games a list shows, and of how many when a filter hides some: "5 games", "2 of 5 games". */
export function shownOf(shown: number, total: number): string {
  return shown === total ? countOf(total, 'game') : `${shown} of ${countOf(total, 'game')}`;
}

export function gamesView({ board, now, param, files, myTeams, filters, timeZone }: GamesOptions): GamesView {
  const today = pageDay(board, now);
  const upcoming = upcomingGames(board, now).map((game) => gameCardView(boardGame(game, board, files), timeZone));
  const started = startedGames(board, now, files).map((game) => gameCardView(game, timeZone));
  const unlisted = unlistedGames(board, now, files).map((game) => gameCardView(game, timeZone));
  const all = [...started, ...unlisted, ...upcoming];
  const awaitingStarted = board.models?.predictions_day === today && files.predictions?.day !== today;

  const offered = { myTeams: myTeams.size > 0, differentPicks: all.some((card) => card.differentPicks) };
  const applied = {
    myTeams: filters.myTeams && offered.myTeams,
    differentPicks: filters.differentPicks && offered.differentPicks,
  };
  const passes = (card: GameCardView) =>
    (!applied.myTeams || myTeams.has(card.home.code) || myTeams.has(card.away.code)) &&
    (!applied.differentPicks || card.differentPicks);

  // The current day when it has a game, otherwise the first day that has one. The address may name another.
  // A day whose forecasts the board carries has games. Late in the evening the board may list none of them any more,
  // and until the forecasts file is here the page knows none: the day keeps its place all the same.
  const withGames = [...new Set([...all.map((card) => card.day), ...(awaitingStarted ? [today] : [])])].sort();
  const preferred = withGames.includes(today) ? today : (withGames[0] ?? null);
  const selected = param !== null && withGames.includes(param) ? param : preferred;
  const ofSelected = (card: GameCardView) => card.day === selected;

  return {
    days: withGames.map((day) => ({
      day,
      label: dayLabel(day, today),
      games: all.filter((card) => card.day === day && passes(card)).length,
      selected: day === selected,
    })),
    selected,
    heading: selected === null ? null : dayHeading(selected, today),
    upcoming: upcoming.filter((card) => ofSelected(card) && passes(card)),
    started: started.filter((card) => ofSelected(card) && passes(card)),
    unlisted: unlisted.filter((card) => ofSelected(card) && passes(card)),
    total: all.filter(ofSelected).length,
    awaitingStarted,
    offered,
    applied,
  };
}

/**
 * The days next to the selected one in the rail, for the two links at the
 * foot of a day: whoever has read down a long day goes on from there. Each is
 * null where the rail ends.
 */
export function neighbors(days: readonly DayChip[]): { previous: DayChip | null; next: DayChip | null } {
  const selected = days.findIndex((chip) => chip.selected);
  if (selected < 0) return { previous: null, next: null };
  return { previous: days[selected - 1] ?? null, next: days[selected + 1] ?? null };
}

/**
 * The sentence under the heading of the games that have started, which are
 * games of `day`. Their forecasts are the ones that were frozen on the
 * morning of that day, and the sentence says so only of cards that hold
 * such a forecast. A number of Elo that was not frozen is not a forecast of
 * the morning, and the job does not grade it. The two mornings are named by
 * their dates, as on the results view: "tomorrow morning" is no longer true
 * after midnight, hours before the day of the page turns.
 */
export function startedNote(started: readonly GameCardView[], day: string): string {
  const results = `Results are due on the morning of ${dayName(addDays(day, 1))}.`;
  const frozen = `with the forecasts as they were frozen on the morning of ${dayName(day)}`;
  const forecasts = started.filter((card) => card.headline === 'points_rest' || card.headline === 'elo');
  const unfrozen = forecasts.filter((card) => !card.frozen);

  if (forecasts.length === 0) return `Under way or just over. ${results}`;
  if (unfrozen.length === 0) return `Under way or just over, ${frozen}. ${results}`;
  if (unfrozen.length === forecasts.length) {
    const [games, them] = started.length === 1 ? ['this game', 'it'] : ['these games', 'them'];
    return `Under way or just over. No forecast was frozen for ${games}, so the models are not graded on ${them}. ${results}`;
  }
  return `Under way or just over, ${frozen}. Where a card says "not frozen", no forecast was frozen for its game. ${results}`;
}

/**
 * The sentence under the heading of the games that the latest snapshot no
 * longer lists, of which there are `count`. The page knows that the odds
 * provider did not have them, and not why.
 */
export function unlistedNote(day: string, count: number): string {
  const missing =
    count === 1
      ? 'does not list this game, although it was taken before the scheduled start: the game may have been put off or moved'
      : 'does not list these games, although it was taken before their scheduled start: they may have been put off or moved';
  return `The latest snapshot of the sportsbooks' lines ${missing}. The forecasts are the ones frozen on the morning of ${dayName(day)}.`;
}

/** What the view says in place of the games when the filters hide every game of the selected day. */
export interface FilteredOut {
  title: string;
  /** Which filter hides the games, and how many. */
  text: string;
  /** The words of the button that switches the filters off. */
  showAll: string;
  /** The nearest day on which the filters keep a game, with the words of a link to it. Null when they keep none on any day. */
  elsewhere: { day: string; label: string } | null;
}

/** A day in the middle of a sentence: "today", "tomorrow", "on Tue, Nov 10". */
function when(chip: Pick<DayChip, 'day' | 'label'>): string {
  return chip.label === dayName(chip.day) ? `on ${chip.label}` : chip.label.toLowerCase();
}

/**
 * Null unless the selected day has games and the filters hide every one of
 * them. The link leads to the next day on which they keep a game, or else to
 * the last one before.
 */
export function filteredOut(view: GamesView): FilteredOut | null {
  const selected = view.days.findIndex((chip) => chip.selected);
  if (selected < 0 || view.total === 0 || view.upcoming.length + view.started.length + view.unlisted.length > 0) return null;

  const day = when(view.days[selected]);
  const games = view.total === 1 ? 'the one game' : `the ${view.total} games`;
  const showAll = view.total === 1 ? 'Show the game' : `Show all ${view.total} games`;
  const { myTeams, differentPicks } = view.applied;

  const kept = (chip: DayChip) => chip.games > 0;
  const nearest = view.days.slice(selected + 1).find(kept) ?? view.days.slice(0, selected).reverse().find(kept);
  const elsewhere = nearest
    ? { day: nearest.day, label: `See ${nearest.games === 1 ? 'the game' : `the ${nearest.games} games`} ${when(nearest)}` }
    : null;

  if (myTeams && differentPicks) {
    return {
      title: `No game of your teams ${day} has different picks`,
      text: `The filters My teams and Different picks hide ${games} of the day.`,
      showAll,
      elsewhere,
    };
  }
  if (myTeams) {
    return { title: `None of your teams plays ${day}`, text: `The filter My teams hides ${games} of the day.`, showAll, elsewhere };
  }
  return {
    title: `No game ${day} has different picks`,
    text: `The filter Different picks hides ${games} of the day.`,
    showAll,
    elsewhere,
  };
}
