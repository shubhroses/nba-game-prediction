import { describe, expect, it } from 'vitest';
import { listed } from './words';

describe('listed', () => {
  it('joins the last two with "and"', () => {
    expect(listed([])).toBe('');
    expect(listed(['Elo'])).toBe('Elo');
    expect(listed(['Elo', 'Sportsbooks'])).toBe('Elo and Sportsbooks');
    expect(listed(['Points & Rest', 'Elo', 'Sportsbooks'])).toBe('Points & Rest, Elo and Sportsbooks');
  });
});
