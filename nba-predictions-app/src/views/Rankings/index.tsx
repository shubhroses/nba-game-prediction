import { EmptyState, FileStatus, ViewHeader } from '../../components/ui';
import { useModel } from '../../hooks/useModel';
import { useMyTeams } from '../../hooks/useMyTeams';
import type { ViewProps } from '../types';
import Ratings from './Ratings';

/** What stands where the table would be while the job has published no ratings. */
function NoRatings() {
  return (
    <EmptyState title="No ratings are published yet">
      The job writes them in its daily run, once it has built the two models. Until then there is nothing to rank.
    </EmptyState>
  );
}

/** Where each of the two models has every team, and Elo's chance for any two of them. */
export default function Rankings({ board, now, param }: ViewProps) {
  const model = useModel(board);
  const { teams } = useMyTeams();

  return (
    <>
      <ViewHeader title="Rankings">
        Where each of the two models has every team. A rating comes from final scores and the schedule alone, and the ratings of its
        two teams are what a forecast of a game starts from.
      </ViewHeader>
      {/* A board without the models has no model file to go with it, and none is asked for. */}
      {board.models === null && <NoRatings />}
      <FileStatus state={model} what="The ratings" missing={<NoRatings />} />
      {model.status === 'ready' && (
        <Ratings model={model.data} board={board} now={now} param={param} refreshing={model.refreshing} myTeams={teams} />
      )}
    </>
  );
}
