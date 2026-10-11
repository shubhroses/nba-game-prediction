/**
 * The record view as a visitor gets it, drawn to text without a browser: the
 * sample season, the record before the first game, the morning after opening
 * night, and the first week. The numbers of each part are tested with the
 * functions of src/display. These tests hold the page as a whole to its
 * rules: the order of its parts, the words it may not use, what stands next
 * to what, and markup that the Content-Security-Policy of the site allows.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SeasonRecord } from '../../data/record';
import { SAMPLE_NOW, sampleBoard, sampleRecord } from '../../data/sampleData';
import { bandsOf, modelScorecard, recordDay, recordedGame, scorecard, seasonRecord } from '../../display/recordExamples';
import BoardTallies from './BoardTallies';
import { unwantedWords } from '../../display/wordRules';
import Season from './Season';

const BEFORE_THE_SEASON = Date.parse('2026-10-10T23:30:00Z');

function drawn(record: SeasonRecord, now = SAMPLE_NOW): string {
  return renderToStaticMarkup(<Season record={record} board={sampleBoard()} now={now} refreshing={false} />);
}

function plain(markup: string): string {
  return markup
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Everything a visitor can read or hear: the text of the page, and what its pictures and marks are called. */
function wordsOf(markup: string): string {
  const named = [...markup.matchAll(/\s(?:aria-label|title|alt)="([^"]*)"/g)].map((match) => match[1]);
  const pointedAt = [...markup.matchAll(/<title>([^<]*)<\/title>/g)].map((match) => match[1]);
  const text = markup.replace(/<title>[^<]*<\/title>/g, ' ').replace(/<[^>]+>/g, ' ');
  return plain([text, ...named, ...pointedAt].join(' ')).replace(/\s+/g, ' ');
}

