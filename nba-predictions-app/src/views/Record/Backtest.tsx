import BacktestTable from '../../components/BacktestTable';
import { Card, Notice, SectionTitle } from '../../components/ui';
import { BACKTEST } from '../../display/backtest';
import MethodLink from './MethodLink';

const { winners, sportsbooks } = BACKTEST.cautions;

/**
 * The backtest that the two models were chosen in, for the time before the
 * season has a game. It is set apart and labeled, because none of its
 * figures is a result of this season, and it is never shown next to the
 * record.
 */
export default function Backtest() {
  return (
    <section>
      <SectionTitle
        note={
          <>
            Until the season has results, this is what there is to go by: how the two models did on the games of the last two
            seasons, each game forecast from the results before it.
          </>
        }
      >
        Before the first game: the backtest
      </SectionTitle>

      <Card padded={false} className="overflow-hidden">
        <BacktestTable />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:mt-5 lg:gap-5">
        <Notice title={winners.lead}>{winners.text}</Notice>
        <Notice title={sportsbooks.lead}>
          {sportsbooks.text} How the two do next to the sportsbooks' line is what this record is for, from opening night on.
        </Notice>
      </div>

      <p className="mt-2">
        <MethodLink />
      </p>
    </section>
  );
}
