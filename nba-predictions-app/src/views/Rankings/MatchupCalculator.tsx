import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Card, LeanBar, SectionTitle, SourceName, SwapIcon, TeamBadge, TextLink } from '../../components/ui';
import type { Board } from '../../data/board';
import type { ModelRatings } from '../../data/model';
import type { Side } from '../../display/pick';
import {
  chanceFormula,
  defaultMatchup,
  matchupOf,
  matchupParam,
  matchupView,
  onBoard,
  onBoardNote,
  pickNote,
  swapped,
  teamChoices,
  wholeNumber,
  withTeam,
  type Matchup,
  type MatchupTeam,
} from '../../display/rankingsMatchup';
import { hrefOf } from '../../display/route';
import { replaceRoute } from '../../hooks/useHashRoute';
import { classes } from '../../utils/classes';

interface MatchupCalculatorProps {
  model: ModelRatings;
  board: Board;
  now: number;
  /** What follows the view in the address. A matchup is kept there, as in `#/rankings/NYK-at-BOS`. */
  param: string | null;
  className?: string;
}

const SUBTITLE = 'text-sm font-semibold text-ink';

/**
 * Puts a matchup in the address, so that it can be linked to and is still
 * there when the page is loaded again. Back leaves the view, however many
 * teams were tried.
 */
function show(matchup: Matchup): void {
  replaceRoute('rankings', matchupParam(matchup));
}

/** One team with its chance. The away team is on the left and the home team on the right, as on the bar under them. */
function TeamChance({ team, side }: { team: MatchupTeam; side: Side }) {
  const home = side === 'home';
  return (
    <div className={classes('flex min-w-0 flex-col gap-1.5', home ? 'items-end text-right' : 'items-start')}>
      <TeamBadge team={team.code} size="md" label="code" className={classes(home && 'flex-row-reverse')} />
      <div className="text-xs text-muted">{home ? 'Home' : 'Away'}</div>
      <div className="text-3xl font-bold leading-none text-ink">{team.chance}%</div>
    </div>
  );
}

/** One line of the sum: the sign it is taken with, what the number is, and the number. */
function Term({ sign, children, points, total = false }: { sign: string; children: ReactNode; points: number; total?: boolean }) {
  return (
    <tr className={classes(total && 'border-t border-line')}>
      <th scope="row" className={classes('py-1 pr-2 text-left align-top', total ? 'font-semibold text-ink' : 'font-normal text-muted')}>
        <span className="flex gap-1.5">
          <span aria-hidden="true" className="w-3 shrink-0 text-center">
            {sign}
          </span>
          <span className="min-w-0">{children}</span>
        </span>
      </th>
      <td className="py-1 text-right align-top font-semibold text-ink">{wholeNumber(points)}</td>
    </tr>
  );
}

/**
 * Elo's chance for any two teams, worked out here from the two ratings in
 * the file and its home court, with the three numbers shown as the sum they
 * are. The calculator opens with the next game on the board.
 */
