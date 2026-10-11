import { Card, ScrollBox, SectionTitle, SourceName } from '../../components/ui';
import type { Board } from '../../data/board';
import type { SeasonRecord } from '../../data/record';
import { countOf } from '../../display/numbers';
import { dayRows, daysShown, type DayCell, type DayRow } from '../../display/recordDays';
import { classes } from '../../utils/classes';

/** The day, and on a phone its games under it, where there is no room for a column of them. */
function Day({ row }: { row: DayRow }) {
  const games = <span className="block text-xs font-normal text-faint sm:hidden">{countOf(row.games, 'game')}</span>;
  return (
    <th scope="row" className="whitespace-nowrap py-0 pl-4 pr-2 text-left font-medium text-ink sm:pl-5 sm:pr-3">
      {row.href ? (
        <a href={row.href} className="group flex min-h-11 flex-col justify-center sm:min-h-10">
          <span className="underline underline-offset-4 group-hover:text-muted">{row.label}</span>
          {games}
        </a>
      ) : (
        <span className="flex min-h-11 flex-col justify-center sm:min-h-10">
          {row.label}
          {games}
        </span>
      )}
    </th>
  );
}

function Tally({ cell }: { cell: DayCell }) {
  return (
    <td className="py-2 pl-2 text-right last:pr-4 sm:px-3 sm:last:pr-5">
      {/* A screen reader gets the day in full, where the page shows the two numbers. */}
      <span aria-hidden="true" className={classes(cell.tallied ? 'font-semibold text-ink' : 'text-xs text-faint')}>
        {cell.text}
      </span>
      <span className="sr-only">{cell.words}</span>
    </td>
  );
}

/** The latest days of the record as a table: the day, its games, and the picks that each source won and lost. */
export default function DayByDay({ record, board }: { record: SeasonRecord; board: Board }) {
  const rows = dayRows(record, board);
  if (rows.length === 0) return null;

  return (
    <section>
      <SectionTitle
        aside={daysShown(record)}
        note="Picks won and lost on the games of each day. A toss-up and a game that was not graded are in neither number."
      >
        Day by day
      </SectionTitle>

      <Card padded={false} className="overflow-hidden">
        {/* On the narrowest screens the table scrolls sideways inside its card. */}
        <ScrollBox label="The record day by day">
          <table className="w-full text-sm">
            <caption className="sr-only">Picks won and lost by each source on the latest days</caption>
            <thead>
              <tr className="border-b border-line bg-sunken text-xs text-muted">
                <th scope="col" className="py-2.5 pl-4 pr-2 text-left align-bottom font-semibold sm:pl-5 sm:pr-3">
                  Day
                </th>
                <th scope="col" className="hidden px-3 py-2.5 text-right align-bottom font-semibold sm:table-cell">
                  Games
                </th>
                {rows[0].cells.map((cell) => (
                  // Unlike in a line of text, the name of a source may run on to a second line over its column.
                  <th key={cell.source.key} scope="col" className="py-2.5 pl-2 text-right align-bottom last:pr-4 sm:px-3 sm:last:pr-5">
                    <SourceName source={cell.source.key} strong wrap />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.day}>
                  <Day row={row} />
                  <td className="hidden px-3 py-2 text-right text-muted sm:table-cell">{row.games}</td>
                  {row.cells.map((cell) => (
                    <Tally key={cell.source.key} cell={cell} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollBox>
      </Card>
      {rows.some((row) => row.href !== null) && (
        <p className="mt-2 text-xs text-faint">An underlined day leads to its results, which the page keeps for eight days.</p>
      )}
    </section>
  );
}
