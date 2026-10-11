import { describe, expect, it } from 'vitest';
// The documentation of the job, read as text: the page must name the same opening day.
import readme from '../../../pipeline/README.md?raw';
import { parseRecord } from '../data/record';
import { sampleBoard, sampleRecord } from '../data/sampleData';
import {
  boardTallies,
  FEW_PICKS,
  fewPicks,
  fewPicksNote,
  finalScore,
  modelCards,
  noRecordYet,
  OPENING_DAY,
  recordedDate,
  recordedDay,
  seasonLine,
  sourceCards,
} from './record';
import { modelScorecard, recordDay, recordedGame, scorecard, seasonRecord } from './recordExamples';

describe('the record before the first game, as the tests build it', () => {
  it('passes the shape check of the page as it is', () => {
    const record = seasonRecord();

    expect(parseRecord(record)).toEqual({ ok: true, value: record });
  });
});

describe('sourceCards', () => {
  it('lists the two models and then the sportsbooks, each with its scorecard', () => {
    const record = sampleRecord();
    const cards = sourceCards(record);

    expect(cards.map(({ source }) => source.name)).toEqual(['Points & Rest', 'Elo', 'Sportsbooks']);
    expect(cards.map(({ card }) => card)).toEqual([record.points_rest, record.elo, record.market]);
    expect(modelCards(record).map(({ source }) => source.name)).toEqual(['Points & Rest', 'Elo']);
  });

  it('has the sportsbooks alone in a sport that is not forecast', () => {
    const record = seasonRecord({ elo: null, points_rest: null });

    expect(sourceCards(record).map(({ source }) => source.key)).toEqual(['market']);
    expect(modelCards(record)).toEqual([]);
  });
});

describe('seasonLine', () => {
  it('says how many games the record is of, since when, and which day is the latest', () => {
    expect(seasonLine(sampleRecord())).toBe('143 games since Tue, Oct 20, the latest on Sat, Nov 7.');
  });

  it('names one day when the record is of one', () => {
    const record = seasonRecord({ since: '2026-10-20', games: 1, by_day: [recordDay('2026-10-20', 1)] });

    expect(seasonLine(record)).toBe('1 game since Tue, Oct 20.');
  });

  it('says nothing before the first game', () => {
    expect(seasonLine(seasonRecord())).toBeNull();
  });
});

describe('noRecordYet', () => {
  it('takes the opening day that the job replays the season from', () => {
    expect(readme).toContain("the season's first day, 20 October 2026");
    expect(OPENING_DAY).toBe('2026-10-20');
  });

  it('says before the season that the record starts with opening night, and on which day that is', () => {
    const tenDaysBefore = noRecordYet(Date.parse('2026-10-10T23:30:00Z'));

    expect(tenDaysBefore.title).toBe('The record starts with opening night');
    expect(tenDaysBefore.text).toContain('The regular season opens on Tue, Oct 20.');
    expect(tenDaysBefore.text).toContain('graded on the morning after');
  });

  it('still says so on opening night, whose games are graded the next morning', () => {
    // 22:30 in New York on Tuesday 20 October, and the last hour of that day as the job counts it.
    expect(noRecordYet(Date.parse('2026-10-21T02:30:00Z')).title).toBe('The record starts with opening night');
    expect(noRecordYet(Date.parse('2026-10-21T09:59:59Z')).title).toBe('The record starts with opening night');
  });

  it('does not speak of opening night once it is past and no result has come in', () => {
    const after = noRecordYet(Date.parse('2026-10-21T10:00:00Z'));

    expect(after.title).toBe('No result has been recorded yet');
    expect(after.text).toBe('A result is recorded on the morning after its game, and the record starts with the first one.');
  });
});

