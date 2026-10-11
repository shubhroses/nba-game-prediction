import { BACKTEST, backtestCount, type BacktestRow } from '../../display/backtest';
import { Chip, SourceName } from '../ui';

// A line under a figure. On a phone it has the whole width of the row, under the name and the figure.
const DETAIL = 'w-full text-right text-xs text-faint sm:text-left';

interface FigureProps {
  label: string;
  figure: string;
  /** The games that a share is of. */
  games?: string;
  /** The two ends of the 95% interval. Null where the document gives the figure alone. */
  interval: string | null;
}

/**
 * One figure of the backtest: what it is, the figure, and under it the games
 * it is of and its interval. On a phone the name and the figure share a
 * line, the name at its left end and the figure at its right. What is under
 * them is as wide as the row and not as the figure alone, so that an
 * interval has a line to itself at 320px.
 *
 * The name of an interval and its two ends are a box each. In a column that
 * is narrower than the two, the line breaks between them, and the ends are
 * parted only where a column is narrower than they are.
 */
function Figure({ label, figure, games, interval }: FigureProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 py-2 sm:block sm:py-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="ml-auto text-right text-lg font-semibold leading-tight text-ink sm:mt-1 sm:text-left">{figure}</dd>
      {games && <dd className={DETAIL}>{games}</dd>}
      {interval && (
        <dd className={DETAIL}>
          <span className="inline-block">95% interval</span> <span className="inline-block">{interval}</span>
        </dd>
      )}
    </div>
  );
}

/**
 * A model, or what the two are held against, with its three figures. From
 * 640px on the figures stand side by side. The name stands above them until
 * 1024px, because next to it a column would be narrower than an interval.
 * The name of a model may take two lines, which it does on a phone whose
 * text is set to twice its size: on one line it would reach out of the box.
 */
function Row({ row }: { row: BacktestRow }) {
  return (
    <div className="px-4 py-4 sm:px-5 lg:grid lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-x-6">
      <h4 className="text-base font-semibold text-ink">
        {row.source ? <SourceName source={row.source} strong wrap /> : row.name}
        {row.note && <span className="block text-xs font-normal text-faint">{row.note}</span>}
      </h4>
      <dl className="mt-2 divide-y divide-line sm:mt-3 sm:grid sm:grid-cols-3 sm:gap-x-6 sm:divide-y-0 lg:mt-0">
        <Figure label="Winners picked" figure={row.winners.figure} games={backtestCount(row.winners)} interval={row.winners.interval} />
        <Figure label="Log loss" figure={row.logLoss.figure} interval={row.logLoss.interval} />
        <Figure label="Brier score" figure={row.brier.figure} interval={row.brier.interval} />
      </dl>
    </div>
  );
}

/**
 * The figures of the backtest that the two models were chosen in, under the
 * label that every one of them is shown with: a row for each model and one
 * for what the two are held against. The label is the first line of the
 * same box, so that the two cannot be taken apart. Whoever shows the box
 * gives it its frame.
 */
export default function BacktestTable() {
  return (
    <>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-sunken px-4 py-3 text-sm sm:px-5">
        <Chip tone="outline">Backtest</Chip>
        <span className="min-w-0 font-medium text-ink">{BACKTEST.label}</span>
      </p>
      <div className="divide-y divide-line">
        {BACKTEST.rows.map((row) => (
          <Row key={row.source ?? row.name} row={row} />
        ))}
      </div>
      <div className="space-y-1.5 border-t border-line bg-sunken px-4 py-3 text-xs text-muted sm:px-5">
        <p>{BACKTEST.pickNote}</p>
        <p>{BACKTEST.scoresNote}</p>
      </div>
    </>
  );
}
