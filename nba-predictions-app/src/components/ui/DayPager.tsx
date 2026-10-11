import { classes } from '../../utils/classes';
import type { RailDay } from './DayRail';

/** A day that the pager leads to. */
export type PagerDay = Pick<RailDay, 'label' | 'note' | 'href'>;

interface DayPagerProps {
  /** The day before the one that is shown. Null when there is none. */
  before: PagerDay | null;
  /** The day after it. Null when there is none. */
  after: PagerDay | null;
}

const LINK = classes(
  'flex min-h-12 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-1.5 text-ink',
  'hover:border-faint motion-safe:transition-colors',
);

function DayLink({ day, forward }: { day: PagerDay; forward: boolean }) {
  return (
    <a href={day.href} className={classes(LINK, forward && 'ml-auto flex-row-reverse text-right')}>
      <span aria-hidden="true" className="text-muted">
        {forward ? '→' : '←'}
      </span>
      <span>
        <span className="sr-only">{forward ? 'The day after: ' : 'The day before: '}</span>
        <span className="block whitespace-nowrap text-sm font-semibold">{day.label}</span>
        <span className="block whitespace-nowrap text-xs text-muted">{day.note}</span>
      </span>
    </a>
  );
}

/**
 * The day before and the day after, at the foot of a day. On a phone a long
 * day is a long way down from the rail of days, and this leads on from where
 * the reading ends. The earlier day is on the left and the later one on the
 * right, whichever way the rail runs.
 */
export default function DayPager({ before, after }: DayPagerProps) {
  if (before === null && after === null) return null;

  return (
    <nav aria-label="The day before and the day after" className="mt-8 flex gap-3 border-t border-line pt-5">
      {before && <DayLink day={before} forward={false} />}
      {after && <DayLink day={after} forward />}
    </nav>
  );
}
