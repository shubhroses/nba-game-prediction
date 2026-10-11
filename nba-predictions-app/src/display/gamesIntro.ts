/**
 * What stands above the games: a sentence or two on what the forecasts of
 * the board rest on, a notice when one model is left out, and the record of
 * each source's picks so far. All of it is read from the board.
 */
import type { Board, Tally } from '../data/board';
import { dayName, gameDay, pageDay } from './day';
import { winsLosses } from './numbers';
import { missingPointsRest } from './pointsRest';
import { source, SOURCES, type SourceKey } from './sources';

export interface GamesIntro {
  /** One to three sentences for the top of the view. */
  sentences: string[];
  /** Set when the points-and-rest model is left out of the forecasts on the board. */
  leftOut: { title: string; text: string } | null;
}

const NOT_BUILT = "The models have not made a forecast yet, so a card shows the sportsbooks' line alone.";
const OPENING_RATINGS = 'Both models are still on their opening ratings, because no game of the season is on record yet.';
const FROZEN_TODAY = "Today's forecasts were made this morning and do not change.";
const EARLY_LOOK = "Until the morning of a game, its card shows Elo's early look.";
// pipeline/README.md: a game of a morning on which the daily work was not done has no forecast, and is not graded for the models.
const NOT_FROZEN =
  "No forecast is frozen for today's games: their cards show Elo from its current ratings, and the models are graded on frozen forecasts only.";

// The board says that the checks failed and not what they found. The model file does, and the Rankings view shows it.
const LEFT_OUT = {
  title: `${source('points_rest').name} is left out today`,
  text:
    "The results on record did not pass this morning's checks, so the forecasts were made without it. " +
    `${source('elo').name} is shown alone until they pass again.`,
};

/**
 * What the forecasts rest on, from `models` of the board, and whether those
 * of the current day are frozen. `results_through` is the day of the last
 * result that was replayed. It does not say that no earlier result is
 * missing, so the sentence speaks of the results on record.
 */
export function gamesIntro(board: Board, now: number): GamesIntro {
  const { models } = board;
  if (models === null) return { sentences: [NOT_BUILT], leftOut: null };

  const ratings =
    models.results_through === null
      ? OPENING_RATINGS
      : `Ratings include every result on record through ${dayName(models.results_through)}.`;
  const leftOut = models.status === 'degraded' ? LEFT_OUT : null;

  const today = pageDay(board, now);
  if (models.predictions_day === today) return { sentences: [ratings, FROZEN_TODAY], leftOut };

  // The morning of the current day has come and the board has a game of the day without a forecast: the daily work of that morning was not done.
  const unfrozen = board.games.some((game) => gameDay(game.commence_time) === today && missingPointsRest(game, board) === 'none');
  return { sentences: unfrozen ? [ratings, NOT_FROZEN, EARLY_LOOK] : [ratings, EARLY_LOOK], leftOut };
}

/** The record of one source's picks so far. */
export interface RecordTile {
  source: SourceKey;
  wins: number;
  losses: number;
  /** As "72–44". */
  record: string;
}

/** What stands in place of the tiles before the first pick is graded. */
export const NO_RECORD_YET = 'No pick has been graded yet. A game is graded on the morning after it is played.';

/**
 * One tile for each source that the board has a record of, in the order of
 * the page. Empty until a pick of any source has been graded, which the
 * view says in a sentence in place of three tiles of 0–0.
 */
export function recordTiles(board: Board): RecordTile[] {
  const { record } = board;
  if (record === null) return [];

  const tallies: Record<SourceKey, Tally | null> = { points_rest: record.points_rest, elo: record.elo, market: record.market };
  const tiles = SOURCES.flatMap(({ key }) => {
    const tally = tallies[key];
    return tally === null ? [] : [{ source: key, wins: tally.wins, losses: tally.losses, record: winsLosses(tally.wins, tally.losses) }];
  });
  return tiles.some((tile) => tile.wins + tile.losses > 0) ? tiles : [];
}

/**
 * What the tallies of the strip are of. Each source is graded on its own
 * picks, so the tallies are not of the same games: more picks won can go
 * with a smaller share of them.
 */
export const OWN_PICKS = 'each source on its own picks';

/** The tiles in one sentence, for a visitor who hears the page: "72–44" alone does not say which number is the wins. */
export function recordSummary(tiles: readonly RecordTile[]): string {
  const each = tiles.map((tile) => `${source(tile.source).name} ${tile.wins} won and ${tile.losses} lost`);
  const whose = tiles.length > 1 ? `, ${OWN_PICKS}` : '';
  return `Picks so far this season${whose}: ${each.join(', ')}. See the full record.`;
}
