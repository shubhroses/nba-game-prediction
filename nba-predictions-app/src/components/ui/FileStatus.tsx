import type { ReactNode } from 'react';
import type { Published } from '../../hooks/usePublished';
import LoadFailure from '../LoadFailure';
import LoadingSpinner from '../LoadingSpinner';

interface FileStatusProps {
  /** The state of a published file, from useRecord, useModel, usePredictions or usePublished. */
  state: Published<unknown>;
  /** The file as a visitor would name it, with its article and a capital: "The record". */
  what: string;
  /** What to show when the server has no such file, which each file means in its own way. */
  missing: ReactNode;
}

/**
 * Stands in for a published file that is not on the page: a spinner while it
 * loads, `missing` when there is none, and the reason with a button to try
 * again when it could not be loaded. Shows nothing once the file is ready.
 */
export default function FileStatus({ state, what, missing }: FileStatusProps) {
  switch (state.status) {
    case 'idle':
    case 'ready':
      return null;
    case 'loading':
      return <LoadingSpinner label={`Loading ${what.charAt(0).toLowerCase()}${what.slice(1)}`} />;
    case 'missing':
      return <>{missing}</>;
    case 'error':
      return <LoadFailure what={what} error={state.error} retrying={state.refreshing} onRetry={state.retry} />;
  }
}
