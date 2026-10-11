import { SourceName } from '../../components/ui';
import { OWN_PICKS, recordSummary, type RecordTile } from '../../display/gamesIntro';
import { hrefOf } from '../../display/route';
import { classes } from '../../utils/classes';

interface RecordStripProps {
  /** One tile for each source, in the order of the page. */
  tiles: readonly RecordTile[];
  /** Where the strip stands and at which widths it is shown, which the view decides. */
  className?: string;
}

/** How the picks of each source have done so far, as three small figures that lead to the record. */
export default function RecordStrip({ tiles, className }: RecordStripProps) {
  return (
    // The whole strip is one link, and a screen reader is told its numbers in a sentence.
    <a
      href={hrefOf('record')}
      aria-label={recordSummary(tiles)}
      className={classes(
        'rounded-xl border border-line bg-surface px-4 py-3 shadow-card hover:border-faint motion-safe:transition-colors sm:px-5',
        className,
      )}
    >
      <span className="flex items-baseline justify-between gap-6">
        <span className="text-sm font-semibold text-ink">
          Record so far{' '}
          <span className="font-normal text-muted">
            · picks won–lost{tiles.length > 1 && `, ${OWN_PICKS}`}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium text-ink underline underline-offset-4">Full record</span>
      </span>
      <span className="mt-2 flex flex-wrap gap-x-5 gap-y-2 sm:gap-x-8">
        {tiles.map((tile) => (
          <span key={tile.source} className="flex flex-col">
            <SourceName source={tile.source} className="text-xs text-muted" />
            <span className="text-xl font-bold leading-tight text-ink">{tile.record}</span>
          </span>
        ))}
      </span>
    </a>
  );
}
