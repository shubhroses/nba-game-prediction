import type { Verdict } from '../../data/results';
import { outcomeOf, outcomeWords, type Outcome } from '../../display/verdict';
import { classes } from '../../utils/classes';
import { CheckIcon, CrossIcon, DashIcon, RingIcon } from './icons';

interface VerdictMarkProps {
  /** The job's verdict on one source for one game. */
  verdict: Verdict;
  /** True for a forecast that was published too late to count. The words then say so. */
  tooLate?: boolean;
  /**
   * Shows the mark alone, with the words left to a screen reader: always, or
   * with `below-lg` on screens narrower than 1024px, where a row of marks
   * has no room for them.
   */
  compact?: boolean | 'below-lg';
  className?: string;
}

const COLORS: Record<Outcome, string> = {
  right: 'text-win',
  wrong: 'text-loss',
  'no-pick': 'text-muted',
  'not-graded': 'text-faint',
};

function Mark({ outcome }: { outcome: Outcome }) {
  switch (outcome) {
    case 'right':
      return <CheckIcon className="h-4 w-4" />;
    case 'wrong':
      return <CrossIcon className="h-4 w-4" />;
    case 'no-pick':
      return <DashIcon className="h-4 w-4" />;
    case 'not-graded':
      return <RingIcon className="h-4 w-4" />;
  }
}

/** Says what became of a forecast with a mark and with words: right, wrong, no pick or not graded. */
export default function VerdictMark({ verdict, tooLate = false, compact = false, className }: VerdictMarkProps) {
  const outcome = outcomeOf(verdict);
  const words = outcome === 'not-graded' && tooLate ? 'Too late to count' : outcomeWords(outcome);
  return (
    <span
      title={compact === true ? words : undefined}
      className={classes('inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium', COLORS[outcome], className)}
    >
      <Mark outcome={outcome} />
      <span className={classes(compact === true && 'sr-only', compact === 'below-lg' && 'sr-only lg:not-sr-only')}>{words}</span>
    </span>
  );
}
