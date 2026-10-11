import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SAMPLE_NOW, sampleBoard, sampleModel, samplePredictions } from '../../data/sampleData';
import { forecastGame, gameCardView, type GameCardView } from '../../display/gameCard';
import { gamesView, NO_FILTERS, type GamesView } from '../../display/games';
import { unwantedWords } from '../../display/wordRules';
import GameCard from './index';
import StartedCard from './StartedCard';

const NEW_YORK = 'America/New_York';
const NOBODY: ReadonlySet<string> = new Set();

/** The view of the sample on one of its days, as a preview shows it. */
function sample(param: string | null = null): GamesView {
  return gamesView({
    board: sampleBoard(),
    now: SAMPLE_NOW,
    param,
    files: { model: sampleModel(), predictions: samplePredictions('2026-11-08') },
    myTeams: NOBODY,
    filters: NO_FILTERS,
    timeZone: NEW_YORK,
  });
}

function named(cards: readonly GameCardView[], title: string): GameCardView {
  const found = cards.find((card) => card.title === title);
  if (!found) throw new Error(`The sample has no card for ${title}`);
  return found;
}

/** The card as the page would write it into the document. */
function drawn(card: GameCardView, myTeams: ReadonlySet<string> = NOBODY): string {
  return renderToStaticMarkup(<GameCard card={card} myTeams={myTeams} onToggleTeam={() => {}} />);
}

