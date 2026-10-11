import { describe, expect, it } from 'vitest';
import type { Board, BoardModels } from '../data/board';
import { SAMPLE_NOW, sampleBoard } from '../data/sampleData';
import { gamesIntro, NO_RECORD_YET, OWN_PICKS, recordSummary, recordTiles } from './gamesIntro';

/** The board of the sample, on the evening of Sunday 8 November, with other words on what its forecasts rest on. */
function boardWith(models: BoardModels | null): Board {
  return { ...sampleBoard(), models };
}

describe('gamesIntro', () => {
  it('says through which day the ratings have the results, and that the forecasts of today are frozen', () => {
    expect(gamesIntro(sampleBoard(), SAMPLE_NOW)).toEqual({
      sentences: ['Ratings include every result on record through Sat, Nov 7.', "Today's forecasts were made this morning and do not change."],
      leftOut: null,
    });
  });

  it('says that both models are on their opening ratings before the first result of the season', () => {
    // The board of today, ten days before opening night.
    const preseason = boardWith({ results_through: null, status: 'ok', predictions_day: null });

    expect(gamesIntro(preseason, Date.parse('2026-10-11T00:30:00Z'))).toEqual({
      sentences: [
        'Both models are still on their opening ratings, because no game of the season is on record yet.',
        "Until the morning of a game, its card shows Elo's early look.",
      ],
      leftOut: null,
    });
  });

  it('says both on opening day: the ratings are the opening ones and the forecasts of the day are made', () => {
    const openingDay = boardWith({ results_through: null, status: 'ok', predictions_day: '2026-10-20' });

    expect(gamesIntro(openingDay, Date.parse('2026-10-20T16:00:00Z')).sentences).toEqual([
      'Both models are still on their opening ratings, because no game of the season is on record yet.',
      "Today's forecasts were made this morning and do not change.",
    ]);
  });

  it('says that nothing is built yet before the models have been built once', () => {
    expect(gamesIntro(boardWith(null), SAMPLE_NOW)).toEqual({
      sentences: ["The models have not made a forecast yet, so a card shows the sportsbooks' line alone."],
      leftOut: null,
    });
  });

  it('does not call the forecasts of yesterday those of today', () => {
    // Monday at six in the morning in New York: the page's day has turned, and the board is still the one of Sunday evening.
    const monday = Date.parse('2026-11-09T11:00:00Z');

    expect(gamesIntro(sampleBoard(), monday).sentences).toEqual([
      'Ratings include every result on record through Sat, Nov 7.',
      "Until the morning of a game, its card shows Elo's early look.",
    ]);
  });

  it('goes by the board once the daily work is done, in the fifty minutes before the day by the clock turns', () => {
    // 05:30 in New York while it is on daylight saving time: the forecasts of Wednesday are made, and the clock's day turns at 06:00.
    const early = boardWith({ results_through: '2026-10-20', status: 'ok', predictions_day: '2026-10-21' });

    expect(gamesIntro(early, Date.parse('2026-10-21T09:30:00Z')).sentences).toEqual([
      'Ratings include every result on record through Tue, Oct 20.',
      "Today's forecasts were made this morning and do not change.",
    ]);
  });

  it('speaks of the results on record, because the day of the last result does not say that none before it is missing', () => {
    // On a degraded day a result can be missing, and the board gives the same day of the last result.
    const degraded = boardWith({ results_through: '2026-11-07', status: 'degraded', predictions_day: '2026-11-08' });

    expect(gamesIntro(degraded, SAMPLE_NOW).sentences[0]).toBe('Ratings include every result on record through Sat, Nov 7.');
  });

  it('says so when the morning of the day has come and no forecast is frozen for its games', () => {
    // Sunday evening after a morning on which the daily work was not done: the models are still those of Saturday morning.
    const noRun: Board = {
      ...boardWith({ results_through: '2026-11-06', status: 'ok', predictions_day: '2026-11-07' }),
      games: sampleBoard().games.map((game) => ({ ...game, points_rest: null })),
    };

    expect(gamesIntro(noRun, SAMPLE_NOW).sentences).toEqual([
      'Ratings include every result on record through Fri, Nov 6.',
      "No forecast is frozen for today's games: their cards show Elo from its current ratings, and the models are graded on frozen forecasts only.",
      "Until the morning of a game, its card shows Elo's early look.",
    ]);
  });

  it('does not say it of a day without a game on the board, or before the board has seen the morning of the day', () => {
    const noRun = boardWith({ results_through: '2026-11-06', status: 'ok', predictions_day: '2026-11-07' });
    const noGameToday: Board = { ...noRun, games: noRun.games.filter((game) => game.commence_time >= '2026-11-09T10:00:00Z') };
    // Monday at six in the morning in New York, with the board of Sunday evening: the morning of Monday's games is not on it.
    const monday = Date.parse('2026-11-09T11:00:00Z');

    expect(gamesIntro(noGameToday, SAMPLE_NOW).sentences).toHaveLength(2);
    expect(gamesIntro({ ...noRun, games: sampleBoard().games.map((game) => ({ ...game, points_rest: null })) }, monday).sentences).toHaveLength(2);
  });

  it('warns that the points-and-rest model is left out when the results did not pass the checks', () => {
    const degraded = boardWith({ results_through: '2026-11-07', status: 'degraded', predictions_day: '2026-11-08' });
    const intro = gamesIntro(degraded, SAMPLE_NOW);

    expect(intro.leftOut).toEqual({
      title: 'Points & Rest is left out today',
      text:
        "The results on record did not pass this morning's checks, so the forecasts were made without it. " +
        'Elo is shown alone until they pass again.',
    });
    // The rest is said all the same.
    expect(intro.sentences).toHaveLength(2);
  });
});

