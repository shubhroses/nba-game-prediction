import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';
import { ChevronIcon } from './icons';

interface DisclosureProps {
  /** The words of the line that opens it. */
  summary: ReactNode;
  /** What it opens. */
  children: ReactNode;
  /** Classes of the whole, such as a border. */
  className?: string;
  /** Classes of the line that opens it, such as its padding and what it does under the pointer. */
  summaryClassName?: string;
}

/**
 * Something that is folded away until a visitor opens it. It is a details
 * element, so it opens without a script and with the keyboard, and a search
 * of the page finds what is in it. The words stand at the left of the line
 * and an arrowhead at its right, which points down once it is open and turns
 * only for a visitor who has not asked for less motion.
 */
export default function Disclosure({ summary, children, className, summaryClassName }: DisclosureProps) {
  return (
    <details className={classes('group', className)}>
      {/* The ring of the focus is drawn inside the line, because a card that cuts off what is in it would cut it off. */}
      <summary
        className={classes(
          'cursor-pointer list-none text-sm font-medium text-ink -outline-offset-2 [&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        {/* The line is laid out inside the summary, which older versions of Safari do not lay out as a row themselves. */}
        <span className="flex min-h-10 items-center justify-between gap-2">
          <span className="min-w-0">{summary}</span>
          <ChevronIcon className="text-muted group-open:rotate-90 motion-safe:transition-transform" />
        </span>
      </summary>
      {children}
    </details>
  );
}
