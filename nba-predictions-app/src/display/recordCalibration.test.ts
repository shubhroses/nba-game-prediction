import { describe, expect, it } from 'vitest';
import { sampleRecord } from '../data/sampleData';
import {
  bandLabel,
  bandRows,
  CHART,
  chartDots,
  chartLabel,
  chartX,
  chartY,
  dotRadius,
  FAINT_BELOW,
  HAPPENED_TICKS,
  mostGames,
  SAID_TICKS,
} from './recordCalibration';
import { bandsOf, modelScorecard, scorecard } from './recordExamples';

function must<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`The sample has no ${what}`);
  return value;
}

describe('bandLabel', () => {
  it('writes the names of the five bands as chances', () => {
    const names = ['52-59', '60-69', '70-79', '80-89', '90+'];

    expect(names.map(bandLabel)).toEqual(['52–59%', '60–69%', '70–79%', '80–89%', '90% and up']);
  });

  it('leaves a name it does not know as it is', () => {
    expect(bandLabel('other')).toBe('other');
  });
});

describe('bandRows', () => {
  const record = sampleRecord();

  it('gives for each band what was said and what happened, with the games it is of', () => {
    const rows = bandRows(must(record.points_rest, "record of the points-and-rest model's picks"));

    expect(rows.map((row) => [row.label, row.games, row.wins, row.saidText, row.happenedText])).toEqual([
      ['52–59%', 40, 19, '55.7%', '47.5%'],
      ['60–69%', 35, 20, '64.9%', '57.1%'],
      ['70–79%', 29, 22, '75.6%', '75.9%'],
      ['80–89%', 11, 10, '83.9%', '90.9%'],
      ['90% and up', 1, 1, '94.6%', '100.0%'],
    ]);
    expect(rows[0]).toMatchObject({ said: 0.5574, happened: 19 / 40 });
  });

  it('marks a band with fewer than ten games, which is too few to read', () => {
    expect(FAINT_BELOW).toBe(10);
    expect(bandRows(must(record.points_rest, "record of the points-and-rest model's picks")).map((row) => row.faint)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(bandRows(record.market).map((row) => row.faint)).toEqual([false, false, false, false, true]);
  });

  it('draws the line at ten games', () => {
    const rows = bandRows(scorecard({ bands: bandsOf([[9, 5, 0.55], [10, 6, 0.64]]) }));

    expect(rows.map((row) => row.faint)).toEqual([true, false, false, false, false]);
  });

  it('shows nothing that was said and nothing that happened for a band without a game, as in the file of 10 October', () => {
    for (const row of bandRows(modelScorecard())) {
      expect(row).toMatchObject({ games: 0, wins: 0, said: null, saidText: null, happened: null, happenedText: null, faint: false });
    }
  });

  it('rounds the share that won once, from the two counts of the band: 6 of 11 is 54.5% and not 54.6%', () => {
    const rows = bandRows(scorecard({ bands: bandsOf([[11, 6, 0.5581], [13, 7, 0.6402], [19, 15, 0.7513]]) }));

    expect(rows.map((row) => row.happenedText)).toEqual(['54.5%', '53.8%', '78.9%', null, null]);
  });

  it('gives a band of favorites that all lost a share of none, and not a gap', () => {
    const [row] = bandRows(scorecard({ bands: bandsOf([[2, 0, 0.561]]) }));

    expect(row).toMatchObject({ happened: 0, happenedText: '0.0%', faint: true });
  });
});

describe('the frame of the chart', () => {
  it('runs across from an even game to a certain one, and up from none of the favorites to all of them', () => {
    expect(chartX(0.5)).toBe(CHART.left);
    expect(chartX(1)).toBe(CHART.right);
    expect(chartX(0.75)).toBe((CHART.left + CHART.right) / 2);
    expect(chartY(0)).toBe(CHART.bottom);
    expect(chartY(1)).toBe(CHART.top);
    expect(chartY(0.5)).toBe((CHART.top + CHART.bottom) / 2);
  });

  it('keeps a number beyond the frame at its edge', () => {
    expect(chartX(0.4)).toBe(CHART.left);
    expect(chartY(1.2)).toBe(CHART.top);
  });

  it('has lines at every tenth across and every quarter up, the frame among them', () => {
    expect(SAID_TICKS).toEqual([0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(HAPPENED_TICKS).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('leaves room around the frame for the largest dot and for the numbers of the two axes', () => {
    const largest = dotRadius(44, 44);

    expect(CHART.top).toBeGreaterThanOrEqual(largest);
    // The last number of the axis across, "100%", is centered on the right edge of the frame.
    expect(CHART.width - CHART.right).toBeGreaterThanOrEqual(16);
    expect(CHART.left).toBeGreaterThanOrEqual(30);
    expect(CHART.height - CHART.bottom).toBeGreaterThanOrEqual(30);
  });
});

describe('dotRadius', () => {
  it('gives the band with the most games the largest dot and a band of one game the smallest that can be seen', () => {
    expect(dotRadius(44, 44)).toBe(10);
    expect(dotRadius(1, 44)).toBeGreaterThanOrEqual(3.5);
    expect(dotRadius(1, 44)).toBeLessThan(5);
  });

  it('grows with the games, by the area of the dot', () => {
    const quarter = dotRadius(11, 44);

    expect(quarter).toBeGreaterThan(dotRadius(1, 44));
    expect(quarter).toBeLessThan(dotRadius(44, 44));
    // A quarter of the games is half of the way from the smallest dot to the largest.
    expect(quarter).toBe(6.8);
  });

  it('does not grow beyond the largest', () => {
    expect(dotRadius(60, 44)).toBe(10);
    expect(dotRadius(0, 0)).toBe(3.5);
  });
});

describe('mostGames', () => {
  it('is the largest band of all the sources, so that their charts share one scale', () => {
    const record = sampleRecord();
    const models = [must(record.elo, "record of Elo's picks"), must(record.points_rest, "record of the other model's picks")];

    expect(mostGames([record.market, ...models])).toBe(44);
  });

  it('is nothing before the first game', () => {
    expect(mostGames([scorecard(), modelScorecard()])).toBe(0);
    expect(mostGames([])).toBe(0);
  });
});

describe('chartDots', () => {
  const record = sampleRecord();
  const most = 44;
  const pointsRest = must(record.points_rest, "record of the points-and-rest model's picks");
  const elo = must(record.elo, "record of Elo's picks");

  it('puts each band where it was said across and where it happened up', () => {
    const dots = chartDots(bandRows(record.market), most);

    expect(dots).toHaveLength(5);
    // 44 picks at a mean of 65.02%, of which 27 won.
    expect(dots[1]).toMatchObject({
      label: '60–69%',
      x: chartX(0.6502),
      y: chartY(27 / 44),
      r: 10,
      faint: false,
      words: '60–69%: given 65.0% on average, won 61.4% of 44 games',
    });
    expect([dots[1].x, dots[1].y]).toEqual([93.3, 81.6]);
    expect(dots.map((dot) => dot.x)).toEqual([...dots.map((dot) => dot.x)].sort((a, b) => a - b));
  });

  it('draws a band with fewer than ten games faint, and says how many it has', () => {
    const dots = chartDots(bandRows(record.market), most);

    expect(dots.map((dot) => dot.faint)).toEqual([false, false, false, false, true]);
    expect(dots[4].games.text).toBe('3');
    expect(dots[4].words).toBe('90% and up: given 92.2% on average, won 100.0% of 3 games');
  });

  it('writes the games above a dot that lies on or over the dashed line, where the chart is empty', () => {
    // 29 picks at 75.6%, of which 75.9% won.
    const dot = chartDots(bandRows(pointsRest), most)[2];

    expect(dot.games).toEqual({ text: '29', x: 132, y: 48, anchor: 'middle' });
    expect(dot.games.y).toBeLessThan(dot.y - dot.r);
  });

  it('writes the games under a dot that lies below the dashed line', () => {
    // 33 picks at 65.1%, of which 45.5% won.
    const dot = chartDots(bandRows(elo), most)[1];

    expect(dot.games).toEqual({ text: '33', x: 93.5, y: 126.6, anchor: 'middle' });
    expect(dot.games.y).toBeGreaterThan(dot.y + dot.r);
  });

  it('writes the games to the left of a dot near the top of the chart, where the title of the axis stands above it', () => {
    const dots = chartDots(bandRows(elo), most);

    // 17 picks at 84.1%, of which 16 won, and two at 91.7%, which both won.
    for (const dot of dots.slice(3)) {
      expect(dot.games.anchor).toBe('end');
      expect(dot.games.x).toBeLessThan(dot.x - dot.r);
      expect(Math.abs(dot.games.y - dot.y)).toBeLessThan(6);
    }
    expect(dots[4].y).toBe(CHART.top);
  });

  it('writes the games above a dot on the bottom of the chart, where the numbers of the axis stand under it', () => {
    // Two picks at 56%, which both lost.
    const [dot] = chartDots(bandRows(scorecard({ bands: bandsOf([[2, 0, 0.561]]) })), 2);

    expect(dot.y).toBe(CHART.bottom);
    expect(dot.games.anchor).toBe('middle');
    expect(dot.games.y).toBeLessThan(dot.y - dot.r);
  });

  it('has no dot for a band without a game', () => {
    const rows = bandRows(scorecard({ bands: bandsOf([[0, 0, null], [3, 1, 0.6429]]) }));

    expect(chartDots(rows, 3).map((dot) => dot.label)).toEqual(['60–69%']);
    expect(chartDots(bandRows(modelScorecard()), 0)).toEqual([]);
  });

  it('keeps every dot of the sample and its number inside the drawing, and no number on a dot', () => {
    for (const card of [record.market, elo, pointsRest]) {
      const dots = chartDots(bandRows(card), most);

      for (const dot of dots) {
        expect(dot.x - dot.r).toBeGreaterThanOrEqual(0);
        expect(dot.x + dot.r).toBeLessThanOrEqual(CHART.width);
        expect(dot.y - dot.r).toBeGreaterThanOrEqual(0);
        expect(dot.y + dot.r).toBeLessThanOrEqual(CHART.height);
        // A line of text is 12 units high, and the title of the axis takes the first 14 of the drawing.
        expect(dot.games.y - 12).toBeGreaterThanOrEqual(14);
        expect(dot.games.y).toBeLessThanOrEqual(CHART.bottom);

        // The box of the number: at most three digits of about 7 units each.
        const width = dot.games.text.length * 7;
        const left = dot.games.anchor === 'end' ? dot.games.x - width : dot.games.x - width / 2;
        const box = { left, right: left + width, top: dot.games.y - 9, bottom: dot.games.y };
        for (const other of dots) {
          const nearestX = Math.min(Math.max(other.x, box.left), box.right);
          const nearestY = Math.min(Math.max(other.y, box.top), box.bottom);
          const distance = Math.hypot(other.x - nearestX, other.y - nearestY);

          expect(distance, `the number of ${dot.label} on the dot of ${other.label}`).toBeGreaterThanOrEqual(other.r);
        }
      }
    }
  });
});

describe('chartLabel', () => {
  it('says what the chart shows and where the numbers are', () => {
    expect(chartLabel('Elo', bandRows(must(sampleRecord().elo, "record of Elo's picks")))).toBe(
      'Elo: the chance it gave its picks against the share of them that won, for 5 bands of chances. ' +
        'The table that goes with the chart has the same numbers.',
    );
  });

  it('counts the bands that have a game', () => {
    const rows = bandRows(scorecard({ bands: bandsOf([[0, 0, null], [3, 1, 0.6429]]) }));

    expect(chartLabel('Sportsbooks', rows)).toContain('for 1 band of chances.');
  });

  it('says that the chart is empty before the first pick is graded', () => {
    expect(chartLabel('Elo', bandRows(modelScorecard()))).toBe('Elo: no pick has been graded yet, so the chart is empty.');
  });
});
