import { describe, expect, it } from 'vitest';
import { lean, leanLabel } from './lean';

describe('lean', () => {
  it('fills nothing at an even game', () => {
    expect(lean(0.5)).toEqual({ side: null, share: 0 });
  });

  it('fills half of the home side at 75%', () => {
    expect(lean(0.75)).toEqual({ side: 'home', share: 0.5 });
  });

  it('fills half of the away side at 25%, the same distance the other way', () => {
    expect(lean(0.25)).toEqual({ side: 'away', share: 0.5 });
  });

  it('fills all but a sliver of a side at the surest chance the files hold', () => {
    expect(lean(0.9999)).toEqual({ side: 'home', share: 0.9998 });
    expect(lean(0.0001)).toEqual({ side: 'away', share: 0.9998 });
  });

  it.each([
    [0.5672, 'home', 0.1344],
    [0.4275, 'away', 0.145],
    [0.52, 'home', 0.04],
    [0.5001, 'home', 0.0002],
    [0.4999, 'away', 0.0002],
  ] as const)('at %f leans %s by %f of that side', (pHome, side, share) => {
    expect(lean(pHome)).toEqual({ side, share });
  });
});

describe('leanLabel', () => {
  it('names the source, the team it leans to and that team\'s chance', () => {
    expect(leanLabel('Elo', 0.5672, 'DET', 'BOS')).toBe('Elo: Detroit Pistons 57%');
    expect(leanLabel('Sportsbooks', 0.4275, 'LAL', 'GSW')).toBe('Sportsbooks: Golden State Warriors 57%');
    expect(leanLabel('Points & Rest', 0.52, 'DET', 'BOS')).toBe('Points & Rest: Detroit Pistons 52%');
  });

  it('calls a toss-up one, with the side it leans to', () => {
    expect(leanLabel('Elo', 0.5113, 'DET', 'BOS')).toBe('Elo: toss-up, Detroit Pistons 51%');
    expect(leanLabel('Elo', 0.5, 'DET', 'BOS')).toBe('Elo: toss-up, 50% each');
  });

  it('never says 52% of a toss-up, which is where a pick begins', () => {
    expect(leanLabel('Elo', 0.4801, 'DET', 'BOS')).toBe('Elo: toss-up, Boston Celtics 51%');
    expect(leanLabel('Points & Rest', 0.5199, 'DET', 'BOS')).toBe('Points & Rest: toss-up, Detroit Pistons 51%');
    expect(leanLabel('Points & Rest', 0.515, 'DET', 'BOS')).toBe('Points & Rest: toss-up, Detroit Pistons 51%');
  });

  it('says so when the source has no chance for the game', () => {
    expect(leanLabel('Points & Rest', null, 'DET', 'BOS')).toBe('Points & Rest: no chance published');
  });

  it('shows the code of a team it does not know', () => {
    expect(leanLabel('Elo', 0.6, 'SEA', 'BOS')).toBe('Elo: SEA 60%');
  });
});
