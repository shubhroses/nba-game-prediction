import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** What cannot be shown, as in "This page" or "This view". */
  what: string;
  /** The heading of the message: an h1 when the whole page is gone, an h2 inside the page. */
  heading: 'h1' | 'h2';
  children: ReactNode;
}

/** Catches an error thrown while its content renders and tells the visitor no more than they can act on. */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const { what, heading: Heading } = this.props;
    return (
      <div className="mx-auto max-w-xl p-8 text-center">
        <Heading className="text-xl font-semibold text-ink">Something went wrong</Heading>
        <p className="mt-2 text-muted">{what} ran into an error and cannot be shown. Reloading the page may help.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-10 rounded-lg bg-elo px-4 text-sm font-semibold text-on-fill hover:opacity-90"
        >
          Reload the page
        </button>
      </div>
    );
  }
}
