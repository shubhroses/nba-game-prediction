import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface StatProps {
  /** What the number is, such as a source's name. */
  label: ReactNode;
  /** The number, written out: "66.7%", "41–19". */
  value: ReactNode;
  /** The line under it, such as the number of games a share is of. */
  note?: ReactNode;
  className?: string;
}

/** One figure that a visitor should find at a glance: a label, a large number and a line under it. */
export default function Stat({ label, value, note, className }: StatProps) {
  return (
    <div className={classes('min-w-0', className)}>
      <div className="text-sm font-medium text-muted">{label}</div>
      <div className="mt-1 text-3xl font-bold leading-none text-ink">{value}</div>
      {note && <div className="mt-1.5 text-sm text-muted">{note}</div>}
    </div>
  );
}
