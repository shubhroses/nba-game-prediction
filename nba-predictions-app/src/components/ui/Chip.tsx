import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';

interface ChipProps {
  children: ReactNode;
  /**
   * `note` for a word that sets something apart, `quiet` for one that is
   * there to be found and not to be noticed, `warn` for one to notice, and
   * `outline` on the sunken color, where a filled chip would not show.
   */
  tone?: 'note' | 'quiet' | 'warn' | 'outline';
  className?: string;
}

const TONES = {
  note: 'bg-sunken text-ink',
  quiet: 'bg-sunken text-muted',
  warn: 'bg-warn-soft text-warn',
  outline: 'border border-line bg-surface text-ink',
};

/** A word or two in a small rounded box, which labels what it stands on or next to. */
export default function Chip({ children, tone = 'note', className }: ChipProps) {
  return <span className={classes('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>{children}</span>;
}
