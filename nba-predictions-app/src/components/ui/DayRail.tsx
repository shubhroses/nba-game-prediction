import { useEffect, useRef } from 'react';
import { classes } from '../../utils/classes';
import { showInRow } from './showInRow';

/** One day of a rail, or the entry that stands for all of them. */
export interface RailDay {
  /** What tells the entries apart: the day, as 2026-11-08. */
  key: string;
  /** "Today", "Last night", or the day as "Tue, Oct 20". */
  label: string;
  /** The line under it: "7 games". */
  note: string;
  /** The address that shows the day. */
  href: string;
  selected: boolean;
  /** True for a day that has nothing to show as things are, which is set back. */
  quiet?: boolean;
}

interface DayRailProps {
  /** The days in the order they are shown in, one of them selected. */
  days: readonly RailDay[];
}

/**
 * The days that a view has something of, as a row of links. A day is a part
 * of the address, so a day can be linked to and the back button leads to the
 * day before it. On a phone the row scrolls sideways inside its own box, out
 * to both edges of the screen, and the selected day is kept in sight. On a
 * wider screen the row wraps.
 */
export default function DayRail({ days }: DayRailProps) {
  const row = useRef<HTMLUListElement>(null);
  const selectedLink = useRef<HTMLAnchorElement>(null);
  const selected = days.find((day) => day.selected)?.key;

  // Only the row is moved, and only sideways. The page stays where the visitor has scrolled it to.
  useEffect(() => {
    if (!row.current || !selectedLink.current) return;
    const around = row.current.getBoundingClientRect();
    const link = selectedLink.current.getBoundingClientRect();
    if (link.left < around.left) row.current.scrollLeft -= around.left - link.left + 16;
    else if (link.right > around.right) row.current.scrollLeft += link.right - around.right + 16;
  }, [selected]);

  return (
    <nav aria-label="Days" className="min-w-0">
      {/* The row takes back the gutter of the page on a phone, and its padding leaves room for the focus ring.
          A day that is brought into the row comes to rest inside that padding. */}
      <ul
        ref={row}
        className="no-scrollbar -mx-gutter flex scroll-px-gutter gap-2 overflow-x-auto px-gutter py-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
      >
        {days.map((day) => (
          <li key={day.key} className="shrink-0">
            <a
              href={day.href}
              ref={day.selected ? selectedLink : undefined}
              aria-current={day.selected ? 'true' : undefined}
              onFocus={showInRow}
              className={classes(
                'flex min-h-12 min-w-[4.75rem] flex-col justify-center whitespace-nowrap rounded-xl border px-3 py-1.5',
                'motion-safe:transition-colors',
                // A theme of forced colors gives every day the same colors, so the selected one has a heavier border
                // and a line under its name there.
                day.selected ? 'border-ink bg-ink text-surface forced-colors:border-[3px]' : 'border-line bg-surface hover:border-faint',
                !day.selected && (day.quiet ? 'text-muted' : 'text-ink'),
              )}
            >
              <span className={classes('text-sm font-semibold', day.selected && 'forced-colors:underline')}>{day.label}</span>
              <span className={classes('text-xs', day.selected ? 'opacity-80' : 'text-muted')}>{day.note}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
