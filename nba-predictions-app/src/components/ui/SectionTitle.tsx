import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface SectionTitleProps {
  children: ReactNode;
  /** The heading it is. A view's own heading is an h2, so a section of it is an h3. */
  level?: 3 | 4;
  /** A sentence under the title that says what the section shows. */
  note?: ReactNode;
  /** Something small at the far end of the line, such as a count. */
  aside?: ReactNode;
  /** Leaves out the room under the title, for a title that stands in a bar or in a row of its own. */
  flush?: boolean;
  className?: string;
}

/** The title of a section of a view, with an optional sentence under it. */
export default function SectionTitle({ children, level = 3, note, aside, flush = false, className }: SectionTitleProps) {
  const Heading = level === 3 ? 'h3' : 'h4';
  return (
    <div className={classes(!flush && 'mb-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Heading className="text-lg font-semibold text-ink">{children}</Heading>
        {aside && <div className="shrink-0 text-sm text-muted">{aside}</div>}
      </div>
      {note && <p className="mt-1 text-sm text-muted">{note}</p>}
    </div>
  );
}
