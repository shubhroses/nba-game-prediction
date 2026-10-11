import { TRACK_LENGTH, trackMarks } from '../../display/recordTrack';

interface IntervalTrackProps {
  /** What the track says, for a visitor who cannot see it. */
  label: string;
  /** The numbers at the two ends of the track. */
  from: number;
  to: number;
  /** The number itself. Null when there is none, and nothing is marked then. */
  point: number | null;
  /** The interval around it. Null when there is none. */
  interval: readonly [number, number] | null;
  /** What is written under the left end, under the middle and under the right end. */
  ends: readonly [string, string, string];
  /** The class of the color that the interval is filled in, from display/sources.ts. */
  fill: string;
  className?: string;
}

// The track is this many units high and the marks stand out above and below it.
const TRACK_HEIGHT = 12;
const OVERHANG = 4;
const HEIGHT = TRACK_HEIGHT + 2 * OVERHANG;
const MIDDLE = TRACK_LENGTH / 2;

/**
 * A number on a track with the interval around it, so that how sure the
 * number is can be seen: a wide fill is a number that is not known well. The
 * dashed line in the middle is what the number is held against, which is an
 * even share on one kind of track and no difference on the other. A fill
 * that reaches across it says that the number cannot be told from it.
 */
export default function IntervalTrack({ label, from, to, point, interval, ends, fill, className }: IntervalTrackProps) {
  const marks = trackMarks(from, to, point, interval);
  const empty = marks.point === null && marks.span === null;

  return (
    <div className={className}>
      <div role="img" aria-label={label} className="relative h-5">
        {empty ? (
          // Nothing to mark yet: a dashed outline where the track will be.
          <div className="absolute inset-x-0 top-1 h-3 rounded-full border border-dashed border-faint" />
        ) : (
          <>
            <svg
              viewBox={`0 0 ${TRACK_LENGTH} ${TRACK_HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute inset-x-0 top-1 block h-3 w-full overflow-hidden rounded-full"
            >
              <rect width={TRACK_LENGTH} height={TRACK_HEIGHT} className="fill-sunken" />
              {marks.span && <rect x={marks.span.x} width={marks.span.width} height={TRACK_HEIGHT} className={fill} />}
            </svg>
            <svg
              viewBox={`0 0 ${TRACK_LENGTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute inset-0 block h-5 w-full overflow-visible"
            >
              <line
                x1={MIDDLE}
                x2={MIDDLE}
                y1={0}
                y2={HEIGHT}
                className="stroke-muted"
                strokeWidth={1}
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
              {marks.point !== null && (
                <>
                  {/* The number is a line in the color of the text with an edge in the color of the card, so that it
                      shows on the fill and on the track alike, in both themes. */}
                  <line
                    x1={marks.point}
                    x2={marks.point}
                    y1={1}
                    y2={HEIGHT - 1}
                    className="stroke-surface"
                    strokeWidth={5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={marks.point}
                    x2={marks.point}
                    y1={1}
                    y2={HEIGHT - 1}
                    className="stroke-ink"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>
          </>
        )}
      </div>
      {/* The numbers of the two ends and of the middle. A track with nothing on it has no use for them. */}
      {!empty && (
        <div aria-hidden="true" className="mt-0.5 grid grid-cols-3 text-xs text-faint">
          <span>{ends[0]}</span>
          <span className="text-center">{ends[1]}</span>
          <span className="text-right">{ends[2]}</span>
        </div>
      )}
    </div>
  );
}
