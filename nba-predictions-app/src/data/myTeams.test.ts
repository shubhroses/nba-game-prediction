import { describe, expect, it } from 'vitest';
import { MY_TEAMS_KEY, readMyTeams, teamsIn, withToggled, writeMyTeams } from './myTeams';

/** A stand-in for the browser's storage. */
function storageWith(stored: Record<string, string> = {}) {
  const items = new Map(Object.entries(stored));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

/** A storage that the browser blocks: every use of it throws. */
const blocked = {
  getItem(): string | null {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  },
  setItem(): void {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  },
};

describe('teamsIn', () => {
  it('reads a list of team codes', () => {
    expect(teamsIn('["BOS","NYK"]')).toEqual(['BOS', 'NYK']);
  });

  it('puts them in order and drops one that is there twice', () => {
    expect(teamsIn('["NYK","BOS","NYK","ATL"]')).toEqual(['ATL', 'BOS', 'NYK']);
  });

  it('leaves out whatever is not one of the 30 codes', () => {
    expect(teamsIn('["BOS","SEA","bos","Boston Celtics",7,null,["NYK"],"constructor"]')).toEqual(['BOS']);
  });

  it.each([null, '', 'BOS', '{"BOS":true}', '"BOS"', '42', 'null', '[', '<html>'])('is empty for %j', (stored) => {
    expect(teamsIn(stored)).toEqual([]);
  });
});

describe('readMyTeams', () => {
  it('reads the teams under the one key', () => {
    expect(readMyTeams(storageWith({ [MY_TEAMS_KEY]: '["LAL","GSW"]', other: '["BOS"]' }))).toEqual(['GSW', 'LAL']);
  });

  it('is empty when nothing is stored', () => {
    expect(readMyTeams(storageWith())).toEqual([]);
  });

  it('is empty when there is no storage or the browser blocks it', () => {
    expect(readMyTeams(null)).toEqual([]);
    expect(readMyTeams(blocked)).toEqual([]);
  });
});

describe('writeMyTeams', () => {
  it('stores the teams as a list in order and says that it did', () => {
    const storage = storageWith();

    expect(writeMyTeams(storage, new Set(['NYK', 'BOS']))).toBe(true);
    expect(storage.items.get(MY_TEAMS_KEY)).toBe('["BOS","NYK"]');
    expect(readMyTeams(storage)).toEqual(['BOS', 'NYK']);
  });

  it('stores an empty list when the last team is taken out', () => {
    const storage = storageWith({ [MY_TEAMS_KEY]: '["BOS"]' });

    writeMyTeams(storage, []);

    expect(readMyTeams(storage)).toEqual([]);
  });

  it('says so when there is no storage or the browser blocks it, and does not throw', () => {
    expect(writeMyTeams(null, ['BOS'])).toBe(false);
    expect(writeMyTeams(blocked, ['BOS'])).toBe(false);
  });
});

describe('withToggled', () => {
  it('adds a team that is not among them', () => {
    expect([...withToggled(new Set(['BOS']), 'NYK')].sort()).toEqual(['BOS', 'NYK']);
  });

  it('takes out a team that is', () => {
    expect([...withToggled(new Set(['BOS', 'NYK']), 'BOS')]).toEqual(['NYK']);
  });

  it('leaves the set it was given as it is', () => {
    const teams = new Set(['BOS']);

    withToggled(teams, 'NYK');

    expect([...teams]).toEqual(['BOS']);
  });
});
