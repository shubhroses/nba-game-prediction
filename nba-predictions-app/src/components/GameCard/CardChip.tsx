import { chipLabel, type Chip as CardChipKind } from '../../display/gameCard';
import { Chip } from '../ui';

/** The one label in the corner of a card. Different picks are a thing to notice, a toss-up is not. */
export default function CardChip({ chip }: { chip: CardChipKind }) {
  return <Chip tone={chip === 'different-picks' ? 'warn' : 'quiet'}>{chipLabel(chip)}</Chip>;
}
