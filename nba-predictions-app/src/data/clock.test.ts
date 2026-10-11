import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixedTime } from './clock';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fixedTime', () => {
  it('reads a UTC time to the second', () => {
    expect(fixedTime('2026-11-08T23:30:00Z')).toBe(Date.UTC(2026, 10, 8, 23, 30, 0));
  });

  it('lets the clock run when the build sets nothing', () => {
    expect(fixedTime(undefined)).toBeNull();
    expect(fixedTime('')).toBeNull();
  });

  it.each(['2026-11-08', '2026-11-08T23:30:00', '2026-11-08T18:30:00-05:00', '2026-13-45T23:30:00Z', 'now', '1794180600000'])(
    'lets the clock run for %j, which is not a UTC time',
    (value) => {
      expect(fixedTime(value)).toBeNull();
    },
  );
});

describe('FIXED_NOW', () => {
  /** The constant the module works out when it is loaded with this value of the build variable. */
  async function builtWith(now: string): Promise<number | null> {
    vi.stubEnv('VITE_DATA_NOW', now);
    vi.resetModules();
    return (await import('./clock')).FIXED_NOW;
  }

  it('is null in a build that sets nothing, as the published page is', async () => {
    expect(await builtWith('')).toBeNull();
  });

  it('follows VITE_DATA_NOW', async () => {
    expect(await builtWith('2026-11-08T23:30:00Z')).toBe(Date.parse('2026-11-08T23:30:00Z'));
  });
});