export default function MatchupCalculator({ model, board, now, param, className }: MatchupCalculatorProps) {
  const id = useId();
  // The matchup it opened with stays until the visitor chooses another, whichever game starts in the meantime.
  const [opened] = useState(() => defaultMatchup(board, model, now));
  const matchup = matchupOf(param, model.elo.ratings) ?? opened;
  const view = matchup && matchupView(model, matchup);

  // A visitor whose address names a matchup came for the calculator, and a phone has it far below the table. So it is
  // brought to the top of the window, once, unless it starts in sight. The page goes to its own top when a view opens,
  // and the next frame comes after that.
  const card = useRef<HTMLDivElement>(null);
  const cameForIt = useRef(matchupOf(param, model.elo.ratings) !== null);
  useEffect(() => {
    if (!cameForIt.current) return;
    const frame = requestAnimationFrame(() => {
      const element = card.current;
      if (element && element.getBoundingClientRect().top >= window.innerHeight) element.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!matchup || !view) return null;

  const choices = teamChoices(model);
  const formula = chanceFormula(view);
  const note = pickNote(view);
  const found = onBoard(board, view, now);
  const select = (side: Side, label: string) => (
    <div className="col-start-1 min-w-0">
      <label htmlFor={`${id}-${side}`} className="block text-xs font-medium text-muted">
        {label}
      </label>
      <select
        id={`${id}-${side}`}
        value={matchup[side]}
        onChange={(event) => show(withTeam(matchup, side, event.target.value))}
        className="mt-1 block min-h-10 w-full rounded-lg border border-line bg-surface px-2 text-sm font-medium text-ink"
      >
        {choices.map((team) => (
          <option key={team.code} value={team.code}>
            {team.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    // The element around the card is what the page scrolls to, and it leaves room for the tabs that stay at the top of the window.
    <div ref={card} className={classes('scroll-mt-below-tabs', className)}>
      <Card as="section">
        <SectionTitle
          aside={<SourceName source="elo" />}
          note="Choose any two teams. Elo's chance for the home team is worked out in your browser, from their two ratings in the table."
        >
          Matchup calculator
        </SectionTitle>

        {/* One column on a phone and next to the table. Two where the card has the width of the page to itself. */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-1">
          <div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2">
              {select('away', 'Away team')}
              <button
                type="button"
                onClick={() => show(swapped(matchup))}
                aria-label="Let the two teams change places"
                title="Let the two teams change places"
                className="col-start-2 row-span-2 row-start-1 mt-5 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:bg-sunken hover:text-ink motion-safe:transition-colors"
              >
                <SwapIcon className="rotate-90" />
              </button>
              {select('home', 'Home team')}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <TeamChance team={view.away} side="away" />
              <TeamChance team={view.home} side="home" />
            </div>
            <LeanBar source="elo" pHome={view.pHome} home={view.home.code} away={view.away.code} className="mt-3" />
            {/* A screen reader reads this line out when another team is chosen. */}
            <p role="status" className="mt-2 text-sm text-muted">
              {note.lead}
              {note.team && <strong className="font-semibold text-ink">{note.team}</strong>}
              {note.rest}
            </p>
          </div>

          <div className="border-t border-line pt-4 sm:border-t-0 sm:pt-0 lg:border-t lg:pt-4">
            <h4 className={SUBTITLE}>The sum behind it</h4>
            <table className="mt-2 w-full border-collapse text-sm">
              <caption className="sr-only">How far ahead Elo has the home team</caption>
              <tbody>
                <Term sign="" points={view.home.rating}>
                  {view.home.name}, at home
                </Term>
                <Term sign="+" points={view.homeCourt}>
                  <span className="sr-only">plus the </span>home court
                </Term>
                <Term sign="−" points={view.away.rating}>
                  <span className="sr-only">minus the </span>
                  {view.away.name}
                </Term>
                <Term sign="=" points={view.gap} total>
                  <span className="sr-only">gives the </span>gap, in rating points
                </Term>
              </tbody>
            </table>
            {/* On a narrow screen the line breaks before the equals sign, and nowhere else. */}
            <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-ink">
              <code className="font-mono">
                <span className="whitespace-nowrap">
                  1 / (1 + 10<sup className="text-xs">{formula.exponent}</sup>)
                </span>{' '}
                <span className="whitespace-nowrap">
                  = <strong className="font-semibold">{formula.chance}</strong>
                </span>
              </code>
            </p>
            <p className="mt-2 text-sm text-muted">
              That is the chance of the home team, which a card shows as {view.home.chance}%.{' '}
              <TextLink href={hrefOf('method')}>How Elo works</TextLink>
            </p>
            {found && (
              <p className="mt-2 text-sm text-muted">
                {onBoardNote(found)}{' '}
                <TextLink href={hrefOf('games')}>See the games</TextLink>
              </p>
            )}
          </div>

          <div className="border-t border-line pt-4 sm:col-span-2 lg:col-span-1">
            <h4 className={SUBTITLE}>What is not in it</h4>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-muted sm:columns-2 sm:gap-x-10 lg:columns-1">
              <li className="break-inside-avoid">
                <strong className="font-semibold text-ink">Rest.</strong> Elo does not count it. Points &amp; Rest does.
              </li>
              <li className="break-inside-avoid">
                <strong className="font-semibold text-ink">A neutral floor.</strong> The sum always adds the home court of {view.homeCourt}. A game
                on a neutral floor has none.
              </li>
              <li className="break-inside-avoid">
                <strong className="font-semibold text-ink">It is not a frozen forecast.</strong> The forecast that is graded is made on the morning
                of its game and never changed.
              </li>
              <li className="break-inside-avoid">
                <strong className="font-semibold text-ink">Points &amp; Rest is not offered here.</strong> Its chance also needs who played the
                night before, how long each team has rested, the altitude of the arena and how far recent results were from what it expected.
                The file of the ratings does not hold those.
              </li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
