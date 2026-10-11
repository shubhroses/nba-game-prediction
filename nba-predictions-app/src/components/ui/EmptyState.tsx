import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface EmptyStateProps {
  /** What is not there, in a few words. */
  title: string;
  /** A sentence that says why, or when it will be. */
  children?: ReactNode;
  className?: string;
}

/** Stands where a list or a chart would be when there is nothing to show yet, and says why. */
export default function EmptyState({ title, children, className }: EmptyStateProps) {
  return (
    <div className={classes('rounded-xl border border-dashed border-line px-4 py-8 text-center sm:py-10', className)}>
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1.5 max-w-prose text-sm text-muted">{children}</p>}
    </div>
  );
}
