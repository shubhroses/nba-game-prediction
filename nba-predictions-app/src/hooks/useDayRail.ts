import { useEffect, useRef, type RefObject } from 'react';

/**
 * For a view that shows one day at a time under a rail of days. It returns a
 * ref for the element that holds the rail, which has to be able to take the
 * focus (`tabIndex={-1}`).
 *
 * After a change of day the view is read from its rail on. The rail is
 * brought into sight, unless it is there already: whoever changed the day at
 * the foot of a long one is taken back up, and whoever has the rail in front
 * of them stays where they are. When the focus was below the rail, it is
 * handed to the rail, so that the keyboard goes on from there as well. The
 * page itself goes to its top only when the view changes, which a change of
 * day is not.
 */
export function useDayRail(selected: string | null): RefObject<HTMLDivElement | null> {
  const rail = useRef<HTMLDivElement>(null);
  const shown = useRef(selected);

  useEffect(() => {
    const element = rail.current;
    if (element && shown.current !== selected) {
      element.scrollIntoView({ block: 'nearest' });

      const focused = document.activeElement;
      const below =
        focused !== null &&
        focused !== document.body &&
        !element.contains(focused) &&
        (element.compareDocumentPosition(focused) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (below) element.focus({ preventScroll: true });
    }
    shown.current = selected;
  }, [selected]);

  return rail;
}
