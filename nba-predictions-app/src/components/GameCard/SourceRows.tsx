import type { SourceRow } from '../../display/gameCard';
import { source } from '../../display/sources';
import { classes } from '../../utils/classes';
import { LeanBar, SourceName } from '../ui';

interface SourceRowsProps {
  /** The three sources, in the order of the page. */
  rows: readonly SourceRow[];
  /** Team codes. The away team is the left end of every bar and the home team the right end. */
  home: string;
  away: string;
}

/** The label at the end of a line, in the source's color when it is a pick. */
function labelClass(row: SourceRow): string {
  if (row.kind === 'pick') return classes('font-semibold', source(row.source).text);
  return row.kind === 'toss-up' ? 'font-medium text-muted' : 'text-muted';
}

/**
 * The name of the source. Where a bar is drawn, the bar says the name and
 * the pick to a screen reader with the team's full name, so the name here is
 * passed over.
 */
function Name({ row }: { row: SourceRow }) {
  return (
    <span aria-hidden={row.pHome !== null || undefined}>
      <SourceName source={row.source} className="text-ink" />
    </span>
  );
}

/**
 * The three sources under each other, each with its name, its pick and a
 * bar of the full width. A source without a number has one line that says
 * why, and no bar.
 */
export function StackedRows({ rows, home, away }: SourceRowsProps) {
  return (
    <div>
      {/* Which end of the bars is which team. The bars themselves say it to a screen reader. */}
      {rows.some((row) => row.pHome !== null) && (
        <div aria-hidden="true" className="mb-1.5 flex justify-between text-xs text-faint">
          <span>← {away}</span>
          <span>{home} →</span>
        </div>
      )}
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.source}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {/* What is to be known of the number stands next to the name. */}
              <span className="flex min-w-0 items-baseline gap-2">
                <Name row={row} />
                {row.qualifier && <span className="text-xs text-muted">{row.qualifier}</span>}
              </span>
              <span aria-hidden={row.pHome !== null || undefined} className={classes('text-right', labelClass(row))}>
                {row.label}
              </span>
            </div>
            {row.pHome !== null && <LeanBar source={row.source} pHome={row.pHome} home={home} away={away} className="mt-1.5" />}
            {row.note && <p className="mt-1.5 text-xs text-muted">{row.note}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The three sources as three short lines: name, a small bar, pick. For a
 * card that has to take little room. What is to be known of a number, such
 * as the time of a line, has a line of its own under its source, where it
 * does not have to fit the column of the names.
 */
export function InlineRows({ rows, home, away }: SourceRowsProps) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.source} className="grid grid-cols-[6.75rem_minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
          <Name row={row} />
          {row.pHome !== null ? (
            <>
              <LeanBar source={row.source} pHome={row.pHome} home={home} away={away} size="sm" />
              <span aria-hidden="true" className={classes('min-w-[4.25rem] text-right', labelClass(row))}>
                {row.label}
              </span>
            </>
          ) : (
            <span className="col-span-2 text-right text-muted">{row.label}</span>
          )}
          {/* Under the name, as far in as the name is after its dot. */}
          {row.qualifier && <span className="col-span-3 pl-4 text-xs text-muted">{row.qualifier}</span>}
        </li>
      ))}
    </ul>
  );
}
