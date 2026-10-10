import type { GameCardView } from '../../display/gameCard';
import GameCard from '../GameCard';

interface GameListProps {
  cards: GameCardView[];
  /** True while a newer board is being checked for. */
  refreshing: boolean;
}

export default function GameList({ cards, refreshing }: GameListProps) {
  if (cards.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <p className="text-lg font-medium">No games have odds posted right now</p>
        <p className="mt-2">Check back after the next update.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy={refreshing}>
      {cards.map((card) => (
        <GameCard key={card.id} card={card} />
      ))}
    </div>
  );
}
