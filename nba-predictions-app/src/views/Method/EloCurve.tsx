import type { WorkedGame } from '../../display/method';
import { CURVE_GAPS, curvePath, curvePoint, curveSummary, eloCurve, gapLabel, smallestPickGap } from '../../display/methodCurve';
import { classes } from '../../utils/classes';

// The drawing is 100 units wide and 100 high, and is stretched to the width
// of the card. Lines keep their width when it is stretched.
const SIZE = 100;
const PATH = curvePath(eloCurve());

// Where the label of each gap stands under the drawing: at its mark, and the two at the ends inside the drawing.
const UNDER = ['left-0', 'left-1/4 -translate-x-1/2', 'left-1/2 -translate-x-1/2', 'left-3/4 -translate-x-1/2', 'right-0'];

/**
 * Elo's formula as a curve: the home team's chance for every gap, with the
 * worked game as a dot on it and the chances without a pick as a band. The
 * labels are text of the page and not of the drawing, so that they keep
 * their size at any width.
 */
export default function EloCurve({ game }: { game: WorkedGame }) {
  const worked = curvePoint(game.gap);
  const dot = {
    x1: worked.x * SIZE,
    x2: worked.x * SIZE,
    y1: worked.y * SIZE,
    y2: worked.y * SIZE,
    strokeLinecap: 'round' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  const marks = CURVE_GAPS.map((gap) => curvePoint(gap).x * SIZE);

  return (
    <figure>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 pt-2">
        {/* The three labels stand at the top, the middle and the bottom of the drawing, each centered on its line. */}
        <div aria-hidden="true" className="-my-2 flex flex-col justify-between text-right text-xs text-muted">
          <span>100%</span>
          <span>50%</span>
          <span>0%</span>
        </div>
        <svg
          role="img"
          aria-label={curveSummary()}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          preserveAspectRatio="none"
          className="block h-36 w-full overflow-visible"
        >
          {/* From 48% to 52% Elo has no pick. */}
          <rect y={48} width={SIZE} height={4} className="fill-sunken" />
          {marks.map((x) => (
            <line key={x} x1={x} x2={x} y1={0} y2={SIZE} className="stroke-line" vectorEffect="non-scaling-stroke" />
          ))}
          {[0, SIZE].map((y) => (
            <line key={y} x1={0} x2={SIZE} y1={y} y2={y} className="stroke-line" vectorEffect="non-scaling-stroke" />
          ))}
          <path d={PATH} fill="none" className="stroke-elo" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {/* A line of no length with round ends is a dot that stays round when the drawing is stretched. The wider one under it is a rim. */}
          <line {...dot} className="stroke-surface" strokeWidth={13} />
          <line {...dot} className="stroke-ink" strokeWidth={8} />
        </svg>
        <div />
        <div aria-hidden="true" className="relative mt-1 h-4 text-xs text-muted">
          {CURVE_GAPS.map((gap, index) => (
            <span key={gap} className={classes('absolute top-0', UNDER[index])}>
              {gapLabel(gap)}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        The home team&apos;s chance for every gap. The dot is the worked game. In the shaded band, from 48% to 52%, Elo has no pick: that is a
        gap of fewer than {smallestPickGap()} points to either side.
      </figcaption>
    </figure>
  );
}
