import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ModelRatings } from '../../data/model';
import { SAMPLE_NOW, sampleBoard, sampleModel } from '../../data/sampleData';
import { unwantedWords } from '../../display/wordRules';
import Ratings from './Ratings';

const NO_TEAMS: ReadonlySet<string> = new Set();

/** The view once the model file is here, as the browser is handed it. */
function rendered(model: ModelRatings, param: string | null = null, myTeams = NO_TEAMS): string {
  return renderToStaticMarkup(
    <Ratings model={model} board={sampleBoard()} now={SAMPLE_NOW} param={param} refreshing={false} myTeams={myTeams} />,
  );
}

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

/** The markup of the two cards: the table of the ratings and the calculator. */
function cards(html: string): { table: string; calculator: string } {
  const [, table = '', calculator = ''] = html.split('<section');
  return { table, calculator };
}

/** The heads of the columns of the first table in a piece of markup. */
function heads(html: string): string[] {
  const head = /<thead>(.*?)<\/thead>/.exec(html)?.[1] ?? '';
  return [...head.matchAll(/<th [^>]*>(.*?)<\/th>/g)].map(([, inner]) => wordsOf(inner));
}

/** The team that a select of the calculator shows as chosen. */
function chosen(html: string): string[] {
  return [...html.matchAll(/<option value="([A-Z]{3})" selected="">/g)].map(([, code]) => code);
}

/** The file as it is before the first result of the season. */
function beforeTheSeason(): ModelRatings {
  const model = sampleModel();
  model.results_through = null;
  model.games = 0;
  for (const code of Object.keys(model.teams)) {
    model.teams[code] = { wins: 0, losses: 0 };
    model.elo.ratings[code].week_ago = model.elo.ratings[code].rating;
  }
  return model;
}

/** The file of a morning on which the results did not pass the job's checks. */
function withoutPointsRest(): ModelRatings {
  return {
    ...sampleModel(),
    status: 'degraded',
    reasons: ['no result for DEN at LAC, which started at 2026-11-02T03:40:00Z (game f2699d4366ea6f7f96b4243432d380a1)'],
    points_rest: null,
  };
}

describe('the ratings of a season in progress', () => {
  const html = rendered(sampleModel());
  const { table, calculator } = cards(html);

  it('say what they rest on, under the title of the table', () => {
    expect(wordsOf(table)).toContain('Team ratings Every result on record through Sat, Nov 7 is in these ratings: 143 games of the 2026-27 season.');
    expect(html).not.toContain('These are the opening ratings');
    expect(html).not.toContain('role="note"');
  });

  it('have a table with a head for every column and a row for every team', () => {
    expect(heads(table)).toEqual(['# Place', 'Team', 'W–L Wins and losses', 'Points & Rest −15 0 +15', 'Elo', 'Week']);
    expect(table.match(/<th scope="col"/g)).toHaveLength(6);
    expect(table.match(/<th scope="row"/g)).toHaveLength(30);
    expect(wordsOf(table)).toContain('The 30 teams with their rating in both models, ranked by Points & Rest');
  });

  it('are ranked by Points & Rest, with the choice of Elo next to it', () => {
    expect(table).toMatch(/aria-pressed="true"[^>]*>Points &amp; Rest<\/button>/);
    expect(table).toMatch(/aria-pressed="false"[^>]*>Elo<\/button>/);
    // The head of the column that the table is in the order of says so to a screen reader.
    expect(table.match(/aria-sort="descending"/g)).toHaveLength(1);
    expect(table).toMatch(/<th scope="col" aria-sort="descending"[^>]*>.*?Points &amp; Rest/);
  });

  it('show a team with everything the file holds of it', () => {
    const first = wordsOf(/<tbody>(.*?)<\/tr>/.exec(table)?.[1] ?? '');

    // The code is for a phone and the name for a wider screen, and so are the two places of the wins and of the week.
    expect(first).toBe('1 OKC Oklahoma City Thunder 5–4 , 5 wins and 4 losses 5–4 5 wins and 4 losses +7.4 ±2.6 1674 4 up 4 4 up 4');
  });

  it('write a dash for a rating that did not move in a week', () => {
    const knicks = wordsOf(/<tr[^>]*><td[^>]*>2<\/td>.*?<\/tr>/.exec(table)?.[0] ?? '');

    expect(knicks).toContain('New York Knicks');
    expect(knicks).toContain('1705 – no change');
  });

  it('explain the numbers under the table', () => {
    const words = wordsOf(table);

    expect(words).toContain('Points & Rest is in points against an average team.');
    expect(words).toContain('as one standard deviation');
    expect(words).toContain('A bar runs from −15 to +15.');
    expect(words).toContain("Elo has the league's average at 1505.");
    expect(words).toContain('since a week before the last result, or since the opening rating');
    expect(words).toContain('A dash is a rating that has not moved.');
    expect(words).toContain('W–L counts the results of the season that are on record.');
  });

  it('open the calculator with the next game on the board, and get the chance that the board has', () => {
    const words = wordsOf(calculator);

    expect(chosen(calculator)).toEqual(['POR', 'CLE']);
    expect(words).toContain('POR Away 34%');
    expect(words).toContain('CLE Home 66%');
    expect(words).toContain("Elo's pick: Cleveland Cavaliers , at 66%");
    expect(words).toContain("This game is to be played on Sun, Nov 8, and Elo's chance on its card is the same number.");
  });

  it('show the three numbers as the sum they are', () => {
    const words = wordsOf(calculator);

    expect(words).toContain('Cleveland Cavaliers, at home 1604 + plus the home court 40 − minus the Portland Trail Blazers 1530 = gives the gap, in rating points 114');
    expect(words).toContain('1 / (1 + 10 −114 / 400 ) = 0.6584');
    expect(words).toContain('That is the chance of the home team, which a card shows as 66%.');
  });

  it('say what the sum leaves out', () => {
    const words = wordsOf(calculator);

    expect(words).toContain('Rest. Elo does not count it. Points & Rest does.');
    expect(words).toContain('A neutral floor. The sum always adds the home court of 40. A game on a neutral floor has none.');
    expect(words).toContain('It is not a frozen forecast. The forecast that is graded is made on the morning of its game and never changed.');
    expect(words).toContain('Points & Rest is not offered here.');
    expect(words).toContain('The file of the ratings does not hold those.');
  });

  it('offer every team for either side', () => {
    expect(calculator.match(/<select/g)).toHaveLength(2);
    expect(calculator.match(/<option /g)).toHaveLength(60);
    // Each select is named by a label of its own.
    for (const name of ['Away team', 'Home team']) {
      const id = new RegExp(`<label for="([^"]+)"[^>]*>${name}</label>`).exec(calculator)?.[1];
      expect(id, name).toBeDefined();
      expect(calculator).toContain(`<select id="${id}"`);
    }
  });
});

