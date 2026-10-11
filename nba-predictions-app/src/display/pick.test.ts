import { describe, expect, it } from 'vitest';
// The job's rule, read as text: the page must pick from the same chance on.
import grading from '../../../pipeline/grading.py?raw';
import { chances, favorite, leaningSide, onePlaceChance, pickedSide, pickLabel, picksDiffer, tenThousandths, wholePercent } from './pick';

describe('tenThousandths', () => {
  it.each([
    [0.52, 5200],
    [0.5199, 5199],
    [0.59, 5900],
    [0.0001, 1],
    [0.9999, 9999],
  ])('%f is %i', (chance, units) => {
    expect(tenThousandths(chance)).toBe(units);
  });
});

describe('pickedSide', () => {
  it('picks from the chance that the job grades from', () => {
    expect(grading).toContain('_FAVORITE_FROM = 5_200  # 52%');
    expect(grading).toContain('if home >= _FAVORITE_FROM:');
    expect(grading).toContain('if away >= _FAVORITE_FROM:');
  });

  it.each([0.52, 0.5201, 0.532, 0.75, 0.9999])('picks the home team at %f', (pHome) => {
    expect(pickedSide(pHome)).toBe('home');
  });

  it.each([0.48, 0.4799, 0.41, 0.25, 0.0001])('picks the away team at %f', (pHome) => {
    expect(pickedSide(pHome)).toBe('away');
  });

  it.each([0.5199, 0.505, 0.5, 0.4999, 0.4801])('has no pick at %f', (pHome) => {
    expect(pickedSide(pHome)).toBeNull();
  });

  it('counts in ten-thousandths, where a chance taken from one would not compare', () => {
    // 1 - 0.48 is the away team's chance, and as a binary fraction it need not reach 0.52.
    expect(pickedSide(1 - 0.52)).toBe('away');
    expect(pickedSide(1 - 0.48)).toBe('home');
    expect(pickedSide(1 - 0.5199)).toBeNull();
  });
});

describe('leaningSide', () => {
  it('is the side a chance is on, however slightly', () => {
    expect(leaningSide(0.5001)).toBe('home');
    expect(leaningSide(0.9)).toBe('home');
    expect(leaningSide(0.4999)).toBe('away');
  });

  it('is neither side at exactly even', () => {
    expect(leaningSide(0.5)).toBeNull();
  });
});

describe('wholePercent', () => {
  it.each([
    [0.6429, 64],
    [0.575, 58],
    [0.5749, 57],
    [0.5, 50],
    [0.145, 15],
  ])('%f is %i', (chance, percent) => {
    expect(wholePercent(chance)).toBe(percent);
  });

  it.each([
    [0.9999, 99],
    [0.996, 99],
    [0.0001, 1],
    [0.004, 1],
  ])('never says 0 or 100: %f is %i', (chance, percent) => {
    expect(wholePercent(chance)).toBe(percent);
  });
});

describe('chances', () => {
  it('gives both teams a whole percent', () => {
    expect(chances(0.6429)).toEqual({ home: 64, away: 36 });
  });

  it.each([0.575, 0.5, 0.0001, 0.9999, 0.4249, 0.5199, 0.4801])('adds up to 100 at %f', (pHome) => {
    const { home, away } = chances(pHome);

    expect(home + away).toBe(100);
  });

  it.each([
    [0.5199, 51, 49],
    [0.515, 51, 49],
    [0.5149, 51, 49],
    [0.4849, 49, 51],
    [0.4801, 49, 51],
  ])('never writes a toss-up as 52%%: %f is %i%% and %i%%', (pHome, home, away) => {
    expect(chances(pHome)).toEqual({ home, away });
  });

  it('writes 52% from the chance that makes a pick, on either side', () => {
    expect(chances(0.52)).toEqual({ home: 52, away: 48 });
    expect(chances(0.48)).toEqual({ home: 48, away: 52 });
  });

  it('says 52% or more of a side exactly when the job picks it, for every chance the files can write', () => {
    for (let units = 1; units <= 9999; units += 1) {
      const pHome = units / 10_000;
      const { home, away } = chances(pHome);
      const side = pickedSide(pHome);

      expect(home >= 52, `home at ${pHome}`).toBe(side === 'home');
      expect(away >= 52, `away at ${pHome}`).toBe(side === 'away');
    }
  });
});

