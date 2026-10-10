import { describe, expect, it } from 'vitest';
import { getTeamLogo } from './formatters';

describe('getTeamLogo', () => {
  it('finds the logo by the full name of the team', () => {
    expect(getTeamLogo('Boston Celtics')).toBe('https://cdn.nba.com/logos/nba/1610612738/global/L/logo.svg');
  });

  it('has no logo for any other name', () => {
    expect(getTeamLogo('Celtics')).toBeNull();
    expect(getTeamLogo('BOS')).toBeNull();
    expect(getTeamLogo('constructor')).toBeNull();
  });
});
