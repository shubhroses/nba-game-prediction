/**
 * What the record view says of the season as a whole, from `record.json`:
 * which sources it has a scorecard for, since when, what stands in for it
 * before the first game, and which sources have too few picks for their
 * numbers to hold still. pipeline/README.md says under "The record" how each
 * number of the file is worked out.
 */
import type { Board } from '../data/board';
import type { ModelScorecard, RecordedGame, Scorecard, SeasonRecord } from '../data/record';
import { currentDay, dayName, gameDay } from './day';
import { countOf, winsLosses, written } from './numbers';
import { source, type Source } from './sources';
import { winningSide } from './verdict';
import { listed } from './words';

/** The first day of the regular season of 2026-27, as pipeline/README.md gives it under "The replay". */
export const OPENING_DAY = '2026-10-20';

/** Below this many graded picks, the games of one evening move a share of wins by several points. */
export const FEW_PICKS = 30;

/** The two models in the order of the page, by the names that the record has for them. */
const MODEL_KEYS = ['points_rest', 'elo'] as const;

/** One source with what the record holds for it. */
export interface SourceCard {
  source: Source;
  card: Scorecard;
}

/** A model with its scorecard, which also holds how it did next to the sportsbooks' line. */
export interface ModelCard {
  source: Source;
  card: ModelScorecard;
}

/** The models that the record has a scorecard for, Points & Rest first. A sport that is not forecast has none. */
export function modelCards(record: SeasonRecord): ModelCard[] {
  return MODEL_KEYS.flatMap((key) => {
    const card = record[key];
    return card === null ? [] : [{ source: source(key), card }];
  });
}

/** Every source that the record has a scorecard for, in the order of the page: the models, then the sportsbooks. */
export function sourceCards(record: SeasonRecord): SourceCard[] {
  return [...modelCards(record), { source: source('market'), card: record.market }];
}

/**
 * How many games the record is of and which days they span, as one sentence:
 * "143 games since Tue, Oct 20, the latest on Sat, Nov 7." Null before the
 * first game.
 */
export function seasonLine(record: SeasonRecord): string | null {
  if (record.games === 0 || record.since === null) return null;

  const games = `${countOf(record.games, 'game')} since ${dayName(record.since)}`;
  const latest = record.by_day[record.by_day.length - 1]?.day;
  return latest === undefined || latest === record.since ? `${games}.` : `${games}, the latest on ${dayName(latest)}.`;
}

/** What stands where the record would be while it has no game. */
export interface NoRecordYet {
  title: string;
  text: string;
}

/**
 * Before the first game is recorded the view says when the record starts.
 * Through opening day that is opening night. After it, a record without a
 * game means that no result has come in, and the view says no more than that.
 */
export function noRecordYet(now: number): NoRecordYet {
  if (currentDay(now) <= OPENING_DAY) {
    return {
      title: 'The record starts with opening night',
      text:
        `The regular season opens on ${dayName(OPENING_DAY)}. Its games are graded on the morning after, ` +
        'and from then on this view shows how the picks of each model and of the sportsbooks have done.',
    };
  }
  return {
    title: 'No result has been recorded yet',
    text: 'A result is recorded on the morning after its game, and the record starts with the first one.',
  };
}

/** A source whose share of wins is of fewer than FEW_PICKS picks. */
export interface FewPicks {
  source: Source;
  picks: number;
}

/** The sources that have fewer than 30 graded picks so far, in the order of the page. */
export function fewPicks(record: SeasonRecord): FewPicks[] {
  return sourceCards(record)
    .filter(({ card }) => card.games < FEW_PICKS)
    .map(({ source: entry, card }) => ({ source: entry, picks: card.games }));
}

/** The notice for those sources. Null when every source has 30 picks or more. */
export function fewPicksNote(few: readonly FewPicks[]): string | null {
  if (few.length === 0) return null;

  const sources = listed(few.map(({ source: entry, picks }) => `${entry.name} (${written(picks)})`));
  return (
    `Fewer than ${FEW_PICKS} picks have been graded for ${sources}. ` +
    'The games of one evening can still move a share of wins by several points, which is what the wide 95% intervals say.'
  );
}

/** The picks that a source won and lost, as the board carries them. */
export interface BoardTally {
  source: Source;
  /** "72–44". */
  tally: string;
}

/**
 * The picks won and lost of each source as the board carries them, in the
 * order of the page. They stand in for the record when its file cannot be
 * shown: the board holds these two counts and nothing else of the record.
 * Empty while no pick of any source has been graded, when there is nothing
 * to fall back on.
 */
export function boardTallies(board: Board): BoardTally[] {
  const { record } = board;
  if (record === null) return [];

  const tallies = [...MODEL_KEYS, 'market' as const].flatMap((key) => {
    const tally = record[key];
    return tally === null ? [] : [{ source: source(key), ...tally }];
  });
  if (tallies.every(({ wins, losses }) => wins + losses === 0)) return [];
  return tallies.map(({ source: entry, wins, losses }) => ({ source: entry, tally: winsLosses(wins, losses) }));
}

/** The day of a game that the record names, as "Sat, Nov 7". */
export function recordedDay(game: RecordedGame): string {
  return dayName(gameDay(game.commence_time));
}

/** The same day without its weekday, for a row that has little room: "Nov 7". */
export function recordedDate(game: RecordedGame): string {
  return recordedDay(game).replace(/^\w+, /, '');
}

/** The final score of a game that the record names, by team codes and with the winner first: "DAL 130, CHI 119". */
export function finalScore(game: RecordedGame): string {
  const home = `${game.home} ${game.home_pts}`;
  const away = `${game.away} ${game.away_pts}`;
  return winningSide(game) === 'home' ? `${home}, ${away}` : `${away}, ${home}`;
}
