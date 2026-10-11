import { CHART, chartX, chartY, HAPPENED_TICKS, SAID_TICKS, type ChartDot } from '../../display/recordCalibration';
import type { Source } from '../../display/sources';
import { classes } from '../../utils/classes';

interface CalibrationChartProps {
  source: Source;
  /** What the chart shows, for a visitor who cannot see it. */
  label: string;
  /** One dot for each band that has a game. */
  dots: readonly ChartDot[];
}

// The size of the text in the units of the drawing. The drawing is never shown smaller than it is, so this is 12px or more.
const TEXT = 12;

/** A share as an axis writes it: "50%", "100%". The lines of the chart are at whole percents. */
function tick(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The chance that one source gave its picks against the share of them that
 * won. Across is the mean chance that the picks of a band were given, and up
 * is the share of them that won. On the dashed line the two are equal. A dot
 * grows with the games of its band, which are written next to it, and the
 * dot of a band with fewer than ten games is hollow.
 */
export default function CalibrationChart({ source, label, dots }: CalibrationChartProps) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      className="mx-auto block h-auto w-full max-w-[17.5rem]"
    >
      {HAPPENED_TICKS.map((share) => (
        <g key={share}>
          <line x1={CHART.left} x2={CHART.right} y1={chartY(share)} y2={chartY(share)} className="stroke-line" strokeWidth={1} />
          <text x={CHART.left - 6} y={chartY(share) + 4} textAnchor="end" fontSize={TEXT} className="fill-faint">
            {tick(share)}
          </text>
        </g>
      ))}
      {SAID_TICKS.map((share) => (
        <g key={share}>
          <line x1={chartX(share)} x2={chartX(share)} y1={CHART.top} y2={CHART.bottom} className="stroke-line" strokeWidth={1} />
          <text x={chartX(share)} y={CHART.bottom + 16} textAnchor="middle" fontSize={TEXT} className="fill-faint">
            {tick(share)}
          </text>
        </g>
      ))}

      <text x={0} y={TEXT - 2} fontSize={TEXT} className="fill-muted">
        ↑ Share that won
      </text>
      <text x={CHART.right} y={CHART.height - 4} textAnchor="end" fontSize={TEXT} className="fill-muted">
        Chance given →
      </text>

      {/* On this line the chance given equals the share that won. A pick is never below 52%, so it starts at an even game. */}
      <line
        x1={chartX(0.5)}
        y1={chartY(0.5)}
        x2={chartX(1)}
        y2={chartY(1)}
        className="stroke-muted"
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />

      {dots.length === 0 && (
        <text
          x={(CHART.left + CHART.right) / 2}
          y={chartY(0.22)}
          textAnchor="middle"
          fontSize={TEXT}
          strokeWidth={3}
          paintOrder="stroke"
          className="fill-muted stroke-surface"
        >
          No pick graded yet
        </text>
      )}

      {dots.map((dot) => (
        <g key={dot.label}>
          <circle
            cx={dot.x}
            cy={dot.y}
            r={dot.r}
            strokeWidth={1.5}
            strokeDasharray={dot.faint ? '2 2' : undefined}
            className={classes(source.stroke, dot.faint ? 'fill-surface' : source.fill)}
          >
            <title>{dot.words}</title>
          </circle>
          {/* The number of games, with an edge in the color of the card so that it reads across a line of the chart. */}
          <text
            x={dot.games.x}
            y={dot.games.y}
            textAnchor={dot.games.anchor}
            fontSize={TEXT}
            strokeWidth={3}
            paintOrder="stroke"
            className="fill-ink stroke-surface font-medium"
          >
            {dot.games.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
