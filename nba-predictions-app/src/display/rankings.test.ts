import { describe, expect, it } from 'vitest';
import type { ModelRatings, PointsRating } from '../data/model';
import { sampleModel } from '../data/sampleData';
import { barAxis, barExtent, eloMove, plusMinus, rankChoices, rankings, ratingBar, ratingsBasis, ratingsNotice } from './rankings';

/** The table of Points & Rest in a file that has to hold one for a test to go on. */
function pointsOf(model: ModelRatings): Record<string, PointsRating> {
  if (model.points_rest === null) throw new Error('The file has no ratings of Points & Rest');
  return model.points_rest.ratings;
}

/** The file as it is before the first result of the season: no game, no win, and no rating that has moved. */
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

describe('ratingsBasis', () => {
  it('names the day of the last result and counts the games', () => {
    const basis = ratingsBasis(sampleModel());

    expect(basis.opening).toBe(false);
    expect(basis.text).toBe('Every result on record through Sat, Nov 7 is in these ratings: 143 games of the 2026-27 season.');
  });

  it('writes one game in the singular', () => {
    const model = { ...sampleModel(), results_through: '2026-10-20', games: 1 };

    expect(ratingsBasis(model).text).toContain('through Tue, Oct 20 is in these ratings: 1 game of the 2026-27 season.');
  });

  it('says that the ratings are the opening ones while no game of the season is on record', () => {
    const basis = ratingsBasis(beforeTheSeason());

    expect(basis.opening).toBe(true);
    expect(basis.text).toContain('No game of the 2026-27 season is on record yet.');
    expect(basis.text).toContain("a quarter of the way toward the league's average for Elo and a fifth for Points & Rest");
  });
});

describe('ratingsNotice', () => {
  it('is nothing on a good day', () => {
    expect(ratingsNotice(sampleModel())).toBeNull();
    expect(ratingsNotice(beforeTheSeason())).toBeNull();
  });

  it('says that Points & Rest is left out, with what the job found', () => {
    const notice = ratingsNotice(withoutPointsRest());

    expect(notice?.title).toBe('Points & Rest is left out today');
    expect(notice?.text).toContain("The results did not pass the checks of the job's last daily run.");
    expect(notice?.reasons).toEqual([
      'no result for DEN at LAC, which started at 2026-11-02T03:40:00Z (game f2699d4366ea6f7f96b4243432d380a1)',
    ]);
  });

  it('does not blame checks that the file says were passed', () => {
    const notice = ratingsNotice({ ...sampleModel(), points_rest: null });

    expect(notice?.title).toBe('Points & Rest is left out today');
    expect(notice?.text).toBe('The file holds no ratings of Points & Rest today, so the table shows Elo alone.');
    expect(notice?.reasons).toEqual([]);
  });

  it('passes on what the job found when the file holds both models all the same', () => {
    const notice = ratingsNotice({ ...sampleModel(), status: 'degraded', reasons: ['BOS has two results on 2026-11-06'] });

    expect(notice?.title).toBe("The results did not pass the checks of the job's last daily run");
    expect(notice?.reasons).toEqual(['BOS has two results on 2026-11-06']);
  });
});

describe('rankChoices', () => {
  it('offers both models, Points & Rest first', () => {
    expect(rankChoices(sampleModel())).toEqual(['points_rest', 'elo']);
  });

  it('offers Elo alone when the file leaves the other model out', () => {
    expect(rankChoices(withoutPointsRest())).toEqual(['elo']);
  });
});

describe('eloMove', () => {
  it('says which way a rating went in a week, and by how much', () => {
    expect(eloMove(1624, 1591)).toEqual({ direction: 'up', points: 33, words: 'up 33' });
    expect(eloMove(1549, 1602)).toEqual({ direction: 'down', points: 53, words: 'down 53' });
  });

  it('says so when it did not move', () => {
    expect(eloMove(1705, 1705)).toEqual({ direction: 'none', points: 0, words: 'no change' });
  });
});

describe('barExtent', () => {
  it('is the next multiple of five that holds every rating with its uncertainty', () => {
    // Washington, at −11.36 give or take 2.61, reaches the farthest.
    expect(barExtent(Object.values(pointsOf(sampleModel())))).toBe(15);
    expect(barExtent([{ rating: 12.5, uncertainty: 2.5 }])).toBe(15);
    expect(barExtent([{ rating: -12.5, uncertainty: 2.51 }])).toBe(20);
  });

  it('is never less than ten points, so that a table of teams that are close does not look far apart', () => {
    expect(barExtent([{ rating: 1.2, uncertainty: 3.1 }])).toBe(10);
    expect(barExtent([])).toBe(10);
  });
});

