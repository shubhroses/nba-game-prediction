import { Card, SourceName } from '../../components/ui';
import { tallyWords, type SourceTally } from '../../display/results';
import { source } from '../../display/sources';
import { classes } from '../../utils/classes';

/** The part of a block's width that is left empty, half of it on either side, so that the blocks stand apart. */
const GAP = 0.14;

/**
 * One block for each pick of the day that was graded: those that won in the
 * color of the source, and the others empty. The numbers above it say the
 * same, so a screen reader passes it over.
 */
function PicksBar({ tally, className }: { tally: SourceTally; className?: string }) {
  const picks = tally.wins + tally.losses;
  if (picks === 0) return null;

  // The drawing is one unit wide for each pick, less the gap at its two ends, and is stretched to the width of the tile.
  return (
    <svg
      aria-hidden="true"
      viewBox={`${GAP / 2} 0 ${picks - GAP} 1`}
      preserveAspectRatio="none"
      className={classes('block h-1.5 w-full', className)}
    >
      {Array.from({ length: picks }, (_, index) => (
        <rect
          key={index}
          x={index + GAP / 2}
          width={1 - GAP}
          height={1}
          className={index < tally.wins ? source(tally.source).fill : 'fill-line'}
        />
      ))}
    </svg>
  );
}

/** How one source did on the day. On a phone the count stands at the far end of the line, and from there up under the name. */
function Tile({ tally }: { tally: SourceTally }) {
  const { count, what, rest } = tallyWords(tally);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:block sm:p-5">
      <SourceName source={tally.source} className="text-sm text-ink" />
      <p className="row-span-2 text-2xl font-bold leading-none text-ink sm:mt-2.5 sm:text-3xl">
        {count ?? <span aria-hidden="true">—</span>}
      </p>
      <p className="mt-0.5 text-sm text-muted sm:mt-1.5">{[what, ...rest].join(' · ')}</p>
      <PicksBar tally={tally} className="col-span-2 mt-2.5 sm:mt-3" />
    </li>
  );
}

/** The day at a glance: for each source, how many of its picks won, of how many. */
export default function Tiles({ tallies }: { tallies: SourceTally[] }) {
  return (
    <Card padded={false} className="mb-4">
      <ul className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {tallies.map((tally) => (
          <Tile key={tally.source} tally={tally} />
        ))}
      </ul>
    </Card>
  );
}
