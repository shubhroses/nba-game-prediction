import BacktestTable from '../../components/BacktestTable';
import { TextLink } from '../../components/ui';
import { BACKTEST } from '../../display/backtest';
import { LINKS } from '../../display/links';
import { ELO } from '../../display/method';
import { hrefOf } from '../../display/route';
import { More, Part, Term } from './parts';

const { games, seasons, difference, cautions } = BACKTEST;

/** The figures of the backtest under their label, with what they do and do not show. */
export function BacktestPart({ className }: { className?: string }) {
  return (
    <Part part="backtest" className={className}>
      <p>
        Before the season, both models were scored on the {games} games of {seasons[0]} and {seasons[1]}, with each game forecast from the
        results of earlier days only. No odds were in it, so it says nothing about either model next to the sportsbooks.
      </p>

      {/* A box inside the card of the part, with a border in place of the shadow that a card on the page has. */}
      <div className="overflow-hidden rounded-xl border border-line">
        <BacktestTable />
      </div>

      <h4 className="pt-1 text-sm font-semibold text-ink">What it does and does not show</h4>
      <ul className="list-disc space-y-2 pl-5 lg:columns-2 lg:gap-x-10">
        <li className="break-inside-avoid">
          <Term>{cautions.winners.lead}</Term> {cautions.winners.text}
        </li>
        <li className="break-inside-avoid">
          <Term>The percentages of Points &amp; Rest scored slightly better than Elo&apos;s.</Term> Game by game, its log loss was lower by{' '}
          {difference.logLoss.lower}, with a 95% interval from {difference.logLoss.from} to {difference.logLoss.to} lower, and its Brier
          score by {difference.brier}. That is about half a percent, and it showed in one of the two seasons only.
        </li>
        <li className="break-inside-avoid">
          <Term>{cautions.sportsbooks.lead}</Term> {cautions.sportsbooks.text} How the two do next to them is what{' '}
          <TextLink href={hrefOf('record')}>the record</TextLink> of this season is for.
        </li>
        <li className="break-inside-avoid">
          <Term>The figures flatter Elo a little.</Term> Its home court of {ELO.homeCourt} was chosen on seasons that include these two.
        </li>
      </ul>

      <More summary="Who ran it, and on which scores">
        <p>
          The backtest was run outside the repository, and the scores it was run on are not published. A second reviewer, who had not
          built it, ran it again with code of their own and looked for any use of later results.{' '}
          <TextLink href={LINKS.models}>The document of the two models</TextLink> gives their notes and says where the scores came from.
        </p>
      </More>
    </Part>
  );
}
