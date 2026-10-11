import { source, type SourceKey } from '../../display/sources';
import { classes } from '../../utils/classes';

interface SourceNameProps {
  source: SourceKey;
  /** Heavier, for a name that is the title of a card or the head of a column. */
  strong?: boolean;
  /**
   * Lets a name of several words run on to a second line where there is no
   * room for it, as at the head of a narrow column. It breaks before the "&"
   * and not after it.
   */
  wrap?: boolean;
  className?: string;
}

/** Names a source next to a dot in its color, so that the color never stands without the name. */
export default function SourceName({ source: key, strong = false, wrap = false, className }: SourceNameProps) {
  const { name, bg } = source(key);
  return (
    <span className={classes('inline-flex items-center gap-1.5', !wrap && 'whitespace-nowrap', strong ? 'font-semibold' : 'font-medium', className)}>
      <span aria-hidden="true" className={classes('h-2.5 w-2.5 shrink-0 rounded-full', bg)} />
      {wrap ? name.replace(' & ', ' & ') : name}
    </span>
  );
}
