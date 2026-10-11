import { describe, expect, it } from 'vitest';
// The document that the arithmetic is taken from, read as text.
import readme from '../../../pipeline/model/README.md?raw';
import { sampleBoard, sampleModel, samplePredictions } from '../data/sampleData';
import { predictionDays } from './day';
import { asPublished, eloChance, eloChanceExact, eloGap, eloHomeGain, eloMultiplier } from './methodElo';

describe('eloGap', () => {
  it('is the home rating, plus the home court, minus the away rating', () => {
    expect(eloGap(1607, 1720, 40)).toBe(-73);
    expect(eloGap(1604, 1530, 40)).toBe(114);
    expect(eloGap(1384, 1617, 0)).toBe(-233);
  });
});

describe('eloChance', () => {
  it('gives the worked game of the README: Boston at 1607 hosting New York at 1720', () => {
    expect(readme).toContain('Boston, at 1607, hosts New York, at 1720');
    expect(readme).toContain('1607 + 40 - 1720 = -73');
    expect(readme).toContain('1 / (1 + 10 ^ (73 / 400)) = 0.3965');

    expect(eloChance(1607, 1720, 40)).toBe(0.3965);
  });

  it('gives an even game to two teams that the home court makes level', () => {
    expect(eloChance(1500, 1540, 40)).toBe(0.5);
    expect(eloChance(1500, 1500, 0)).toBe(0.5);
  });

  it('gives ten times the chance to a team that is 400 points ahead', () => {
    expect(eloChanceExact(1900, 1500, 0)).toBeCloseTo(10 / 11, 12);
    expect(eloChance(1900, 1500, 0)).toBe(0.9091);
  });

  it('gives the two teams of a game on a neutral floor chances that add up to 1', () => {
    expect(eloChanceExact(1617, 1384, 0) + eloChanceExact(1384, 1617, 0)).toBeCloseTo(1, 12);
  });

  it('is what the job published for every game of the sample, from the three numbers next to it', () => {
    const days = predictionDays(sampleBoard());
    const games = days.flatMap((day) => samplePredictions(day).games);

    expect(days).toHaveLength(9);
    expect(games).toHaveLength(70);
    for (const { id, elo } of games) {
      expect(eloChance(elo.home_rating, elo.away_rating, elo.home_court), `game ${id}`).toBe(elo.p_home);
    }
  });

  it('is what the job published for the game on a neutral floor, where the home court is 0', () => {
    const mexicoCity = samplePredictions('2026-11-07').games.find((game) => game.neutral);

    expect(mexicoCity?.elo).toEqual({ p_home: 0.2073, home_rating: 1384, away_rating: 1617, home_court: 0 });
    expect(eloChance(1384, 1617, 0)).toBe(0.2073);
    // With the home court that the game does not have, the chance would be another one.
    expect(eloChance(1384, 1617, 40)).toBe(0.2477);
  });

  it('is the chance on the board for every game to come, from the ratings of the model file', () => {
    const { ratings, constants } = sampleModel().elo;
    const games = sampleBoard().games;

    expect(games).toHaveLength(26);
    for (const game of games) {
      const chance = eloChance(ratings[game.home].rating, ratings[game.away].rating, constants.home_court);
      expect(chance, `${game.away} at ${game.home}`).toBe(game.elo?.p_home);
    }
  });
});

describe('asPublished', () => {
  it('writes four decimals', () => {
    expect(asPublished(0.39648)).toBe(0.3965);
    expect(asPublished(0.65844)).toBe(0.6584);
    expect(asPublished(0.5)).toBe(0.5);
  });

  it('never writes that a team cannot win or cannot lose', () => {
    expect(asPublished(0.00001)).toBe(0.0001);
    expect(asPublished(0.99999)).toBe(0.9999);
    expect(asPublished(0)).toBe(0.0001);
    expect(asPublished(1)).toBe(0.9999);
  });
});

describe('eloMultiplier', () => {
  it('gives the multiplier of the worked game: a win by 8 for a team that was 73 points behind', () => {
    expect(readme).toContain('11 ^ 0.8 / (7.5 - 0.006 x 73) = 0.9642');

    expect(eloMultiplier(8, -73)).toBeCloseTo(0.9642, 4);
  });

  it('counts a win by more points for more, and an expected win for less', () => {
    expect(eloMultiplier(20, 0)).toBeGreaterThan(eloMultiplier(5, 0));
    expect(eloMultiplier(8, 150)).toBeLessThan(eloMultiplier(8, -150));
  });
});

describe('eloHomeGain', () => {
  const boston = { homeRating: 1607, awayRating: 1720, homePts: 112, awayPts: 104, homeCourt: 40, k: 20 };

  it('gives what Boston gains in the worked game', () => {
    expect(readme).toContain('Boston gains 20 x 0.9642 x (1 - 0.3965) = 11.64 points');

    expect(eloHomeGain(boston)).toBeCloseTo(11.64, 2);
  });

  it('is below zero when the home team loses', () => {
    const lost = eloHomeGain({ ...boston, homePts: 104, awayPts: 112 });

    expect(lost).toBeLessThan(0);
    // New York was expected to win, so it takes less than Boston would have.
    expect(-lost).toBeLessThan(eloHomeGain(boston));
  });

  it('takes from one team what it gives the other, whichever of them is called the home team', () => {
    const asVisitors = eloHomeGain({ homeRating: 1720, awayRating: 1607, homePts: 104, awayPts: 112, homeCourt: 0, k: 20 });
    const asHosts = eloHomeGain({ homeRating: 1607, awayRating: 1720, homePts: 112, awayPts: 104, homeCourt: 0, k: 20 });

    expect(asVisitors).toBeCloseTo(-asHosts, 12);
  });
});
