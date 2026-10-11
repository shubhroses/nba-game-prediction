import type { CardTeam, GameCardView } from '../../display/gameCard';
import { source, type Source } from '../../display/sources';
import { classes } from '../../utils/classes';
import { Card, Disclosure, SourceName, TeamLogo, TextLink } from '../ui';
import CardChip from './CardChip';
import FollowButton from './FollowButton';
import { StackedRows } from './SourceRows';

interface TeamRowProps {
  team: CardTeam;
  /** The source of the chance, whose color marks the pick. Null when no source has a number. */
  accent: Source | null;
  /** True when the other team is the pick, and this one is set back. */
  setBack: boolean;
  /** Writes "home" under the name. */
  atHome: boolean;
  followed: boolean;
  onToggle: () => void;
}

/** One team of the game: its logo and name, the star that follows it, and its chance. The pick is heavier and marked. */
function TeamRow({ team, accent, setBack, atHome, followed, onToggle }: TeamRowProps) {
  return (
    // Next to other cards a row has the room of a name of two lines, so that the bars of the cards stand at one height.
    <div className="flex min-h-12 items-center gap-2.5 md:min-h-[3.75rem]">
      <TeamLogo team={team.code} />
      <div className="min-w-0 flex-1">
        <p className={classes('text-sm leading-tight text-ink', team.picked ? 'font-bold' : 'font-medium')}>{team.name}</p>
        {(team.picked || atHome) && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            {team.picked && accent && (
              <span className={classes('rounded px-1.5 py-0.5 font-semibold', accent.soft, accent.text)}>Pick</span>
            )}
            {atHome && <span>home</span>}
          </p>
        )}
      </div>
      <FollowButton name={team.name} followed={followed} onToggle={onToggle} />
      {/* Both chances of a card take the same room, so that the two stars stand under each other. */}
      {team.chance !== null && (
        <p
          className={classes(
            'min-w-[4.25rem] shrink-0 text-right text-3xl leading-none',
            setBack ? 'font-medium text-muted' : 'font-bold text-ink',
          )}
        >
          {team.chance}%
        </p>
      )}
    </div>
  );
}

interface GameCardProps {
  card: GameCardView;
  /** The codes of the teams the visitor follows. */
  myTeams: ReadonlySet<string>;
  /** Follows a team, or stops following it. */
  onToggleTeam: (code: string) => void;
}

/**
 * The card of a game that is still to start. It leads with the chance of the
 * page's own model, has the three sources under each other so that the
 * sportsbooks' number is the yardstick beside it, and opens to say how each
 * number is made.
 */
export default function GameCard({ card, myTeams, onToggleTeam }: GameCardProps) {
  const accent = card.headline === null ? null : source(card.headline);

  return (
    <Card as="article" padded={false} className="flex w-full flex-col">
      <h4 className="sr-only">{card.title}</h4>

      <div className="flex-1 p-4 sm:p-5">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <p className="text-sm text-muted">
            <time dateTime={card.commenceTime}>{card.start}</time>
            {card.neutral === true && ' · neutral floor'}
          </p>
          {card.chip && <CardChip chip={card.chip} />}
        </div>

        <div className="mt-2 space-y-1">
          <TeamRow
            team={card.away}
            accent={accent}
            setBack={card.home.picked}
            atHome={false}
            followed={myTeams.has(card.away.code)}
            onToggle={() => onToggleTeam(card.away.code)}
          />
          <TeamRow
            team={card.home}
            accent={accent}
            setBack={card.away.picked}
            // On a neutral floor the second team is not at home. Where the page cannot tell, the schedule's word stands.
            atHome={card.neutral !== true}
            followed={myTeams.has(card.home.code)}
            onToggle={() => onToggleTeam(card.home.code)}
          />
        </div>

        <p className="mt-2.5 flex items-start gap-1.5 text-xs text-muted">
          {accent && <span aria-hidden="true" className={classes('mt-1 h-2 w-2 shrink-0 rounded-full', accent.bg)} />}
          <span>{card.caption}</span>
        </p>

        <div className="mt-3 border-t border-line pt-3">
          <StackedRows rows={card.rows} home={card.home.code} away={card.away.code} />
        </div>

        {card.note && <p className="mt-3 text-sm font-medium text-ink">{card.note}</p>}
      </div>

      <Disclosure
        // Every card has such a line, and a screen reader hears which game this one is of.
        summary={
          <>
            How these numbers are made<span className="sr-only"> for {card.title}</span>
          </>
        }
        className="border-t border-line"
        summaryClassName="rounded-b-xl px-4 py-0.5 hover:bg-sunken group-open:rounded-none sm:px-5"
      >
        <p className="px-4 pt-1 text-sm text-muted sm:px-5">Each percentage is a team's chance of winning, as one source sees it.</p>
        <dl className="space-y-3 px-4 pb-4 pt-3 text-sm sm:px-5 sm:pb-5">
          {card.made.map((line) => (
            <div key={line.source}>
              <dt>
                <SourceName source={line.source} className="text-ink" />
              </dt>
              <dd className="mt-0.5 text-muted">
                {line.figures && <span className="block text-ink">{line.figures}</span>}
                {line.text}
                {/* On a line of its own, so that it is high enough for a finger. */}
                {line.link && (
                  <span className="block">
                    <TextLink href={line.link.href} standalone>
                      {line.link.label}
                      <span className="sr-only"> for {card.title}</span>
                    </TextLink>
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </Card>
  );
}