describe('ratingBar', () => {
  // A bar of 16 points to either side, so that every share is a fraction that a float holds exactly.
  it('fills from the middle to the right for a team that is better than average', () => {
    expect(ratingBar({ rating: 8, uncertainty: 4 }, 16)).toEqual({ from: 0.5, to: 0.75, low: 0.625, high: 0.875 });
  });

  it('fills from the middle to the left for a team that is worse', () => {
    expect(ratingBar({ rating: -8, uncertainty: 4 }, 16)).toEqual({ from: 0.25, to: 0.5, low: 0.125, high: 0.375 });
  });

  it('fills nothing for an average team, whose uncertainty lies on both sides of the middle', () => {
    expect(ratingBar({ rating: 0, uncertainty: 4 }, 16)).toEqual({ from: 0.5, to: 0.5, low: 0.375, high: 0.625 });
  });

  it('stays inside the bar', () => {
    expect(ratingBar({ rating: 14, uncertainty: 4 }, 16).high).toBe(1);
    expect(ratingBar({ rating: -40, uncertainty: 4 }, 16)).toEqual({ from: 0, to: 0.5, low: 0, high: 0 });
  });
});

describe('plusMinus', () => {
  it.each([
    [2.63, '±2.6'],
    [2.65, '±2.7'],
    [3.2, '±3.2'],
    [3, '±3.0'],
  ])('%f is "%s"', (uncertainty, text) => {
    expect(plusMinus(uncertainty)).toBe(text);
  });
});

describe('barAxis', () => {
  it('writes the two ends and the middle', () => {
    expect(barAxis(15)).toEqual(['−15', '0', '+15']);
  });
});

