import { describe, expect, it } from 'vitest';
import { bounds, day, hasRow, isDay, orNull, parsed, share, ShapeProblem, teamTable, text } from './shape';

describe('parsed', () => {
  it('returns what the check returns', () => {
    expect(parsed(() => 7)).toEqual({ ok: true, value: 7 });
  });

  it('turns a problem with the shape into a result', () => {
    expect(parsed(() => text('', 'sport'))).toEqual({ ok: false, problem: 'sport should be a string that is not empty' });
  });

  it('throws any other error on', () => {
    const fault = new TypeError('a fault of the page');

    expect(() =>
      parsed(() => {
        throw fault;
      }),
    ).toThrow(fault);
  });
});

describe('isDay', () => {
  it.each(['2026-10-20', '2027-02-28', '2028-02-29', '2026-12-31'])('takes %s', (value) => {
    expect(isDay(value)).toBe(true);
  });

  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-5', '20261020', '2026-10-20T00:00:00Z', ''])(
    'refuses %j',
    (value) => {
      expect(isDay(value)).toBe(false);
    },
  );
});

describe('day', () => {
  it('names the field and gives an example', () => {
    expect(() => day('20 October', 'since')).toThrow(new ShapeProblem('since should be a date like 2026-10-20'));
    expect(() => day(20261020, 'since')).toThrow('since should be a date like 2026-10-20');
  });
});

describe('orNull', () => {
  it('leaves null as it is', () => {
    expect(orNull(null, 'since', day)).toBeNull();
  });

  it('checks anything else', () => {
    expect(orNull('2026-10-20', 'since', day)).toBe('2026-10-20');
  });

  it('says that null would have done', () => {
    expect(() => orNull(undefined, 'since', day)).toThrow('since should be a date like 2026-10-20 or null');
  });

  it('leaves a complaint about a field further in as it is', () => {
    const interval = (value: unknown, path: string) => bounds(value, path, share);

    expect(() => orNull([0.2, 1.5], 'accuracy_interval', interval)).toThrow(
      new ShapeProblem('accuracy_interval[1] should be a number from 0 to 1'),
    );
  });
});

describe('bounds', () => {
  it('takes a lower and an upper bound', () => {
    expect(bounds([0.2065, 1], 'interval', share)).toEqual([0.2065, 1]);
    expect(bounds([0.5, 0.5], 'interval', share)).toEqual([0.5, 0.5]);
  });

  it.each([[[0.6, 0.4]], [[0.4]], [[0.1, 0.2, 0.3]], ['0.4 to 0.6'], [{ lower: 0.4, upper: 0.6 }]])('refuses %j', (value) => {
    expect(() => bounds(value, 'interval', share)).toThrow(
      'interval should be a lower bound and an upper bound that is not below it',
    );
  });
});

describe('teamTable', () => {
  it('copies the rows of the teams and nothing else', () => {
    const table = teamTable(JSON.parse('{"BOS": "a", "NYK": "b"}'), 'teams', text);

    expect(table).toEqual({ BOS: 'a', NYK: 'b' });
  });

  it.each(['__proto__', 'constructor', 'bos', 'Boston'])('refuses a row under %j', (key) => {
    const table = JSON.parse(`{"BOS": "a", "${key}": "b"}`);

    expect(() => teamTable(table, 'teams', text)).toThrow('teams should be a table keyed by three capital letters');
  });

  it('names the row that is wrong', () => {
    expect(() => teamTable({ BOS: 'a', NYK: '' }, 'teams', text)).toThrow('teams.NYK should be a string that is not empty');
  });
});

describe('hasRow', () => {
  it('finds a row that a table has under a key, and none that it has not', () => {
    const table = { BOS: { rating: 1572 }, NYK: { rating: 1720 } };

    expect(hasRow(table, 'BOS')).toBe(true);
    expect(hasRow(table, 'SEA')).toBe(false);
  });

  it('does not take what every object has for a row of the table', () => {
    expect(hasRow({}, 'toString')).toBe(false);
    expect(hasRow({}, 'constructor')).toBe(false);
  });

  it('needs nothing that a browser of before 2022 does not have', () => {
    const hasOwn = Object.hasOwn;
    // @ts-expect-error The function is taken away as an old browser lacks it.
    delete Object.hasOwn;
    try {
      expect(hasRow({ BOS: 1 }, 'BOS')).toBe(true);
    } finally {
      Object.hasOwn = hasOwn;
    }
  });
});
