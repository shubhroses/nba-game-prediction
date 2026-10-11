import type { GameCardView } from '../../display/gameCard';
import GameCard from '../GameCard';
import StartedCard from '../GameCard/StartedCard';

interface GameListProps {
  cards: readonly GameCardView[];
  /**
   * `upcoming` for games that are still to start, `started` for the small
   * cards of games that are under way, and `unlisted` for the small cards of
   * games that the latest snapshot no longer lists.
   */
  kind: 'upcoming' | 'started' | 'unlisted';
  /** The codes of the teams the visitor follows. */
  myTeams: ReadonlySet<string>;
  /** Follows a team, or stops following it. */
  onToggleTeam: (code: string) => void;
  /** True while a newer board is being checked for. */
  refreshing: boolean;
}

/** The cards of a list of games: one column on a phone, two on a tablet, three on a wide screen. */
export default function GameList({ cards, kind, myTeams, onToggleTeam, refreshing }: GameListProps) {
  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-3" aria-busy={refreshing}>
      {cards.map((card) => (
        // The cards of a row are as tall as the tallest of them.
        <li key={card.id} className="flex min-w-0">
          {kind === 'upcoming' ? (
            <GameCard card={card} myTeams={myTeams} onToggleTeam={onToggleTeam} />
          ) : (
            <StartedCard card={card} unlisted={kind === 'unlisted'} />
          )}
        </li>
      ))}
    </ul>
  );
}