describe('recordTiles', () => {
  it('has a tile for each source, in the order of the page, with the wins and the losses of its picks', () => {
    expect(recordTiles(sampleBoard())).toEqual([
      { source: 'points_rest', wins: 72, losses: 44, record: '72–44' },
      { source: 'elo', wins: 73, losses: 43, record: '73–43' },
      { source: 'market', wins: 83, losses: 48, record: '83–48' },
    ]);
  });

  it('has none until the daily work has been recorded once', () => {
    expect(recordTiles({ ...sampleBoard(), record: null })).toEqual([]);
  });

  it('has none while no pick has been graded, as on the board of today', () => {
    const nothing = { wins: 0, losses: 0 };

    expect(recordTiles({ ...sampleBoard(), record: { market: nothing, elo: nothing, points_rest: nothing } })).toEqual([]);
  });

  it('shows a model at 0–0 once the sportsbooks have a graded pick, as on the morning after opening night', () => {
    const nothing = { wins: 0, losses: 0 };
    const tiles = recordTiles({ ...sampleBoard(), record: { market: { wins: 4, losses: 2 }, elo: nothing, points_rest: nothing } });

    expect(tiles.map((tile) => tile.record)).toEqual(['0–0', '0–0', '4–2']);
  });

  it('has the sportsbooks alone in a sport that is not forecast', () => {
    const tiles = recordTiles({ ...sampleBoard(), record: { market: { wins: 4, losses: 2 }, elo: null, points_rest: null } });

    expect(tiles).toEqual([{ source: 'market', wins: 4, losses: 2, record: '4–2' }]);
  });
});

describe('recordSummary', () => {
  it('says in words which number is the wins, for a visitor who hears the page', () => {
    expect(recordSummary(recordTiles(sampleBoard()))).toBe(
      'Picks so far this season, each source on its own picks: ' +
        'Points & Rest 72 won and 44 lost, Elo 73 won and 43 lost, Sportsbooks 83 won and 48 lost. See the full record.',
    );
  });

  it('says that the tallies are not of the same games, which three tallies side by side would not', () => {
    // 72, 73 and 83 picks won are of 116, 116 and 131 picks.
    const picks = recordTiles(sampleBoard()).map((tile) => tile.wins + tile.losses);

    expect(picks).toEqual([116, 116, 131]);
    expect(OWN_PICKS).toBe('each source on its own picks');
    expect(recordSummary(recordTiles(sampleBoard()))).toContain(OWN_PICKS);
  });

  it('says nothing of other sources where the sportsbooks stand alone', () => {
    const alone = recordTiles({ ...sampleBoard(), record: { market: { wins: 4, losses: 2 }, elo: null, points_rest: null } });

    expect(recordSummary(alone)).toBe('Picks so far this season: Sportsbooks 4 won and 2 lost. See the full record.');
  });
});

describe('NO_RECORD_YET', () => {
  it('says when the first pick will be graded, and shows no number', () => {
    expect(NO_RECORD_YET).toBe('No pick has been graded yet. A game is graded on the morning after it is played.');
    expect(NO_RECORD_YET).not.toMatch(/\d/);
  });
});
