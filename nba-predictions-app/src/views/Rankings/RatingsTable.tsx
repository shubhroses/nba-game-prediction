import { Card, MoveIcon, ScrollBox, SectionTitle, Segmented, SourceName, StarMark, TeamLogo } from '../../components/ui';
import { barAxis, type EloMove, type RankBy, type RankingRow, type Rankings } from '../../display/rankings';
import { source } from '../../display/sources';
import { classes } from '../../utils/classes';
import RatingBar from './RatingBar';

interface RatingsTableProps {
  table: Rankings;
  /** The orders a visitor can choose from. With one of them there is nothing to choose. */
  choices: readonly RankBy[];
  onRankBy: (by: RankBy) => void;
  /** True before the first result of the season, when no team has a win, a loss or a rating that has moved. */
  opening: boolean;
  /** What the ratings rest on, for under the title. */
  note?: string;
  /** The league's average in Elo, from the file. */
  eloMean: number;
  /** The codes of the teams the visitor follows. Their rows are marked with a star. */
  myTeams: ReadonlySet<string>;
  className?: string;
}

const HEAD = 'py-2 text-xs font-semibold text-muted';
const CELL = 'py-1.5 sm:py-2';
// A phone has four columns and little room between them. From 640px on there are six.
const FIRST = 'pl-3 pr-1 sm:pl-5 sm:pr-2';
const INNER = 'px-1.5 sm:px-2';
const LAST = 'pl-1.5 pr-3 sm:pl-2 sm:pr-5';
// A phone shows the code of a team and a wider screen its name. Next to the calculator the table has less room again.
const TEAM_WIDTH = 'w-[5.5rem] sm:w-40 md:w-60 lg:w-48 xl:w-60';

/** How far a rating went in a week: an arrow and the points, or a dash when it did not move. */
function Move({ move, className }: { move: EloMove; className?: string }) {
  return (
    <span className={classes('inline-flex items-center justify-end gap-1 text-muted', className)}>
      {move.direction === 'none' ? (
        <span aria-hidden="true" className="text-faint">
          –
        </span>
      ) : (
        <>
          <MoveIcon up={move.direction === 'up'} className="text-ink" />
          <span aria-hidden="true">{move.points}</span>
        </>
      )}
      <span className="sr-only">{move.words}</span>
    </span>
  );
}

