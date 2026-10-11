import { Card, SectionTitle, SourceName } from '../../components/ui';
import type { SeasonRecord } from '../../data/record';
import { baseline, scorecards, type DetailRow, type ScorecardView } from '../../display/recordScorecard';
import { classes } from '../../utils/classes';
import IntervalTrack from './IntervalTrack';

const SHARE_ENDS = ['0%', '50%', '100%'] as const;

function Detail({ row }: { row: DetailRow }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="min-w-0 text-ink">
        {row.label}
        {row.hint && <span className="block text-xs text-faint">{row.hint}</span>}
      </dt>
      <dd className="shrink-0 font-semibold text-ink">{row.value}</dd>
    </div>
  );
}

/** One source: its picks won and lost, the share of them with its interval, and what it had no pick for. */
function Scorecard({ view }: { view: ScorecardView }) {
  const { source } = view;
  return (
    <Card as="article" padded={false} className="flex flex-col overflow-hidden">
      {/* A band in the color of the source: the one accent of the card. */}
      <div aria-hidden="true" className={classes('h-1', source.bg)} />
      {/* Between a phone and a desktop the card lies down: the tally on the left, the small print on the right. */}
      <div className="flex-1 p-4 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:p-5 lg:block">
        <div>
          <h4 className="text-base text-ink">
            <SourceName source={source.key} strong />
          </h4>

          <div className="mt-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div>
              <div className="text-3xl font-bold leading-none text-ink">{view.tally}</div>
              <div className="mt-1.5 text-sm text-muted">picks won and lost</div>
            </div>
            {view.won && (
              <div className="text-right">
                <div className="text-xl font-semibold leading-none text-ink">{view.won.text}</div>
                <div className="mt-1.5 text-sm text-muted">{view.picksText}</div>
              </div>
            )}
          </div>

          <IntervalTrack
            label={view.trackLabel}
            from={0}
            to={1}
            point={view.won?.share ?? null}
            interval={view.won?.interval ?? null}
            ends={SHARE_ENDS}
            fill={source.fill}
            className="mt-4"
          />
          {view.won === null && (
            <p className="mt-1.5 text-sm text-muted">No pick has been graded yet, so there is no share of wins to show.</p>
          )}
          {view.won?.intervalText && (
            <p className="mt-1.5 text-sm text-muted">
              95% interval <span className="font-medium text-ink">{view.won.intervalText}</span>
            </p>
          )}
        </div>

        <div className="mt-4 sm:mt-0 lg:mt-4">
          <dl className="divide-y divide-line border-y border-line text-sm">
            {view.rows.map((row) => (
              <Detail key={row.label} row={row} />
            ))}
          </dl>
          <p className="mt-2.5 text-xs text-faint">{view.scoresNote}</p>
        </div>
      </div>
    </Card>
  );
}

/** The scorecards of the sources, and under them what picking the home team every time would have won. */
export default function Scorecards({ record }: { record: SeasonRecord }) {
  const cards = scorecards(record);
  const home = baseline(record);

  return (
    <section>
      <SectionTitle
        note={
          <>
            A pick is the side that a source puts at 52% or more.
            {cards.length > 1 && ' Each source is graded on its own picks, so the tallies are not of the same games.'}
          </>
        }
      >
        Picks won and lost
      </SectionTitle>

      <div className={classes('grid grid-cols-1 gap-4 lg:gap-5', cards.length > 1 && 'lg:grid-cols-3')}>
        {cards.map((view) => (
          <Scorecard key={view.source.key} view={view} />
        ))}
      </div>

      {home && (
        <div
          className={classes(
            'mt-4 flex flex-col gap-x-8 gap-y-2 rounded-xl border border-line bg-sunken px-4 py-3',
            'sm:flex-row sm:items-center sm:justify-between sm:px-5 lg:mt-5',
          )}
        >
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-ink">The home team every time</h4>
            <p className="mt-0.5 text-sm text-muted">
              What picking the home team in every recorded game would have won. It counts every game, graded or not, so it is
              not of the same games as the picks of a source.
            </p>
          </div>
          <p className="shrink-0 text-sm text-muted sm:text-right">
            <span className="block text-xl font-semibold leading-tight text-ink">{home.share}</span>
            {home.count}
          </p>
        </div>
      )}
    </section>
  );
}
