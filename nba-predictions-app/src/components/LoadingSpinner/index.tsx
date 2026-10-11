interface LoadingSpinnerProps {
  /** What is being loaded, as in "Loading the record". */
  label?: string;
}

export default function LoadingSpinner({ label = 'Loading the games' }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-sm text-muted" role="status">
      {/* The ring turns only for a visitor who has not asked for less motion. The words say the same without it. */}
      <div className="h-10 w-10 rounded-full border-2 border-line border-t-elo motion-safe:animate-spin" aria-hidden="true"></div>
      <p>{label}…</p>
    </div>
  );
}
