import { describe, expect, it } from 'vitest';
import { CURVE_GAPS, CURVE_REACH, curvePath, curvePoint, curveSummary, eloCurve, gapLabel, smallestPickGap } from './methodCurve';
import { eloChance } from './methodElo';

describe('curvePoint', () => {
  it('puts an even game in the middle of the drawing', () => {
    expect(curvePoint(0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('puts a team that is 400 points ahead at the right end, at ten to one', () => {
    const ahead = curvePoint(CURVE_REACH);

    expect(ahead.x).toBe(1);
    expect(1 - ahead.y).toBeCloseTo(10 / 11, 12);
  });

  it('puts a team that is as far behind at the left end, as far from the bottom', () => {
    const behind = curvePoint(-CURVE_REACH);

    expect(behind.x).toBe(0);
    expect(1 - behind.y).toBeCloseTo(1 / 11, 12);
  });

  it('puts the home team of the worked game where its chance of 0.3965 is', () => {
    const boston = curvePoint(-73);

    expect(boston.x).toBe((400 - 73) / 800);
    expect(1 - boston.y).toBeCloseTo(eloChance(1607, 1720, 40), 4);
  });
});

describe('eloCurve', () => {
  it('runs from the left end to the right end in even steps', () => {
    const points = eloCurve(40);

    expect(points).toHaveLength(41);
    expect(points[0].x).toBe(0);
    expect(points.at(-1)?.x).toBe(1);
    expect(points[20]).toEqual({ x: 0.5, y: 0.5 });
  });

  it('rises all the way: a team that is further ahead has the better chance', () => {
    const points = eloCurve(40);

    for (let index = 1; index < points.length; index += 1) {
      expect(points[index].x).toBeGreaterThan(points[index - 1].x);
      expect(points[index].y).toBeLessThan(points[index - 1].y);
    }
  });

  it('is the same curve from either end, because one team is ahead by what the other is behind', () => {
    const points = eloCurve(40);

    points.forEach((point, index) => {
      expect(point.y + (points.at(-1 - index)?.y ?? NaN)).toBeCloseTo(1, 12);
    });
  });
});

describe('curvePath', () => {
  it('writes the points as a path in a drawing of 100 by 100', () => {
    expect(curvePath([{ x: 0, y: 0.9091 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.0909 }])).toBe('M0.00 90.91 L50.00 50.00 L100.00 9.09');
  });

  it('writes the whole curve', () => {
    const path = curvePath(eloCurve(40));

    expect(path.startsWith('M0.00 90.91 L2.50 ')).toBe(true);
    expect(path.endsWith(' L100.00 9.09')).toBe(true);
    expect(path.split(' L')).toHaveLength(41);
  });
});

describe('the gaps that the drawing labels', () => {
  it('are five, at even steps', () => {
    expect(CURVE_GAPS).toEqual([-400, -200, 0, 200, 400]);
    expect(CURVE_GAPS.map((gap) => curvePoint(gap).x)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('have these chances in whole percent', () => {
    expect(CURVE_GAPS.map((gap) => Math.round(eloChance(gap, 0, 0) * 100))).toEqual([9, 24, 50, 76, 91]);
  });
});

describe('smallestPickGap', () => {
  it('is 14 points: 13 points ahead is 51.87%, which is a toss-up, and 14 points is 52.01%', () => {
    expect(smallestPickGap()).toBe(14);
    expect(eloChance(13, 0, 0)).toBe(0.5187);
    expect(eloChance(14, 0, 0)).toBe(0.5201);
  });
});

describe('gapLabel', () => {
  it('writes a gap with its sign', () => {
    expect(CURVE_GAPS.map(gapLabel)).toEqual(['−400', '−200', '0', '+200', '+400']);
  });
});

describe('curveSummary', () => {
  it('says in words what the curve shows', () => {
    expect(curveSummary()).toBe(
      "The home team's chance for every gap: 9% at a gap of −400, 24% at a gap of −200, 50% at a gap of 0, 76% at a gap of +200 and 91% at a gap of +400.",
    );
  });
});
