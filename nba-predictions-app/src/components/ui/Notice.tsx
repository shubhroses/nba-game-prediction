import type { ReactNode } from 'react';
import { classes } from '../../utils/classes';
import { InfoIcon, WarnIcon } from './icons';

interface NoticeProps {
  /** `info` for something to know, `warn` for something that is not as it should be. */
  tone?: 'info' | 'warn';
  /** A few words in bold before the text. */
  title?: string;
  children: ReactNode;
  className?: string;
}

/** A short message set apart from the text around it, told apart by its icon as well as its color. */
export default function Notice({ tone = 'info', title, children, className }: NoticeProps) {
  const warn = tone === 'warn';
  return (
    <div
      role="note"
      className={classes(
        'flex gap-3 rounded-xl border px-4 py-3 text-sm text-ink',
        warn ? 'border-warn/40 bg-warn-soft' : 'border-line bg-sunken',
        className,
      )}
    >
      {warn ? <WarnIcon className="mt-0.5 text-warn" /> : <InfoIcon className="mt-0.5 text-muted" />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className={classes(title && 'mt-0.5', 'text-muted')}>{children}</div>
      </div>
    </div>
  );
}