describe('the calculator', () => {
  it('shows the matchup that the address names', () => {
    const { calculator } = cards(rendered(sampleModel(), 'NYK-at-BOS'));
    const words = wordsOf(calculator);

    expect(chosen(calculator)).toEqual(['NYK', 'BOS']);
    // Boston at 1572 hosting New York at 1705: 1572 + 40 − 1705.
    expect(words).toContain('Boston Celtics, at home 1572');
    expect(words).toContain('= gives the gap, in rating points −93');
    expect(words).toContain('1 / (1 + 10 93 / 400 ) = 0.3693');
    expect(words).toContain("Elo's pick: New York Knicks , at 63%");
    // The two do not meet in Boston on the board of the sample.
    expect(words).not.toContain('This game is on the board');
  });

  it('opens with the next game when the address names no matchup of two teams', () => {
    for (const param of ['elo', 'NYK-at-NYK', 'SEA-at-BOS', '2026-11-07']) {
      expect(chosen(cards(rendered(sampleModel(), param)).calculator)).toEqual(['POR', 'CLE']);
    }
  });

  it('says toss-up when Elo has neither team at 52%', () => {
    // Minnesota at 1551 hosting the Clippers at 1580 is a gap of 11 points, which is 51.58%.
    const words = wordsOf(cards(rendered(sampleModel(), 'LAC-at-MIN')).calculator);

    // The two whole percents stop short of 52%, which is where a pick begins.
    expect(words).toContain('LAC Away 49%');
    expect(words).toContain('MIN Home 51%');
    expect(words).toContain('Toss-up: Elo has the home team at 51.58%, short of the 52% that makes a pick');
    expect(words).not.toContain("Elo's pick");
  });

  it('holds the sum against a board that has another chance for the game', () => {
    const board = sampleBoard();
    const game = board.games.find((entry) => entry.home === 'CLE' && entry.away === 'POR');
    if (!game) throw new Error('The sample has no game of Portland at Cleveland');
    game.elo = { p_home: 0.6049 };
    const html = renderToStaticMarkup(
      <Ratings model={sampleModel()} board={board} now={SAMPLE_NOW} param={null} refreshing={false} myTeams={NO_TEAMS} />,
    );

    expect(wordsOf(html)).toContain('and its card has Cleveland Cavaliers at 60% for Elo. That is the number that counts.');
  });
});

