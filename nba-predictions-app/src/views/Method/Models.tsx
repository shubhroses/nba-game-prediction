import { TextLink } from '../../components/ui';
import { ELO, OPENING_HOME_COURT, POINTS_REST, REST_TERMS, workedGame } from '../../display/method';
import { ELO_SCALE } from '../../display/methodElo';
import { signedPoints } from '../../display/numbers';
import { matchupParam } from '../../display/rankingsMatchup';
import { hrefOf } from '../../display/route';
import EloCurve from './EloCurve';
import { Figures, Formula, Line, More, Part, Power, Term } from './parts';

/** Elo: the formula of a chance, a game worked through with the page's own sums, and the constants. */
export function EloPart() {
  const game = workedGame();
  // In the worked game the home team was behind and won, and the sums are written with the signs as they fall then.
  const behind = -game.gap;

  return (
    <Part part="elo" source="elo">
      <p>
        Every team has one number, its <Term>rating</Term>. The league&apos;s average is {ELO.mean}. Before a game, Elo looks at how far ahead
        the home team is: its rating, plus {ELO.homeCourt} points for playing at home, minus the rating of the visitors.
      </p>
      <Formula>
        <Line>
          {'gap    = home rating + '}
          {ELO.homeCourt}
        </Line>
        <Line>{'         − away rating'}</Line>
        <Line>
          {'chance = 1 / (1 + 10'}
          <Power>
            {'−gap/'}
            {ELO_SCALE}
          </Power>
          {')'}
        </Line>
      </Formula>
      <p>
        <Term>A worked game.</Term> Boston, at {game.homeRating}, hosts New York, at {game.awayRating}. Boston&apos;s gap is {game.homeRating} +{' '}
        {game.homeCourt} − {game.awayRating} = −{behind}, so its chance is
      </p>
      <Formula>
        <Line>
          {'1 / (1 + 10'}
          <Power>
            {behind}/{ELO_SCALE}
          </Power>
          {') = '}
          {game.chance}
        </Line>
      </Formula>
      <p>
        which a card shows as {game.percent}%. The ratings are published as whole numbers, and every chance of Elo on this page is worked out
        from two of them, so this sum gives exactly the number that is shown.{' '}
        <TextLink href={hrefOf('rankings', matchupParam({ away: 'NYK', home: 'BOS' }))}>The matchup calculator</TextLink>{' '}
        does it for any two teams, with the ratings of today.
      </p>
      <EloCurve game={game} />

      <More summary="What a result does to the two ratings">
        <p>The winner takes points from the loser: more for a win that was not expected, and more for a win by many points.</p>
        <Formula>
          <Line>{'change = K × multiplier'}</Line>
          <Line>{"  × (1 − winner's chance)"}</Line>
          <Line>{'multiplier ='}</Line>
          <Line>
            {'  (margin + 3)'}
            <Power>0.8</Power>
          </Line>
          <Line>{'  / (7.5 + 0.006 × gap)'}</Line>
        </Formula>
        <p>Here the gap is the winner&apos;s: how far ahead it was before the game, which is below zero for a team that was behind.</p>
        <p>
          Boston wins that game {game.homePts} to {game.awayPts}. The multiplier is {game.margin + 3}
          <Power>0.8</Power> / (7.5 − 0.006 × {behind}) = {game.multiplier}, so Boston gains {game.k} × {game.multiplier} × (1 − {game.chance}) ={' '}
          {game.gain} points and New York loses as many. The two changes are always equal and opposite.
        </p>
      </More>

      <p>
        The method is the one that FiveThirtyEight used for its NBA ratings, and three of the four constants are FiveThirtyEight&apos;s as
        well. The home court is not: FiveThirtyEight gave the home team 100 points.
      </p>
      <Figures
        caption="The constants of Elo"
        head={['Constant', 'Number']}
        rows={[
          { key: 'k', name: 'K, which sets how far one result moves a rating', figure: ELO.k },
          { key: 'home', name: 'Home court, which a neutral floor does not have', figure: ELO.homeCourt },
          { key: 'mean', name: "The league's average", figure: ELO.mean },
          {
            key: 'reversion',
            name: 'What a rating gives up of its distance to the average between two seasons',
            figure: `${ELO.reversion * 100}%`,
          },
        ]}
      />
    </Part>
  );
}

