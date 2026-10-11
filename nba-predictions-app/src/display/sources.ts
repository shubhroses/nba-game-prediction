/**
 * The three sources of a chance, in the order the page shows them: its two
 * models first, then the sportsbooks they are graded against. Each has one
 * color, which tailwind.config.js names.
 */
import type { BoardGame } from '../data/board';
import type { ResultLine, Verdict } from '../data/results';

/** The name of a source in the result lines and in the record. */
export type SourceKey = 'points_rest' | 'elo' | 'market';

export interface Source {
  key: SourceKey;
  /** As the page writes it. */
  name: string;
  /** One line that says what the source is. */
  description: string;
  /** The name of its color, as in `text-pr`, `bg-elo-soft` and `fill-books`. */
  token: 'pr' | 'elo' | 'books';
  /**
   * The classes of its color, written out. Tailwind keeps a class only when
   * it finds the whole name in a source file, so a name must not be put
   * together from the token.
   */
  text: string;
  bg: string;
  soft: string;
  border: string;
  fill: string;
  stroke: string;
}

const BY_KEY: Record<SourceKey, Source> = {
  points_rest: {
    key: 'points_rest',
    name: 'Points & Rest',
    description: 'A rating in points for every team, plus home court and rest, made on the morning of the game.',
    token: 'pr',
    text: 'text-pr',
    bg: 'bg-pr',
    soft: 'bg-pr-soft',
    border: 'border-pr',
    fill: 'fill-pr',
    stroke: 'stroke-pr',
  },
  elo: {
    key: 'elo',
    name: 'Elo',
    description: 'One rating for each team, moved by every result and its margin.',
    token: 'elo',
    text: 'text-elo',
    bg: 'bg-elo',
    soft: 'bg-elo-soft',
    border: 'border-elo',
    fill: 'fill-elo',
    stroke: 'stroke-elo',
  },
  market: {
    key: 'market',
    name: 'Sportsbooks',
    description: 'The median of what the sportsbooks imply, with their margin taken out: the yardstick for both models.',
    token: 'books',
    text: 'text-books',
    bg: 'bg-books',
    soft: 'bg-books-soft',
    border: 'border-books',
    fill: 'fill-books',
    stroke: 'stroke-books',
  },
};

/** In the order of the page: Points & Rest, Elo, Sportsbooks. */
export const SOURCES: readonly Source[] = [BY_KEY.points_rest, BY_KEY.elo, BY_KEY.market];

/** The two models, without the sportsbooks. */
export const MODELS: readonly Source[] = [BY_KEY.points_rest, BY_KEY.elo];

export function source(key: SourceKey): Source {
  return BY_KEY[key];
}

/**
 * A source's chance for the home team of a game on the board. Null when the
 * board holds none: no line yet, no forecast yet, a model left out.
 */
export function boardChance(game: BoardGame, key: SourceKey): number | null {
  switch (key) {
    case 'points_rest':
      return game.points_rest?.p_home ?? null;
    case 'elo':
      return game.elo?.p_home ?? null;
    case 'market':
      return game.line?.p_home ?? null;
  }
}

/** What a source said of a game that is over, as its chance for the home team. Null when it said nothing. */
export function resultChance(line: ResultLine, key: SourceKey): number | null {
  return line[key]?.p_home ?? null;
}

/** The verdict on a source for a game that is over. */
export function resultVerdict(line: ResultLine, key: SourceKey): Verdict {
  return line[`${key}_verdict`];
}