describe('the teams a visitor follows', () => {
  const { table } = cards(rendered(sampleModel(), null, new Set(['BOS', 'LAL'])));

  it('are marked in the table, in words as well as with a star', () => {
    const rows = [...table.matchAll(/<tr class="border-t border-line">.*?<\/tr>/g)].map(([row]) => wordsOf(row));
    const marked = rows.filter((row) => row.includes(', a team you follow'));

    expect(marked.map((row) => row.split(' ')[1])).toEqual(['LAL', 'BOS']);
    expect(wordsOf(table)).toContain('A star marks a team you follow.');
  });

  it('are not spoken of when there are none', () => {
    const words = wordsOf(cards(rendered(sampleModel())).table);

    expect(words).not.toContain('a team you follow');
    expect(words).not.toContain('A star marks');
  });
});

describe('the ratings before the season', () => {
  const html = rendered(beforeTheSeason());
  const { table } = cards(html);

  it('say that they are the opening ratings', () => {
    const words = wordsOf(html);

    expect(html).toContain('role="note"');
    expect(words).toContain('These are the opening ratings No game of the 2026-27 season is on record yet.');
    expect(words).not.toContain('Every result on record');
  });

  it('show no wins, no losses and no change of a week, because there are none yet', () => {
    expect(heads(table)).toEqual(['# Place', 'Team', 'Points & Rest −15 0 +15', 'Elo']);
    expect(table.match(/<th scope="row"/g)).toHaveLength(30);
    expect(wordsOf(table)).not.toContain('0–0');
    expect(wordsOf(table)).not.toContain('no change');
    expect(wordsOf(table)).not.toContain('W–L');
  });

  it('still rank the teams and work a matchup out', () => {
    const first = wordsOf(/<tbody>(.*?)<\/tr>/.exec(table)?.[1] ?? '');

    expect(first).toBe('1 OKC Oklahoma City Thunder +7.4 ±2.6 1674');
    expect(wordsOf(html)).toContain('The sum behind it');
  });
});

describe('the ratings of a morning on which Points & Rest is left out', () => {
  const html = rendered(withoutPointsRest());
  const { table, calculator } = cards(html);

  it('give the reasons of the file in a notice', () => {
    const words = wordsOf(html);

    expect(html).toContain('role="note"');
    expect(words).toContain('Points & Rest is left out today');
    expect(words).toContain("The results did not pass the checks of the job's last daily run.");
    expect(words).toContain(
      'What the checks found: no result for DEN at LAC, which started at 2026-11-02T03:40:00Z (game f2699d4366ea6f7f96b4243432d380a1)',
    );
  });

  it('show Elo alone, with nothing to choose the order by', () => {
    expect(heads(table)).toEqual(['# Place', 'Team', 'W–L Wins and losses', 'Elo', 'Week']);
    expect(wordsOf(table)).toContain('Ranked by Elo');
    expect(table).not.toContain('aria-pressed');
    expect(wordsOf(table)).toContain('The 30 teams with their rating in Elo, ranked by Elo');
    expect(wordsOf(/<tbody>(.*?)<\/tr>/.exec(table)?.[1] ?? '')).toBe('1 NYK New York Knicks 7–3 , 7 wins and 3 losses 7–3 7 wins and 3 losses 1705 – no change – no change');
  });

  it('explain no bar under a table that has none', () => {
    expect(wordsOf(table)).not.toContain('standard deviation');
    expect(table).not.toContain('<svg aria-hidden="true" viewBox="0 0 200 12"');
  });

  it('still work a matchup out, which needs the ratings of Elo alone', () => {
    expect(chosen(calculator)).toEqual(['POR', 'CLE']);
  });
});

describe('a file that rates no team', () => {
  it('is said to rate none', () => {
    const model = sampleModel();
    model.elo.ratings = {};
    model.points_rest = null;
    model.teams = {};

    expect(wordsOf(rendered(model))).toBe('The file rates no team The ratings appear here once the job has built the two models.');
  });
});

describe('the words of the view', () => {
  const states = [rendered(sampleModel()), rendered(sampleModel(), 'LAC-at-MIN'), rendered(beforeTheSeason()), rendered(withoutPointsRest())];

  it.each(states.map((html, index) => [index, html] as const))('in state %i are none of those that the page does without', (_index, html) => {
    const words = wordsOf(html);

    expect(unwantedWords(words)).toEqual([]);
  });

  it.each(states.map((html, index) => [index, html] as const))('in state %i carry no style of their own in the markup', (_index, html) => {
    expect(html).not.toMatch(/\sstyle=/);
  });

  it.each(states.map((html, index) => [index, html] as const))('in state %i link inside the page to a view only', (_index, html) => {
    const inside = [...html.matchAll(/<a [^>]*href="(#[^"]*)"/g)].map(([, href]) => href);

    expect(inside.length).toBeGreaterThan(0);
    for (const href of inside) expect(['#/method', '#/games']).toContain(href);
  });
});
