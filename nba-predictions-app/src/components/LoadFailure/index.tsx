import type { LoadError } from '../../data/published';
import { explainLoadError } from '../../display/loadError';
import { WarnIcon } from '../ui/icons';

interface LoadFailureProps {
  /** What could not be loaded, with its article and a capital: "The games", "The record". */
  what: string;
  error: LoadError;
  /** True while another attempt is under way. */
  retrying: boolean;
  onRetry: () => void;
}

export default function LoadFailure({ what, error, retrying, onRetry }: LoadFailureProps) {
  return (
    <div className="rounded-xl border border-loss/40 bg-loss-soft p-4 sm:p-5" role="alert">
      <div className="flex gap-3">
        <WarnIcon className="mt-0.5 text-loss" />
        <p className="text-ink">{explainLoadError(what, error)}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="mt-4 min-h-10 rounded-lg border border-loss/50 bg-surface px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:opacity-60 motion-safe:transition-colors"
      >
        {retrying ? 'Trying again…' : 'Try again'}
      </button>
    </div>
  );
}
