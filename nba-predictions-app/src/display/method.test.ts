import { describe, expect, it } from 'vitest';
// The documents and the two opening files that the figures are copied from, read as text.
import eloFile from '../../../pipeline/model/elo_2026_27.json?raw';
import pointsRestFile from '../../../pipeline/model/points_rest_2026_27.json?raw';
import readme from '../../../pipeline/model/README.md?raw';
import {
  ELO,
  ELO_CARRIED_THROUGH,
  METHOD_PARTS,
  OPENING_HOME_COURT,
  partAnchor,
  partTitle,
  POINTS_REST,
  REST_TERMS,
  workedGame,
} from './method';
import { signedPoints } from './numbers';

const elo = JSON.parse(eloFile) as { constants: Record<string, number>; ratings: Record<string, number> };
const pointsRest = JSON.parse(pointsRestFile) as {
  constants: Record<string, number>;
  coef: Record<string, number>;
  kappa: number;
  state: { home_court: number };
};

/** A number to as many decimals as the README writes it with. */
function rounded(number: number, decimals: number): number {
  return Number(number.toFixed(decimals));
}

describe('the parts of the view', () => {
  it('are nine, each with a name of its own for the document and for the row of buttons', () => {
    expect(METHOD_PARTS).toHaveLength(9);
    expect(new Set(METHOD_PARTS.map((part) => part.id)).size).toBe(9);
    expect(new Set(METHOD_PARTS.map((part) => part.short)).size).toBe(9);
  });

  it('have the two models right after what the page is, Points & Rest by its name and Elo by its name', () => {
    expect(METHOD_PARTS.slice(0, 3).map((part) => part.title)).toEqual(['What this page is', 'Elo', 'Points & Rest']);
  });

  it('are found by their id', () => {
    expect(partTitle('backtest')).toBe('The backtest');
    expect(partAnchor('backtest')).toBe('how-backtest');
    expect(partAnchor('points-rest')).toBe('how-points-rest');
  });
});

describe('the constants of Elo', () => {
  it('are the ones in the opening file of the season', () => {
    expect(elo.constants).toEqual({ k: ELO.k, home_court: ELO.homeCourt, mean: ELO.mean, reversion: ELO.reversion });
  });

  it('are the ones in the table of the README', () => {
    expect(readme).toContain(`| K | ${ELO.k} |`);
    expect(readme).toContain(`| Home court | ${ELO.homeCourt} |`);
    expect(readme).toContain(`| Mean | ${ELO.mean} |`);
    expect(readme).toContain(`| Reversion between seasons | ${ELO.reversion * 100}% |`);
  });

  it('come with the number of games that the opening ratings were carried through', () => {
    expect(readme).toContain(`carried through the ${ELO_CARRIED_THROUGH} games of 2023-24, 2024-25 and 2025-26`);
  });
});

describe('workedGame', () => {
  const game = workedGame();

  it('is the game of the README', () => {
    expect(readme).toContain('Boston, at 1607, hosts New York, at 1720, and wins 112 to 104.');

    expect(game).toMatchObject({
      home: 'Boston Celtics',
      away: 'New York Knicks',
      homeRating: 1607,
      awayRating: 1720,
      homeCourt: 40,
      homePts: 112,
      awayPts: 104,
      margin: 8,
      k: 20,
    });
  });

  it('works out the numbers that the README writes', () => {
    expect(readme).toContain(`1607 + 40 - 1720 = ${game.gap}`);
    expect(readme).toContain(`1 / (1 + 10 ^ (73 / 400)) = ${game.chance}`);
    expect(readme).toContain(`11 ^ 0.8 / (7.5 - 0.006 x 73) = ${game.multiplier}`);
    expect(readme).toContain(`20 x ${game.multiplier} x (1 - ${game.chance}) = ${game.gain} points`);

    expect(game).toMatchObject({ gap: -73, chance: '0.3965', percent: 40, multiplier: '0.9642', gain: '11.64' });
  });
});

describe('the numbers of Points & Rest', () => {
  it('are the ones in the opening file of the season, rounded as the README writes them', () => {
    expect(pointsRest.constants.sigma).toBe(POINTS_REST.noise);
    expect(pointsRest.constants.cap).toBe(POINTS_REST.cap);
    expect(pointsRest.constants.q_per_day).toBe(POINTS_REST.drift);
    expect(rounded(pointsRest.kappa, 4)).toBe(POINTS_REST.scale);
    expect(rounded(pointsRest.state.home_court, 3)).toBe(POINTS_REST.leagueHomeCourt);
    expect(rounded(pointsRest.coef.home, 3)).toBe(POINTS_REST.homeConstant);
    expect(rounded(pointsRest.coef.altitude_km, 3)).toBe(POINTS_REST.altitudePerKm);
  });

  it('give a home team at sea level with equal rest the 1.09 points of the README', () => {
    expect(readme).toContain('1.725 - 0.633 = 1.09 points');

    expect(rounded(OPENING_HOME_COURT, 2)).toBe(1.09);
  });

  it('give Denver and Utah what the README says their altitude is worth', () => {
    const { denver, utah } = POINTS_REST.altitude;

    expect(readme).toContain(
      `Denver's arena is at 1.609 km and Utah's at 1.288 km, which is about ${denver.toFixed(1)} and ${utah.toFixed(1)} points against a team from sea level.`,
    );
    expect((1.609 * POINTS_REST.altitudePerKm).toFixed(1)).toBe(denver.toFixed(1));
    expect((1.288 * POINTS_REST.altitudePerKm).toFixed(1)).toBe(utah.toFixed(1));
  });

  it('say how well a rating is known as the README does', () => {
    const { known, pointWorth } = POINTS_REST;

    expect(readme).toContain(
      `On opening night a rating is known to about ${known.opening} points either way and takes about ${known.openingShare} of a surprise.`,
    );
    expect(readme).toContain(`After 40 games it is known to about ${known.afterForty} points and takes about ${known.afterFortyShare}.`);
    expect(readme).toContain(`one point of margin is worth about ${pointWorth} percentage points on opening night`);
  });
});

describe('the rest terms', () => {
  it('are the three coefficients of the opening file, in points for the home team', () => {
    const { b2b_home, b2b_away, games7_diff } = pointsRest.coef;

    expect(REST_TERMS.map((term) => term.points)).toEqual([rounded(b2b_home, 3), rounded(b2b_away, 3), rounded(games7_diff, 3)]);
  });

  it('are in the table of the README', () => {
    expect(readme).toContain('| `coef.b2b_home` | -1.352 | The home team played yesterday. |');
    expect(readme).toContain('| `coef.b2b_away` | +1.706 | The away team played yesterday. |');
    expect(readme).toContain('| `coef.games7_diff` | -0.319 | For each game more that the home team played in the last seven days. |');
  });

  it('are written with two decimals on the page', () => {
    expect(REST_TERMS.map((term) => signedPoints(term.points, 2))).toEqual(['−1.35', '+1.71', '−0.32']);
  });
});
