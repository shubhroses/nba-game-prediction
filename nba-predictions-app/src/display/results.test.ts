import { describe, expect, it } from 'vitest';
import type { Board, BoardGame } from '../data/board';
import type { DayTally } from '../data/record';
import type { ResultLine, Verdict } from '../data/results';
import { SAMPLE_NOW, sampleBoard, sampleRecord } from '../data/sampleData';
import { currentDay } from './day';
import {
  ALL_DAYS,
  dayHeading,
  dayTabs,
  emptyResults,
  neighbors,
  nextResults,
  nightName,
  resultDays,
  selection,
  tallyWords,
  type ResultDay,
  type SourceTally,
} from './results';

const SATURDAY = '2026-11-07';
const SUNDAY = '2026-11-08';

/** A game of the evening of a day, which the sportsbooks and Elo had right and the other model had no pick for. */
function line(id: string, commence_time: string, changes: Partial<ResultLine> = {}): ResultLine {
  return {
    id,
    commence_time,
    home: 'BOS',
    away: 'NYK',
    home_pts: 112,
    away_pts: 104,
    recorded_at: '2026-11-09T10:10:00Z',
    market: { p_home: 0.64, lo: 0.62, hi: 0.65, n: 3, at: '2026-11-08T22:10:00Z' },
    market_verdict: 'favorite_won',
    elo: { p_home: 0.7, published_at: '2026-11-08T10:10:00Z' },
    elo_verdict: 'favorite_won',
    points_rest: { p_home: 0.51, margin: 0.3, published_at: '2026-11-08T10:10:00Z' },
    points_rest_verdict: 'toss_up',
    ...changes,
  };
}

function game(id: string, commence_time: string): BoardGame {
  return { id, commence_time, home: 'BOS', away: 'NYK', line: null, open: null, elo: { p_home: 0.6 }, points_rest: null };
}

/** A board of the morning of Monday 9 November, with these results and these games to come. */
function board(recent_results: ResultLine[], games: BoardGame[] = [], changes: Partial<Board> = {}): Board {
  return {
    schema: 1,
    sport: 'basketball_nba',
    generated_at: '2026-11-09T10:10:30Z',
    slot: '2026-11-09T05:10-05:00',
    next_due: '2026-11-09T09:10-05:00',
    games,
    models: { results_through: SUNDAY, status: 'ok', predictions_day: '2026-11-09' },
    record: { market: { wins: 1, losses: 0 }, elo: { wins: 1, losses: 0 }, points_rest: { wins: 0, losses: 0 } },
    recent_results,
    ...changes,
  };
}

/** The board as it is before the season: games to come, and nothing that has been played. */
function preseason(games: BoardGame[]): Board {
  return board([], games, {
    generated_at: '2026-10-10T22:11:07Z',
    slot: '2026-10-10T18:10-04:00',
    next_due: '2026-10-10T21:10-04:00',
    models: { results_through: null, status: 'ok', predictions_day: null },
    record: { market: { wins: 0, losses: 0 }, elo: { wins: 0, losses: 0 }, points_rest: { wins: 0, losses: 0 } },
  });
}

const PRESEASON_NOW = Date.parse('2026-10-11T00:30:00Z');

function tallyOf(day: ResultDay, source: SourceTally['source']): SourceTally {
  const found = day.tallies.find((tally) => tally.source === source);
  if (!found) throw new Error(`no tally of ${source}`);
  return found;
}

/** A tally as the record writes the counts of a day. */
function asRecorded({ wins, losses, tossUps, notGraded }: SourceTally): DayTally {
  return { wins, losses, toss_ups: tossUps, not_graded: notGraded };
}

function tally(counts: Partial<SourceTally> = {}): SourceTally {
  return { source: 'elo', wins: 0, losses: 0, tossUps: 0, notGraded: 0, absent: null, ...counts };
}