describe('favorite', () => {
  it('names the side at 52% or more and its chance', () => {
    expect(favorite(0.6429)).toEqual({ side: 'home', chance: 64 });
    expect(favorite(0.3571)).toEqual({ side: 'away', chance: 64 });
    expect(favorite(0.52)).toEqual({ side: 'home', chance: 52 });
    expect(favorite(0.48)).toEqual({ side: 'away', chance: 52 });
  });

  it('is nothing for a toss-up, also one that rounds to 52%', () => {
    expect(favorite(0.5199)).toBeNull();
    expect(favorite(0.4801)).toBeNull();
    expect(favorite(0.5)).toBeNull();
  });
});

describe('onePlaceChance', () => {
  it.each([
    [0.8786, '87.9%'],
    [0.5574, '55.7%'],
    [0.5816, '58.2%'],
    [0.52, '52.0%'],
    [0.9167, '91.7%'],
    [0.5, '50.0%'],
    [0.48, '48.0%'],
  ])('%f is "%s"', (chance, text) => {
    expect(onePlaceChance(chance)).toBe(text);
  });

  it('takes half a tenth up, as a share of games is rounded', () => {
    expect(onePlaceChance(0.5815)).toBe('58.2%');
    expect(onePlaceChance(1 - 0.4185)).toBe('58.2%');
  });

  it('never says that a team cannot lose or cannot win: such a chance keeps its two decimals', () => {
    expect(onePlaceChance(0.9996)).toBe('99.96%');
    expect(onePlaceChance(0.9999)).toBe('99.99%');
    expect(onePlaceChance(0.0001)).toBe('0.01%');
    expect(onePlaceChance(0.9994)).toBe('99.9%');
  });

  it('never rounds a toss-up into a pick: a chance just short of 52% keeps its two decimals', () => {
    expect(onePlaceChance(0.5199)).toBe('51.99%');
    expect(onePlaceChance(0.5195)).toBe('51.95%');
    expect(onePlaceChance(0.5194)).toBe('51.9%');
    // The other team of the same game is as far from a pick.
    expect(onePlaceChance(0.4801)).toBe('48.01%');
    expect(onePlaceChance(0.4806)).toBe('48.1%');
  });
});

describe('pickLabel', () => {
  const teams = { home: 'DET', away: 'BOS' };

  it('names the team that is picked by its code, with its whole percent', () => {
    expect(pickLabel(0.5712, teams)).toBe('DET 57%');
    expect(pickLabel(0.41, teams)).toBe('BOS 59%');
    expect(pickLabel(0.52, teams)).toBe('DET 52%');
  });

  it('says "Toss-up" between 48% and 52%, also for a chance that rounds to 52%', () => {
    expect(pickLabel(0.5199, teams)).toBe('Toss-up');
    expect(pickLabel(0.4801, teams)).toBe('Toss-up');
    expect(pickLabel(0.5, teams)).toBe('Toss-up');
  });
});

describe('picksDiffer', () => {
  it('is true when two sources pick different sides', () => {
    expect(picksDiffer(0.7117, 0.4275)).toBe(true);
    expect(picksDiffer(0.48, 0.52)).toBe(true);
  });

  it('is false when they pick the same side, however far apart they are', () => {
    expect(picksDiffer(0.53, 0.95)).toBe(false);
    expect(picksDiffer(0.2, 0.47)).toBe(false);
  });

  it('is false when either has no pick', () => {
    expect(picksDiffer(0.7117, 0.5199)).toBe(false);
    expect(picksDiffer(0.5, 0.2)).toBe(false);
    expect(picksDiffer(0.51, 0.49)).toBe(false);
  });

  it('is false when either has no chance at all', () => {
    expect(picksDiffer(null, 0.2)).toBe(false);
    expect(picksDiffer(0.8, null)).toBe(false);
    expect(picksDiffer(null, null)).toBe(false);
  });
});
