/**
 * The backtest that the two models were chosen in, as the page shows it: the
 * table of pipeline/model/README.md and what that document says the figures
 * do and do not show. Every figure is copied as it is written there, and
 * backtest.test.ts holds each of them to the document.
 *
 * None of the figures is a result of this season. The page shows them under
 * their label only: on the How it works view, and on the Record view while
 * the record has no game. It never shows one next to the record.
 */

/** A figure of the backtest with its 95% interval, as the document writes them. */
export interface BacktestFigure {
  /** "67.6%", "0.6031". */
  figure: string;
  /** "65.8% to 69.3%". Null where the document gives the figure alone. */
  interval: string | null;
}

export interface BacktestRow {
  /** The model, for its name and its color. Null for the row that is no model. */
  source: 'points_rest' | 'elo' | null;
  /** What the row is called when it is no model. */
  name: string | null;
  /** A few words under the name. */
  note: string | null;
  /**
   * The share of the games whose winner was given more than 50%, and how many
   * games that was, as the document writes the number: "1,786". Null where it
   * gives the share alone.
   */
  winners: BacktestFigure & { games: string | null };
  logLoss: BacktestFigure;
  brier: BacktestFigure;
}

/** A sentence of caution: its first words, which carry it, and the rest. */
export interface Caution {
  lead: string;
  text: string;
}

/** The games of the two test seasons, as the document writes the number. */
const GAMES = '2,643';
const SEASONS = ['2024-25', '2025-26'] as const;

/** In the order of the page: Points & Rest, Elo, and what the two are held against. */
const ROWS: BacktestRow[] = [
  {
    source: 'points_rest',
    name: null,
    note: null,
    winners: { figure: '67.6%', games: '1,786', interval: '65.8% to 69.3%' },
    logLoss: { figure: '0.6031', interval: '0.5890 to 0.6175' },
    brier: { figure: '0.2082', interval: '0.2020 to 0.2145' },
  },
  {
    source: 'elo',
    name: null,
    note: null,
    winners: { figure: '66.7%', games: '1,762', interval: '64.9% to 68.4%' },
    logLoss: { figure: '0.6065', interval: '0.5919 to 0.6212' },
    brier: { figure: '0.2096', interval: '0.2032 to 0.2161' },
  },
  {
    source: null,
    name: 'The home team every time',
    note: "at last season's home-win rate",
    winners: { figure: '55.0%', games: null, interval: null },
    logLoss: { figure: '0.6881', interval: null },
    brier: { figure: '0.2475', interval: null },
  },
];

/** What saying one half for every game scores. */
const COIN_FLIP = { logLoss: '0.6931', brier: '0.25' } as const;

/** Points & Rest next to Elo, game by game. */
const DIFFERENCE = {
  /** How many more winners it picked, and the two ends of the 95% interval of that difference. */
  winners: { games: 24, fewer: 1, more: 49 },
  /** How much lower its log loss was, and the two ends of the 95% interval of that. */
  logLoss: { lower: '0.0034', from: '0.0067', to: '0.0001' },
  /** How much lower its Brier score was. */
  brier: '0.0015',
} as const;

export const BACKTEST = {
  games: GAMES,
  seasons: SEASONS,
  /** What every figure of the backtest is shown with. */
  label: `A backtest on ${GAMES} games of ${SEASONS[0]} and ${SEASONS[1]}, with no odds in it. It is not a result of this season.`,
  rows: ROWS,
  coinFlip: COIN_FLIP,
  difference: DIFFERENCE,
  /** The backtest counted a pick in another way than the record does. */
  pickNote:
    'In the backtest a winner counted as picked when it was given more than 50%. ' +
    'The record counts a pick from 52% on, so its shares of wins are not the same kind of number as these.',
  scoresNote:
    'Lower is better for log loss and for the Brier score, ' +
    `and a coin flip for every game scores ${COIN_FLIP.logLoss} and ${COIN_FLIP.brier}.`,
  /** The two plainest of the cautions that the document gives, in its words. */
  cautions: {
    winners: {
      lead: 'It is not shown that Points & Rest picks more winners than Elo.',
      text:
        `The gap of ${DIFFERENCE.winners.games} games is within what chance produces: the 95% interval of the difference ` +
        `runs from ${DIFFERENCE.winners.fewer} game fewer to ${DIFFERENCE.winners.more} more. ` +
        'Expect the two to pick about the same number of winners.',
    },
    sportsbooks: {
      lead: 'Neither model was tested against the sportsbooks.',
      text: 'The backtest had no odds.',
    },
  } satisfies Record<string, Caution>,
};

/**
 * The games that a share of the backtest is of: "1,786 of 2,643 games", or
 * "of 2,643 games" where the count of winners is not given.
 */
export function backtestCount({ games }: BacktestRow['winners']): string {
  return games === null ? `of ${GAMES} games` : `${games} of ${GAMES} games`;
}