/** The words of a piece of markup, without its tags. */
function wordsOf(markup: string): string {
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the bars of a card say to a screen reader, in order. */
function bars(markup: string): string[] {
  return [...markup.matchAll(/role="img" aria-label="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
}

const cleveland = named(sample().upcoming, 'Portland Trail Blazers at Cleveland Cavaliers');
const chicago = named(sample('2026-11-10').upcoming, 'Sacramento Kings at Chicago Bulls');

describe('GameCard', () => {
  it('is an article with the game as its heading and the start as a time', () => {
    const markup = drawn(cleveland);

    expect(markup).toMatch(/^<article /);
    expect(markup).toContain('<h4 class="sr-only">Portland Trail Blazers at Cleveland Cavaliers</h4>');
    expect(markup).toContain('<time dateTime="2026-11-09T00:10:00Z">7:10 PM EST</time>');
  });

  it('leads with the chance of the model, marks the pick and the home team, and says where the chance is from', () => {
    const words = wordsOf(drawn(cleveland));

    expect(words).toContain('Portland Trail Blazers 40% Cleveland Cavaliers Pick home 60% Points & Rest, made this morning');
    expect(words.match(/\bPick\b/g)).toHaveLength(1);
    // The one tag under the name of the second team. "Home court" in the text below is another matter.
    expect(words.match(/\bhome\b(?! court)/g)).toHaveLength(1);
    expect(words).toContain('Different picks');
  });

  it('has the three sources under each other, with a bar that says each of them in words', () => {
    const markup = drawn(cleveland);

    expect(bars(markup)).toEqual([
      'Points & Rest: Cleveland Cavaliers 60%',
      'Elo: Cleveland Cavaliers 66%',
      'Sportsbooks: Portland Trail Blazers 59%',
    ]);
    expect(wordsOf(markup)).toContain('Sportsbooks POR 59% Median of 6 sportsbooks, POR 58% to 60%');
    expect(wordsOf(markup)).toContain('Points & Rest and Elo pick Cleveland, the sportsbooks pick Portland.');
  });

  it('draws no bar for a source without a number, and says why in its place', () => {
    const markup = drawn(chicago);

    expect(bars(markup)).toEqual(['Elo: Chicago Bulls 63%', 'Sportsbooks: Sacramento Kings 58%']);
    expect(wordsOf(markup)).toContain('Points & Rest Morning of the game');
    expect(wordsOf(markup)).toContain('Elo, early look: the full forecast comes on the morning of the game');
  });

  it('has a star for each team, which says whether the team is followed', () => {
    const stars = (markup: string) => [...markup.matchAll(/<button type="button" aria-pressed="(true|false)" aria-label="([^"]+)"/g)];

    expect(stars(drawn(cleveland)).map((star) => [star[2], star[1]])).toEqual([
      ['Follow the Portland Trail Blazers', 'false'],
      ['Follow the Cleveland Cavaliers', 'false'],
    ]);
    expect(stars(drawn(cleveland, new Set(['CLE']))).map((star) => star[1])).toEqual(['false', 'true']);
  });

  it('opens to say how each number is made, in a details element that works without a script', () => {
    const markup = drawn(cleveland);

    expect(markup).toMatch(/<details[^>]*><summary[^>]*>(?:<span[^>]*>)*How these numbers are made/);
    expect(wordsOf(markup)).toContain(
      'Points & Rest Cleveland by 2.8 = ratings +1.52, home court +1.26, rest 0.00. ' +
        'This expected margin is a number to compare games by, not a point spread.',
    );
    expect(wordsOf(markup)).toContain('Elo Ratings: Portland 1530, Cleveland 1604. Home court adds 40 rating points for Cleveland.');
    // The calculator of the Rankings view does the sum of those ratings.
    expect(markup).toContain('<a href="#/rankings/POR-at-CLE"');
  });

  it('names the game in the line that opens and in the link to the calculator, for a screen reader that lists them', () => {
    const words = wordsOf(drawn(cleveland));

    expect(words).toContain('How these numbers are made for Portland Trail Blazers at Cleveland Cavaliers');
    expect(words).toContain('See the sum in the matchup calculator for Portland Trail Blazers at Cleveland Cavaliers');
    // The names are for a screen reader alone: the card shows them once, above.
    expect(drawn(cleveland)).toContain('<span class="sr-only"> for Portland Trail Blazers at Cleveland Cavaliers</span>');
  });

  it('does not call the second team the home team on a neutral floor', () => {
    const mexicoCity = samplePredictions('2026-11-07').games.find((game) => game.neutral);
    if (!mexicoCity) throw new Error('The sample has no game on a neutral floor');
    const words = wordsOf(drawn(gameCardView(forecastGame(mexicoCity), NEW_YORK)));

    expect(words).toContain('· neutral floor');
    expect(words).not.toMatch(/\bhome\b(?! court)/);
  });

  it('shows no percentage for a game that no source has a number for', () => {
    const unknown = gameCardView(
      {
        ...forecastGame(samplePredictions('2026-11-08').games[0]),
        pointsRest: null,
        missing: 'not-built',
        elo: null,
        eloInputs: null,
        line: null,
      },
      NEW_YORK,
    );
    const words = wordsOf(drawn(unknown));

    expect(words).not.toContain('%');
    expect(words).toContain('No forecast and no line yet');
    expect(bars(drawn(unknown))).toEqual([]);
  });
});

describe('StartedCard', () => {
  const detroit = named(sample().started, 'Los Angeles Clippers at Detroit Pistons');
  const markup = renderToStaticMarkup(<StartedCard card={detroit} />);

  it('says that the game has started, and when', () => {
    expect(markup).toContain('<h4 class="sr-only">Los Angeles Clippers at Detroit Pistons</h4>');
    expect(wordsOf(markup)).toContain('Started 6:00 PM EST');
  });

  it('has the three sources of that morning, and says when the sportsbooks’ number is from', () => {
    expect(bars(markup)).toEqual([
      'Points & Rest: toss-up, Los Angeles Clippers 50%',
      'Elo: Detroit Pistons 53%',
      'Sportsbooks: Detroit Pistons 60%',
    ]);
    // The forecasts file holds the line of 21:10 in New York on the evening before.
    expect(wordsOf(markup)).toContain('Sportsbooks DET 60% as of Sat 9:10 PM');
    expect(wordsOf(markup)).toContain('Points & Rest is 10 percentage points lower on Detroit than the sportsbooks were as of Sat 9:10 PM.');
    expect(wordsOf(markup)).toContain('Toss-up');
  });

  it('has nothing to press', () => {
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<details');
  });

  it('does not say started of a game that the latest snapshot no longer lists', () => {
    const unlisted = wordsOf(renderToStaticMarkup(<StartedCard card={detroit} unlisted />));

    expect(unlisted).toContain('Was set for 6:00 PM EST');
    expect(unlisted).not.toContain('Started');
  });
});

describe('every card of the sample', () => {
  const days = sample().days.map((chip) => sample(chip.day));
  const markups = days.flatMap((day) => [
    ...day.upcoming.map((card) => drawn(card)),
    ...day.started.map((card) => renderToStaticMarkup(<StartedCard card={card} />)),
  ]);

  it('is drawn', () => {
    // The 26 games on the board and the two of Sunday that have left it.
    expect(markups).toHaveLength(28);
  });

  it('carries no style of its own, which the Content-Security-Policy of the page would refuse', () => {
    expect(markups.filter((markup) => /\sstyle=/.test(markup))).toEqual([]);
  });

  it('is worded plainly: no word of betting advice and none that oversells the models', () => {
    expect(markups.map(wordsOf).flatMap(unwantedWords)).toEqual([]);
  });

  it('writes no number that is not one', () => {
    expect(markups.map(wordsOf).filter((words) => /NaN|undefined|null|Infinity/.test(words))).toEqual([]);
  });
});
