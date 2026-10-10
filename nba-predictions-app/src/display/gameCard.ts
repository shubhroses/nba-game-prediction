import type { BoardGame } from '../data/board';
import { teamName } from './teams';

/** Within this many points of 50% the card names no favorite. */
const TOSS_UP_POINTS = 2;

export interface CardTeam {
  name: string;
  /** The team's implied chance of winning, in whole percent. Null without a line. */
  chance: number | null;
  /** The lowest and the highest sportsbook, when there are two or more and they differ. */
  range: { low: number; high: number } | null;
}

export type Outlook =
  | { kind: 'favorite'; side: 'home' | 'away'; team: string; chance: number }
  | { kind: 'toss-up' }
  | { kind: 'no-line' };

/** What the card of one game shows. */
export interface GameCardView {
  id: string;
  startsAt: Date;
  home: CardTeam;
  away: CardTeam;
  outlook: Outlook;
  /** How many sportsbooks the chances are the median of. 0 without a line. */
  sportsbooks: number;
}

/** The board gives a probability to four decimals. Hundredths of a percent are whole numbers, so they compare exactly. */
function hundredths(probability: number): number {
  return Math.round(probability * 10_000);
}

/** Whole percent, kept between 1 and 99: a line never says that a team cannot lose. */
function wholePercent(probability: number): number {
  return Math.min(99, Math.max(1, Math.round(hundredths(probability) / 100)));
}

function outlook(pHome: number, home: string, away: string, homeChance: number): Outlook {
  const fromEven = hundredths(pHome) - 5000;
  if (Math.abs(fromEven) <= TOSS_UP_POINTS * 100) return { kind: 'toss-up' };
  return fromEven > 0
    ? { kind: 'favorite', side: 'home', team: home, chance: homeChance }
    : { kind: 'favorite', side: 'away', team: away, chance: 100 - homeChance };
}

export function gameCardView(game: BoardGame): GameCardView {
  const card = { id: game.id, startsAt: new Date(game.commence_time) };
  const home = teamName(game.home);
  const away = teamName(game.away);
  const { line } = game;
  if (line === null) {
    return {
      ...card,
      home: { name: home, chance: null, range: null },
      away: { name: away, chance: null, range: null },
      outlook: { kind: 'no-line' },
      sportsbooks: 0,
    };
  }

  // The away team's numbers are the home team's taken from 100, so that the two always add up.
  const chance = wholePercent(line.p_home);
  const low = wholePercent(line.lo);
  const high = wholePercent(line.hi);
  const apart = line.n >= 2 && low !== high;
  return {
    ...card,
    home: { name: home, chance, range: apart ? { low, high } : null },
    away: { name: away, chance: 100 - chance, range: apart ? { low: 100 - high, high: 100 - low } : null },
    outlook: outlook(line.p_home, home, away, chance),
    sportsbooks: line.n,
  };
}

/** The games that have not started at `now`, soonest first. */
export function upcomingCards(games: readonly BoardGame[], now: number): GameCardView[] {
  return games
    .map(gameCardView)
    .filter((card) => card.startsAt.getTime() > now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The label in the corner of the card. */
export function outlookLabel(outlook: Outlook): string {
  switch (outlook.kind) {
    case 'favorite':
      return `${outlook.chance}% implied`;
    case 'toss-up':
      return 'Toss-up';
    case 'no-line':
      return 'No line yet';
  }
}

/** Says how many sportsbooks are behind the chances. Null without a line. */
export function sportsbooksNote(card: GameCardView): string | null {
  if (card.sportsbooks === 0) return null;
  if (card.sportsbooks === 1) return '1 sportsbook';
  return card.home.range
    ? `Median of ${card.sportsbooks} sportsbooks`
    : `${card.sportsbooks} sportsbooks within a point of each other`;
}
