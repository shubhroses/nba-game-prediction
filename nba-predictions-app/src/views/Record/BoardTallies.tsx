import { Card, SectionTitle, SourceName, Stat } from '../../components/ui';
import type { Board } from '../../data/board';
import { boardTallies } from '../../display/record';

/**
 * What the page still knows of the record while the record itself is not on
 * it: the picks that each source won and lost, which the board carries.
 * Nothing when the board has no graded pick either.
 */
export default function BoardTallies({ board }: { board: Board }) {
  const tallies = boardTallies(board);
  if (tallies.length === 0) return null;

  return (
    <section className="mt-8 sm:mt-10">
      <SectionTitle note="The file of the games carries these two numbers for each source, and nothing else of the record.">
        Picks won and lost
      </SectionTitle>
      <Card>
        {/* Under each other on a phone: three of these side by side do not fit under 400px. */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {tallies.map(({ source, tally }) => (
            <Stat key={source.key} label={<SourceName source={source.key} />} value={tally} note="picks won and lost" />
          ))}
        </div>
      </Card>
    </section>
  );
}
