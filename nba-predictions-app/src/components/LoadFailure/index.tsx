import type { LoadError } from '../../data/fetchBoard';

function explain(error: LoadError): string {
  switch (error.kind) {
    case 'network':
      return 'The odds could not be loaded because the server that holds them could not be reached.';
    case 'http':
      return `The odds could not be loaded: the server that holds them answered with HTTP ${error.status}.`;
    case 'shape':
      return 'The odds were loaded, but not in a form this page can read.';
  }
}

interface LoadFailureProps {
  error: LoadError;
  /** True while another attempt is under way. */
  retrying: boolean;
  onRetry: () => void;
}

export default function LoadFailure({ error, retrying, onRetry }: LoadFailureProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6" role="alert">
      <div className="flex items-center">
        <svg className="w-5 h-5 text-red-400 mr-2 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-red-700">{explain(error)}</p>
      </div>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="mt-4 px-4 py-2 bg-red-100 text-red-700 rounded-md hover:bg-red-200 transition-colors disabled:opacity-60"
      >
        {retrying ? 'Trying again...' : 'Try again'}
      </button>
    </div>
  );
}