describe('resultDays', () => {
  it('is empty for a board without a result', () => {
    expect(resultDays(board([]))).toEqual([]);
  });

  it('groups the games by their day, the newest day first', () => {
    const days = resultDays(
      board([
        line('a', '2026-11-07T00:10:00Z'),
        line('b', '2026-11-08T00:10:00Z'),
        line('c', '2026-11-08T03:40:00Z'),
        line('d', '2026-11-09T00:40:00Z'),
      ]),
    );

    expect(days.map((day) => [day.day, day.games.map((row) => row.id)])).toEqual([
      [SUNDAY, ['d']],
      [SATURDAY, ['b', 'c']],
      ['2026-11-06', ['a']],
    ]);
  });

  it('counts a game that starts after midnight in UTC with the evening it belongs to', () => {
    // 22:30 in Los Angeles on Saturday is Sunday in UTC, and a game of Saturday.
    const days = resultDays(board([line('late', '2026-11-08T06:30:00Z'), line('early', '2026-11-07T20:00:00Z')]));

    expect(days).toHaveLength(1);
    expect(days[0].day).toBe(SATURDAY);
    expect(days[0].games.map((row) => row.id)).toEqual(['early', 'late']);
  });

  it('puts the games of a day in the order they started, and those of one moment by id', () => {
    const days = resultDays(
      board([line('c', '2026-11-08T01:10:00Z'), line('b', '2026-11-08T00:10:00Z'), line('a', '2026-11-08T01:10:00Z')]),
    );

    expect(days[0].games.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('counts for each source the picks that won and lost, the toss-ups and the games not graded', () => {
    const verdicts = (market: Verdict, elo: Verdict, pointsRest: Verdict) => ({
      market_verdict: market,
      elo_verdict: elo,
      points_rest_verdict: pointsRest,
    });
    const [day] = resultDays(
      board([
        line('a', '2026-11-08T00:10:00Z', verdicts('favorite_won', 'favorite_won', 'toss_up')),
        line('b', '2026-11-08T00:40:00Z', verdicts('upset', 'favorite_won', 'upset')),
        line('c', '2026-11-08T01:10:00Z', verdicts('toss_up', 'upset', 'favorite_won')),
        line('d', '2026-11-08T01:40:00Z', { ...verdicts('not_graded', 'not_graded', 'favorite_won'), market: null }),
      ]),
    );

    expect(day.tallies.map((entry) => entry.source)).toEqual(['points_rest', 'elo', 'market']);
    expect(tallyOf(day, 'market')).toEqual({ source: 'market', wins: 1, losses: 1, tossUps: 1, notGraded: 1, absent: null });
    // Elo's forecast for the last game is there and not graded: it came too late, and Elo is not absent.
    expect(tallyOf(day, 'elo')).toEqual({ source: 'elo', wins: 2, losses: 1, tossUps: 0, notGraded: 1, absent: null });
    expect(tallyOf(day, 'points_rest')).toEqual({ source: 'points_rest', wins: 2, losses: 1, tossUps: 1, notGraded: 0, absent: null });
  });

  it('says why a source said nothing of any game of a day', () => {
    const none = { points_rest: null, points_rest_verdict: 'not_graded' } as const;
    const neither = { ...none, elo: null, elo_verdict: 'not_graded' } as const;
    const unquoted = { market: null, market_verdict: 'not_graded' } as const;
    const absentOf = (lines: ResultLine[]) => resultDays(board(lines))[0].tallies.map((entry) => entry.absent);

    // Elo alone: the other model was left out on the day.
    expect(absentOf([line('a', '2026-11-08T00:10:00Z', none), line('b', '2026-11-08T00:40:00Z', none)])).toEqual(['left-out', null, null]);
    // Neither model: the forecasts of the day were not made.
    expect(absentOf([line('a', '2026-11-08T00:10:00Z', neither)])).toEqual(['no-forecast', 'no-forecast', null]);
    // A game that the job did not know that morning, on a day on which the model was left out.
    expect(absentOf([line('a', '2026-11-08T00:10:00Z', neither), line('b', '2026-11-08T00:40:00Z', none)])).toEqual(['left-out', null, null]);
    expect(absentOf([line('a', '2026-11-08T00:10:00Z', unquoted)])).toEqual([null, null, 'no-line']);
    // One game with a forecast is enough for the model not to be absent.
    expect(absentOf([line('a', '2026-11-08T00:10:00Z', none), line('b', '2026-11-08T00:40:00Z')])).toEqual([null, null, null]);
  });
});

describe('a day that the board has cut short', () => {
  const evening = (id: string) => line(id, '2026-11-01T00:10:00Z');

  it('is whole while the eight days end before any game of the day can have started', () => {
    // The slot of 09:10 in New York, eight days on: the cut falls four hours into the day.
    const days = resultDays(board([evening('a')], [], { generated_at: '2026-11-08T14:10:30Z' }));

    expect(days[0].day).toBe('2026-10-31');
    expect(days[0].cutAt).toBeNull();
  });

  it('may be cut once the eight days end in the afternoon, and says from when', () => {
    const days = resultDays(board([evening('a')], [], { generated_at: '2026-11-08T20:10:30Z' }));

    expect(days[0].cutAt).toBe(Date.parse('2026-10-31T20:10:30Z'));
  });

  it('is whole up to the sixth hour of the day, and not after it', () => {
    const cutOf = (generated_at: string) => resultDays(board([evening('a')], [], { generated_at }))[0].cutAt;

    expect(cutOf('2026-11-08T16:00:00Z')).toBeNull();
    expect(cutOf('2026-11-08T16:00:01Z')).toBe(Date.parse('2026-10-31T16:00:01Z'));
  });

  it('is only the oldest day', () => {
    const days = resultDays(
      board([evening('a'), line('b', '2026-11-02T00:10:00Z'), line('c', '2026-11-08T00:10:00Z')], [], {
        generated_at: '2026-11-08T23:10:21Z',
      }),
    );

    expect(days.map((day) => day.cutAt !== null)).toEqual([false, false, true]);
  });
});

describe('the results of the sample by day', () => {
  const sample = sampleBoard();
  const days = resultDays(sample);
  const today = currentDay(SAMPLE_NOW);

  it('are of eight days, the newest first, with every result of the board', () => {
    expect(days.map((day) => [day.day, day.games.length])).toEqual([
      [SATURDAY, 6],
      ['2026-11-06', 9],
      ['2026-11-05', 10],
      ['2026-11-04', 7],
      ['2026-11-03', 9],
      ['2026-11-02', 6],
      ['2026-11-01', 7],
      ['2026-10-31', 6],
    ]);
    expect(days.flatMap((day) => day.games).map((row) => row.id).sort()).toEqual(sample.recent_results.map((entry) => entry.id).sort());
  });

  it('open with last night, of which each source has its count', () => {
    expect(today).toBe(SUNDAY);
    expect(dayHeading(days[0], today)).toEqual({ title: 'Last night', aside: 'Sat, Nov 7 · 6 games' });
    expect(days[0].tallies.map(tallyWords)).toEqual([
      { count: '2 of 6', what: 'picks won', rest: [] },
      { count: '2 of 6', what: 'picks won', rest: [] },
      { count: '3 of 4', what: 'picks won', rest: ['1 toss-up', '1 not graded'] },
    ]);
  });

  it('count each whole day as the record does', () => {
    const recorded = new Map(sampleRecord().by_day.map((entry) => [entry.day, entry]));

    for (const day of days.filter((entry) => entry.cutAt === null)) {
      const entry = recorded.get(day.day);

      expect(entry?.games, day.day).toBe(day.games.length);
      expect(asRecorded(tallyOf(day, 'market')), day.day).toEqual(entry?.market);
      expect(asRecorded(tallyOf(day, 'elo')), day.day).toEqual(entry?.elo);
      expect(asRecorded(tallyOf(day, 'points_rest')), day.day).toEqual(entry?.points_rest);
    }
  });

  it('say that the oldest day is cut, which the record has nine games of and the board six', () => {
    const cut = days.filter((day) => day.cutAt !== null);
    const recorded = sampleRecord().by_day.find((entry) => entry.day === '2026-10-31');

    expect(cut.map((day) => day.day)).toEqual(['2026-10-31']);
    expect(cut[0].cutAt).toBe(Date.parse('2026-10-31T23:10:21Z'));
    expect(cut[0].games).toHaveLength(6);
    expect(recorded?.games).toBe(9);
  });

  it('say that the points-and-rest model was left out on the Monday', () => {
    const monday = days.find((day) => day.day === '2026-11-02');
    if (!monday) throw new Error('The sample has no result of 2 November');

    expect(tallyWords(tallyOf(monday, 'points_rest'))).toEqual({ count: null, what: 'Left out that day', rest: ['6 not graded'] });
    expect(tallyWords(tallyOf(monday, 'elo'))).toEqual({ count: '3 of 4', what: 'picks won', rest: ['2 toss-ups'] });
    expect(days.filter((day) => day.tallies.some((entry) => entry.absent !== null))).toEqual([monday]);
  });

  it('are linked day by day, after the link to all of them', () => {
    const tabs = dayTabs(days, today);

    expect(tabs.slice(0, 3)).toEqual([
      { key: ALL_DAYS, label: 'All days', games: 60, href: '#/results' },
      { key: SATURDAY, label: 'Last night', games: 6, href: '#/results/2026-11-07' },
      { key: '2026-11-06', label: 'Fri, Nov 6', games: 9, href: '#/results/2026-11-06' },
    ]);
    expect(tabs).toHaveLength(9);
    expect(new Set(tabs.map((tab) => tab.key)).size).toBe(9);
    // The link to all of them counts the games of every day.
    expect(tabs.slice(1).reduce((games, tab) => games + tab.games, 0)).toBe(tabs[0].games);
  });

  it('are followed by the games of Sunday, whose forecasts the board carries', () => {
    expect(nextResults(sample, SAMPLE_NOW)).toBe('Next: the games of Sun, Nov 8, whose results are due on the morning of Mon, Nov 9.');
  });
});

describe('tallyWords', () => {
  it('says how many picks won, of how many', () => {
    expect(tallyWords(tally({ wins: 7, losses: 2 }))).toEqual({ count: '7 of 9', what: 'picks won', rest: [] });
    expect(tallyWords(tally({ wins: 0, losses: 3 }))).toEqual({ count: '0 of 3', what: 'picks won', rest: [] });
  });

  it('adds the games without a pick and the games not graded when there are any', () => {
    expect(tallyWords(tally({ wins: 1, losses: 1, tossUps: 1, notGraded: 2 })).rest).toEqual(['1 toss-up', '2 not graded']);
    expect(tallyWords(tally({ wins: 1, tossUps: 3 })).rest).toEqual(['3 toss-ups']);
    expect(tallyWords(tally({ wins: 1, notGraded: 1 })).rest).toEqual(['1 not graded']);
  });

  it('has no count, and never "0 of 0", for a source without a pick that was graded', () => {
    expect(tallyWords(tally({ tossUps: 2 }))).toEqual({ count: null, what: 'No pick that day', rest: ['2 toss-ups'] });
    expect(tallyWords(tally({ notGraded: 6, absent: 'left-out' }))).toEqual({ count: null, what: 'Left out that day', rest: ['6 not graded'] });
    expect(tallyWords(tally({ notGraded: 6, absent: 'no-forecast' })).what).toBe('No forecast that day');
    expect(tallyWords(tally({ source: 'market', notGraded: 1, absent: 'no-line' })).what).toBe('No line that day');
  });
});

describe('nightName', () => {
  it('calls the day before today last night', () => {
    expect(nightName(SATURDAY, SUNDAY)).toBe('Last night');
  });

  it('calls any other day by its date', () => {
    expect(nightName('2026-11-06', SUNDAY)).toBe('Fri, Nov 6');
    // Results of the day that is still being played: a run by hand in the evening, or the hour before the day turns.
    expect(nightName(SUNDAY, SUNDAY)).toBe('Sun, Nov 8');
    expect(nightName('2026-11-09', SUNDAY)).toBe('Mon, Nov 9');
  });
});

describe('dayHeading', () => {
  const [day] = resultDays(board([line('a', '2026-11-08T00:10:00Z'), line('b', '2026-11-08T00:40:00Z')]));

  it('puts the date after the title when the title is not the date', () => {
    expect(dayHeading(day, SUNDAY)).toEqual({ title: 'Last night', aside: 'Sat, Nov 7 · 2 games' });
  });

  it('does not say the date twice', () => {
    expect(dayHeading(day, '2026-11-10')).toEqual({ title: 'Sat, Nov 7', aside: '2 games' });
  });

  it('counts one game as one game', () => {
    const [single] = resultDays(board([line('a', '2026-11-08T00:10:00Z')]));

    expect(dayHeading(single, '2026-11-10').aside).toBe('1 game');
  });
});

describe('selection', () => {
  const days = resultDays(board([line('a', '2026-11-06T00:10:00Z'), line('b', '2026-11-08T00:10:00Z')]));

  it('shows every day when the address names none', () => {
    expect(selection(null, days)).toEqual({ day: null, problem: null });
  });

  it('shows a day alone when the board has results of it', () => {
    expect(selection(SATURDAY, days)).toEqual({ day: SATURDAY, problem: null });
    expect(selection('2026-11-05', days)).toEqual({ day: '2026-11-05', problem: null });
  });

  it.each(['yesterday', '2026-11-7', '2026-02-30', '07/11/2026', '<b>', '2026-11-07/extra', ''])(
    'shows every day for "%s", which is not a day',
    (param) => {
      expect(selection(param, days)).toEqual({ day: null, problem: 'The address does not name a day, so every day is shown.' });
    },
  );

  it('says that a later day has no result yet', () => {
    expect(selection('2026-11-09', days)).toEqual({
      day: null,
      problem: 'There is no result of Mon, Nov 9 yet. A result is recorded on the morning after its game.',
    });
  });

  it('says that the results of an earlier day are no longer shown', () => {
    expect(selection('2026-10-20', days)).toEqual({
      day: null,
      problem: 'The results of Tue, Oct 20 are no longer shown here. This view keeps a result for eight days, and the record counts every game.',
    });
  });

  it('says no more than that of a day between two days with results', () => {
    expect(selection('2026-11-06', days)).toEqual({ day: null, problem: 'There is no result of Fri, Nov 6.' });
  });

  it('says that there is no result yet when the board has none at all', () => {
    expect(selection('2026-10-20', []).problem).toBe(
      'There is no result of Tue, Oct 20 yet. A result is recorded on the morning after its game.',
    );
  });
});

describe('neighbors', () => {
  const days = resultDays(
    board([line('a', '2026-11-06T00:10:00Z'), line('b', '2026-11-07T00:10:00Z'), line('c', '2026-11-08T00:10:00Z')]),
  );

  it('are the day before and the day after, as the links of the view name them', () => {
    expect(neighbors(days, '2026-11-06', SUNDAY)).toEqual({
      earlier: { key: '2026-11-05', label: 'Thu, Nov 5', games: 1, href: '#/results/2026-11-05' },
      later: { key: SATURDAY, label: 'Last night', games: 1, href: '#/results/2026-11-07' },
    });
  });

  it('have no later day after the newest, and no earlier day before the oldest', () => {
    expect(neighbors(days, SATURDAY, SUNDAY)).toMatchObject({ earlier: { key: '2026-11-06' }, later: null });
    expect(neighbors(days, '2026-11-05', SUNDAY)).toMatchObject({ earlier: null, later: { key: '2026-11-06' } });
  });

  it('pass over a day without a game, to the next day that the board has results of', () => {
    const gapped = resultDays(board([line('a', '2026-11-04T00:10:00Z'), line('c', '2026-11-08T00:10:00Z')]));

    expect(neighbors(gapped, SATURDAY, SUNDAY).earlier?.key).toBe('2026-11-03');
  });

  it('are none for a day that the board has no result of', () => {
    expect(neighbors(days, '2026-10-20', SUNDAY)).toEqual({ earlier: null, later: null });
    expect(neighbors([], SATURDAY, SUNDAY)).toEqual({ earlier: null, later: null });
  });
});

describe('nextResults', () => {
  const NOW = Date.parse('2026-11-09T15:00:00Z');
  const last = line('a', '2026-11-09T00:10:00Z');

  it('names the first day after the newest result that the board has a game of', () => {
    const coming = board([last], [game('x', '2026-11-11T00:10:00Z'), game('y', '2026-11-12T00:10:00Z')], {
      models: { results_through: SUNDAY, status: 'ok', predictions_day: null },
    });

    expect(nextResults(coming, NOW)).toBe('Next: the games of Tue, Nov 10, whose results are due on the morning of Wed, Nov 11.');
  });

  it('counts the day whose forecasts are frozen, whose games may all have left the board', () => {
    expect(nextResults(board([last], [game('x', '2026-11-11T00:10:00Z')]), NOW)).toBe(
      'Next: the games of Mon, Nov 9, whose results are due on the morning of Tue, Nov 10.',
    );
  });

  it('says of a day that is over that its games have no result yet', () => {
    // Tuesday morning, and the results of Monday were not recorded.
    const tuesday = Date.parse('2026-11-10T15:00:00Z');

    expect(nextResults(board([last], [game('x', '2026-11-11T00:10:00Z')]), tuesday)).toBe('The games of Mon, Nov 9 have no result yet.');
  });

  it('does not take a game of a day that already has results for the next one', () => {
    // A game that was put off stays on the board with its old start until the provider moves it.
    const stale = board([last], [game('old', '2026-11-08T23:10:00Z')], {
      models: { results_through: SUNDAY, status: 'ok', predictions_day: SUNDAY },
    });

    expect(nextResults(stale, NOW)).toBeNull();
  });

  it('is nothing when the board knows no later game', () => {
    expect(nextResults(board([last], [], { models: null }), NOW)).toBeNull();
  });
});

describe('emptyResults', () => {
  it('says before the season that there is no result yet, and when the first is due', () => {
    const opening = preseason([game('b', '2026-10-21T23:30:00Z'), game('a', '2026-10-20T23:30:00Z'), game('c', '2026-12-25T17:00:00Z')]);

    expect(emptyResults(opening, PRESEASON_NOW)).toEqual({
      title: 'No result yet',
      text: 'A result appears here on the morning after its game. The first games to come are those of Tue, Oct 20, and their results are due on the morning of Wed, Oct 21.',
    });
  });

  it('says so on opening night as well, while the first games are played', () => {
    const openingNight = Date.parse('2026-10-21T02:00:00Z');

    expect(emptyResults(preseason([game('a', '2026-10-20T23:30:00Z')]), openingNight).text).toContain(
      'those of Tue, Oct 20, and their results are due on the morning of Wed, Oct 21.',
    );
  });

  it('says that the first games have no result yet once their day is over', () => {
    const morningAfter = Date.parse('2026-10-21T15:00:00Z');

    expect(emptyResults(preseason([game('a', '2026-10-20T23:30:00Z')]), morningAfter)).toEqual({
      title: 'No result yet',
      text: 'A result appears here on the morning after its game. The games of Tue, Oct 20 have no result yet.',
    });
  });

  it('names no day when the board has no game either', () => {
    expect(emptyResults(preseason([]), PRESEASON_NOW)).toEqual({
      title: 'No result yet',
      text: 'A result appears here on the morning after its game.',
    });
  });

  it('holds for a board from before the models, which has neither their fields nor a record', () => {
    const bare = { ...preseason([game('a', '2026-10-20T23:30:00Z')]), models: null, record: null };

    expect(emptyResults(bare, PRESEASON_NOW).title).toBe('No result yet');
  });

  it('says during the season that the last eight days have no result, and which games come next', () => {
    const afterTheBreak = board([], [game('a', '2027-02-19T00:10:00Z')], {
      generated_at: '2027-02-17T15:10:30Z',
      models: { results_through: '2027-02-08', status: 'ok', predictions_day: null },
    });

    expect(emptyResults(afterTheBreak, Date.parse('2027-02-17T15:30:00Z'))).toEqual({
      title: 'No results in the last eight days',
      text: 'This view keeps a result for eight days after its game. Next: the games of Thu, Feb 18, whose results are due on the morning of Fri, Feb 19.',
    });
  });

  it('takes a record with a pick in it as a sign that the season has begun', () => {
    const started = { ...preseason([]), record: { market: { wins: 0, losses: 1 }, elo: null, points_rest: null } };

    expect(emptyResults(started, PRESEASON_NOW).title).toBe('No results in the last eight days');
  });
});
