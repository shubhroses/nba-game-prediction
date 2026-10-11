import { teamName } from '../../display/teams';

/** A team by its three-letter code, with its full name for a visitor who points at it. */
export default function TeamCode({ team }: { team: string }) {
  return (
    <abbr title={teamName(team)} className="font-semibold text-ink no-underline">
      {team}
    </abbr>
  );
}
