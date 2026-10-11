/**
 * The view as a whole, written out as markup the way a server would and read
 * as text. The logic of what a game and a day show is tested in src/display.
 * These tests hold the view to what it must have on the page in each state:
 * the sample season, one day of it, an address that names no such day, the
 * states that the sample does not have, and the board from before the season.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Board } from '../../data/board';
import { SAMPLE_NOW, sampleBoard } from '../../data/sampleData';
import { unwantedWords } from '../../display/wordRules';
import Results from './index';

function markup(board: Board, param: string | null = null, now = SAMPLE_NOW): string {
  return renderToStaticMarkup(<Results board={board} now={now} refreshing={false} param={param} />);
}

/** How often a piece of markup is found. */
function count(html: string, piece: string): number {
  return html.split(piece).length - 1;
}

/** The words of the page, without its markup. */
function words(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

/** The board as it is before the season: games to come, and nothing that has been played. */
function preseason(): Board {
  const board = sampleBoard();
  return {
    ...board,
    generated_at: '2026-10-10T22:11:07Z',
    slot: '2026-10-10T18:10-04:00',
    next_due: '2026-10-10T21:10-04:00',
    games: board.games.slice(0, 3).map((game, index) => ({
      ...game,
      commence_time: `2026-10-2${index}T23:30:00Z`,
      points_rest: null,
    })),
    models: { results_through: null, status: 'ok', predictions_day: null },
    record: { market: { wins: 0, losses: 0 }, elo: { wins: 0, losses: 0 }, points_rest: { wins: 0, losses: 0 } },
    recent_results: [],
  };
}

const PRESEASON_NOW = Date.parse('2026-10-11T00:30:00Z');

describe('the results of the sample season', () => {
  const html = markup(sampleBoard());
  const text = words(html);

  it('have a card with its details for each of the 60 games, under one heading for each of the eight days', () => {
    expect(count(html, '<article')).toBe(60);
    expect(count(html, '<details')).toBe(60);
    expect([...html.matchAll(/<section aria-label="Results of ([^"]+)"/g)].map(([, day]) => day)).toEqual([
      'Sat, Nov 7',
      'Fri, Nov 6',
      'Thu, Nov 5',
      'Wed, Nov 4',
      'Tue, Nov 3',
      'Mon, Nov 2',
      'Sun, Nov 1',
      'Sat, Oct 31',
    ]);
  });

  it('open with last night and a tile for each source', () => {
    expect(text).toContain('Last night Sat, Nov 7 · 6 games Points & Rest 2 of 6 picks won Elo 2 of 6 picks won Sportsbooks 3 of 4');
    expect(text).toContain('picks won · 1 toss-up · 1 not graded');
    // The tiles are of the first day only, and each has its bar.
    expect(count(html, 'preserveAspectRatio="none"')).toBe(3);
  });

  it('give each earlier day its three counts in one line', () => {
    expect(count(text, 'Picks won Points & Rest')).toBe(7);
    expect(text).toContain('Fri, Nov 6 9 games Picks won Points & Rest 6 of 9 Elo 6 of 9 Sportsbooks 7 of 9');
    expect(text).toContain('Mon, Nov 2 6 games Picks won Points & Rest left out that day Elo 3 of 4 Sportsbooks 4 of 6');
  });

  it('show both teams of a game with the final score, and each source with what it said and its mark', () => {
    expect(html).toContain('<article aria-label="Milwaukee Bucks at Atlanta Hawks"');
    expect(text).toContain('MIL at ATL Final Milwaukee Bucks 105 , won Atlanta Hawks 96 Points & Rest ATL 62% Wrong');
    expect(text).toContain('Upset Sportsbooks had Atlanta at 58%');
    expect(text).toContain('Models split Points & Rest had Houston, Elo had Orlando');
  });

  it('put the winner in bold and set the loser back', () => {
    // The line of one team, from its opening tag to its score, with the logo in between.
    const teamLine = (classes: string, name: string, points: number) =>
      new RegExp(`<div class="flex items-center gap-2 ${classes}">(?:(?!<div)[\\s\\S])*?>${name}</span><span class="text-base">${points}<`);

    expect(html).toMatch(teamLine('font-bold text-ink', 'Milwaukee Bucks', 105));
    expect(html).toMatch(teamLine('text-muted', 'Atlanta Hawks', 96));
    expect(html).not.toMatch(teamLine('font-bold text-ink', 'Atlanta Hawks', 96));
    // A screen reader hears who won, which the eye takes from the weight.
    expect(count(text, ', won')).toBe(60);
  });

  it('say plainly why a source has no pick or is not graded', () => {
    expect(text).toContain('Sportsbooks — Not graded No line before the start');
    expect(text).toContain('Points & Rest — Not graded Left out that day');
    expect(text).toContain('Sportsbooks Toss-up No pick');
  });

  it('name the game on the line that opens its details, for a screen reader', () => {
    expect(text).toContain('Details of Milwaukee Bucks at Atlanta Hawks');
    expect(count(html, '<summary')).toBe(60);
  });

  it('hold in the details of a game what its result line holds', () => {
    expect(html.toLowerCase()).toContain('<time datetime="2026-11-07t20:23:28z">');
    expect(text).toContain('Expected margin Atlanta by 3.5 points Final margin Milwaukee by 9 points');
    expect(text).toContain('It is the median of 5 sportsbooks, which had Atlanta from 57.4% to 58.9%.');
    expect(count(text, 'counts a blowout as 22 points')).toBe(54);
  });

  it('say that the oldest day is cut, and of that day only', () => {
    expect(count(text, 'This view keeps a result for eight days')).toBe(1);
    expect(html.toLowerCase()).toContain('<time datetime="2026-10-31t23:10:21.000z">');
  });

  it('link every day, say what comes next and end with the way to the record', () => {
    expect(html).toContain('<nav aria-label="Days"');
    expect(html).toContain('href="#/results" aria-current="true"');
    expect(count(html, 'href="#/results/2026-')).toBe(8);
    // Each link says how many games it leads to.
    expect(text).toContain('All days 60 games Last night 6 games Fri, Nov 6 9 games');
    expect(text).toContain('Next: the games of Sun, Nov 8, whose results are due on the morning of Mon, Nov 9.');
    expect(html.lastIndexOf('href="#/record"')).toBeGreaterThan(html.lastIndexOf('</article>'));
    expect(text).toContain('See the full record');
    // The games to come are one tab away, and the link to them is for the view without a result.
    expect(html).not.toContain('href="#/games"');
  });

  it('has its headings in order under the heading of the view', () => {
    const levels = [...html.matchAll(/<h(\d)/g)].map(([, level]) => Number(level));

    expect(levels[0]).toBe(2);
    expect(levels.filter((level) => level === 2)).toHaveLength(1);
    expect(levels.filter((level) => level === 3)).toHaveLength(8);
    expect(levels.every((level, index) => index === 0 || level - levels[index - 1] <= 1)).toBe(true);
  });

  it('use none of the words that the page keeps away from, and nothing that is not a word', () => {
    expect(unwantedWords(text)).toEqual([]);
    expect(text).not.toMatch(/undefined|null|NaN|\[object/);
    expect(text).not.toMatch(/\b0 of 0\b/);
  });

  it('sets no style on an element, which the Content-Security-Policy would refuse', () => {
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe('the results once the board of a new morning is here, before the day by the clock has turned', () => {
  // Half past nine UTC on Sunday: the clock's day is still Saturday, and the board carries the forecasts of Sunday.
  const text = words(markup(sampleBoard(), null, Date.parse('2026-11-08T09:30:00Z')));

  it('call the evening before last night, and say what comes next', () => {
    expect(text).toContain('All days 60 games Last night 6 games Fri, Nov 6 9 games');
    expect(text).toContain('Last night Sat, Nov 7 · 6 games');
    expect(text).toContain('Next: the games of Sun, Nov 8, whose results are due on the morning of Mon, Nov 9.');
  });
});

describe('the results of one day', () => {
  const html = markup(sampleBoard(), '2026-11-02');
  const text = words(html);

  it('are shown alone, with a tile for each source', () => {
    expect(count(html, '<section aria-label="Results of')).toBe(1);
    expect(count(html, '<article')).toBe(6);
    expect(text).toContain('Mon, Nov 2 6 games Points & Rest — Left out that day · 6 not graded Elo 3 of 4 picks won · 2 toss-ups Sportsbooks 4 of 6');
    expect(text).not.toContain('Picks won Points & Rest');
  });

  it('lead on to the day before and to the day after, and back to every day', () => {
    expect(html).toContain('<nav aria-label="The day before and the day after"');
    expect(text).toContain('← The day before: Sun, Nov 1 7 games → The day after: Tue, Nov 3 9 games');
    expect(text).toContain('See all days See the full record');
    // The newest day has no day after it, and with every day in sight there is nothing to lead on to.
    expect(words(markup(sampleBoard(), '2026-11-07'))).toContain('← The day before: Fri, Nov 6 9 games One night is a handful of games');
    expect(markup(sampleBoard())).not.toContain('The day before');
    expect(words(markup(sampleBoard()))).not.toContain('See all days');
  });

  it('mark the day among the links, and leave what comes next to the newest day', () => {
    expect(html).toContain('href="#/results/2026-11-02" aria-current="true"');
    expect(html).not.toContain('href="#/results" aria-current="true"');
    expect(text).not.toContain('Next:');
    expect(words(markup(sampleBoard(), '2026-11-07'))).toContain('Next: the games of Sun, Nov 8');
  });
});

describe('an address that names no day with results', () => {
  it.each([
    ['2026-10-20', 'The results of Tue, Oct 20 are no longer shown here.'],
    ['2026-11-30', 'There is no result of Mon, Nov 30 yet.'],
    ['<script>', 'The address does not name a day, so every day is shown.'],
  ])('shows every day for %s and says why', (param, sentence) => {
    const html = markup(sampleBoard(), param);

    expect(words(html)).toContain(sentence);
    expect(html).toContain('role="note"');
    expect(count(html, '<article')).toBe(60);
    expect(html).toContain('href="#/results" aria-current="true"');
    // What the visitor typed is not written back to them.
    expect(html).not.toContain('script');
  });
});

describe('the states that the sample does not have', () => {
  const board = sampleBoard();
  const last = board.recent_results.length - 1;
  const late = board.recent_results[last];
  const unknown = board.recent_results[last - 1];
  late.elo = { p_home: 0.6961, published_at: late.commence_time };
  late.elo_verdict = 'not_graded';
  unknown.elo = null;
  unknown.elo_verdict = 'not_graded';
  unknown.points_rest = null;
  unknown.points_rest_verdict = 'not_graded';
  const text = words(markup(board));

  it('show a forecast that came too late, and say that it does not count', () => {
    expect(text).toContain('Elo PHX 70% Too late to count Published too late to count');
    expect(text).toContain('It was published at or after the start of the game, so it does not count.');
  });

  it('say of a game without a forecast that it has none', () => {
    expect(text).toContain('Points & Rest — Not graded No forecast for this game Elo — Not graded No forecast for this game');
    expect(text).toContain('There is no forecast for this game: the forecasts of its day were not made, or were made without it.');
  });

  it('count both as not graded on the tile', () => {
    expect(text).toContain('Elo 1 of 4 picks won · 2 not graded');
  });
});

describe('the view before the season', () => {
  const html = markup(preseason(), null, PRESEASON_NOW);
  const text = words(html);

  it('says that there is no result yet, when results appear and when the first is due', () => {
    expect(text).toContain('No result yet');
    expect(text).toContain('A result appears here on the morning after its game.');
    expect(text).toContain('The first games to come are those of Tue, Oct 20, and their results are due on the morning of Wed, Oct 21.');
  });

  it('has no game, no day to link and no count, and leads on to the games and to the record', () => {
    expect(count(html, '<article')).toBe(0);
    expect(html).not.toContain('<nav');
    expect(text).not.toMatch(/\d+ of \d+/);
    expect(html).toContain('href="#/games"');
    expect(html).toContain('href="#/record"');
  });

  it('is the same whatever the address asks for', () => {
    expect(markup(preseason(), '2026-10-20', PRESEASON_NOW)).toBe(html);
  });
});
