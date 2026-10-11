import { useEffect, useRef, useState, type ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface ScrollBoxProps {
  /** What is in the box, for a screen reader that lands on it: "The record day by day". */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A box that scrolls sideways inside itself when what is in it is wider, so
 * that the page never does: for a table on a narrow screen.
 *
 * The box is the frame of what is in it. Words that only a screen reader
 * gets are taken out of the flow of the page, and without a frame they would
 * stay where the table began and widen the page. While the content is wider
 * than the box, a keyboard can reach the box and scroll it. It is a stop for
 * the Tab key only then.
 */
export default function ScrollBox({ label, children, className }: ScrollBoxProps) {
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    // The observer reports once when it starts, and again whenever the box or what is in it changes its size.
    const observer = new ResizeObserver(() => setScrolls(element.scrollWidth > element.clientWidth));
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={box}
      role={scrolls ? 'region' : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={classes('relative overflow-x-auto -outline-offset-2', className)}
    >
      {children}
    </div>
  );
}
