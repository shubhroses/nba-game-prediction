import type { ReactNode } from 'react';
import { Card, SectionTitle } from '../../components/ui';
import MethodLink from './MethodLink';

function Point({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-ink">{term}</dt>
      <dd className="mt-0.5 text-muted">{children}</dd>
    </div>
  );
}

/** What a visitor has to know to read the numbers of the view, each in a sentence or two. */
export default function HowToRead() {
  return (
    <section>
      <SectionTitle>How to read this</SectionTitle>
      <Card>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 text-sm md:grid-cols-2">
          <Point term="A pick">
            The side that a source puts at 52% or more. A pick that wins counts as won, and one that loses as lost.
          </Point>
          <Point term="A toss-up">
            Between 48% and 52% a source has no pick. The game counts as neither won nor lost for it.
          </Point>
          <Point term="Not graded">
            A source had no chance for the game before it started: no line, no forecast, or a forecast that was published too
            late.
          </Point>
          <Point term="The 95% interval">
            A share of wins is of the games played so far, and a few more games could move it. The interval runs from the
            lowest to the highest true share that the count so far is compatible with. With few games it is wide.
          </Point>
          <Point term="Morning and evening">
            A model's chance is made on the morning of the game. The sportsbooks' line is from the last snapshot before the
            start, hours later, so the two are not forecasts of the same moment.
          </Point>
        </dl>
        <p className="mt-3 border-t border-line pt-1">
          <MethodLink />
        </p>
      </Card>
    </section>
  );
}
