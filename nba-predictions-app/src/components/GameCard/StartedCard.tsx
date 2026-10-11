import type { GameCardView } from '../../display/gameCard';
import { Card, TeamBadge } from '../ui';
import CardChip from './CardChip';
import { InlineRows } from './SourceRows';

interface StartedCardProps {
  card: GameCardView;
  /**
   * True for a game that the latest snapshot no longer lists although it was
   * taken before the scheduled start. The page does not know that such a
   * game has started, so the card gives the time as the one it was set for.
   */
  unlisted?: boolean;
}

/**
 * The card of a game that has started and has no result yet: the two teams
 * and what each source had said, in little room. The away team is on the
 * left and the home team on the right, as on the bars under them.
 */
export default function StartedCard({ card, unlisted = false }: StartedCardProps) {
  return (
    <Card as="article" className="flex w-full flex-col">
      <h4 className="sr-only">{card.title}</h4>

      <div className="flex min-h-7 items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {unlisted ? 'Was set for' : 'Started'} <time dateTime={card.commenceTime}>{card.start}</time>
          {card.neutral === true && ' · neutral floor'}
        </p>
        {card.chip && <CardChip chip={card.chip} />}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <TeamBadge team={card.away.code} size="sm" />
        <span className="text-xs text-faint">{card.neutral === true ? 'vs' : 'at'}</span>
        <TeamBadge team={card.home.code} size="sm" />
      </div>

      <div className="mt-3">
        <InlineRows rows={card.rows} home={card.home.code} away={card.away.code} />
      </div>

      {card.note && <p className="mt-3 text-xs text-muted">{card.note}</p>}
    </Card>
  );
}