describe('rankings', () => {
  it('has a row for each of the 30 teams', () => {
    const { rows, by, extent } = rankings(sampleModel(), 'points_rest');

    expect(by).toBe('points_rest');
    expect(extent).toBe(15);
    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((row) => row.code)).size).toBe(30);
  });

  it('puts the highest rating of Points & Rest first', () => {
    const { rows } = rankings(sampleModel(), 'points_rest');

    expect(rows.slice(0, 4).map((row) => [row.rank, row.code, row.pointsRest?.rating])).toEqual([
      [1, 'OKC', '+7.4'],
      [2, 'NYK', '+6.5'],
      [3, 'SAS', '+5.6'],
      [4, 'LAL', '+5.1'],
    ]);
    expect(rows.at(-1)).toMatchObject({ rank: 30, code: 'WAS', name: 'Washington Wizards', pointsRest: { rating: '−11.4', uncertainty: '±2.6' } });
  });

  it('writes what the file holds of a team', () => {
    const lakers = rankings(sampleModel(), 'points_rest').rows.find((row) => row.code === 'LAL');

    expect(lakers).toEqual({
      code: 'LAL',
      name: 'Los Angeles Lakers',
      rank: 4,
      record: '8–1',
      recordWords: '8 wins and 1 loss',
      pointsRest: { rating: '+5.1', uncertainty: '±2.6', bar: ratingBar({ rating: 5.1, uncertainty: 2.62 }, 15) },
      elo: { rating: 1624, move: { direction: 'up', points: 33, words: 'up 33' } },
    });
  });

  it('puts the highest rating of Elo first when asked to', () => {
    const { rows, by } = rankings(sampleModel(), 'elo');

    expect(by).toBe('elo');
    expect(rows.slice(0, 4).map((row) => [row.rank, row.code, row.elo.rating])).toEqual([
      [1, 'NYK', 1705],
      [2, 'OKC', 1674],
      [3, 'SAS', 1668],
      [4, 'LAL', 1624],
    ]);
    expect(rows.at(-1)).toMatchObject({ rank: 30, code: 'WAS' });
  });

  it('gives teams that show the same rating the same place, and leaves the places after them out', () => {
    const { rows } = rankings(sampleModel(), 'points_rest');
    const shown = (from: number, to: number) => rows.slice(from, to).map((row) => [row.rank, row.code, row.pointsRest?.rating]);

    // The file has Boston at +1.94, Phoenix at +1.91, Toronto at +1.87 and Charlotte at +1.84.
    expect(shown(10, 14)).toEqual([
      [11, 'BOS', '+1.9'],
      [11, 'PHX', '+1.9'],
      [11, 'TOR', '+1.9'],
      [14, 'CHA', '+1.8'],
    ]);
    // It has Milwaukee at −1.32, and Philadelphia and Golden State both at −1.34.
    expect(shown(18, 22)).toEqual([
      [19, 'MIL', '−1.3'],
      [19, 'PHI', '−1.3'],
      [19, 'GSW', '−1.3'],
      [22, 'DAL', '−3.6'],
    ]);
  });

  it.each(['points_rest', 'elo'] as const)('counts a place from the ratings that the table writes when it is ranked by %s', (by) => {
    const { rows } = rankings(sampleModel(), by);
    // A rating as a number again: "−1.3" is written with the minus sign.
    const written = rows.map((row) => (by === 'elo' ? row.elo.rating : Number(row.pointsRest?.rating.replace('−', '-'))));

    rows.forEach((row, index) => {
      expect(row.rank).toBe(1 + written.filter((rating) => rating > written[index]).length);
    });
  });

  it('parts two teams by a hundredth where the hundredth changes what the table writes', () => {
    const { rows } = rankings(sampleModel(), 'points_rest');

    // The file has Detroit at +2.15 and Houston at +2.13, and half of the last digit goes up.
    expect(rows.slice(8, 10).map((row) => [row.rank, row.code, row.pointsRest?.rating])).toEqual([
      [9, 'DET', '+2.2'],
      [10, 'HOU', '+2.1'],
    ]);
  });

  it('gives one place to two teams that are written 0.0, one a little above an average team and one a little below', () => {
    const model = sampleModel();
    pointsOf(model).ORL = { rating: 0.04, uncertainty: 2.53 };
    pointsOf(model).MIL = { rating: -0.04, uncertainty: 2.57 };
    const { rows } = rankings(model, 'points_rest');

    expect(rows.slice(17, 20).map((row) => [row.rank, row.code, row.pointsRest?.rating])).toEqual([
      [18, 'ORL', '0.0'],
      [18, 'MIL', '0.0'],
      [20, 'PHI', '−1.3'],
    ]);
  });

  it('puts teams of one place in the order of the file, and in the order of the other model where the file rates them the same', () => {
    const byPoints = rankings(sampleModel(), 'points_rest').rows.map((row) => row.code);
    // Milwaukee's −1.32 is above the −1.34 of the two others. Elo has Philadelphia at 1480 and Golden State at 1463.
    expect(byPoints.slice(18, 21)).toEqual(['MIL', 'PHI', 'GSW']);

    const byElo = rankings(sampleModel(), 'elo').rows;
    // Miami and Charlotte are both at 1549. Points & Rest has Miami at +2.76 and Charlotte at +1.84.
    expect(byElo.slice(12, 15).map((row) => [row.rank, row.code])).toEqual([
      [13, 'MIA'],
      [13, 'CHA'],
      [15, 'PHX'],
    ]);
  });

  it('puts teams that both models rate the same by name', () => {
    const model = sampleModel();
    for (const code of ['BOS', 'ATL']) {
      model.elo.ratings[code] = { rating: 1600, week_ago: 1600 };
      pointsOf(model)[code] = { rating: 3, uncertainty: 2.6 };
    }
    const codes = rankings(model, 'elo').rows.map((row) => row.code);

    // Atlanta Hawks before Boston Celtics.
    expect(codes.indexOf('BOS')).toBe(codes.indexOf('ATL') + 1);
  });

  it('ranks by Elo, whatever was asked, when the file leaves Points & Rest out', () => {
    const { by, rows, extent } = rankings(withoutPointsRest(), 'points_rest');

    expect(by).toBe('elo');
    expect(extent).toBeNull();
    expect(rows).toHaveLength(30);
    expect(rows[0]).toMatchObject({ rank: 1, code: 'NYK', pointsRest: null });
    expect(rows.every((row) => row.pointsRest === null)).toBe(true);
  });

  it('shows the opening ratings before the season: no win, no loss, and no rating that has moved', () => {
    const { rows } = rankings(beforeTheSeason(), 'points_rest');

    expect(rows).toHaveLength(30);
    expect(rows.every((row) => row.record === '0–0' && row.recordWords === '0 wins and 0 losses')).toBe(true);
    expect(rows.every((row) => row.elo.move.direction === 'none')).toBe(true);
  });

  it('calls a team that is not one of the 30 by its code', () => {
    const model = sampleModel();
    model.elo.ratings.SEA = { rating: 1500, week_ago: 1500 };
    pointsOf(model).SEA = { rating: 0.5, uncertainty: 3.1 };
    model.teams.SEA = { wins: 1, losses: 0 };

    expect(rankings(model, 'elo').rows.find((row) => row.code === 'SEA')).toMatchObject({ name: 'SEA', record: '1–0', recordWords: '1 win and 0 losses' });
  });

  it('is an empty table for a file that rates no team', () => {
    const model = sampleModel();
    model.elo.ratings = {};
    model.points_rest = null;
    model.teams = {};

    expect(rankings(model, 'elo')).toEqual({ by: 'elo', rows: [], extent: null });
  });
});
