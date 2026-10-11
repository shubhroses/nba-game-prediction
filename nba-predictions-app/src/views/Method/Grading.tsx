import { TextLink } from '../../components/ui';
import { POINTS_REST } from '../../display/method';
import { hrefOf } from '../../display/route';
import { Part, Term } from './parts';

/** That a forecast is written once, on the morning of its game, and why Points & Rest has none before that. */
export function FrozenPart() {
  return (
    <Part part="frozen">
      <p>
        Every morning, at about 5:10 in New York, a scheduled job replays the whole season: from the opening ratings through every final score on
        record. Then it writes the forecasts for the games of that day into one file.
      </p>
      <p>
        That file is written once, and nothing changes it afterwards. So every forecast that is graded was on record before its game
        started. A forecast that was published at the start or after it does not count.
      </p>
      <p>
        Points &amp; Rest is made on that morning and not before. It counts rest, and only then does it know who played the night before.
        This is why a game of a later day shows the chance of Elo alone, and why that chance can still move until the morning of the game.
      </p>
    </Part>
  );
}

/** The rule that grades all three sources, and what the record counts. */
export function GradingPart() {
  return (
    <Part part="grading">
      <p>
        A <Term>pick</Term> is the side that a source puts at 52% or more. Between 48% and 52% it has no pick: the game is a{' '}
        <Term>toss-up</Term>, which counts neither as a win nor as a loss. One rule grades both models and the sportsbooks.
      </p>
      <p>
        The line of the sportsbooks that is graded is the last one the job recorded before the start, which can be up to about three
        hours old. A forecast of a model is from the morning. So the two do not know the same things: the sportsbooks have the news of the
        day, and the models do not.
      </p>
      <p>
        <TextLink href={hrefOf('record')}>The record</TextLink>{' '}
        counts the picks of each source that won and that lost, always with the number of games. It also scores the percentages themselves
        with a Brier score: the average of the squared distance between a chance and what happened. Lower is better, and a coin flip for
        every game scores 0.25.
      </p>
      <p>A game that no sportsbook quoted is not graded for the sportsbooks, and a game without a forecast is not graded for a model.</p>
    </Part>
  );
}

const LIMITS = [
  {
    title: 'Injuries, trades and line-ups',
    text: 'The models see final scores and the schedule, and nothing else. A team that loses its best player is rated as before until its results show it.',
  },
  {
    title: 'What a summer changed',
    text: "Early in a season the ratings lean on the season before. The opening ratings are last season's, moved part of the way to the average. The draft and a summer's trades are not in them.",
  },
  {
    title: 'What the day brings',
    text: "A forecast is made in the morning and never changed. The sportsbooks' line is hours newer.",
  },
  {
    title: 'How big a win will be',
    text: `The margin of Points & Rest is on a scale where a blowout counts as ${POINTS_REST.cap} points, so it runs smaller than real margins do. It is a number to compare games by, not a point spread.`,
  },
  {
    title: 'A neutral floor that nobody listed',
    text: 'The games on a neutral floor are a list that is kept by hand. A game that is missing from it gets a home court that it does not have, in both models.',
  },
] as const;

/** What neither model can see, because both go by results alone. */
export function LimitsPart({ className }: { className?: string }) {
  return (
    <Part part="limits" className={className}>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {LIMITS.map((limit) => (
          <div key={limit.title}>
            <dt className="font-semibold text-ink">{limit.title}</dt>
            <dd>{limit.text}</dd>
          </div>
        ))}
      </dl>
    </Part>
  );
}
