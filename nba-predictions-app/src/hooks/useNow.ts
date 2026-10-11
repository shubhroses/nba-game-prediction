import { useEffect, useState } from 'react';
import { FIXED_NOW } from '../data/clock';

/**
 * The current time, refreshed every half minute so that ages and the list of
 * games stay current. In a build that sets VITE_DATA_NOW the clock stands
 * still at that time, which is how sample data of one day is previewed.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => FIXED_NOW ?? Date.now());

  useEffect(() => {
    if (FIXED_NOW !== null) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
