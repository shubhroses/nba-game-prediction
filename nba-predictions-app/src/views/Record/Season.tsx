import { EmptyState, Notice } from '../../components/ui';
import type { Board } from '../../data/board';
import type { SeasonRecord } from '../../data/record';
import { fewPicks, fewPicksNote, noRecordYet } from '../../display/record';
import AgainstSportsbooks from './AgainstSportsbooks';
import Backtest from './Backtest';
import Calibration from './Calibration';
import DayByDay from './DayByDay';
import HowToRead from './HowToRead';
import Scorecards from './Scorecards';
import Upsets from './Upsets';

interface SeasonProps {
  record: SeasonRecord;
  board: Board;
  now: number;
  /** True while a newer record is being asked for. */
  refreshing: boolean;
}

/**
 * The record once the file is here. Before the first game there is nothing
 * of the season to show: the view says when the record starts, and under it
 * shows the backtest, which it never shows next to the record itself.
 */
export default function Season({ record, board, now, refreshing }: SeasonProps) {
  if (record.games === 0) {
    const { title, text } = noRecordYet(now);
    return (
      <div className="space-y-8 sm:space-y-10" aria-busy={refreshing}>
        <EmptyState title={title}>{text}</EmptyState>
        <Backtest />
      </div>
    );
  }

  const few = fewPicksNote(fewPicks(record));
  return (
    <div className="space-y-8 sm:space-y-10" aria-busy={refreshing}>
      {few && <Notice title="These numbers will swing">{few}</Notice>}
      <Scorecards record={record} />
      <AgainstSportsbooks record={record} />
      <Calibration record={record} />
      {/* On a wide screen the days and the upsets stand side by side, because a table of five columns reads best
          when it is not stretched. The last section then stands under the table, next to the rest of the upsets. */}
      <div className="grid grid-cols-1 gap-8 sm:gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-x-5">
        <div className="lg:col-start-1 lg:row-start-1">
          <DayByDay record={record} board={board} />
        </div>
        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Upsets record={record} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <HowToRead />
        </div>
      </div>
    </div>
  );
}
