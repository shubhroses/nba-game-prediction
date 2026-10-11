import { SourceName } from '../../components/ui';
import type { GameRow } from '../../display/resultsGame';
import { SOURCES } from '../../display/sources';
import { classes } from '../../utils/classes';
import { COLUMNS } from './columns';
import Game from './Game';

interface GameListProps {
  /** The games of one day, by start. */
  games: GameRow[];
  /** True while a newer board is being checked for. */
  refreshing: boolean;
}

/**
 * The games of one day. On a phone each is a card, on a tablet the cards
 * stand two abreast, and on a wide screen the day is one card with a row for
 * each game under a row of column heads.
 */
export default function GameList({ games, refreshing }: GameListProps) {
  return (
    <div aria-busy={refreshing} className="lg:rounded-xl lg:border lg:border-line lg:bg-surface lg:shadow-card">
      {/* Every game names its sources itself for a screen reader, so the heads are for the eye only. They stay
          under the title of the day while its games pass: under the tabs and the bar of the title, which is 2.75rem
          high. A card that cut off what is in it would keep them from staying, so the heads and the last row are
          given the corners of the card, less its border, themselves. */}
      <div
        aria-hidden="true"
        className={classes(
          'hidden rounded-t-[0.6875rem] border-b border-line bg-sunken py-2 text-xs font-semibold text-muted',
          'lg:sticky lg:top-[calc(theme(spacing.tabs)+2.75rem)] lg:z-[1] lg:items-center',
          COLUMNS,
        )}
      >
        <div className="flex justify-between">
          <span>Game</span>
          <span>Final</span>
        </div>
        {SOURCES.map(({ key }) => (
          <SourceName key={key} source={key} strong />
        ))}
      </div>

      {/* Two abreast, each card keeps its own height, so that opening the details of one does not stretch its neighbor. */}
      <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:gap-0">
        {games.map((game) => (
          <li
            key={game.id}
            className="overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:rounded-none lg:border-x-0 lg:border-b-0 lg:shadow-none lg:first:border-t-0 lg:last:rounded-b-[0.6875rem]"
          >
            <Game game={game} />
          </li>
        ))}
      </ul>
    </div>
  );
}
