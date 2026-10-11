import { describe, expect, it } from 'vitest';
import { countOf, onePlacePercent, scoreText, shareOf, signedPoints, signedScore, winsLosses, written } from './numbers';

describe('onePlacePercent', () => {
  it.each([
    [0.6667, '66.7%'],
    [0.6833, '68.3%'],
    [0.5577, '55.8%'],
    [0.7869, '78.7%'],
    [0.55, '55.0%'],
    [0.2065, '20.7%'],
    [0.0704, '7.0%'],
  ])('%f is "%s"', (share, text) => {
    expect(onePlacePercent(share)).toBe(text);
  });

  it('takes none of the games and all of them', () => {
    expect(onePlacePercent(0)).toBe('0.0%');
    expect(onePlacePercent(1)).toBe('100.0%');
  });
});

describe('shareOf', () => {
  it.each([
    [81, 143, '56.6%'],
    [19, 40, '47.5%'],
    [1, 1, '100.0%'],
    [0, 7, '0.0%'],
    [2, 3, '66.7%'],
  ])('%i of %i is "%s"', (wins, games, text) => {
    expect(shareOf(wins, games)).toBe(text);
  });

  it.each([
    [12, 22, '54.5%'],
    [6, 11, '54.5%'],
    [56, 101, '55.4%'],
    [64, 102, '62.7%'],
    [15, 19, '78.9%'],
    [29, 31, '93.5%'],
  ])('rounds once, where four decimals first would make %i of %i a tenth too high: "%s"', (wins, games, text) => {
    expect(shareOf(wins, games)).toBe(text);
    // The share as a file would write it, rounded to four decimals, reads a tenth higher.
    expect(onePlacePercent(Math.round((10_000 * wins) / games) / 10_000)).not.toBe(text);
  });

  it('takes half a tenth up, as the page does everywhere', () => {
    // 1 of 8 is 12.5%, and 1 of 16 is 6.25%.
    expect(shareOf(1, 8)).toBe('12.5%');
    expect(shareOf(1, 16)).toBe('6.3%');
    expect(shareOf(1, 2000)).toBe('0.1%');
  });

  it('is the one decimal of the true share for every count of a season', () => {
    for (let games = 1; games <= 1230; games += 1) {
      for (let wins = 0; wins <= games; wins += 1) {
        // Whole numbers only: twice the thousandths, plus one half, cut off.
        const tenths = Math.floor((2000 * wins + games) / (2 * games));
        if (shareOf(wins, games) !== `${(tenths / 10).toFixed(1)}%`) throw new Error(`${wins} of ${games} reads ${shareOf(wins, games)}`);
      }
    }
  });
});

describe('signedPoints', () => {
  it.each([
    [5.14, '+5.1'],
    [9.74, '+9.7'],
    [-2.82, '−2.8'],
    [0.05, '+0.1'],
    [-0.05, '−0.1'],
    [8.35, '+8.4'],
    [-8.35, '−8.4'],
    [12, '+12.0'],
  ])('%f is "%s"', (points, text) => {
    expect(signedPoints(points)).toBe(text);
  });

  it('gives nothing a sign when it rounds to nothing', () => {
    expect(signedPoints(0)).toBe('0.0');
    expect(signedPoints(-0)).toBe('0.0');
    expect(signedPoints(0.04)).toBe('0.0');
    expect(signedPoints(-0.04)).toBe('0.0');
  });

  it('writes as many decimals as asked', () => {
    expect(signedPoints(1.16, 2)).toBe('+1.16');
    expect(signedPoints(-7.31, 2)).toBe('−7.31');
    expect(signedPoints(-11.64, 0)).toBe('−12');
    expect(signedPoints(0, 2)).toBe('0.00');
  });
});

describe('winsLosses', () => {
  it('writes the wins first', () => {
    expect(winsLosses(41, 19)).toBe('41–19');
    expect(winsLosses(0, 0)).toBe('0–0');
  });
});

describe('written', () => {
  it('puts a comma at every thousand', () => {
    expect(written(0)).toBe('0');
    expect(written(999)).toBe('999');
    expect(written(1230)).toBe('1,230');
    expect(written(28382)).toBe('28,382');
    expect(written(1000000)).toBe('1,000,000');
  });
});

describe('countOf', () => {
  it('names one thing in the singular and any other number in the plural', () => {
    expect(countOf(1, 'game')).toBe('1 game');
    expect(countOf(0, 'game')).toBe('0 games');
    expect(countOf(60, 'game')).toBe('60 games');
    expect(countOf(2, 'toss-up')).toBe('2 toss-ups');
    expect(countOf(1, 'loss', 'losses')).toBe('1 loss');
    expect(countOf(3, 'loss', 'losses')).toBe('3 losses');
  });

  it('writes a count of a thousand or more with its comma', () => {
    expect(countOf(143, 'game')).toBe('143 games');
    expect(countOf(1230, 'game')).toBe('1,230 games');
  });
});

describe('scoreText', () => {
  it('writes a score with the four decimals of the file', () => {
    expect(scoreText(0.2174)).toBe('0.2174');
    expect(scoreText(0.621)).toBe('0.6210');
    expect(scoreText(0.25)).toBe('0.2500');
  });
});

describe('signedScore', () => {
  it.each([
    [0.0067, '+0.0067'],
    [-0.0128, '−0.0128'],
    [0.027, '+0.0270'],
    [-0.0417, '−0.0417'],
    [0.1, '+0.1000'],
  ])('%f is "%s"', (difference, text) => {
    expect(signedScore(difference)).toBe(text);
  });

  it('gives nothing a sign', () => {
    expect(signedScore(0)).toBe('0.0000');
    expect(signedScore(-0)).toBe('0.0000');
  });
});
