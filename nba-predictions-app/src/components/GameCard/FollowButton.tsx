import { classes } from '../../utils/classes';
import { StarIcon } from '../ui';

interface FollowButtonProps {
  /** The full name of the team: "Detroit Pistons". */
  name: string;
  /** Whether the visitor follows the team. */
  followed: boolean;
  onToggle: () => void;
}

/**
 * Adds a team to the visitor's teams, or takes it out. A screen reader hears
 * one name for the button and whether it is pressed.
 */
export default function FollowButton({ name, followed, onToggle }: FollowButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={followed}
      aria-label={`Follow the ${name}`}
      title={followed ? `In my teams: the ${name}` : `Add the ${name} to my teams`}
      onClick={onToggle}
      className={classes(
        '-mx-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-sunken motion-safe:transition-colors',
        followed ? 'text-ink' : 'text-faint hover:text-ink',
      )}
    >
      <StarIcon filled={followed} />
    </button>
  );
}
