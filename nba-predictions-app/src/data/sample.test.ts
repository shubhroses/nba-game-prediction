/**
 * The sample data is what the views are built and looked at with before the
 * season has a result. tests/sample_season.py writes it with the job itself,
 * and tests/test_sample_season.py holds it to what the job writes. These
 * tests read it as the page does: with the page's shape checks, its days and
 * its rule for a pick. They hold it to the states that the views count on
 * finding there. The teams and the days are those of sample-data/README.md.
 */
import { describe, expect, it } from 'vitest';
import { addDays, currentDay, gameDay, predictionDays } from '../display/day';
import { pickedSide, picksDiffer } from '../display/pick';
import { missingPointsRest } from '../display/pointsRest';
import { boardChance, resultChance, resultVerdict, SOURCES } from '../display/sources';
import { TEAM_NAMES } from '../display/teams';
import { publishedTooLate, winningSide } from '../display/verdict';
import { parseBoard } from './board';
import { parseModel } from './model';
import { parsePredictionsOf } from './predictions';
import { parseRecord } from './record';
import { VERDICTS, type ResultLine, type Verdict } from './results';
import { SAMPLE_FILES, SAMPLE_NOW, sampleBoard, sampleModel, samplePredictions, sampleRecord } from './sampleData';
import type { Parse } from './shape';

const PATHS = [...SAMPLE_FILES.keys()].sort();

const SATURDAY = '2026-11-07';
const SUNDAY = '2026-11-08';
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

/** The shape check of a published file, from its path under the prefix. Null for a file that the page does not read. */
function checkOf(path: string): Parse<unknown> | null {
  if (path === 'slate.json') return parseBoard;
  if (path === 'record.json') return parseRecord;
  if (path === 'model.json') return parseModel;

  const day = /^predictions\/(\d{4}-\d{2}-\d{2})\.json$/.exec(path)?.[1];
  return day === undefined ? null : parsePredictionsOf(day);
}

/** What the sample has to hold for a test to go on. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`The sample has no ${what}`);
  return value;
}

function called(game: { home: string; away: string }): string {
  return `${game.away} at ${game.home}`;
}

function dayOf(game: { commence_time: string }): string {
  return gameDay(game.commence_time);
}

function startOf(game: { commence_time: string }): number {
  return Date.parse(game.commence_time);
}

/** Points as a whole number of hundredths, which is what the files round them to. */
function hundredths(points: number): number {
  return Math.round(points * 100);
}

/** The verdict that the page's own rule gives a chance for the home team, once the game is over. */
function verdictOf(pHome: number, line: ResultLine): Verdict {
  const side = pickedSide(pHome);
  if (side === null) return 'toss_up';
  return side === winningSide(line) ? 'favorite_won' : 'upset';
}

describe('the files of the sample', () => {
  it('are the board, the record, the model file and the forecasts of some days, and nothing else', () => {
    expect(PATHS).toEqual(expect.arrayContaining(['slate.json', 'record.json', 'model.json', `predictions/${SUNDAY}.json`]));
    // A file of another kind would be one that the page has no shape check for.
    expect(PATHS.filter((path) => checkOf(path) === null)).toEqual([]);
  });

  it.each(PATHS)('%s passes its shape check, and the check leaves out nothing that the job writes', (path) => {
    const file: unknown = JSON.parse(must(SAMPLE_FILES.get(path), path));

    // A field that the job writes and the types of the page do not have would be missing on the left.
    expect(checkOf(path)?.(file)).toEqual({ ok: true, value: file });
  });
});

