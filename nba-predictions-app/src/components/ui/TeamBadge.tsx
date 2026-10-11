import { useState } from 'react';
import { teamName } from '../../display/teams';
import { classes } from '../../utils/classes';
import { getTeamLogo } from '../../utils/formatters';

type Size = 'sm' | 'md' | 'lg';

interface TeamBadgeProps {
  /** The team's three-letter code. */
  team: string;
  size?: Size;
  /** What is written next to the logo: the code or the full name. */
  label?: 'code' | 'name';
  className?: string;
}

const DISCS: Record<Size, string> = {
  sm: 'h-7 w-7 p-0.5 text-xs',
  md: 'h-10 w-10 p-1 text-xs',
  lg: 'h-14 w-14 p-1.5 text-base',
};

const LABELS: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

/**
 * The initials of a team's name, as many as fit on a disc of the size. A
 * team that is not in the table goes by its code, which is then its name.
 */
function initials(name: string, size: Size): string {
  const parts = name.split(' ');
  const letters = parts.length === 1 ? name : parts.map((part) => part[0]).join('');
  return letters.substring(0, size === 'sm' ? 2 : 3);
}

/**
 * The logo, or the team's initials when there is no logo or it does not
 * load. The disc is white in both themes, because the logos are drawn for a
 * white background. The team's name always stands next to it, so the disc
 * says nothing more and a screen reader passes it over.
 */
function Disc({ name, size, className }: { name: string; size: Size; className?: string }) {
  const [failed, setFailed] = useState(false);
  const logo = getTeamLogo(name);

  return (
    <span
      aria-hidden="true"
      className={classes(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white font-bold text-header ring-1 ring-line',
        DISCS[size],
        className,
      )}
    >
      {logo && !failed ? (
        <img src={logo} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" onError={() => setFailed(true)} />
      ) : (
        initials(name, size)
      )}
    </span>
  );
}

interface TeamLogoProps {
  /** The team's three-letter code. */
  team: string;
  size?: Size;
  className?: string;
}

/**
 * The logo of a team alone, on its white disc. It is for a view that writes
 * the team's name next to it in its own way, such as heavier for the winner
 * of a game, and it says nothing to a screen reader.
 */
export function TeamLogo({ team, size = 'md', className }: TeamLogoProps) {
  const name = teamName(team);
  return <Disc key={name} name={name} size={size} className={className} />;
}

/** Shows a team: its logo on a white disc, with its code or its full name next to it, in three sizes. */
export default function TeamBadge({ team, size = 'md', label = 'code', className }: TeamBadgeProps) {
  const name = teamName(team);

  return (
    <span className={classes('inline-flex min-w-0 items-center gap-2', className)}>
      <Disc key={name} name={name} size={size} />
      <span className={classes('min-w-0 font-semibold', LABELS[size])}>{label === 'name' ? name : team}</span>
    </span>
  );
}
