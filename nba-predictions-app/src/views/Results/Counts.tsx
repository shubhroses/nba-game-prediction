import { SourceName } from '../../components/ui';
import { tallyWords, type SourceTally } from '../../display/results';

/**
 * The counts of a day in one line, under the title of an earlier day: for
 * each source, how many of its picks won, of how many. It is made of spans,
 * so that it can stand in a paragraph, and on a narrow screen it runs on to a
 * second line between two sources and never inside one.
 */
export default function Counts({ tallies }: { tallies: SourceTally[] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span>Picks won</span>
      {tallies.map((tally) => {
        const { count, what } = tallyWords(tally);
        return (
          <span key={tally.source} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <SourceName source={tally.source} className="text-ink" />
            {count === null ? <span>{what.toLowerCase()}</span> : <span className="font-semibold text-ink">{count}</span>}
          </span>
        );
      })}
    </span>
  );
}
