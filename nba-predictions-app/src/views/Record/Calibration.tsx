import { Card, ScrollBox, SectionTitle, SourceName } from '../../components/ui';
import type { SeasonRecord } from '../../data/record';
import { sourceCards } from '../../display/record';
import { bandRows, chartDots, chartLabel, FAINT_BELOW, mostGames, type BandRow } from '../../display/recordCalibration';
import type { Source } from '../../display/sources';
import { classes } from '../../utils/classes';
import CalibrationChart from './CalibrationChart';

/** Stands where a number would be for a band without a game, and says so to a screen reader. */
function Nothing() {
  return (
    <>
      <span aria-hidden="true" className="text-faint">
        –
      </span>
      <span className="sr-only">no game</span>
    </>
  );
}

/** The numbers of the chart above it: one row for each band, also for a band without a game. */
function BandTable({ source, rows }: { source: Source; rows: readonly BandRow[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{source.name}: its picks by the chance they were given</caption>
      <thead>
        {/* Under a chart the head of the table has a line above it. Next to a chart it starts at the top of the card. */}
        <tr className="border-y border-line bg-sunken text-xs font-semibold text-muted sm:border-t-0 lg:border-t">
          <th scope="col" className="py-2 pl-4 pr-1 text-left align-bottom font-semibold sm:pl-5">
            Band
          </th>
          <th scope="col" className="px-1.5 py-2 text-right align-bottom font-semibold sm:px-2">
            Games
          </th>
          <th scope="col" className="px-1.5 py-2 text-right align-bottom font-semibold sm:px-2">
            Chance given
          </th>
          <th scope="col" className="py-2 pl-1.5 pr-4 text-right align-bottom font-semibold sm:pl-2 sm:pr-5">
            Won
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((row) => (
          <tr key={row.label} className={classes(row.faint && 'text-muted')}>
            <th scope="row" className="whitespace-nowrap py-2 pl-4 pr-1 text-left font-medium text-ink sm:pl-5">
              {row.label}
            </th>
            <td className="px-1.5 py-2 text-right sm:px-2">{row.games}</td>
            <td className="px-1.5 py-2 text-right sm:px-2">{row.saidText ?? <Nothing />}</td>
            <td className="py-2 pl-1.5 pr-4 text-right font-semibold sm:pl-2 sm:pr-5">{row.happenedText ?? <Nothing />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The chance that each source gave its picks against the share of them that
 * won: a chart for each source, and under it the same numbers as a table.
 */
export default function Calibration({ record }: { record: SeasonRecord }) {
  const cards = sourceCards(record);
  const most = mostGames(cards.map(({ card }) => card));

  return (
    <section>
      <SectionTitle
        note={
          <>
            Of the picks that a source gives about 70%, about 70% should win. Each dot is one band of chances: across is the
            mean chance that the picks in it were given, and up is the share of them that won. The fewer games a band has,
            the further its dot can stray from the dashed line by chance.
          </>
        }
      >
        Calibration
      </SectionTitle>

      <div className={classes('grid grid-cols-1 gap-4 lg:gap-5', cards.length > 1 && 'lg:grid-cols-3')}>
        {cards.map(({ source, card }) => {
          const rows = bandRows(card);
          return (
            // Between a phone and a desktop the card lies down: the chart on the left, its numbers on the right.
            <Card
              key={source.key}
              as="article"
              padded={false}
              className="overflow-hidden sm:grid sm:grid-cols-[18rem_minmax(0,1fr)] lg:block"
            >
              <div className="p-4 pb-3 sm:p-5 lg:pb-3">
                <h4 className="mb-3 text-base text-ink">
                  <SourceName source={source.key} strong />
                </h4>
                <CalibrationChart source={source} label={chartLabel(source.name, rows)} dots={chartDots(rows, most)} />
              </div>
              {/* Should the table ever be wider than its card, it scrolls inside this box and is not cut off. */}
              <ScrollBox label={`The calibration of ${source.name} in numbers`} className="sm:border-l sm:border-line lg:border-l-0">
                <BandTable source={source} rows={rows} />
              </ScrollBox>
            </Card>
          );
        })}
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-muted">
        <li className="inline-flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 28 12" className="h-3 w-7 shrink-0">
            <line x1={1} x2={27} y1={6} y2={6} className="stroke-muted" strokeWidth={1.5} strokeDasharray="4 3" />
          </svg>
          The chance given equals the share that won
        </li>
        <li className="inline-flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
            <circle cx={6} cy={6} r={5} className="fill-muted" />
          </svg>
          A band of chances, larger with more games
        </li>
        <li className="inline-flex items-center gap-2">
          <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 shrink-0">
            <circle cx={6} cy={6} r={4.5} className="fill-none stroke-muted" strokeWidth={1.5} strokeDasharray="2 2" />
          </svg>
          Fewer than {FAINT_BELOW} games: too few to read
        </li>
      </ul>
    </section>
  );
}
