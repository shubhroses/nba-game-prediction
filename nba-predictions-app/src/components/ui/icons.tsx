import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface IconProps {
  className?: string;
}

/**
 * The size of an icon: the one its class asks for, and otherwise 20px. A
 * class of a size takes the place of the usual one. With both on the element,
 * the order of the stylesheet would settle which of them counts, and not the
 * order they are written in.
 */
function sized(className: string | undefined, usual = 'h-5 w-5'): string {
  const asksForOne = className !== undefined && /(?:^|\s)(?:h|w)-/.test(className);
  return classes(!asksForOne && usual, 'shrink-0', className);
}

/** The frame of an icon that is drawn in lines: in the color of the text around it, and passed over by a screen reader. */
function Icon({ className, usual, children }: IconProps & { usual?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={sized(className, usual)}
    >
      {children}
    </svg>
  );
}

/** A check mark, for a pick that was right. */
export function CheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </Icon>
  );
}

/** A cross, for a pick that was wrong. */
export function CrossIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </Icon>
  );
}

/** A dash, for a source that had no pick. */
export function DashIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M5 10h10" />
    </Icon>
  );
}

/** A dotted ring, for a game that was not graded. */
export function RingIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="10" cy="10" r="6" strokeDasharray="1 3.2" />
    </Icon>
  );
}

/** A circled i, for something to know. */
export function InfoIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9.5v4M10 6.5v.01" />
    </Icon>
  );
}

/** A warning triangle, for something that is not as it should be. */
export function WarnIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 3.5l7.5 13h-15z" />
      <path d="M10 8.5v3.5M10 14.5v.01" />
    </Icon>
  );
}

/** An arrowhead that points to the right, for something that opens. It is turned downward once that is open. */
export function ChevronIcon({ className }: IconProps) {
  return (
    <Icon className={className} usual="h-4 w-4">
      <path d="M7.5 5l5 5-5 5" />
    </Icon>
  );
}

/** Two arrows that pass each other, for two things that change places. */
export function SwapIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M3.5 7h12l-3-3M16.5 13h-12l3 3" />
    </Icon>
  );
}

/** A small triangle that points up or down, for a number that rose or fell. */
export function MoveIcon({ up, className }: IconProps & { up: boolean }) {
  return (
    <svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" className={sized(className, 'h-2.5 w-2.5')}>
      <path d={up ? 'M5 1.5l4.5 7h-9z' : 'M5 8.5l-4.5-7h9z'} />
    </svg>
  );
}

const STAR = 'M10 2.75L11.97 7.74L17.32 8.07L13.19 11.49L14.53 16.68L10 13.8L5.47 16.68L6.81 11.49L2.68 8.07L8.03 7.74z';

/**
 * A star, for a team the visitor follows. It is filled for a team that is
 * followed and an outline for one that is not, so the two are told apart by
 * their shape and not by their color.
 */
export function StarIcon({ filled, className }: IconProps & { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
      className={sized(className)}
    >
      <path d={STAR} />
    </svg>
  );
}

/**
 * The same star, small and filled, to mark a team the visitor follows where
 * there is no room for a button. Its rim has the color of what it lies on,
 * which sets it off from a logo it is on the corner of.
 */
export function StarMark({ on = 'surface', className }: IconProps & { on?: 'surface' | 'sunken' }) {
  return (
    <svg
      viewBox="0 0 20 20"
      strokeWidth="2.5"
      strokeLinejoin="round"
      aria-hidden="true"
      className={classes(sized(className, 'h-4 w-4'), 'fill-ink', on === 'surface' ? 'stroke-surface' : 'stroke-sunken')}
    >
      <path paintOrder="stroke" d={STAR} />
    </svg>
  );
}
