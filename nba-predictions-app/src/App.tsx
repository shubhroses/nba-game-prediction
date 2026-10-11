import { useCallback, useEffect, useRef, type ComponentType } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import Layout from './components/Layout';
import LoadFailure from './components/LoadFailure';
import LoadingSpinner from './components/LoadingSpinner';
import StatusLine from './components/StatusLine';
import type { View } from './display/route';
import { useBoard } from './hooks/useBoard';
import { useHashRoute, useViewScroll } from './hooks/useHashRoute';
import { useNow } from './hooks/useNow';
import Games from './views/Games';
import Method from './views/Method';
import Rankings from './views/Rankings';
import RecordView from './views/Record';
import Results from './views/Results';
import type { ViewProps } from './views/types';

/** The views that show the board. How it works reads no file, and is shown without one. */
const BOARD_VIEWS: Record<Exclude<View, 'method'>, ComponentType<ViewProps>> = {
  games: Games,
  results: Results,
  record: RecordView,
  rankings: Rankings,
};

export default function App() {
  const { state, checkNow } = useBoard();
  const now = useNow();
  const { view, param } = useHashRoute();
  const main = useRef<HTMLElement>(null);

  // A view starts at its top, and a view that the visitor comes back to is put where they left it.
  useViewScroll(view);

  // "Try again" is gone once the board is here, and the focus would be left on nothing. It goes on to the content.
  const retried = useRef(false);
  const retry = useCallback(() => {
    retried.current = true;
    checkNow();
  }, [checkNow]);
  useEffect(() => {
    if (state.status === 'ready' && retried.current) main.current?.focus({ preventScroll: true });
    if (state.status !== 'error') retried.current = false;
  }, [state.status]);

  const failure = state.status === 'error' && (
    <LoadFailure what="The games" error={state.error} retrying={state.refreshing} onRetry={retry} />
  );

  return (
    <Layout
      view={view}
      main={main}
      status={state.status === 'ready' && <StatusLine board={state.board} fetchedAt={state.fetchedAt} now={now} />}
    >
      {view === 'method' ? (
        <>
          {/* The view says how the models work and reads no file, so it is shown whatever became of the board. */}
          {failure && <div className="mb-5 sm:mb-6">{failure}</div>}
          <ErrorBoundary key={view} what="This view" heading="h2">
            <Method />
          </ErrorBoundary>
        </>
      ) : (
        <>
          {state.status === 'loading' && <LoadingSpinner label="Loading the games" />}
          {failure}
          {state.status === 'ready' && (
            // A view that fails leaves the tabs standing, and the next view starts afresh.
            <ErrorBoundary key={view} what="This view" heading="h2">
              <BoardView view={view} board={state.board} now={now} refreshing={state.refreshing} param={param} />
            </ErrorBoundary>
          )}
        </>
      )}
    </Layout>
  );
}

function BoardView({ view, ...props }: ViewProps & { view: keyof typeof BOARD_VIEWS }) {
  const Shown = BOARD_VIEWS[view];
  return <Shown {...props} />;
}
