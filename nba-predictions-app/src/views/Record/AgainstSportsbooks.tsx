import { Card, Notice, SectionTitle, SourceName, VerdictMark } from '../../components/ui';
import type { SeasonRecord } from '../../data/record';
import { modelCards, type ModelCard } from '../../display/record';
import { brierView, differentPicks, type DifferentPickRow, type DifferentPicksView } from '../../display/recordAgainst';
import { reachOf, sharedBar, TRACK_LENGTH } from '../../display/recordTrack';
import { source as sourceOf } from '../../display/sources';
import IntervalTrack from './IntervalTrack';
import TeamCode from './TeamCode';

const SPORTSBOOKS = sourceOf('market');

/** How often each of the two was right in the games in which they picked different winners, as two parts of one bar. */
function RightBar({ picks, fill }: { picks: DifferentPicksView; fill: string }) {
  const bar = sharedBar(picks.modelRight, picks.marketRight);
  if (bar === null) return null;

  return (
    <svg
      role="img"
      aria-label={picks.barLabel}
      viewBox={`0 0 ${TRACK_LENGTH} 12`}
      preserveAspectRatio="none"
      className="block h-3 w-full overflow-hidden rounded-full"
    >
      <rect x={bar.left.x} width={bar.left.width} height={12} className={fill} />
      <rect x={bar.right.x} width={bar.right.width} height={12} className={SPORTSBOOKS.fill} />
    </svg>
  );
}

/** A team's code in a box of one width, so that what follows it lines up from row to row. */
function Pick({ team }: { team: string }) {
  return (
    <span className="inline-block w-[2.375rem]">
      <TeamCode team={team} />
    </span>
  );
}

/**
 * One game: its day and its score, and what each of the two picked. On a
 * wide screen that is one line, and anywhere else two, whatever the teams
 * are called: a row that broke by its own length would break the columns.
 */
function DifferentPick({ row }: { row: DifferentPickRow }) {
  return (
    <li className="py-2.5 text-sm xl:flex xl:items-center xl:justify-between xl:gap-4">
      <span className="flex items-baseline gap-3">
        <span className="w-[3.25rem] shrink-0 text-muted">{row.dayText}</span>
        <span className="font-medium text-ink">{row.final}</span>
      </span>
      {/* The two halves go under each other where one line cannot hold them, as with a larger font of the browser. */}
      <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-muted xl:mt-0">
        <span className="inline-flex items-center gap-1.5">
          Picked <Pick team={row.modelPick} />
          <VerdictMark verdict={row.modelRight ? 'favorite_won' : 'upset'} compact />
        </span>
        <span className="inline-flex items-center gap-1.5">
          Sportsbooks <Pick team={row.marketPick} />
          <VerdictMark verdict={row.modelRight ? 'upset' : 'favorite_won'} compact />
        </span>
      </span>
    </li>
  );
}

/** One model next to the sportsbooks' line: the difference between their Brier scores, and the games they picked differently. */
function Against({ model, reach }: { model: ModelCard; reach: number }) {
  const { source, card } = model;
  const brier = brierView(source, card.brier_against_market);
  const picks = differentPicks(source, card.picks_against_market);

  return (
    <Card as="article">
      <h4 className="text-base text-ink">
        <SourceName source={source.key} strong />
      </h4>

      <h5 className="mt-4 text-sm font-medium text-muted">Difference in Brier score</h5>
      <p className="mt-1 text-xl font-bold leading-snug text-ink">{brier.headline}</p>
      <p className="mt-1 text-sm text-muted">{brier.detail}</p>
      <IntervalTrack
        label={brier.trackLabel}
        from={-reach}
        to={reach}
        point={brier.point}
        interval={brier.span}
        ends={[`−${reach}`, '0', `+${reach}`]}
        fill={source.fill}
        className="mt-4"
      />
      {brier.difference && (
        <p className="mt-2 text-sm text-muted">
          Difference <span className="font-semibold text-ink">{brier.difference}</span>
          {brier.interval && (
            <>
              , 95% interval <span className="whitespace-nowrap font-semibold text-ink">{brier.interval}</span>
            </>
          )}
          , over {brier.games}.
        </p>
      )}
      <p className="mt-1.5 text-xs text-faint">{brier.axisNote}</p>

      <h5 className="mt-6 text-sm font-medium text-muted">Different picks</h5>
      <p className="mt-1 text-sm text-ink">{picks.summary}</p>
      {picks.differ > 0 && (
        <>
          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="inline-flex items-baseline gap-2">
              <SourceName source={source.key} className="text-muted" />
              <span className="font-semibold text-ink">{picks.modelRight}</span>
            </span>
            <span className="inline-flex items-baseline gap-2">
              <span className="font-semibold text-ink">{picks.marketRight}</span>
              <SourceName source="market" className="text-muted" />
            </span>
          </div>
          <div className="mt-1.5">
            <RightBar picks={picks} fill={source.fill} />
          </div>
        </>
      )}
      {picks.listTitle && (
        <>
          <h6 className="mt-5 text-sm font-medium text-muted">{picks.listTitle}</h6>
          <ul className="mt-1 divide-y divide-line border-t border-line">
            {picks.latest.map((row) => (
              <DifferentPick key={row.id} row={row} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/** Each model next to the sportsbooks' line, which is the yardstick for both. Nothing in a sport that is not forecast. */
export default function AgainstSportsbooks({ record }: { record: SeasonRecord }) {
  const models = modelCards(record);
  if (models.length === 0) return null;

  // One reach for both tracks, so that the two can be compared by eye.
  const reach = reachOf(
    models.flatMap(({ card }) => [card.brier_against_market.difference, ...(card.brier_against_market.interval ?? [])]),
  );

  return (
    <section>
      <SectionTitle
        note={
          <>
            The sportsbooks' line is the yardstick. Each model is held against it over the games that both had a chance for.
          </>
        }
      >
        Against the sportsbooks
      </SectionTitle>

      <Notice title="Not forecasts of the same moment" className="mb-4 lg:mb-5">
        A model's chance is from the morning of the game. The sportsbooks' line is from the last snapshot before the start,
        hours later, and it knows what the day has brought.
      </Notice>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {models.map((model) => (
          <Against key={model.source.key} model={model} reach={reach} />
        ))}
      </div>
    </section>
  );
}
