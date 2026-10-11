import { CheckIcon } from '../../components/ui';
import type { Filters } from '../../display/games';
import { classes } from '../../utils/classes';

interface FilterButtonsProps {
  /** Which filters can do something. One that cannot is not shown. */
  offered: Filters;
  /** Which filters are at work. */
  applied: Filters;
  /** Switches one filter on, or off when it is on. */
  onToggle: (filter: keyof Filters) => void;
}

const LABELS: Record<keyof Filters, string> = { myTeams: 'My teams', differentPicks: 'Different picks' };
const ORDER: readonly (keyof Filters)[] = ['myTeams', 'differentPicks'];

/**
 * The two ways to narrow the games down, each a button that stays pressed
 * while it is at work. A check mark says so as well as the color.
 */
export default function FilterButtons({ offered, applied, onToggle }: FilterButtonsProps) {
  const shown = ORDER.filter((key) => offered[key]);
  if (shown.length === 0) return null;

  return (
    <div role="group" aria-label="Show only" className="flex shrink-0 flex-wrap gap-2 md:py-1">
      {shown.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={applied[key]}
          onClick={() => onToggle(key)}
          className={classes(
            'inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium',
            'motion-safe:transition-colors',
            applied[key] ? 'border-ink bg-ink text-surface' : 'border-line bg-surface text-ink hover:border-faint',
          )}
        >
          {applied[key] && <CheckIcon className="h-4 w-4" />}
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
