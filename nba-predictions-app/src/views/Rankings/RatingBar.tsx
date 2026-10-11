import type { RatingBar as Bar } from '../../display/rankings';
import { classes } from '../../utils/classes';

// The drawing is this many units wide and is stretched to the width of its
// container, as the lean bar is. The middle is an average team.
const WIDTH = 200;
const HEIGHT = 12;
const MIDDLE = HEIGHT / 2;

interface RatingBarProps {
  bar: Bar;
  className?: string;
}

/**
 * One team's rating in points on a bar that is centered on an average team:
 * filled from the middle to the rating, with a line across the end of the
 * fill that reaches as far as the uncertainty to either side. The number is
 * written next to the bar, so a screen reader passes the drawing over.
 */
export default function RatingBar({ bar, className }: RatingBarProps) {
  const whisker = { x1: bar.low * WIDTH, x2: bar.high * WIDTH, y1: MIDDLE, y2: MIDDLE, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={classes('block h-3 overflow-hidden rounded-full', className)}
    >
      <rect width={WIDTH} height={HEIGHT} className="fill-sunken" />
      <rect x={bar.from * WIDTH} width={(bar.to - bar.from) * WIDTH} height={HEIGHT} className="fill-pr" />
      <line x1={WIDTH / 2} x2={WIDTH / 2} y1={0} y2={HEIGHT} className="stroke-ink" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      {/* The line lies on the fill and on the track, in both themes. A casing in the color of the card sets it off from either. */}
      <line {...whisker} className="stroke-surface" strokeWidth={4} />
      <line {...whisker} className="stroke-ink" strokeWidth={1.5} />
    </svg>
  );
}
