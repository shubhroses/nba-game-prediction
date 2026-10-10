import { describe, expect, it } from 'vitest';
import { formatDate, getTeamLogo } from './formatters';

describe('formatDate', () => {
  it('gives the day, the time and the time zone', () => {
    const opener = new Date('2026-10-20T23:00:00Z');

    expect(formatDate(opener, 'America/New_York')).toBe('Tue, Oct 20, 7:00 PM EDT');
    expect(formatDate(opener, 'America/Los_Angeles')).toBe('Tue, Oct 20, 4:00 PM PDT');
  });

  it('follows the end of daylight saving time', () => {
    expect(formatDate(new Date('2026-11-02T00:30:00Z'), 'America/New_York')).toBe('Sun, Nov 1, 7:30 PM EST');
  });
});

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
