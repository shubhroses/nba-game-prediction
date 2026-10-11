import { EmptyState, FileStatus, ViewHeader } from '../../components/ui';
import { seasonLine } from '../../display/record';
import { useRecord } from '../../hooks/useRecord';
import type { ViewProps } from '../types';
import BoardTallies from './BoardTallies';
import Season from './Season';

/** The scoreboard of the season: how the picks of each model and of the sportsbooks have done, with the uncertainty shown. */
export default function RecordView({ board, now }: ViewProps) {
  const record = useRecord(board);
  const since = record.status === 'ready' ? seasonLine(record.data) : null;

  return (
    <>
      <ViewHeader title="Record" note={since}>
        How the picks of the two models and of the sportsbooks have done this season, with the uncertainty that the number of
        games leaves.
      </ViewHeader>

      <FileStatus
        state={record}
        what="The record"
        missing={
          <EmptyState title="No record is published yet">
            It is written once a day, on the morning after the games.
          </EmptyState>
        }
      />
      {record.status === 'ready' && <Season record={record.data} board={board} now={now} refreshing={record.refreshing} />}
      {/* Without the record the page still has the tallies that the board carries. */}
      {(record.status === 'error' || record.status === 'missing') && <BoardTallies board={board} />}
    </>
  );
}