/** Points & Rest: a rating and its uncertainty, the three parts of a margin, the rest terms, and how a margin becomes a chance. */
export function PointsRestPart() {
  const { known, altitude } = POINTS_REST;

  return (
    <Part part="points-rest" source="points_rest">
      <p>
        The second model works in points. A team&apos;s <Term>rating</Term> is how many points better than an average team it is. Next to it the
        model keeps an <Term>uncertainty</Term>: how well it knows that rating. On opening night a rating is known to about {known.opening}{' '}
        points either way, and after 40 games to about {known.afterForty}. A rating that is less certain moves more after a game.
      </p>
      <p>
        For a game, three parts add up to a <Term>margin</Term>: the number of points that the home team is expected to win by.
      </p>
      <dl className="space-y-2">
        <div>
          <dt className="font-semibold text-ink">Ratings</dt>
          <dd>The home team&apos;s rating minus the away team&apos;s.</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Home court</dt>
          <dd>
            About {OPENING_HOME_COURT.toFixed(1)} points at the start of this season. An arena that lies higher than the visitors&apos; own
            adds to it: about {altitude.denver.toFixed(1)} points in Denver and {altitude.utah.toFixed(1)} in Utah against a team from sea
            level. A neutral floor has no home court.
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Rest</dt>
          <dd>The sum of the three terms below, in points for the home team.</dd>
        </div>
      </dl>
      <Figures
        caption="The rest terms of Points & Rest"
        head={['Rest term', 'Points']}
        rows={REST_TERMS.map((term) => ({ key: term.when, name: term.when, figure: signedPoints(term.points, 2) }))}
      />
      <p>The margin becomes a chance on a bell curve. The chance is the share of the curve that lies on the home team&apos;s side.</p>
      <Formula>
        <Line>{'margin = ratings + home court'}</Line>
        <Line>{'         + rest'}</Line>
        <Line>{'total  = home variance'}</Line>
        <Line>{'         + away variance'}</Line>
        <Line>
          {'         + '}
          {POINTS_REST.noise}
          {'²'}
        </Line>
        <Line>
          {'width  = '}
          {POINTS_REST.scale}
        </Line>
        <Line>{'         × √(spread × total)'}</Line>
        <Line>{'chance = Φ(margin / width)'}</Line>
      </Formula>
      <p>
        Φ is the normal distribution. The {POINTS_REST.noise} points are the noise of a single game. A variance is an uncertainty squared, plus{' '}
        {POINTS_REST.drift} for each day since the team&apos;s last game. The spread follows how far recent results were from what the model
        expected. Near an even game on opening night, one point of margin is worth about {POINTS_REST.pointWorth} percentage points.
      </p>

      <More summary="What a result does to the two ratings">
        <p>
          Each team moves by its share of the surprise, and a team whose rating is less certain takes the larger share. The home margin is
          cut off at {POINTS_REST.cap} points either way: a blowout counts as {POINTS_REST.cap} points and no more.
        </p>
        <Formula>
          <Line>{'expected = ratings'}</Line>
          <Line>{'  + league home court'}</Line>
          <Line>{'surprise = home margin'}</Line>
          <Line>{'  − expected'}</Line>
          <Line>{'home rating += surprise'}</Line>
          <Line>{'  × home variance / total'}</Line>
          <Line>{'away rating −= surprise'}</Line>
          <Line>{'  × away variance / total'}</Line>
        </Formula>
        <p>
          The total is the one above. On opening night a rating takes about {known.openingShare} of a surprise, and after 40 games about{' '}
          {known.afterFortyShare}: each variance shrinks after a game by its square divided by the total, so a team is known a little better
          with every game it plays. The league&apos;s home court and the spread follow the results as well, slowly.
        </p>
      </More>
    </Part>
  );
}
