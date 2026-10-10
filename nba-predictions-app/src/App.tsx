import GameList from './components/GameList';
import Layout from './components/Layout';
import LoadFailure from './components/LoadFailure';
import LoadingSpinner from './components/LoadingSpinner';
import StatusLine from './components/StatusLine';
import { upcomingCards } from './display/gameCard';
import { useBoard } from './hooks/useBoard';
import { useNow } from './hooks/useNow';

export default function App() {
  const { state, checkNow } = useBoard();
  const now = useNow();

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Upcoming Games & Predictions</h2>
        {state.status === 'ready' && <StatusLine board={state.board} fetchedAt={state.fetchedAt} now={now} />}
        <p className="text-gray-600">
          Each percentage is a team's chance of winning as the sportsbooks' prices imply it, with their margin taken out.
        </p>
      </div>

      {state.status === 'loading' && <LoadingSpinner />}
      {state.status === 'error' && <LoadFailure error={state.error} retrying={state.refreshing} onRetry={checkNow} />}
      {state.status === 'ready' && (
        <GameList cards={upcomingCards(state.board.games, now)} refreshing={state.refreshing} />
      )}
    </Layout>
  );
}
