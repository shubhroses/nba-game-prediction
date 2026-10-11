import { useState } from 'react';
import { EmptyState, Notice } from '../../components/ui';
import type { Board } from '../../data/board';
import type { ModelRatings } from '../../data/model';
import { rankChoices, rankings, ratingsBasis, ratingsNotice, type RankBy } from '../../display/rankings';
import MatchupCalculator from './MatchupCalculator';
import RatingsTable from './RatingsTable';

interface RatingsProps {
  /** The model file, once it is here. */
  model: ModelRatings;
  board: Board;
  now: number;
  /** What follows the view in the address, which can name a matchup. */
  param: string | null;
  /** True while a newer model file is being asked for. */
  refreshing: boolean;
  /** The codes of the teams the visitor follows. */
  myTeams: ReadonlySet<string>;
}

/**
 * The view once the model file is here: what the ratings rest on, what the
 * job found when it left a model out, the table and the calculator.
 */
export default function Ratings({ model, board, now, param, refreshing, myTeams }: RatingsProps) {
  const [wanted, setWanted] = useState<RankBy>('points_rest');
  const basis = ratingsBasis(model);
  const notice = ratingsNotice(model);
  const table = rankings(model, wanted);

  if (table.rows.length === 0) {
    return <EmptyState title="The file rates no team">The ratings appear here once the job has built the two models.</EmptyState>;
  }

  return (
    <div className="space-y-4 lg:space-y-5" aria-busy={refreshing}>
      {basis.opening && <Notice title="These are the opening ratings">{basis.text}</Notice>}
      {notice && (
        <Notice tone="warn" title={notice.title}>
          <p>{notice.text}</p>
          {notice.reasons.length > 0 && (
            <>
              <p className="mt-2">What the checks found:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {notice.reasons.map((reason, index) => (
                  // A reason names a game by an id of 32 letters, which has to be let break on a narrow screen.
                  <li key={`${index} ${reason}`} className="[overflow-wrap:anywhere]">
                    {reason}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Notice>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-12 lg:gap-5">
        <RatingsTable
          table={table}
          choices={rankChoices(model)}
          onRankBy={setWanted}
          opening={basis.opening}
          note={basis.opening ? undefined : basis.text}
          eloMean={model.elo.constants.mean}
          myTeams={myTeams}
          className="min-w-0 lg:col-span-8"
        />
        {/* Next to the table on a wide screen, and under it on a narrower one. */}
        <MatchupCalculator model={model} board={board} now={now} param={param} className="min-w-0 lg:col-span-4" />
      </div>
    </div>
  );
}
