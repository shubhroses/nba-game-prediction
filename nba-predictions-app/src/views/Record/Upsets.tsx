import { Card, SectionTitle, SourceName, TeamBadge } from '../../components/ui';
import type { SeasonRecord } from '../../data/record';
import { biggestUpsets, type UpsetRow } from '../../display/recordUpsets';

function Upset({ row }: { row: UpsetRow }) {
  return (
    <li className="py-3 first:pt-1 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <TeamBadge team={row.favorite} size="sm" label="name" className="text-ink" />
        <span className="shrink-0 text-right text-lg font-bold leading-none text-ink">{row.chance}</span>
      </div>
      {/* Under the name of the team, which starts after its logo. */}
      <p className="mt-1 pl-9 text-sm text-muted">{row.outcome}</p>
      <p className="pl-9 text-xs text-faint">{row.game}</p>
    </li>
  );
}

/** For each source, the picks with the highest chance that lost. */
export default function Upsets({ record }: { record: SeasonRecord }) {
  const sources = biggestUpsets(record);

  return (
    <section>
      <SectionTitle note="For each source, the picks that it gave the highest chance and that lost.">Biggest upsets</SectionTitle>

      <div className="grid grid-cols-1 gap-4 lg:gap-5">
        {sources.map(({ source, rows, none }) => (
          <Card key={source.key} as="article">
            <h4 className="text-base text-ink">
              <SourceName source={source.key} strong />
            </h4>
            {none ? (
              <p className="mt-2 text-sm text-muted">{none}</p>
            ) : (
              <ol className="mt-2 divide-y divide-line">
                {rows.map((row) => (
                  <Upset key={row.id} row={row} />
                ))}
              </ol>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
