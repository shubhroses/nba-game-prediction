/**
 * The figures that the How it works view quotes from pipeline/model/README.md
 * and from the two opening files of the season. They are written out here,
 * and method.test.ts holds each of them to the document and to the files, so
 * that the page cannot go on showing a number that the job no longer uses.
 */
import { eloChance, eloGap, eloHomeGain, eloMultiplier } from './methodElo';
import { wholePercent } from './pick';
import { teamName } from './teams';

/**
 * The parts of the view, in the order they are in. `short` is what the row
 * of buttons at the top of the view calls a part.
 */
export const METHOD_PARTS = [
  { id: 'page', title: 'What this page is', short: 'This page' },
  { id: 'elo', title: 'Elo', short: 'Elo' },
  { id: 'points-rest', title: 'Points & Rest', short: 'Points & Rest' },
  { id: 'frozen', title: 'Frozen on the morning of the game', short: 'Frozen forecasts' },
  { id: 'grading', title: 'How a forecast is graded', short: 'Grading' },
  { id: 'limits', title: 'What the models cannot know', short: 'Limits' },
  { id: 'backtest', title: 'The backtest', short: 'Backtest' },
  { id: 'sources', title: 'Where the numbers come from', short: 'Sources' },
  { id: 'more', title: 'Read more', short: 'Read more' },
] as const;

export type MethodPart = (typeof METHOD_PARTS)[number]['id'];

/** The title of a part. */
export function partTitle(id: MethodPart): string {
  return METHOD_PARTS.find((part) => part.id === id)?.title ?? id;
}

/**
 * The id that the element of a part has in the document. A button scrolls
 * to it. No link leads to it, because the address after the # is the route.
 */
export function partAnchor(id: MethodPart): string {
  return `how-${id}`;
}

/** The constants of Elo, as elo_2026_27.json has them. */
export const ELO = {
  /** How far one result can move a rating. */
  k: 20,
  /** What the home team is given, in rating points. None on a neutral floor. */
  homeCourt: 40,
  /** The league's average rating. */
  mean: 1505,
  /** The share of its distance to the average that a rating gives up between two seasons. */
  reversion: 0.25,
} as const;

/** How many games of the three seasons since FiveThirtyEight's file ends the opening ratings were carried through. */
export const ELO_CARRIED_THROUGH = '3,962';

/** The worked game of the README: Boston hosts New York and wins by eight. */
const WORKED = { home: 'BOS', away: 'NYK', homeRating: 1607, awayRating: 1720, homePts: 112, awayPts: 104 } as const;

export interface WorkedGame {
  /** The two teams by name. */
  home: string;
  away: string;
  homeRating: number;
  awayRating: number;
  homeCourt: number;
  /** The home team's rating, plus the home court, minus the away team's rating. */
  gap: number;
  /** The home team's chance to four decimals, and as a card would show it. */
  chance: string;
  percent: number;
  homePts: number;
  awayPts: number;
  /** By how many points the home team won. */
  margin: number;
  k: number;
  /** What the margin and the gap make of K, to four decimals. */
  multiplier: string;
  /** What the home team gains and the away team loses, to two decimals. */
  gain: string;
}

/** The worked game with every number of it worked out here, by the page's own arithmetic. */
export function workedGame(): WorkedGame {
  const { homeRating, awayRating, homePts, awayPts } = WORKED;
  const gap = eloGap(homeRating, awayRating, ELO.homeCourt);
  const chance = eloChance(homeRating, awayRating, ELO.homeCourt);
  const margin = homePts - awayPts;
  return {
    home: teamName(WORKED.home),
    away: teamName(WORKED.away),
    homeRating,
    awayRating,
    homeCourt: ELO.homeCourt,
    gap,
    chance: chance.toFixed(4),
    percent: wholePercent(chance),
    homePts,
    awayPts,
    margin,
    k: ELO.k,
    multiplier: eloMultiplier(margin, gap).toFixed(4),
    gain: eloHomeGain({ homeRating, awayRating, homePts, awayPts, homeCourt: ELO.homeCourt, k: ELO.k }).toFixed(2),
  };
}

/** The numbers of Points & Rest, as points_rest_2026_27.json has them, rounded as the README writes them. */
export const POINTS_REST = {
  /** The noise of a single game, in points. */
  noise: 12,
  /** The margin that a blowout counts as. */
  cap: 22,
  /** What a variance grows by on each day without a game. */
  drift: 0.06,
  /** What scales the width of the bell curve. */
  scale: 0.9446,
  /** The league's home court on opening day, and the constant that is added to it for every home team. */
  leagueHomeCourt: 1.725,
  homeConstant: -0.633,
  /** Added for each kilometre that the home arena lies above the visitors'. */
  altitudePerKm: 0.742,
  /** What that comes to against a team from sea level in the two arenas that lie high, in points. */
  altitude: { denver: 1.2, utah: 1.0 },
  /** How well a rating is known on opening night and after 40 games, in points, and the share of a surprise it then takes. */
  known: { opening: 3.1, afterForty: 2.2, openingShare: '6%', afterFortyShare: '3%' },
  /** What a point of margin is worth near an even game on opening night, in percentage points. */
  pointWorth: 3.4,
} as const;

/** What a home team at sea level with equal rest starts the season with, in points. */
export const OPENING_HOME_COURT = POINTS_REST.leagueHomeCourt + POINTS_REST.homeConstant;

/** One of the terms that make up the rest part of a margin. `points` is what it adds for the home team. */
export interface RestTerm {
  when: string;
  points: number;
}

export const REST_TERMS: readonly RestTerm[] = [
  { when: 'The home team played yesterday', points: -1.352 },
  { when: 'The away team played yesterday', points: 1.706 },
  { when: 'Each game more that the home team played in the last seven days', points: -0.319 },
];
