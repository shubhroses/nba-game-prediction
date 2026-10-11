import { Chip, SourceName, TeamLogo, VerdictMark } from '../../components/ui';
import type { Chip as GameChip, GameRow, SourceCell, TeamScore } from '../../display/resultsGame';
import { classes } from '../../utils/classes';
import { COLUMNS } from './columns';
import Details from './Details';

/** One team with its final score. The winner is in bold, and the loser is set back. */
function Team({ team }: { team: TeamScore }) {
  return (
    <div className={classes('flex items-center gap-2', team.won ? 'font-bold text-ink' : 'text-muted')}>
      <TeamLogo team={team.code} size="sm" />
      <span className="min-w-0 flex-1 text-sm">{team.name}</span>
      <span className="text-base">
        {team.points}
        {team.won && <span className="sr-only">, won</span>}
      </span>
    </div>
  );
}

const SAID = {
  pick: 'font-semibold text-ink',
  'toss-up': 'font-medium text-muted',
  nothing: 'text-faint',
};

/**
 * What one source said of the game and what became of it. On a card it is a
 * line: the name, what it said, and the mark alone, with a line under it for
 * what the mark does not say. In the row of a wide screen it stands under the
 * head of its column, with the mark in words as well.
 */
function Cell({ cell }: { cell: SourceCell }) {
  const kind = cell.said === null ? 'nothing' : cell.verdict === 'toss_up' ? 'toss-up' : 'pick';

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-2.5 py-1 lg:block lg:py-0">
      <SourceName source={cell.source} className="text-sm text-ink lg:sr-only" />
      <span className={classes('text-right text-sm lg:block lg:text-left', SAID[kind])}>
        {cell.said ?? <span aria-hidden="true">—</span>}
      </span>
      <span className="flex justify-end lg:mt-0.5 lg:justify-start">
        <VerdictMark verdict={cell.verdict} tooLate={cell.tooLate} compact="below-lg" />
      </span>
      {cell.note && (
        // In a row the mark of a late forecast says in words that it came too late, and the note would say it twice.
        <span className={classes('col-span-full pl-4 text-xs text-muted lg:mt-0.5 lg:pl-0', cell.tooLate ? 'lg:hidden' : 'lg:block')}>
          {cell.note}
        </span>
      )}
    </div>
  );
}

function Chips({ chips }: { chips: GameChip[] }) {
  if (chips.length === 0) return null;

  return (
    <ul className="space-y-1.5 border-t border-line px-4 py-2.5 lg:col-span-full lg:mt-3 lg:flex lg:flex-wrap lg:gap-x-6 lg:gap-y-1.5 lg:space-y-0 lg:border-0 lg:p-0">
      {chips.map((chip) => (
        <li key={chip.kind} className="flex items-start gap-2 text-sm text-muted">
          <Chip>{chip.label}</Chip>
          <span>{chip.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One game that is over: a card of its own on a phone and on a tablet, and a
 * row of the day's card on a wide screen, where the sources stand in columns.
 */
export default function Game({ game }: { game: GameRow }) {
  const name = `${game.away.name} at ${game.home.name}`;

  return (
    <article aria-label={name} className={classes('relative lg:items-center lg:py-3.5', COLUMNS)}>
      {/* In a row the head of the column says "Final" for every game, so this line is left to a screen reader there. */}
      <p className="flex items-center justify-between gap-3 px-4 pt-3 text-xs font-semibold text-muted lg:sr-only">
        <span>
          {game.away.code} at {game.home.code}
        </span>
        <span className="uppercase tracking-wide">Final</span>
      </p>

      <div className="space-y-1.5 px-4 pb-3 pt-2 lg:p-0">
        <Team team={game.away} />
        <Team team={game.home} />
      </div>

      {/* On a wide screen the three cells are laid out on the columns of the row themselves. */}
      <div className="border-t border-line px-4 py-2 lg:contents">
        {game.cells.map((cell) => (
          <Cell key={cell.source} cell={cell} />
        ))}
      </div>

      <Chips chips={game.chips} />
      <Details details={game.details} game={name} />
    </article>
  );
}