/** The headings of the page in order, each as its level and its text. */
function headings(markup: string): [number, string][] {
  return [...markup.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/g)].map((match) => [
    Number(match[1]),
    plain(match[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
  ]);
}

/** The morning after opening night: six games, graded for the sportsbooks, and no forecast of either model for them. */
function afterOpeningNight(): SeasonRecord {
  return seasonRecord({
    since: '2026-10-20',
    games: 6,
    market: scorecard({
      games: 5,
      wins: 2,
      losses: 3,
      accuracy: 0.4,
      accuracy_interval: [0.1176, 0.7693],
      toss_ups: 1,
      with_line: 6,
      brier: 0.2681,
      log_loss: 0.7312,
      bands: bandsOf([[2, 1, 0.5612], [2, 1, 0.6433], [1, 0, 0.7969]]),
      biggest_upsets: [{ ...recordedGame(), favorite: 'DEN', p_favorite: 0.7969 }],
    }),
    elo: modelScorecard({ not_graded: 6 }),
    points_rest: modelScorecard({ not_graded: 6 }),
    baseline_home: { games: 6, wins: 3 },
    by_day: [
      recordDay('2026-10-20', 6, {
        market: { wins: 2, losses: 3, toss_ups: 1, not_graded: 0 },
        elo: { wins: 0, losses: 0, toss_ups: 0, not_graded: 6 },
        points_rest: { wins: 0, losses: 0, toss_ups: 0, not_graded: 6 },
      }),
    ],
  });
}

/** The first week: every source has picks, none has 30, and four forecasts of Elo were published too late. */
function firstWeek(): SeasonRecord {
  const picks = { games: 20, wins: 12, losses: 8, accuracy: 0.6, accuracy_interval: [0.3866, 0.7812] as [number, number] };
  const scores = { with_line: 24, toss_ups: 4, brier: 0.2301, log_loss: 0.6512 };
  return seasonRecord({
    since: '2026-10-20',
    games: 28,
    market: scorecard({ ...picks, ...scores, with_line: 28, toss_ups: 8 }),
    elo: modelScorecard({
      ...picks,
      ...scores,
      not_graded: 4,
      late: 4,
      brier_against_market: { games: 24, difference: 0.0123, interval: null },
      picks_against_market: {
        differ: 1,
        model_right: 0,
        market_right: 1,
        latest: [{ ...recordedGame(), pick: 'DEN', market_pick: 'DAL', right: 'market' }],
      },
    }),
    points_rest: modelScorecard({ ...picks, ...scores, not_graded: 4 }),
    baseline_home: { games: 28, wins: 16 },
    by_day: [recordDay('2026-10-20', 6), recordDay('2026-10-21', 8), recordDay('2026-10-22', 7), recordDay('2026-10-23', 7)],
  });
}

const STATES: [string, () => string][] = [
  ['the sample season', () => drawn(sampleRecord())],
  ['the record before the first game', () => drawn(seasonRecord(), BEFORE_THE_SEASON)],
  ['a record without a game after opening night', () => drawn(seasonRecord(), SAMPLE_NOW)],
  ['the morning after opening night', () => drawn(afterOpeningNight())],
  ['the first week', () => drawn(firstWeek())],
  ['a sport that is not forecast', () => drawn(seasonRecord({ ...afterOpeningNight(), elo: null, points_rest: null }))],
];

describe.each(STATES)('the record view for %s', (_state, draw) => {
  const markup = draw();
  const words = wordsOf(markup);

  it('uses none of the words that the page keeps away from', () => {
    // Betting talk, a claim to win, and names for the models, for the sportsbooks and for a chance that the page does not use.
    expect(unwantedWords(words)).toEqual([]);
  });

  it('calls every interval a 95% interval', () => {
    for (const [before] of [...words.matchAll(/(\S+)\s+interval/gi)].map((match) => [match[1]])) {
      expect(['95%', 'whole', 'an', 'no', 'The', 'the']).toContain(before);
    }
  });

  it('is markup that the Content-Security-Policy of the site allows', () => {
    expect(markup).not.toMatch(/\sstyle=/);
    expect(markup).not.toMatch(/<style|<script|javascript:/i);
  });

  it('has its headings in order, never a level skipped on the way down', () => {
    const levels = headings(markup).map(([level]) => level);

    // The heading of the view is an h2, so the first heading here is an h3.
    expect(levels.length === 0 || levels[0] === 3).toBe(true);
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('gives every table a name, a head with a scope for each column and a head for each row', () => {
    const tables = [...markup.matchAll(/<table[\s\S]*?<\/table>/g)].map((match) => match[0]);

    for (const table of tables) {
      expect(table).toMatch(/<caption/);
      const [head, body] = table.split('<tbody');
      expect(head).toMatch(/<th scope="col"/);
      expect(head).not.toMatch(/<th(?=[\s>])(?! scope="col")/);
      const rows = [...body.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((match) => match[0]);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toMatch(/^<tr[^>]*><th scope="row"/);
    }
  });

  it('names the sources in the order of the page wherever it names more than one', () => {
    const order = ['Points & Rest', 'Elo', 'Sportsbooks'];
    const sections = markup.split(/<section/).slice(1);

    for (const section of sections) {
      const named = headings(section)
        .filter(([level, text]) => level === 4 && order.includes(text))
        .map(([, text]) => text);

      expect(named).toEqual(order.filter((name) => named.includes(name)));
    }
  });
});

describe('the record view for the sample season', () => {
  const markup = drawn(sampleRecord());
  const words = wordsOf(markup);

  it('has its six parts in order', () => {
    expect(headings(markup).filter(([level]) => level === 3).map(([, text]) => text)).toEqual([
      'Picks won and lost',
      'Against the sportsbooks',
      'Calibration',
      'Day by day',
      'Biggest upsets',
      'How to read this',
    ]);
  });

  it('gives every share of wins on a scorecard the picks it is of, and its interval', () => {
    expect(words).toContain('72–44 picks won and lost 62.1% of 116 picks');
    expect(words).toContain('73–43 picks won and lost 62.9% of 116 picks');
    expect(words).toContain('83–48 picks won and lost 63.4% of 131 picks');
    expect(words).toContain('95% interval 53.0% to 70.4%');
    expect(words).toContain('56.6% 81 of 143 games');
  });

  it('draws each interval where its numbers are', () => {
    // Points & Rest: 62.07% of its picks won, from 52.99% to 70.38%, on a track of 200 units from 0% to 100%.
    expect(markup).toContain('<rect x="105.98" width="34.78"');
    expect(markup).toContain('x1="124.14"');
    // Elo against the sportsbooks: +0.0067, from −0.0128 to +0.0270, on a track from −0.03 to +0.03.
    expect(markup).toContain('<rect x="57.33" width="132.67"');
    expect(markup).toContain('x1="122.33"');
    // The games with different picks: seven for the model and eight for the sportsbooks.
    expect(markup).toContain('<rect x="0" width="92.33"');
    expect(markup).toContain('<rect x="94.33" width="105.67"');
  });

  it('shows no figure of the backtest next to the record of the season', () => {
    expect(words).not.toMatch(/backtest/i);
    expect(words).not.toContain('2,643');
    expect(words).not.toContain('67.6%');
    expect(words).not.toContain('0.6031');
  });

  it('has no notice about small numbers, because every source has more than 30 picks', () => {
    expect(words).not.toContain('These numbers will swing');
  });

  it('says next to the comparison that the two numbers are not of the same moment', () => {
    // Each scorecard names the section in its small print, so the section is found by its heading.
    const [, against] = markup.split(/<h3[^>]*>Against the sportsbooks<\/h3>/);

    expect(wordsOf(against.split('<article')[0])).toContain(
      "Not forecasts of the same moment A model's chance is from the morning of the game. " +
        "The sportsbooks' line is from the last snapshot before the start, hours later",
    );
    expect(words.match(/No difference can be told/g)).toHaveLength(2);
  });

  it('draws a chart for each source and gives its numbers as a table under it', () => {
    const [, calibration] = markup.split(/<h3[^>]*>Calibration<\/h3>/);
    const cards = calibration
      .split('<article')
      .slice(1, 4)
      .map((card) => card.split('</article>')[0]);

    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card.indexOf('<svg role="img"')).toBeGreaterThan(-1);
      expect(card.indexOf('<table')).toBeGreaterThan(card.indexOf('<svg role="img"'));
      expect([...card.matchAll(/<circle/g)]).toHaveLength(5);
      expect([...card.split('<tbody')[1].matchAll(/<tr/g)]).toHaveLength(5);
    }
  });

  it('links a day to its results only while the board holds them', () => {
    expect(markup).toContain('href="#/results/2026-11-07"');
    expect(markup).toContain('href="#/results/2026-10-31"');
    expect(markup).not.toContain('href="#/results/2026-10-30"');
  });
});

describe('the record view before the first game', () => {
  const markup = drawn(seasonRecord(), BEFORE_THE_SEASON);
  const words = wordsOf(markup);

  it('says that the record starts with opening night, and shows nothing of a season that has no game', () => {
    expect(words).toContain('The record starts with opening night');
    expect(words).toContain('The regular season opens on Tue, Oct 20.');
    for (const part of ['Picks won and lost', 'Against the sportsbooks', 'Calibration', 'Day by day', 'Biggest upsets']) {
      expect(words).not.toContain(part);
    }
    expect(words).not.toContain('0–0');
    expect(words).not.toContain('These numbers will swing');
  });

  it('shows the backtest under it, set apart and labeled as no result of this season', () => {
    expect(markup.indexOf('The record starts with opening night')).toBeLessThan(markup.indexOf('<section'));
    expect(headings(markup)[0]).toEqual([3, 'Before the first game: the backtest']);
    expect(words).toContain(
      'Backtest A backtest on 2,643 games of 2024-25 and 2025-26, with no odds in it. It is not a result of this season.',
    );
  });

  it('shows the three rows of the backtest, each share with the games it is of', () => {
    expect(headings(markup).filter(([level]) => level === 4).map(([, text]) => text)).toEqual([
      'Points & Rest',
      'Elo',
      "The home team every time at last season's home-win rate",
    ]);
    expect(words).toContain('Winners picked 67.6% 1,786 of 2,643 games 95% interval 65.8% to 69.3%');
    expect(words).toContain('Winners picked 66.7% 1,762 of 2,643 games 95% interval 64.9% to 68.4%');
    expect(words).toContain('Winners picked 55.0% of 2,643 games Log loss 0.6881 Brier score 0.2475');
  });

  it('carries the two cautions, and does not say that one model picks more winners than the other', () => {
    expect(words).toContain('It is not shown that Points & Rest picks more winners than Elo.');
    expect(words).toContain('Neither model was tested against the sportsbooks.');
    expect(words.replace('It is not shown that Points & Rest picks more winners than Elo.', '')).not.toMatch(/more winners/);
  });

  it('says no more than that no result has come in once opening night is past', () => {
    const late = wordsOf(drawn(seasonRecord(), SAMPLE_NOW));

    expect(late).toContain('No result has been recorded yet');
    expect(late).not.toContain('The record starts with opening night');
    expect(late).not.toContain('The regular season opens on');
  });
});

describe('the record view on the morning after opening night', () => {
  const words = wordsOf(drawn(afterOpeningNight()));

  it('says that these numbers will swing, and for which sources', () => {
    expect(words).toContain(
      'These numbers will swing Fewer than 30 picks have been graded for Points & Rest (0), Elo (0) and Sportsbooks (5).',
    );
  });

  it('shows no share and no score for a model that was not graded on a game', () => {
    expect(words.match(/No pick has been graded yet, so there is no share of wins to show\./g)).toHaveLength(2);
    expect(words.match(/Brier score None yet Log loss None yet/g)).toHaveLength(2);
    expect(words.match(/Nothing to compare yet/g)).toHaveLength(2);
    expect(words.match(/The two have not picked different winners in a game yet\./g)).toHaveLength(2);
    expect(words).toContain('No pick of Points & Rest has been graded yet.');
  });

  it('still shows what the sportsbooks did', () => {
    expect(words).toContain('2–3 picks won and lost 40.0% of 5 picks');
    expect(words).toContain('95% interval 11.8% to 76.9%');
  });
});

describe('the record view in the first week', () => {
  const words = wordsOf(drawn(firstWeek()));

  it('reads nothing into a difference that has no interval yet', () => {
    expect(words).toContain('Too few games to tell');
    expect(words).toContain('Difference +0.0123 , over 24 games with a chance from both.');
    expect(words).not.toContain('No difference can be told');
  });

  it('says how many forecasts were published too late', () => {
    expect(words).toContain('Not graded no forecast in time, 4 published too late 4');
    expect(words).toContain('Not graded no forecast in time, 0 published too late 4');
  });
});

describe('the record view of a sport that is not forecast', () => {
  const markup = drawn(seasonRecord({ ...afterOpeningNight(), elo: null, points_rest: null }));

  it('shows the sportsbooks alone, and nothing to hold them against', () => {
    expect(headings(markup).filter(([level]) => level === 3).map(([, text]) => text)).toEqual([
      'Picks won and lost',
      'Calibration',
      'Day by day',
      'Biggest upsets',
      'How to read this',
    ]);
    expect(headings(markup).filter(([level]) => level === 4).map(([, text]) => text)).toEqual([
      'Sportsbooks',
      'The home team every time',
      'Sportsbooks',
      'Sportsbooks',
    ]);
  });
});

describe('what stands in for the record when its file cannot be shown', () => {
  it('is the picks won and lost that the board carries, and it says where they are from', () => {
    const words = wordsOf(renderToStaticMarkup(<BoardTallies board={sampleBoard()} />));

    expect(words).toContain('The file of the games carries these two numbers for each source, and nothing else of the record.');
    expect(words).toContain('Points & Rest 72–44 picks won and lost');
    expect(words).toContain('Elo 73–43 picks won and lost');
    expect(words).toContain('Sportsbooks 83–48 picks won and lost');
    // A share of wins is not among them: the board does not carry one.
    expect(words).not.toContain('%');
  });

  it('is nothing before a pick has been graded', () => {
    const none = { wins: 0, losses: 0 };
    const board = { ...sampleBoard(), record: { market: none, elo: none, points_rest: none } };

    expect(renderToStaticMarkup(<BoardTallies board={board} />)).toBe('');
  });
});
