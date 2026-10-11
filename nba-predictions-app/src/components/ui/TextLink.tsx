import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface TextLinkProps {
  /** Where it leads: a view, as `hrefOf` gives it, or an address outside the page. */
  href: string;
  children: ReactNode;
  /** For a link that stands by itself: it is then at least 40px high and wide, which a finger needs. A link in a line of text keeps the height of its line. */
  standalone?: boolean;
  className?: string;
}

/**
 * A link in the words of the page. It is underlined and has the color of the
 * text around it, because blue is the color of one of the sources.
 */
export default function TextLink({ href, children, standalone = false, className }: TextLinkProps) {
  return (
    <a
      href={href}
      className={classes(
        standalone && 'inline-flex min-h-10 min-w-10 items-center',
        'font-medium text-ink underline underline-offset-4 hover:text-muted',
        className,
      )}
    >
      {children}
    </a>
  );
}
