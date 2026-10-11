import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface CardProps {
  children: ReactNode;
  /** The element it is: an `article` for a game, a `section` for a part of a view, an `li` in a list. */
  as?: 'div' | 'article' | 'section' | 'li';
  /** False for a card whose content reaches its edges, such as a table. */
  padded?: boolean;
  className?: string;
}

/** The surface that one thing sits on: a game, a table, a group of figures. */
export default function Card({ children, as: Element = 'div', padded = true, className }: CardProps) {
  return (
    <Element className={classes('rounded-xl border border-line bg-surface shadow-card', padded && 'p-4 sm:p-5', className)}>
      {children}
    </Element>
  );
}