describe('the board of the sample', () => {
  const board = sampleBoard();
  const today = board.games.filter((game) => dayOf(game) === SUNDAY);
  const later = board.games.filter((game) => dayOf(game) > SUNDAY);
  const named = (name: string) => must(today.find((game) => called(game) === name), `game of the day called ${name}`);

  it('is of the evening of Sunday 8 November, and a preview looks at it twenty minutes later', () => {
    const age = SAMPLE_NOW - Date.parse(board.generated_at);

    expect(board.slot).toBe('2026-11-08T18:10-05:00');
    expect(board.models).toEqual({ results_through: SATURDAY, status: 'ok', predictions_day: SUNDAY });
    expect(age).toBeGreaterThan(0);
    expect(age).toBeLessThan(20 * 60 * 1000);
    expect(Date.parse(board.next_due)).toBeGreaterThan(SAMPLE_NOW);
    // The day by the page's clock is the day whose forecasts are frozen, and no game on the board has started.
    expect(currentDay(SAMPLE_NOW)).toBe(SUNDAY);
    expect(board.games.every((game) => startOf(game) > SAMPLE_NOW)).toBe(true);
    expect(today.length + later.length).toBe(board.games.length);
  });

  it('has games of the day with the frozen forecast of the points-and-rest model', () => {
    expect(today.map(called)).toEqual(['POR at CLE', 'BOS at TOR', 'MEM at MIN', 'CHA at UTA', 'PHI at LAL']);

    for (const game of today) {
      const forecast = must(game.points_rest, `forecast of the points-and-rest model for ${called(game)}`);

      expect(game.elo).not.toBeNull();
      expect(game.line).not.toBeNull();
      expect(missingPointsRest(game, board)).toBeNull();
      // The margin is the sum of its three parts as they are written, so a view can show them adding up.
      expect(hundredths(forecast.margin)).toBe(
        hundredths(forecast.rating_edge) + hundredths(forecast.home_court) + hundredths(forecast.rest_edge),
      );
    }
    // Charlotte played the evening before, and what that gives Utah is a part of its own. Not every game has such a part.
    expect(named('CHA at UTA').points_rest?.rest_edge).toBeGreaterThan(1);
    expect(named('POR at CLE').points_rest?.rest_edge).toBe(0);
  });

  it("has later games with Elo's chance alone, for which the other model has no forecast yet", () => {
    expect([...new Set(later.map(dayOf))]).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(later.length).toBeGreaterThan(today.length);

    for (const game of later) {
      expect(game.elo).not.toBeNull();
      expect(game.points_rest).toBeNull();
      expect(missingPointsRest(game, board)).toBe('not-yet');
    }
  });

  it('has games with no line, which have no opening line either', () => {
    const unquoted = board.games.filter((game) => game.line === null);

    expect(unquoted.length).toBeGreaterThan(0);
    expect(unquoted.every((game) => game.open === null && game.elo !== null)).toBe(true);
    // Every game of the day has a line, so a game without one is a game of a later day.
    expect(unquoted.every((game) => later.includes(game))).toBe(true);
  });

  it('has a line from a single sportsbook, which is counted and not named', () => {
    const single = board.games.filter((game) => game.line?.n === 1);

    expect(single.map(called)).toContain('MEM at MIN');
    for (const game of single) {
      const line = must(game.line, 'line');

      expect(line.books).toEqual([]);
      expect([line.lo, line.hi]).toEqual([line.p_home, line.p_home]);
    }
    // The other lines name the sportsbooks they are the median of.
    expect(named('POR at CLE').line?.books).toEqual(['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => `Book ${letter}`));
  });

  it('has a game of the day in which both models pick one side and the sportsbooks the other', () => {
    const differing = today.filter((game) => picksDiffer(boardChance(game, 'points_rest'), boardChance(game, 'market')));

    expect(differing.map(called)).toEqual(['POR at CLE']);
    // In the order of the page: Points & Rest, Elo, the sportsbooks.
    expect(SOURCES.map((source) => pickedSide(must(boardChance(differing[0], source.key), 'chance')))).toEqual([
      'home',
      'home',
      'away',
    ]);
  });

  it('has a game of the day whose line is a toss-up while both models have a pick', () => {
    const even = today.filter((game) => pickedSide(must(boardChance(game, 'market'), 'line')) === null);

    expect(even.map(called)).toEqual(['BOS at TOR']);
    expect(pickedSide(must(boardChance(even[0], 'points_rest'), 'chance'))).toBe('home');
    expect(pickedSide(must(boardChance(even[0], 'elo'), 'chance'))).toBe('home');
  });

  it('counts the wins and losses of each source as the record does', () => {
    const record = sampleRecord();
    const tally = ({ wins, losses }: { wins: number; losses: number }) => ({ wins, losses });

    expect(board.record).toEqual({
      market: tally(record.market),
      elo: tally(must(record.elo, "record of Elo's picks")),
      points_rest: tally(must(record.points_rest, "record of the points-and-rest model's picks")),
    });
  });
});

describe('the recent results of the sample', () => {
  const board = sampleBoard();
  const results = board.recent_results;
  const days = [...new Set(results.map(dayOf))];

  it('have each of the four verdicts for the sportsbooks', () => {
    expect(new Set(results.map((line) => line.market_verdict))).toEqual(new Set(VERDICTS));

    // The game that is not graded for them was never quoted. Both models are graded on it.
    const ungraded = results.filter((line) => line.market_verdict === 'not_graded');
    expect(ungraded.map(called)).toEqual(['ORL at CHA']);
    expect(ungraded[0].market).toBeNull();
    expect(ungraded[0].elo_verdict).not.toBe('not_graded');
    expect(ungraded[0].points_rest_verdict).not.toBe('not_graded');
  });

  it('have games that a model is not graded on, because it was left out on their day', () => {
    const ungraded = results.filter((line) => line.points_rest_verdict === 'not_graded');

    expect(ungraded.length).toBeGreaterThan(0);
    expect(new Set(ungraded.map(dayOf))).toEqual(new Set(['2026-11-02']));
    for (const line of ungraded) {
      expect(line.points_rest).toBeNull();
      // It is not a forecast that came too late, and Elo is graded on the game.
      expect(publishedTooLate(line, 'points_rest')).toBe(false);
      expect(line.elo).not.toBeNull();
      expect(line.elo_verdict).not.toBe('not_graded');
    }

    // The file of that day says why.
    const monday = samplePredictions('2026-11-02');
    expect(monday.status).toBe('degraded');
    expect(monday.reasons).toHaveLength(1);
    expect(monday.reasons[0]).toContain('no result for DEN at LAC');
    expect(monday.games.map((game) => game.id).sort()).toEqual(ungraded.map((line) => line.id).sort());
    expect(monday.games.every((game) => game.points_rest === null)).toBe(true);
  });

  it("carry the job's verdict on every forecast, which is the one that the page's rule of 52% gives", () => {
    const graded = results.flatMap((line) =>
      SOURCES.map((source) => ({ line, verdict: resultVerdict(line, source.key), chance: resultChance(line, source.key) })),
    );

    expect(graded).toHaveLength(3 * results.length);
    for (const { line, verdict, chance } of graded) {
      expect(verdict).toBe(chance === null ? 'not_graded' : verdictOf(chance, line));
    }
  });

  it('are of eight days, and the oldest day is cut by the eight days that the board keeps a result for', () => {
    expect(days).toEqual(Array.from({ length: 8 }, (_, index) => addDays('2026-10-31', index)));

    const held = new Set(results.map((line) => line.id));
    const missing = (day: string) => samplePredictions(day).games.filter((game) => !held.has(game.id));
    const cut = Date.parse(board.generated_at) - EIGHT_DAYS_MS;
    // The afternoon games of 31 October started before the cut. The evening games did not.
    expect(missing('2026-10-31').map(called)).toEqual(['CHI at NOP', 'PHI at DAL', 'DET at ATL']);
    expect(missing('2026-10-31').every((game) => startOf(game) < cut)).toBe(true);
    expect(results.every((line) => startOf(line) > cut)).toBe(true);
    // Every later day is whole: each game that was forecast has its result.
    for (const day of days.slice(1)) expect(missing(day)).toEqual([]);
  });

  it('name a game by its id, and carry a start that is some minutes after the scheduled one', () => {
    const saturday = samplePredictions(SATURDAY);

    expect(saturday.games).toHaveLength(6);
    for (const game of saturday.games) {
      const line = must(results.find((result) => result.id === game.id), `result of ${called(game)}`);
      const late = startOf(line) - startOf(game);

      expect(called(line)).toBe(called(game));
      expect(late).toBeGreaterThan(0);
      expect(late).toBeLessThan(15 * 60 * 1000);
      // What the result says of each model is what the file of the day says.
      expect(line.elo).toEqual({ p_home: game.elo.p_home, published_at: saturday.published_at });
      expect(line.points_rest).toEqual({
        p_home: game.points_rest?.p_home,
        margin: game.points_rest?.margin,
        published_at: saturday.published_at,
      });
    }
  });
});

describe('the forecasts of the sample', () => {
  const board = sampleBoard();

  it('have a file for every day that the page may ask for, and for no other day', () => {
    const days = PATHS.flatMap((path) => /^predictions\/(.+)\.json$/.exec(path)?.[1] ?? []);

    // A day without a file is answered with "no such file", which a browser writes to its console as an error.
    expect(days).toEqual(predictionDays(board));
    expect(days).toHaveLength(9);
  });

  it('have seven games on the last day, of which two have started and are not on the board', () => {
    const sunday = samplePredictions(SUNDAY);
    const onTheBoard = new Map(board.games.map((game) => [game.id, game]));
    const over = new Set(board.recent_results.map((line) => line.id));
    const started = sunday.games.filter((game) => !onTheBoard.has(game.id));
    const toCome = sunday.games.filter((game) => onTheBoard.has(game.id));

    expect(sunday.games).toHaveLength(7);
    expect(sunday.games.every((game) => game.points_rest !== null && game.market !== null)).toBe(true);
    // The two are being played or just over. Their results come with the next morning.
    expect(started.map(called)).toEqual(['WAS at NYK', 'LAC at DET']);
    expect(started.every((game) => startOf(game) < SAMPLE_NOW && !over.has(game.id))).toBe(true);
    // In the second of them the points-and-rest model has no pick.
    expect(started.map((game) => pickedSide(must(game.points_rest, 'forecast').p_home))).toEqual(['home', null]);

    // The other five are the first five of the board, with the forecasts of the file and a newer line.
    expect(toCome.map((game) => game.id)).toEqual(board.games.slice(0, 5).map((game) => game.id));
    for (const game of toCome) {
      const shown = must(onTheBoard.get(game.id), 'game');

      expect(shown.commence_time).toBe(game.commence_time);
      expect(shown.elo).toEqual({ p_home: game.elo.p_home });
      expect(shown.points_rest).toEqual(game.points_rest);
      expect(Date.parse(must(shown.line, 'line').captured_at)).toBeGreaterThan(Date.parse(must(game.market, 'line').at));
    }
  });

  it('have a game on a neutral floor, where neither model gives the home team anything', () => {
    const neutral = samplePredictions(SATURDAY).games.filter((game) => game.neutral);

    expect(neutral.map(called)).toEqual(['DEN at IND']);
    expect(neutral[0].elo.home_court).toBe(0);
    expect(neutral[0].points_rest?.home_court).toBe(0);
    // Every other game of the nine days is on the floor of its home team.
    const others = predictionDays(board).flatMap((day) => samplePredictions(day).games.filter((game) => !game.neutral));
    expect(others.length).toBeGreaterThan(60);
    expect(others.every((game) => game.elo.home_court === 40)).toBe(true);
  });

  it('have a game that no sportsbook had quoted by the morning', () => {
    const unquoted = samplePredictions(SATURDAY).games.filter((game) => game.market === null);

    expect(unquoted.map(called)).toEqual(['ORL at CHA']);
  });
});

describe('the record of the sample', () => {
  const record = sampleRecord();
  const models = [must(record.elo, "record of Elo's picks"), must(record.points_rest, "record of the other model's picks")];

  it('has 120 games or more', () => {
    const { wins, losses, toss_ups, not_graded } = record.market;

    expect(record.since).toBe('2026-10-20');
    expect(record.games).toBeGreaterThanOrEqual(120);
    expect(wins + losses + toss_ups + not_graded).toBe(record.games);
  });

  it('has an interval against the sportsbooks for each model, and zero is inside each', () => {
    for (const { brier_against_market: against } of models) {
      const [low, high] = must(against.interval, 'interval');
      const difference = must(against.difference, 'difference');

      expect(against.games).toBeGreaterThanOrEqual(30);
      expect(low).toBeLessThanOrEqual(difference);
      expect(high).toBeGreaterThanOrEqual(difference);
      // So the sample shows neither model to be better or worse than the sportsbooks, and no view may say that it is.
      expect(low).toBeLessThan(0);
      expect(high).toBeGreaterThan(0);
    }
  });

  it('lists games in which a model and the sportsbooks picked different winners, with either of them right', () => {
    for (const { picks_against_market: picks } of models) {
      expect(picks.differ).toBe(picks.model_right + picks.market_right);
      expect(picks.latest).toHaveLength(10);
      expect(new Set(picks.latest.map((game) => game.right))).toEqual(new Set(['model', 'market']));
      // The latest is first: Dallas at Chicago on the last day of results.
      expect(picks.latest[0]).toMatchObject({ home: 'CHI', away: 'DAL', pick: 'CHI', market_pick: 'DAL', right: 'market' });
    }
  });

  it('lists three favorites of the sportsbooks at 75% or more that lost', () => {
    const upsets = record.market.biggest_upsets;

    expect(upsets).toHaveLength(3);
    expect(upsets.every((upset) => upset.p_favorite >= 0.75)).toBe(true);
    expect(upsets[0]).toMatchObject({ favorite: 'MIA', home: 'MIA', away: 'CHI', home_pts: 104, away_pts: 109 });
  });

  it('has favorites in each of the five bands for every source', () => {
    for (const card of [record.market, ...models]) {
      expect(card.bands.map((band) => band.band)).toEqual(['52-59', '60-69', '70-79', '80-89', '90+']);
      expect(card.bands.every((band) => band.games > 0 && band.mean_p_favorite !== null)).toBe(true);
    }
  });

  it('counts every game on one day, and has days on which a model is not graded on any game', () => {
    const days = record.by_day;
    const ungraded = (model: 'elo' | 'points_rest') =>
      days.filter((day) => day[model]?.not_graded === day.games).map((day) => day.day);

    expect(days).toHaveLength(19);
    expect(days.reduce((games, day) => games + day.games, 0)).toBe(record.games);
    // Opening night, and the morning on which no run came.
    expect(ungraded('elo')).toEqual(['2026-10-20', '2026-10-27']);
    // And the day on which the points-and-rest model was left out.
    expect(ungraded('points_rest')).toEqual(['2026-10-20', '2026-10-27', '2026-11-02']);
    expect(days.every((day) => day.market.not_graded < day.games)).toBe(true);
  });

  it('counts each game on the day that the page gives it', () => {
    const results = sampleBoard().recent_results;

    // The record goes by the New York date and the page by the day of the models. The two are the same for a game
    // that starts between six in the morning and midnight in New York, as every game of the sample does.
    // 31 October is left out, because the board no longer has all of its results.
    for (const day of record.by_day.filter((entry) => entry.day > '2026-10-31')) {
      expect(results.filter((line) => dayOf(line) === day.day)).toHaveLength(day.games);
    }
  });
});

describe('the ratings of the sample', () => {
  const model = sampleModel();
  const teams = [...TEAM_NAMES.keys()].sort();

  it('have the 30 teams in both tables, each under a code that the page has a name for', () => {
    expect(teams).toHaveLength(30);
    expect(Object.keys(model.elo.ratings).sort()).toEqual(teams);
    expect(Object.keys(must(model.points_rest, 'table of the points-and-rest model').ratings).sort()).toEqual(teams);
    expect(Object.keys(model.teams).sort()).toEqual(teams);
  });

  it('are of the results that the board and the record have', () => {
    const played = Object.values(model.teams);

    expect(model.status).toBe('ok');
    expect(model.results_through).toBe(sampleBoard().models?.results_through);
    expect(model.games).toBe(sampleRecord().games);
    // Every game is one team's win and another's loss.
    expect(played.reduce((wins, team) => wins + team.wins, 0)).toBe(model.games);
    expect(played.reduce((losses, team) => losses + team.losses, 0)).toBe(model.games);
  });

  it('have moved within the last week, up for some teams and down for others', () => {
    const elo = Object.values(model.elo.ratings);

    expect(elo.some((team) => team.rating > team.week_ago)).toBe(true);
    expect(elo.some((team) => team.rating < team.week_ago)).toBe(true);
  });

  it('are centered: Elo around its mean, and the other model around an average team', () => {
    const mean = (ratings: { rating: number }[]) => ratings.reduce((sum, team) => sum + team.rating, 0) / ratings.length;
    const points = Object.values(must(model.points_rest, 'table of the points-and-rest model').ratings);

    expect(Math.abs(mean(Object.values(model.elo.ratings)) - model.elo.constants.mean)).toBeLessThan(1);
    expect(Math.abs(mean(points))).toBeLessThan(0.01);
    expect(points.every((team) => team.uncertainty > 0)).toBe(true);
  });
});