/** One team. `mine` marks a team the visitor follows. */
function Row({ row, opening, mine }: { row: RankingRow; opening: boolean; mine: boolean }) {
  return (
    <tr className="border-t border-line">
      <td className={classes(CELL, 'text-right text-muted', FIRST)}>{row.rank}</td>
      <th scope="row" className={classes(CELL, 'text-left font-normal', INNER)}>
        <span className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="relative flex shrink-0">
            <TeamLogo team={row.code} size="sm" />
            {mine && <StarMark className="absolute -right-1.5 -top-1.5" />}
          </span>
          <span className="min-w-0">
            {/* A phone shows the code and, under it, the wins and losses, which have a column of their own from 640px on. */}
            <span aria-hidden="true" className="block font-semibold text-ink sm:hidden">
              {row.code}
            </span>
            <span className="sr-only font-semibold text-ink sm:not-sr-only">{row.name}</span>
            {mine && <span className="sr-only">, a team you follow</span>}
            {!opening && (
              <span className="block text-xs text-muted sm:hidden">
                <span aria-hidden="true">{row.record}</span>
                <span className="sr-only">, {row.recordWords}</span>
              </span>
            )}
          </span>
        </span>
      </th>
      {!opening && (
        <td className={classes(CELL, 'hidden whitespace-nowrap text-center text-muted sm:table-cell', INNER)}>
          <span aria-hidden="true">{row.record}</span>
          <span className="sr-only">{row.recordWords}</span>
        </td>
      )}
      {row.pointsRest && (
        <td className={classes(CELL, INNER)}>
          {/* On a phone the bar lies under the two numbers. From 640px on it stands next to them, under the scale in the head. */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:flex-nowrap sm:gap-x-2">
            <span className="whitespace-nowrap font-semibold text-ink sm:w-12 sm:shrink-0 sm:text-right">{row.pointsRest.rating}</span>
            <span className="whitespace-nowrap text-xs text-muted sm:w-9 sm:shrink-0">{row.pointsRest.uncertainty}</span>
            <RatingBar bar={row.pointsRest.bar} className="w-full sm:w-auto sm:min-w-0 sm:flex-1" />
          </div>
        </td>
      )}
      <td className={classes(CELL, 'text-right', opening ? LAST : classes(INNER, 'pr-3'))}>
        <span className="block font-semibold text-ink">{row.elo.rating}</span>
        {!opening && <Move move={row.elo.move} className="text-xs sm:hidden" />}
      </td>
      {!opening && (
        <td className={classes(CELL, 'hidden text-right sm:table-cell', LAST)}>
          <Move move={row.elo.move} />
        </td>
      )}
    </tr>
  );
}

/**
 * Every team with its rating in both models, in the order of one of them. A
 * phone has four columns: the place, the team with its wins and losses, and
 * the two ratings. A wider screen has the wins and losses and the week's
 * change of Elo in columns of their own.
 */
export default function RatingsTable({ table, choices, onRankBy, opening, note, eloMean, myTeams, className }: RatingsTableProps) {
  const { by, rows, extent } = table;
  const ranked = source(by).name;
  const sortOf = (column: RankBy) => (column === by ? 'descending' : undefined);

  return (
    <Card as="section" padded={false} className={classes('overflow-hidden', className)}>
      <div className="flex flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-start md:justify-between md:gap-6">
        <SectionTitle note={note} flush>
          Team ratings
        </SectionTitle>
        {choices.length > 1 ? (
          <div className="flex shrink-0 items-center gap-2">
            <span aria-hidden="true" className="text-sm text-muted">
              Rank by
            </span>
            <Segmented label="Rank by" options={choices.map((key) => ({ key, label: source(key).name }))} value={by} onChange={onRankBy} />
          </div>
        ) : (
          <p className="shrink-0 text-sm text-muted">Ranked by {ranked}</p>
        )}
      </div>

      {/* Should the table ever be wider than a narrow screen, it scrolls inside this box and the page does not. */}
      <ScrollBox label="The ratings of every team">
        {/* The columns have the widths that the head gives them, and the one of Points & Rest, with its bar, takes what is left. */}
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">
            The {rows.length} teams with their rating in {extent === null ? 'Elo' : 'both models'}, ranked by {ranked}
          </caption>
          <thead>
            <tr className="border-t border-line bg-sunken">
              <th scope="col" className={classes(HEAD, FIRST, 'w-9 text-right sm:w-12')}>
                <span aria-hidden="true">#</span>
                <span className="sr-only">Place</span>
              </th>
              <th scope="col" className={classes(HEAD, INNER, 'text-left', extent !== null && TEAM_WIDTH)}>
                Team
              </th>
              {!opening && (
                <th scope="col" className={classes(HEAD, INNER, 'hidden whitespace-nowrap text-center sm:table-cell sm:w-14')}>
                  <span aria-hidden="true">W–L</span>
                  <span className="sr-only">Wins and losses</span>
                </th>
              )}
              {extent !== null && (
                <th scope="col" aria-sort={sortOf('points_rest')} className={classes(HEAD, INNER, 'text-left')}>
                  <span className="flex items-center gap-2">
                    {/* On a phone the name may take two lines, so that the column is no wider than its numbers need. */}
                    <SourceName source="points_rest" strong wrap className="sm:w-[5.75rem] sm:shrink-0 sm:whitespace-nowrap" />
                    <span aria-hidden="true" className="hidden min-w-0 flex-1 justify-between font-normal sm:flex">
                      {barAxis(extent).map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </span>
                  </span>
                </th>
              )}
              <th scope="col" aria-sort={sortOf('elo')} className={classes(HEAD, 'text-right', opening ? classes(LAST, 'w-16 sm:w-24') : classes(INNER, 'w-16 pr-3'))}>
                <SourceName source="elo" strong />
              </th>
              {!opening && (
                <th scope="col" className={classes(HEAD, LAST, 'hidden text-right sm:table-cell sm:w-[4.5rem]')}>
                  Week
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row key={row.code} row={row} opening={opening} mine={myTeams.has(row.code)} />
            ))}
          </tbody>
        </table>
      </ScrollBox>

      <ul className="space-y-1.5 border-t border-line bg-sunken px-4 py-3 text-xs text-muted sm:px-5">
        {extent !== null && (
          <li>
            <strong className="font-semibold text-ink">Points &amp; Rest</strong> is in points against an average team. The ± is how well the model
            knows the rating, as one standard deviation, and the line across the end of a bar reaches that far to either side. A bar runs
            from {barAxis(extent)[0]} to {barAxis(extent)[2]}.
          </li>
        )}
        <li>
          <strong className="font-semibold text-ink">Elo</strong> has the league&apos;s average at {eloMean}.
          {!opening &&
            ' The arrow is how far a rating has moved since a week before the last result, or since the opening rating while the season is younger than that. A dash is a rating that has not moved.'}
        </li>
        {!opening && (
          <li>
            <strong className="font-semibold text-ink">W–L</strong> counts the results of the season that are on record.
          </li>
        )}
        {rows.some((row) => myTeams.has(row.code)) && (
          <li className="flex items-center gap-1.5">
            <StarMark on="sunken" />
            <span>A star marks a team you follow.</span>
          </li>
        )}
      </ul>
    </Card>
  );
}
