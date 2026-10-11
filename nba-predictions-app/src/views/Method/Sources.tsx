import { SourceName, TextLink } from '../../components/ui';
import { LINKS } from '../../display/links';
import { ELO, ELO_CARRIED_THROUGH } from '../../display/method';
import { hrefOf } from '../../display/route';
import { SOURCES } from '../../display/sources';
import { Part, Term } from './parts';

/** What the page is: two models of its own that go by results alone, next to the sportsbooks they are graded against. */
export function IntroPart({ className }: { className?: string }) {
  return (
    <Part part="page" className={className}>
      <div className="grid gap-x-8 gap-y-4 lg:grid-cols-2">
        <div className="space-y-3">
          <p>
            This page forecasts every game of the NBA&apos;s regular season with two models of its own, and shows each forecast next to what
            the sportsbooks say about the same game: their <Term>line</Term>. A percentage is always a team&apos;s <Term>chance</Term> of
            winning.
          </p>
          <p>
            Both models use the schedule and the final scores of the season so far, and nothing else: no injuries, no line-ups, no trades
            and no odds. The sportsbooks&apos; line is the yardstick. Once a game is over, all three are graded by one rule, and{' '}
            <TextLink href={hrefOf('record')}>the record</TextLink> keeps the count.
          </p>
        </div>
        <ul className="space-y-2.5">
          {SOURCES.map((source) => (
            <li key={source.key} className="rounded-lg border border-line px-3 py-2.5">
              <SourceName source={source.key} className="text-ink" />
              <p className="mt-0.5 text-sm leading-5">{source.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </Part>
  );
}

/** Where each kind of number comes from, with the credit that the ratings of FiveThirtyEight are published under. */
export function SourcesPart() {
  return (
    <Part part="sources">
      <dl className="space-y-3">
        <div>
          <dt className="font-semibold text-ink">The sportsbooks</dt>
          <dd>
            The prices of US sportsbooks come through The Odds API, six times a day. No price is published. For each game the job takes what
            every sportsbook implies about the home team, removes that sportsbook&apos;s margin, and publishes the median, the lowest, the
            highest and the number of sportsbooks.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Final scores</dt>
          <dd>They come from the same provider, once a day, on the morning after the games. Both models are built from them and the schedule.</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">The opening ratings of Elo</dt>
          <dd>
            They start from each team&apos;s last rating in{' '}
            <TextLink href={LINKS.fiveThirtyEight}>the NBA Elo ratings that FiveThirtyEight published</TextLink>, which end with the finals
            of June 2023. Those were carried through the {ELO_CARRIED_THROUGH} games of the three seasons since, by the rule above and with
            a home court of {ELO.homeCourt}. FiveThirtyEight published its data under the{' '}
            <TextLink href={LINKS.license}>Creative Commons Attribution 4.0 International License</TextLink>
            .
          </dd>
        </div>
      </dl>
    </Part>
  );
}

const READ_MORE = [
  { href: LINKS.models, title: 'The two models', text: 'Every formula and constant, how the two were chosen, and what the backtest shows.' },
  { href: LINKS.job, title: 'The job', text: 'What it records, how it grades, and every field of every file it publishes.' },
  { href: LINKS.data, title: 'The data branch', text: 'The files this page reads: the games with their line, the record, the ratings and the forecasts of each day.' },
] as const;

/** The two documents and the published files, on GitHub. */
export function ReadMorePart() {
  return (
    <Part part="more">
      <p>Everything above is written out at length in the repository, next to the code that does it.</p>
      <ul className="space-y-1">
        {READ_MORE.map((entry) => (
          <li key={entry.href}>
            <TextLink href={entry.href} standalone>
              {entry.title}
            </TextLink>
            <p className="text-sm leading-5">{entry.text}</p>
          </li>
        ))}
      </ul>
    </Part>
  );
}
