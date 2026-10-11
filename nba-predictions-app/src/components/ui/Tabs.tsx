import { useEffect, useRef } from 'react';
import { classes } from '../../utils/classes';
import { showInRow } from './showInRow';

export interface Tab<Key extends string> {
  key: Key;
  label: string;
  /** Where the tab leads, such as `#/record`. */
  href: string;
}

interface TabsProps<Key extends string> {
  /** What the links are, for a screen reader: "Views". */
  label: string;
  tabs: readonly Tab<Key>[];
  current: Key;
  className?: string;
}

/**
 * The views of the page as a row of links on the navy of the header, one of
 * which is where the visitor is. That one is marked by a line under it and a
 * heavier weight as well as by its color. On a screen that is too narrow for
 * the row, it scrolls sideways inside its own box, and the current link and
 * the link with the focus are kept in sight.
 */
export default function Tabs<Key extends string>({ label, tabs, current, className }: TabsProps<Key>) {
  const row = useRef<HTMLUListElement>(null);
  const currentLink = useRef<HTMLAnchorElement>(null);

  // Only the row is moved, and only sideways. The page stays where the visitor has scrolled it to.
  useEffect(() => {
    if (!row.current || !currentLink.current) return;
    const around = row.current.getBoundingClientRect();
    const link = currentLink.current.getBoundingClientRect();
    if (link.left < around.left) row.current.scrollLeft -= around.left - link.left;
    else if (link.right > around.right) row.current.scrollLeft += link.right - around.right;
  }, [current]);

  return (
    <nav aria-label={label} className={className}>
      <ul ref={row} className="no-scrollbar flex overflow-x-auto">
        {tabs.map((tab) => {
          const isCurrent = tab.key === current;
          return (
            <li key={tab.key} className="shrink-0">
              <a
                href={tab.href}
                ref={isCurrent ? currentLink : undefined}
                aria-current={isCurrent ? 'page' : undefined}
                onFocus={showInRow}
                // The ring is drawn inside the link, because the scrolling row cuts off what is outside it.
                className={classes(
                  'flex h-11 items-center whitespace-nowrap border-b-2 -outline-offset-2 motion-safe:transition-colors',
                  // The five links fit a screen of 320px in the smallest letters of the page, and one of 360px in
                  // their usual ones with less room between them. A narrower row scrolls inside its own box.
                  'px-1.5 text-xs min-[360px]:px-1 min-[360px]:text-sm min-[380px]:px-2 sm:px-3',
                  // A theme of forced colors draws every border, also one that is transparent. There the line stands
                  // under the current tab alone.
                  isCurrent
                    ? 'border-accent font-semibold text-header-ink'
                    : 'border-transparent font-medium text-header-muted hover:text-header-ink forced-colors:border-b-0',
                )}
              >
                {tab.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
