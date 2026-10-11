import type { ReactNode } from 'react';
import { Card, Disclosure, SectionTitle, SourceName } from '../../components/ui';
import { partAnchor, partTitle, type MethodPart } from '../../display/method';
import type { SourceKey } from '../../display/sources';
import { classes } from '../../utils/classes';

interface PartProps {
  /** Which part of the view it is. Its title and its place in the document go by that. */
  part: MethodPart;
  /** The source the part is about, whose dot stands before the title. */
  source?: SourceKey;
  children: ReactNode;
  className?: string;
}

/**
 * One part of the view: a card with its title and what it says under it.
 * The element around the card is what a button at the top of the view
 * scrolls to and hands the focus. Like everything in the content that can
 * take the focus, it comes to rest under the tabs that stay at the top of
 * the window.
 */
export function Part({ part, source, children, className }: PartProps) {
  return (
    <div id={partAnchor(part)} tabIndex={-1} className={classes('min-w-0 rounded-xl', className)}>
      <Card as="section" className="h-full">
        <SectionTitle>{source ? <SourceName source={source} strong /> : partTitle(part)}</SectionTitle>
        <div className="space-y-3 text-sm leading-6 text-muted sm:text-[0.9375rem]">{children}</div>
      </Card>
    </div>
  );
}

/** A word that the text explains where it stands. */
export function Term({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}

/**
 * A formula, set in a box of its own in letters of one width. A line that is
 * longer than a narrow screen scrolls sideways inside the box.
 */
export function Formula({ children }: { children: ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-[0.8125rem] leading-6 text-ink sm:text-sm">
      <code>{children}</code>
    </pre>
  );
}

/** One line of a formula. */
export function Line({ children }: { children: ReactNode }) {
  return <span className="block">{children}</span>;
}

/** What a number is raised to. It is set no smaller than the smallest text of the page. */
export function Power({ children }: { children: ReactNode }) {
  return <sup className="text-xs">{children}</sup>;
}

/** A part of the text that is folded away until a visitor opens it, such as the longer formulas. */
export function More({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <Disclosure summary={summary} className="rounded-lg border border-line" summaryClassName="rounded-lg px-3 py-0.5 hover:bg-sunken group-open:rounded-b-none">
      <div className="space-y-3 border-t border-line px-3 py-3">{children}</div>
    </Disclosure>
  );
}

interface FiguresProps {
  /** What the table holds, for a screen reader. */
  caption: string;
  /** What the two columns are. */
  head: [string, string];
  rows: readonly { name: ReactNode; figure: ReactNode; key: string }[];
}

/** A short table of names and the number that goes with each. */
export function Figures({ caption, head, rows }: FiguresProps) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-xs text-muted">
          <th scope="col" className="pb-1.5 pr-3 text-left font-semibold">
            {head[0]}
          </th>
          <th scope="col" className="pb-1.5 text-right font-semibold">
            {head[1]}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-line">
            <th scope="row" className="py-1.5 pr-3 text-left font-normal text-muted">
              {row.name}
            </th>
            <td className="whitespace-nowrap py-1.5 text-right align-top font-semibold text-ink">{row.figure}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
