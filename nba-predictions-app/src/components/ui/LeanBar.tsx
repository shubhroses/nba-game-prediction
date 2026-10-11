import { lean, leanLabel } from '../../display/lean';
import { source, type SourceKey } from '../../display/sources';
import { classes } from '../../utils/classes';

interface LeanBarProps {
  source: SourceKey;
  /** The source's chance for the home team. Null when it has none, and the track is then drawn empty. */
  pHome: number | null;
  /** Team codes. The away team is the left end of the bar and the home team the right end. */
  home: string;
  away: string;
  /** `sm` for a dense row, such as one of a table. The width is always that of the container. */
  size?: 'sm' | 'md';
  className?: string;
}

const HEIGHTS = { sm: 'h-2', md: 'h-3' };

// The drawing is this many units wide and is stretched to the width of its
// container. Half of it belongs to each team.
const WIDTH = 200;
const HEIGHT = 12;
const MIDDLE = WIDTH / 2;

/**
 * Shows which way one source leans in one game, and how far: filled from the
 * tick in the middle toward the away team on the left or the home team on
 * the right. Bars of several sources under each other share the axis, so a
 * disagreement shows as fills on different sides.
 */
export default function LeanBar({ source: key, pHome, home, away, size = 'md', className }: LeanBarProps) {
  const { name, fill } = source(key);
  if (pHome === null) {
    // Nothing to lean with: a dashed outline where the track would be, and no middle to lean from.
    return (
      <svg
        role="img"
        aria-label={leanLabel(name, pHome, home, away)}
        className={classes('block w-full rounded-full border border-dashed border-faint', HEIGHTS[size], className)}
      />
    );
  }

  const { side, share } = lean(pHome);
  const filled = share * MIDDLE;
  return (
    <svg
      role="img"
      aria-label={leanLabel(name, pHome, home, away)}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={classes('block w-full overflow-hidden rounded-full', HEIGHTS[size], className)}
    >
      <rect width={WIDTH} height={HEIGHT} className="fill-sunken" />
      {side && <rect x={side === 'home' ? MIDDLE : MIDDLE - filled} width={filled} height={HEIGHT} className={fill} />}
      <line x1={MIDDLE} x2={MIDDLE} y1={0} y2={HEIGHT} className="stroke-ink" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
