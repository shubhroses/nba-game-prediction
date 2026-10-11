import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
// The document of the two models, read as text: what the page says of Elo is said there.
import readme from '../../../../pipeline/model/README.md?raw';
import { BACKTEST } from '../../display/backtest';
import { LINKS } from '../../display/links';
import { METHOD_PARTS, partAnchor } from '../../display/method';
import { unwantedWords } from '../../display/wordRules';
import Method from './index';

/** The view as the browser is handed it. It reads no file, so it is the same whatever the board holds. */
const HTML = renderToStaticMarkup(<Method />);

/** The words of a piece of markup, as a visitor reads them. */
function wordsOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const WORDS = wordsOf(HTML);

/** The titles of the parts, in the order they are in. */
function titles(): string[] {
  return [...HTML.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(([, inner]) => wordsOf(inner));
}

/** The markup of one part, from its title to the title of the next one. */
function part(title: string): string {
  const all = titles();
  const starts = [...HTML.matchAll(/<h3[^>]*>/g)].map((match) => match.index);
  const index = all.indexOf(title);
  if (index < 0) throw new Error(`The view has no part called ${title}`);
  return HTML.slice(starts[index], starts[index + 1] ?? HTML.length);
}

/** Where every link of the view leads. */
function links(): string[] {
  return [...HTML.matchAll(/<a [^>]*href="([^"]*)"/g)].map(([, href]) => href);
}

describe('the How it works view', () => {
  it('has its parts in the order a visitor needs them', () => {
    expect(titles()).toEqual([
      'What this page is',
      'Elo',
      'Points & Rest',
      'Frozen on the morning of the game',
      'How a forecast is graded',
      'What the models cannot know',
      'The backtest',
      'Where the numbers come from',
      'Read more',
    ]);
  });

  it('names every part in a row of buttons at its top, each of which has a part to lead to', () => {
    const row = /<nav aria-label="On this page"[^>]*>(.*?)<\/nav>/.exec(HTML)?.[1] ?? '';
    const buttons = [...row.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/g)].map(([, inner]) => wordsOf(inner));

    expect(buttons).toEqual(['This page', 'Elo', 'Points & Rest', 'Frozen forecasts', 'Grading', 'Limits', 'Backtest', 'Sources', 'Read more']);
    expect(titles()).toEqual(METHOD_PARTS.map((entry) => entry.title));
    for (const { id } of METHOD_PARTS) expect(HTML.match(new RegExp(` id="${partAnchor(id)}"`, 'g'))).toHaveLength(1);
    // A button, because a link to a part would change the address, and the address after the # is the route.
    expect(row).not.toContain('<a ');
  });

  it('says what the models go by and what they do not', () => {
    const intro = wordsOf(part('What this page is'));

    expect(intro).toContain('two models of its own');
    expect(intro).toContain('the schedule and the final scores of the season so far, and nothing else');
    expect(intro).toContain('no injuries, no line-ups, no trades and no odds');
    expect(intro).toContain("The sportsbooks' line is the yardstick");
    expect(intro).toContain('what the sportsbooks say about the same game: their line');
    // The three sources in the order of the page.
    expect(intro.indexOf('Points & Rest A rating in points')).toBeGreaterThan(0);
    expect(intro.indexOf('Elo One rating')).toBeGreaterThan(intro.indexOf('Points & Rest A rating in points'));
    expect(intro.indexOf('Sportsbooks The median')).toBeGreaterThan(intro.indexOf('Elo One rating'));
  });

  it('works the game of the README through for Elo, with the constants', () => {
    const elo = wordsOf(part('Elo'));

    expect(elo).toContain("Boston, at 1607, hosts New York, at 1720. Boston's gap is 1607 + 40 − 1720 = −73");
    expect(elo).toContain('1 / (1 + 10 73/400 ) = 0.3965');
    expect(elo).toContain('which a card shows as 40%');
    expect(elo).toContain('The multiplier is 11 0.8 / (7.5 − 0.006 × 73) = 0.9642, so Boston gains 20 × 0.9642 × (1 − 0.3965) = 11.64 points');
    expect(elo).toContain('K, which sets how far one result moves a rating 20');
    expect(elo).toContain('Home court, which a neutral floor does not have 40');
    expect(elo).toContain("The league's average 1505");
    expect(elo).toContain('between two seasons 25%');
  });

  it('says whose method Elo is, and which of its constants are not its own', () => {
    expect(wordsOf(part('Elo'))).toContain(
      "The method is the one that FiveThirtyEight used for its NBA ratings, and three of the four constants are FiveThirtyEight's as well. " +
        'The home court is not: FiveThirtyEight gave the home team 100 points.',
    );
    // The document of the models, which is where the page has it from.
    expect(readme).toContain('The method is the one FiveThirtyEight used for its NBA ratings.');
    expect(readme).toContain("| K | 20 | FiveThirtyEight's. |");
    expect(readme).toContain("| Mean | 1505 | FiveThirtyEight's. |");
    expect(readme).toContain("| Reversion between seasons | 25% | FiveThirtyEight's. |");
    expect(readme).toContain('| Home court | 40 | FiveThirtyEight used 100.');
  });

  it('draws the formula of Elo as a curve, and says in words what the drawing shows', () => {
    const elo = part('Elo');

    expect(elo).toContain(
      `<svg role="img" aria-label="The home team&#x27;s chance for every gap: 9% at a gap of −400, 24% at a gap of −200, 50% at a gap of 0, 76% at a gap of +200 and 91% at a gap of +400."`,
    );
    expect(wordsOf(elo)).toContain('In the shaded band, from 48% to 52%, Elo has no pick: that is a gap of fewer than 14 points to either side.');
    // The labels of the drawing are text of the page, and a screen reader has the sentence above in their place.
    expect(elo).toMatch(/<div aria-hidden="true"[^>]*><span>100%<\/span><span>50%<\/span><span>0%<\/span><\/div>/);
  });

  it('gives the three parts of a margin and the rest terms of Points & Rest', () => {
    const points = wordsOf(part('Points & Rest'));

    expect(points).toContain("Ratings The home team's rating minus the away team's.");
    expect(points).toContain('margin = ratings + home court + rest total = home variance + away variance + 12²');
    expect(points).toContain('Home court About 1.1 points at the start of this season');
    expect(points).toContain('The home team played yesterday −1.35');
    expect(points).toContain('The away team played yesterday +1.71');
    expect(points).toContain('Each game more that the home team played in the last seven days −0.32');
    expect(points).toContain('chance = Φ(margin / width)');
    expect(points).toContain('known to about 3.1 points either way, and after 40 games to about 2.2');
  });

  it('gives the rule that a forecast is graded by', () => {
    const grading = wordsOf(part('How a forecast is graded'));

    expect(grading).toContain('A pick is the side that a source puts at 52% or more');
    expect(grading).toContain('Between 48% and 52% it has no pick: the game is a toss-up');
  });

  it('shows no figure of the backtest outside the part that is labeled as one', () => {
    const outside = wordsOf(HTML.replace(part('The backtest'), ' '));
    const scored = BACKTEST.rows.flatMap((row) => [row.winners, row.logLoss, row.brier]);
    const figures = [
      ...scored.map(({ figure }) => figure),
      ...scored.flatMap(({ interval }) => interval?.split(' to ') ?? []),
      ...BACKTEST.rows.flatMap((row) => row.winners.games ?? []),
      BACKTEST.games,
      BACKTEST.coinFlip.logLoss,
    ];

    expect(figures).toHaveLength(25);
    for (const figure of figures) expect(outside, figure).not.toContain(figure);
  });

  it('labels the backtest where it shows the figures of it', () => {
    const backtest = part('The backtest');

    expect(wordsOf(backtest)).toContain('A backtest on 2,643 games of 2024-25 and 2025-26, with no odds in it. It is not a result of this season.');
    // The label is the first line of the box that holds the figures, so the two cannot be taken apart.
    expect(backtest).toMatch(/<div class="overflow-hidden rounded-xl border border-line"><p[^>]*><span[^>]*>Backtest<\/span><span[^>]*>A backtest on 2,643 games/);
    expect(backtest.indexOf('A backtest on 2,643 games')).toBeLessThan(backtest.indexOf('67.6%'));
  });

  it('gives a share of wins with the number of games it is of, and calls an interval a 95% interval', () => {
    const backtest = wordsOf(part('The backtest'));

    expect(backtest).toContain('Winners picked 67.6% 1,786 of 2,643 games 95% interval 65.8% to 69.3%');
    expect(backtest).toContain('Winners picked 66.7% 1,762 of 2,643 games 95% interval 64.9% to 68.4%');
    expect(backtest).toContain('The home team every time at last season\'s home-win rate Winners picked 55.0% of 2,643 games');
    // Six intervals in the box and one in the text under it, and each of them is called what it is.
    expect(backtest.match(/[\d.]+%? to [\d.]+%?/g)).toHaveLength(7);
    expect(backtest.match(/95% interval (?:from )?[\d.]+%? to [\d.]+%?/g)).toHaveLength(7);
  });

  it('breaks an interval of the box between its name and its two ends, and gives it the width of its row on a phone', () => {
    // Each of the two is a box, so a line that is too long breaks between them before it parts the two ends.
    const lines = [
      ...part('The backtest').matchAll(
        /<dd class="([^"]*)"><span class="inline-block">95% interval<\/span> <span class="inline-block">([^<]*)<\/span><\/dd>/g,
      ),
    ];

    expect(lines.map(([, , ends]) => ends)).toEqual([
      '65.8% to 69.3%',
      '0.5890 to 0.6175',
      '0.2020 to 0.2145',
      '64.9% to 68.4%',
      '0.5919 to 0.6212',
      '0.2032 to 0.2161',
    ]);
    // On a phone the name of a figure and the figure share a line, and the line under them has the width of the row.
    for (const [, classes] of lines) expect(classes.split(' ')).toContain('w-full');
  });

  it('does not hold the name of a model in the box to one line, where large text would reach out of the box', () => {
    const names = [...part('The backtest').matchAll(/<h4[^>]*><span class="([^"]*)"><span[^>]*><\/span>([^<]*)<\/span>/g)];

    expect(names.map(([, , name]) => name.replace(/\s/g, ' '))).toEqual(['Points &amp; Rest', 'Elo']);
    for (const [, classes] of names) expect(classes.split(' ')).not.toContain('whitespace-nowrap');
  });

  it('says what the backtest does not show', () => {
    const backtest = wordsOf(part('The backtest'));

    expect(backtest).toContain('It is not shown that Points & Rest picks more winners than Elo.');
    expect(backtest).toContain('the 95% interval of the difference runs from 1 game fewer to 49 more');
    expect(backtest).toContain('Neither model was tested against the sportsbooks.');
    expect(backtest).toContain('The record counts a pick from 52% on, so its shares of wins are not the same kind of number as these.');
  });

  it('names the provider of the odds in words and does not link to it', () => {
    // The host is put together here, so that this file does not hold it either.
    const host = ['the', 'odds', 'api'].join('-');

    expect(wordsOf(part('Where the numbers come from'))).toContain('come through The Odds API, six times a day. No price is published.');
    expect(HTML.toLowerCase()).not.toContain(host);
    expect(links().filter((href) => /odds/i.test(href))).toEqual([]);
  });

  it('credits the ratings of FiveThirtyEight under their license', () => {
    const sources = part('Where the numbers come from');

    expect(wordsOf(sources)).toContain('the NBA Elo ratings that FiveThirtyEight published');
    expect(wordsOf(sources)).toContain('carried through the 3,962 games of the three seasons since');
    expect(sources).toContain(`<a href="${LINKS.license}"`);
    expect(wordsOf(sources)).toContain('Creative Commons Attribution 4.0 International License');
  });

  it('links the ratings of FiveThirtyEight to where they are published', () => {
    const sources = part('Where the numbers come from');

    expect(sources).toMatch(
      new RegExp(`<a href="${LINKS.fiveThirtyEight}"[^>]*>the NBA Elo ratings that FiveThirtyEight published</a>`),
    );
  });

  it('links to the two documents and to the data branch', () => {
    const readMore = part('Read more');

    for (const href of [LINKS.models, LINKS.job, LINKS.data]) expect(readMore).toContain(`<a href="${href}"`);
  });

  it('links inside the page to a view only, because the address after the # is the route', () => {
    const inside = links().filter((href) => href.startsWith('#'));

    expect(inside).toEqual(['#/record', '#/rankings/NYK-at-BOS', '#/record', '#/record']);
  });

  it('uses none of the words that the page does without, and never says that a model does better than the sportsbooks', () => {
    expect(unwantedWords(WORDS)).toEqual([]);
  });

  it('carries no style of its own in the markup, which the Content-Security-Policy would refuse', () => {
    expect(HTML).not.toMatch(/\sstyle=/);
  });
});
