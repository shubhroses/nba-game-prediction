const UTC_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * The time the page's clock is fixed at, in milliseconds, from the value of
 * the build variable VITE_DATA_NOW: a UTC time to the second, such as
 * 2026-11-08T23:30:00Z. Null when the build sets nothing or anything else,
 * and the clock then runs.
 */
export function fixedTime(value: string | undefined): number | null {
  if (value === undefined || !UTC_TIME.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Null in the published page. A build that previews sample data sets the
 * variable, so that the page shows the day the sample is of and not the day
 * it is opened on.
 */
export const FIXED_NOW = fixedTime(import.meta.env.VITE_DATA_NOW);
