/**
 * Calibration: whether the favorites that a source gave about 70% won about
 * 70% of the time. The record sorts the picks of each source into five bands
 * by the chance that the favorite was given. For each band the view shows
 * what was said, which is the mean of those chances, against what happened,
 * which is the share of those favorites that won: as a dot on a chart and as
 * a row of the table under it.
 */
import type { Band, Scorecard } from '../data/record';
import { countOf, shareOf, written } from './numbers';
import { onePlaceChance } from './pick';

/** A band with fewer games than this is drawn faint: its share of wins is of too few games to read anything from. */
export const FAINT_BELOW = 10;

/** One band of one source, as a row of the table. */
export interface BandRow {
  /** "52–59%", or "90% and up" for the last band. */
  label: string;
  games: number;
  wins: number;
  /** What was said: the mean chance of the favorites in the band. Null for a band without a game. */
  said: number | null;
  /** "55.7%". */
  saidText: string | null;
  /** What happened: the share of those favorites that won. Null for a band without a game. */
  happened: number | null;
  /** "47.5%". */
  happenedText: string | null;
  /** True for a band with a game and fewer than ten of them. */
  faint: boolean;
}

/** The name of a band as the page writes it, from the name that the file gives it: `52-59` or `90+`. */
export function bandLabel(band: string): string {
  const range = /^(\d+)-(\d+)$/.exec(band);
  if (range) return `${range[1]}–${range[2]}%`;

  const open = /^(\d+)\+$/.exec(band);
  return open ? `${open[1]}% and up` : band;
}

function bandRow(band: Band): BandRow {
  // A band without a game has nothing that was said and nothing that happened, and the page shows neither.
  const played = band.games > 0;
  const said = played ? band.mean_p_favorite : null;
  const happened = played ? band.wins / band.games : null;
  return {
    label: bandLabel(band.band),
    games: band.games,
    wins: band.wins,
    said,
    saidText: said === null ? null : onePlaceChance(said),
    happened,
    happenedText: played ? shareOf(band.wins, band.games) : null,
    faint: played && band.games < FAINT_BELOW,
  };
}

/** The five bands of a source, in the order of the file. */
export function bandRows(card: Scorecard): BandRow[] {
  return card.bands.map(bandRow);
}

/** The most games that any band of these sources has, which the size of every dot is measured against. */
export function mostGames(cards: readonly Scorecard[]): number {
  return Math.max(0, ...cards.flatMap((card) => card.bands.map((band) => band.games)));
}

/**
 * The frame of a chart, in the units of its drawing. What was said runs
 * across, from an even game at the left to a certain one at the right: a
 * favorite is never below 52%. What happened runs up, from none of the
 * favorites to all of them.
 */
export const CHART = { width: 240, height: 208, left: 38, right: 222, top: 26, bottom: 170 } as const;

/** The chances that the lines of the chart are drawn at, across and up. */
export const SAID_TICKS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
export const HAPPENED_TICKS = [0, 0.25, 0.5, 0.75, 1];

const SAID_FROM = 0.5;
const SMALLEST_DOT = 3.5;
const LARGEST_DOT = 10;

const tenth = (units: number) => Math.round(units * 10) / 10;

/** Where a chance that was said lies across the chart. */
export function chartX(said: number): number {
  const share = (Math.min(1, Math.max(SAID_FROM, said)) - SAID_FROM) / (1 - SAID_FROM);
  return tenth(CHART.left + share * (CHART.right - CHART.left));
}

/** Where a share that happened lies up the chart. The top of a drawing is zero, so more is less. */
export function chartY(happened: number): number {
  return tenth(CHART.bottom - Math.min(1, Math.max(0, happened)) * (CHART.bottom - CHART.top));
}

/** The radius of the dot of a band. Its area grows with the games of the band, up to the band with the most. */
export function dotRadius(games: number, most: number): number {
  const share = most > 0 ? Math.min(1, games / most) : 0;
  return tenth(SMALLEST_DOT + (LARGEST_DOT - SMALLEST_DOT) * Math.sqrt(share));
}

/** Where the number of games of a band is written next to its dot. */
export interface DotNumber {
  /** "40". */
  text: string;
  x: number;
  /** The line that the text stands on. */
  y: number;
  /** `middle` for a number above or under its dot, `end` for one to the left of it. */
  anchor: 'middle' | 'end';
}

/** One band on the chart. A band without a game has no dot. */
export interface ChartDot {
  label: string;
  x: number;
  y: number;
  r: number;
  games: DotNumber;
  faint: boolean;
  /** The band in words, for a visitor who points at the dot: "52–59%: given 55.7% on average, won 47.5% of 40 games". */
  words: string;
}

// The height of a line of the small text of the chart, how high its digits are, and the room between a dot and its number.
const TEXT = 12;
const DIGIT = 9;
const GAP = 4;
// The top of the drawing, down to here, belongs to the title of the axis that runs up.
const TITLE_ROOM = 14;

/**
 * The number goes where the chart is empty. The dots lie along the dashed
 * line, which rises to the right, so there is room above a dot that is on or
 * over the line and under a dot that is below it. Near the top of the chart
 * the title of the axis is in the way and the number stands to the left of
 * its dot, and on the bottom of the chart it stands above.
 */
function numberOf(text: string, belowTheLine: boolean, x: number, y: number, r: number): DotNumber {
  const above: DotNumber = { text, x, y: tenth(y - r - GAP), anchor: 'middle' };
  const under: DotNumber = { text, x, y: tenth(y + r + GAP + DIGIT), anchor: 'middle' };

  if (belowTheLine) return under.y <= CHART.bottom - GAP ? under : above;
  if (above.y - TEXT >= TITLE_ROOM) return above;
  return { text, x: tenth(x - r - GAP), y: tenth(y + DIGIT / 2), anchor: 'end' };
}

/** The dots of the bands that have a game. `most` is from mostGames, so that the charts of all sources share one scale. */
export function chartDots(rows: readonly BandRow[], most: number): ChartDot[] {
  return rows.flatMap((row) => {
    if (row.said === null || row.happened === null) return [];

    const x = chartX(row.said);
    const y = chartY(row.happened);
    const r = dotRadius(row.games, most);
    return [
      {
        label: row.label,
        x,
        y,
        r,
        games: numberOf(written(row.games), row.happened < row.said, x, y, r),
        faint: row.faint,
        words: `${row.label}: given ${row.saidText} on average, won ${row.happenedText} of ${countOf(row.games, 'game')}`,
      },
    ];
  });
}

/**
 * What the chart of a source shows, for a visitor who cannot see it. The
 * table with the numbers stands under the chart or next to it, by the width
 * of the screen.
 */
export function chartLabel(name: string, rows: readonly BandRow[]): string {
  const played = rows.filter((row) => row.games > 0).length;
  if (played === 0) return `${name}: no pick has been graded yet, so the chart is empty.`;
  return (
    `${name}: the chance it gave its picks against the share of them that won, for ${countOf(played, 'band')} of chances. ` +
    'The table that goes with the chart has the same numbers.'
  );
}
