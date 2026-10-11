import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface ViewHeaderProps {
  /** The heading of the view, an h2 under the h1 of the page. */
  title: string;
  /** A sentence or two that say what the view shows. */
  children?: ReactNode;
  /** A smaller line under them, for what is true of the view right now: how many games it counts, or what it waits for. */
  note?: ReactNode;
  /**
   * For a view whose first screen on a phone belongs to what it shows. Below
   * 640px the heading is then for a screen reader alone, where the tab of the
   * view names it for the eye, and the sentences are left out: the view
   * writes them further down.
   */
  wideOnly?: boolean;
}

/** The top of a view: its heading and what it shows, the same on every view. */
export default function ViewHeader({ title, children, note, wideOnly = false }: ViewHeaderProps) {
  const sentence = wideOnly ? 'hidden sm:block' : undefined;
  return (
    <div className={classes(!wideOnly && 'mb-5', 'sm:mb-6')}>
      <h2 className={classes('text-xl font-bold text-ink sm:text-2xl', wideOnly && 'sr-only sm:not-sr-only')}>{title}</h2>
      {children && <p className={classes('mt-1.5 max-w-3xl text-sm text-muted sm:text-base', sentence)}>{children}</p>}
      {note && <p className={classes('mt-1.5 max-w-3xl text-sm text-muted', sentence)}>{note}</p>}
    </div>
  );
}