describe('fewPicks', () => {
  it('names nobody in the sample, where every source has more than a hundred picks', () => {
    expect(FEW_PICKS).toBe(30);
    expect(fewPicks(sampleRecord())).toEqual([]);
    expect(fewPicksNote(fewPicks(sampleRecord()))).toBeNull();
  });

  it('names every source with fewer than 30 graded picks, with how many it has', () => {
    const record = seasonRecord({
      games: 40,
      market: scorecard({ games: 34, wins: 20, losses: 14 }),
      elo: modelScorecard({ games: 29, wins: 17, losses: 12 }),
      points_rest: modelScorecard({ games: 30, wins: 18, losses: 12 }),
    });

    expect(fewPicks(record).map(({ source, picks }) => [source.name, picks])).toEqual([['Elo', 29]]);
    expect(fewPicksNote(fewPicks(record))).toBe(
      'Fewer than 30 picks have been graded for Elo (29). ' +
        'The games of one evening can still move a share of wins by several points, which is what the wide 95% intervals say.',
    );
  });

  it('counts a model that has not been graded on a game yet, as after opening night', () => {
    const record = seasonRecord({
      games: 6,
      market: scorecard({ games: 5, wins: 2, losses: 3, toss_ups: 1 }),
      elo: modelScorecard({ not_graded: 6 }),
      points_rest: modelScorecard({ not_graded: 6 }),
    });

    expect(fewPicksNote(fewPicks(record))).toContain('for Points & Rest (0), Elo (0) and Sportsbooks (5).');
  });

  it('goes by the picks and not by the games recorded', () => {
    const record = seasonRecord({ games: 200, market: scorecard({ games: 12, wins: 6, losses: 6, toss_ups: 188 }) });

    expect(fewPicks(record).find(({ source }) => source.key === 'market')?.picks).toBe(12);
  });
});

describe('boardTallies', () => {
  it('gives the picks won and lost of each source as the board carries them, in the order of the page', () => {
    expect(boardTallies(sampleBoard()).map(({ source, tally }) => [source.name, tally])).toEqual([
      ['Points & Rest', '72–44'],
      ['Elo', '73–43'],
      ['Sportsbooks', '83–48'],
    ]);
  });

  it('agrees with the record of the sample', () => {
    const record = sampleRecord();

    expect(boardTallies(sampleBoard()).map(({ tally }) => tally)).toEqual(
      sourceCards(record).map(({ card }) => `${card.wins}–${card.losses}`),
    );
  });

  it('has nothing to fall back on before a pick has been graded, as with the board of 10 October', () => {
    const board = sampleBoard();
    const none = { wins: 0, losses: 0 };

    expect(boardTallies({ ...board, record: { market: none, elo: none, points_rest: none } })).toEqual([]);
    expect(boardTallies({ ...board, record: null })).toEqual([]);
  });

  it('shows the sportsbooks alone in a sport that is not forecast', () => {
    const board = { ...sampleBoard(), record: { market: { wins: 3, losses: 1 }, elo: null, points_rest: null } };

    expect(boardTallies(board).map(({ source, tally }) => [source.key, tally])).toEqual([['market', '3–1']]);
  });

  it('keeps a source that has no graded pick yet next to one that has', () => {
    const none = { wins: 0, losses: 0 };
    const board = { ...sampleBoard(), record: { market: { wins: 2, losses: 3 }, elo: none, points_rest: none } };

    expect(boardTallies(board).map(({ tally }) => tally)).toEqual(['0–0', '0–0', '2–3']);
  });
});

describe('a game that the record names', () => {
  it('is of the day its evening belongs to', () => {
    // 21:10 in New York on Wednesday 21 October, which is Thursday in UTC.
    expect(recordedDay(recordedGame())).toBe('Wed, Oct 21');
    expect(recordedDate(recordedGame())).toBe('Oct 21');
    expect(recordedDate(recordedGame({ commence_time: '2026-12-26T01:10:00Z' }))).toBe('Dec 25');
  });

  it('is written with the winner first, whichever side that was', () => {
    expect(finalScore(recordedGame())).toBe('DAL 110, DEN 101');
    expect(finalScore(recordedGame({ home_pts: 112, away_pts: 104 }))).toBe('DEN 112, DAL 104');
  });
});
