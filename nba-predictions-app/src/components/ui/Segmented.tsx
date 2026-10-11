import { classes } from '../../utils/classes';

interface SegmentedProps<Key extends string> {
  /** What is being chosen, for a screen reader: "Games shown". */
  label: string;
  options: readonly { key: Key; label: string }[];
  value: Key;
  onChange: (key: Key) => void;
  className?: string;
}

/**
 * A choice between a few ways of showing the same thing, such as all games
 * or the games of the teams a visitor follows. The chosen one is raised and
 * heavier, and a screen reader hears it as pressed.
 */
export default function Segmented<Key extends string>({ label, options, value, onChange, className }: SegmentedProps<Key>) {
  return (
    <div
      role="group"
      aria-label={label}
      // With more options than fit, the row scrolls sideways inside its own box.
      className={classes('no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-sunken p-0.5', className)}
    >
      {options.map((option) => {
        const chosen = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={chosen}
            onClick={() => onChange(option.key)}
            className={classes(
              'min-h-10 min-w-10 shrink-0 whitespace-nowrap rounded-[0.625rem] px-3 text-sm -outline-offset-2 motion-safe:transition-colors',
              chosen ? 'bg-surface font-semibold text-ink shadow-card' : 'font-medium text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
