import { describe, expect, it } from 'vitest';
import type { PointsRestForecast } from '../data/forecasts';
import { sampleBoard, sampleModel, samplePredictions } from '../data/sampleData';
import {
  boardGame,
  chipLabel,
  comparison,
  differingModels,
  forecastGame,
  gameCardView,
  headlineCaption,
  headlineOf,
  madeLines,
  marginSum,
  sportsbooksNote,
  startLabel,
  type CardGame,
  type FilesAtHand,
  type GameCardView,
} from './gameCard';
import { SOURCES, type SourceKey } from './sources';

const NEW_YORK = 'America/New_York';

/** Invented numbers. The home team is Detroit, and each part of the margin is in points for it. */
function forecast(changes: Partial<PointsRestForecast> = {}): PointsRestForecast {
  return { p_home: 0.6712, margin: 5.14, rating_edge: 3.98, home_court: 1.16, rest_edge: 0, ...changes };
}

/** Boston at Detroit on the evening of Tuesday 20 October, with all three sources. Each test changes what it is about. */
function game(changes: Partial<CardGame> = {}): CardGame {
  return {
    id: 'game-1',
    commence_time: '2026-10-20T23:00:00Z',
    home: 'DET',
    away: 'BOS',
    pointsRest: forecast(),
    missing: null,
    elo: 0.6239,
    eloInputs: { home: 1548, away: 1500, homeCourt: 40, neutral: false },
    line: { p_home: 0.5871, lo: 0.5712, hi: 0.6034, n: 6 },
    lineAt: '2026-10-20T22:10:41Z',
    lineFrom: 'snapshot',
    open: { p_home: 0.5541, at: '2026-10-10T16:10:52Z' },
    neutral: false,
    ...changes,
  };
}

/** A game of a later day: Elo's chance and the sportsbooks' line, and the other model still to come. */
function later(changes: Partial<CardGame> = {}): CardGame {
  return game({
    pointsRest: null,
    missing: 'not-yet',
    eloInputs: { home: 1548, away: 1500, homeCourt: 40, neutral: null },
    neutral: null,
    ...changes,
  });
}

/**
 * The same game as the forecasts file of its day holds it: the line is the
 * one of 21:10 in New York on the evening before, and no first line is carried.
 */
function fromFile(changes: Partial<CardGame> = {}): CardGame {
  return game({ lineAt: '2026-10-20T01:10:35Z', lineFrom: 'morning', open: null, ...changes });
}

/** A line on which every sportsbook gives the home team this chance. */
const priced = (p_home: number) => ({ p_home, lo: p_home, hi: p_home, n: 3 });

const card = (changes: Partial<CardGame> = {}) => gameCardView(game(changes), NEW_YORK);
const row = (view: GameCardView, key: SourceKey) => view.rows.find((entry) => entry.source === key);
/** What "How these numbers are made" says of one source for a game, from the first word to the last. */
function madeOf(of: CardGame, key: SourceKey, timeZone = NEW_YORK): string | undefined {
  const line = madeLines(of, timeZone).find((entry) => entry.source === key);
  return line && [line.figures, line.text].filter((part) => part !== null).join(' ');
}

const made = (changes: Partial<CardGame>, key: SourceKey) => madeOf(game(changes), key);

describe('headlineOf', () => {
  it('is the points-and-rest model once the game has its forecast', () => {
    expect(headlineOf(game())).toBe('points_rest');
  });

  it('is Elo before that', () => {
    expect(headlineOf(later())).toBe('elo');
  });

  it('falls back to the sportsbooks when no model has a number', () => {
    expect(headlineOf(game({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null }))).toBe('market');
  });

  it('is nobody when the game has no forecast and no line', () => {
    expect(headlineOf(game({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null, line: null, open: null }))).toBeNull();
  });
});

describe('gameCardView', () => {
  it('names both teams in full, with their codes, and says who plays where', () => {
    const view = card();

    expect(view.id).toBe('game-1');
    expect(view.title).toBe('Boston Celtics at Detroit Pistons');
    expect(view.away).toMatchObject({ code: 'BOS', name: 'Boston Celtics' });
    expect(view.home).toMatchObject({ code: 'DET', name: 'Detroit Pistons' });
  });

  it('gives the start as the files write it and as a visitor reads it, and the day of the game', () => {
    const view = card();

    expect(view.commenceTime).toBe('2026-10-20T23:00:00Z');
    expect(view.start).toBe('7:00 PM EDT');
    expect(view.day).toBe('2026-10-20');
  });

  it('keeps a late game with its evening', () => {
    // 22:30 in New York on Tuesday is Wednesday in UTC.
    expect(card({ commence_time: '2026-10-21T02:30:00Z' }).day).toBe('2026-10-20');
  });

  it('leads with the chance of the points-and-rest model, and marks its pick', () => {
    const view = card();

    expect(view.headline).toBe('points_rest');
    expect(view.caption).toBe('Points & Rest, made this morning');
    expect(view.home).toMatchObject({ chance: 67, picked: true });
    expect(view.away).toMatchObject({ chance: 33, picked: false });
  });

  it('leads with Elo for a game of a later day, and says that it is an early look', () => {
    const view = gameCardView(later(), NEW_YORK);

    expect(view.headline).toBe('elo');
    expect(view.caption).toBe('Elo, early look: the full forecast comes on the morning of the game');
    expect(view.home).toMatchObject({ chance: 62, picked: true });
    expect(view.away).toMatchObject({ chance: 38, picked: false });
  });

  it('leads with the sportsbooks when no model has a number, and says so', () => {
    const view = card({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null });

    expect(view.headline).toBe('market');
    expect(view.caption).toBe('Sportsbooks alone: the models have not made a forecast yet');
    expect(view.home).toMatchObject({ chance: 59, picked: true });
  });

  it('shows no chance when there is no forecast and no line, and fills the gap with nothing', () => {
    const view = card({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null, line: null, open: null });

    expect(view.headline).toBeNull();
    expect(view.caption).toBe('No forecast and no line yet');
    expect(view.home).toMatchObject({ chance: null, picked: false });
    expect(view.away).toMatchObject({ chance: null, picked: false });
    expect(view.chip).toBeNull();
    expect(view.note).toBeNull();
    expect(view.rows.map((entry) => entry.pHome)).toEqual([null, null, null]);
  });

  it('picks the away team with the rest of the home chance', () => {
    const view = card({ pointsRest: forecast({ p_home: 0.3571, margin: -4.2, rating_edge: -5.36 }) });

    expect(view.away).toMatchObject({ chance: 64, picked: true });
    expect(view.home).toMatchObject({ chance: 36, picked: false });
  });

  it.each([
    [0.52, 'home'],
    [0.5201, 'home'],
    [0.48, 'away'],
    [0.4799, 'away'],
  ] as const)('has a pick at %f, as the job does from 52%% on', (p_home, side) => {
    const view = card({ pointsRest: forecast({ p_home }) });

    expect(view[side].picked).toBe(true);
    expect(view[side].chance).toBe(52);
    expect(view.chip).not.toBe('toss-up');
  });

  it.each([0.4801, 0.4999, 0.5, 0.5113, 0.5199])('has no pick at %f, where neither team is at 52%%, and says toss-up', (p_home) => {
    // The other two sources are on the same side, so that nothing else is to be said of the game.
    const view = card({ pointsRest: forecast({ p_home }), elo: 0.5, line: priced(0.5) });

    expect(view.home.picked).toBe(false);
    expect(view.away.picked).toBe(false);
    expect(view.chip).toBe('toss-up');
    expect(row(view, 'points_rest')).toMatchObject({ kind: 'toss-up', label: 'Toss-up' });
    // Neither of the two large numbers says 52%, which is where a pick begins.
    expect(Math.max(view.home.chance ?? 0, view.away.chance ?? 0)).toBeLessThan(52);
    expect((view.home.chance ?? 0) + (view.away.chance ?? 0)).toBe(100);
  });

  it.each([
    [0.5199, 51, 49],
    [0.515, 51, 49],
    [0.4849, 49, 51],
    [0.4801, 49, 51],
  ])('writes a toss-up at %f as %i%% and %i%%, and not as the 52%% that it is short of', (p_home, home, away) => {
    const view = card({ pointsRest: forecast({ p_home }), elo: 0.5, line: priced(0.5) });

    expect(view.home.chance).toBe(home);
    expect(view.away.chance).toBe(away);
  });

  it('still gives both chances of a toss-up', () => {
    const view = card({ pointsRest: forecast({ p_home: 0.5113 }) });

    expect(view.home.chance).toBe(51);
    expect(view.away.chance).toBe(49);
  });

  it.each([
    [0.9999, 99, 1],
    [0.996, 99, 1],
    [0.0001, 1, 99],
  ])('never shows 0%% or 100%%: %f is %i%% and %i%%', (p_home, home, away) => {
    const view = card({ pointsRest: forecast({ p_home }) });

    expect(view.home.chance).toBe(home);
    expect(view.away.chance).toBe(away);
  });

  it('makes the two chances add up to 100 on a half point', () => {
    const view = card({ pointsRest: forecast({ p_home: 0.575 }) });

    expect(view.home.chance).toBe(58);
    expect(view.away.chance).toBe(42);
  });

  it('has the three sources in the order of the page, each with its pick and its chance', () => {
    const view = card();

    expect(view.rows.map((entry) => entry.source)).toEqual(['points_rest', 'elo', 'market']);
    expect(view.rows.map((entry) => entry.label)).toEqual(['DET 67%', 'DET 62%', 'DET 59%']);
    expect(view.rows.map((entry) => entry.kind)).toEqual(['pick', 'pick', 'pick']);
    expect(view.rows.map((entry) => entry.pHome)).toEqual([0.6712, 0.6239, 0.5871]);
  });

  it('writes the pick of a source that favors the away team with that team', () => {
    expect(row(card({ elo: 0.41 }), 'elo')).toMatchObject({ kind: 'pick', label: 'BOS 59%' });
  });

  it.each([
    ['not-yet', 'Morning of the game'],
    ['left-out', 'Left out today'],
    ['none', 'No forecast'],
    ['not-built', 'No forecast yet'],
  ] as const)('says why the points-and-rest model has no number: %s', (missing, label) => {
    const view = card({ pointsRest: null, missing });

    expect(row(view, 'points_rest')).toEqual({ source: 'points_rest', pHome: null, kind: 'missing', label, qualifier: null, note: null });
  });

  it('says that Elo has no forecast yet before the models are built', () => {
    const view = card({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null });

    expect(row(view, 'elo')).toMatchObject({ pHome: null, kind: 'missing', label: 'No forecast yet' });
  });

  it('says that there is no line yet for a game that never had one', () => {
    const view = card({ line: null, lineAt: null, open: null });

    expect(row(view, 'market')).toEqual({
      source: 'market',
      pHome: null,
      kind: 'missing',
      label: 'No line yet',
      qualifier: null,
      note: null,
    });
    // The models are shown all the same.
    expect(view.headline).toBe('points_rest');
    expect(view.note).toBeNull();
  });

  it('puts under the sportsbooks how many they are and how far apart', () => {
    expect(row(card(), 'market')?.note).toBe('Median of 6 sportsbooks, DET 57% to 60%');
    expect(row(card(), 'points_rest')?.note).toBeNull();
    expect(row(card(), 'elo')?.note).toBeNull();
  });

  it('says that there is no line right now for a game that had one in an earlier snapshot', () => {
    const view = card({ line: null, lineAt: null });

    expect(row(view, 'market')).toMatchObject({ pHome: null, kind: 'missing', label: 'No line right now' });
  });

  it('says of a game from the forecasts file only that it had no line that morning', () => {
    const view = gameCardView(fromFile({ line: null, lineAt: null }), NEW_YORK);

    expect(row(view, 'market')).toMatchObject({ pHome: null, kind: 'missing', label: 'No line that morning', qualifier: null });
  });

  it('gives the time of a line from the forecasts file, which is of the evening before', () => {
    expect(row(gameCardView(fromFile(), NEW_YORK), 'market')?.qualifier).toBe('as of Mon 9:10 PM');
    expect(row(gameCardView(fromFile(), 'America/Los_Angeles'), 'market')?.qualifier).toBe('as of Mon 6:10 PM');
    expect(row(gameCardView(fromFile(), 'Asia/Tokyo'), 'market')?.qualifier).toBe('as of Tue 10:10 AM');
    expect(row(card(), 'market')?.qualifier).toBeNull();
    expect(row(gameCardView(fromFile(), NEW_YORK), 'elo')?.qualifier).toBeNull();
  });

  it('says of Elo that its number is not frozen when the morning has come without a forecast for the game', () => {
    const unfrozen = card({ pointsRest: null, missing: 'none' });

    expect(row(unfrozen, 'elo')).toMatchObject({ label: 'DET 62%', qualifier: 'not frozen' });
    expect(unfrozen.caption).toBe('Elo from its current ratings: no forecast is frozen for this game, so the models are not graded on it');
    expect(unfrozen.frozen).toBe(false);
    // An early look says so in its caption, and a frozen forecast needs no word.
    expect(row(gameCardView(later(), NEW_YORK), 'elo')?.qualifier).toBeNull();
    expect(row(card(), 'elo')?.qualifier).toBeNull();
  });

  it('knows which cards hold a forecast that was frozen on the morning of the game', () => {
    expect(card().frozen).toBe(true);
    expect(gameCardView(fromFile(), NEW_YORK).frozen).toBe(true);
    // Elo's forecast is frozen on a day on which the other model is left out.
    expect(card({ pointsRest: null, missing: 'left-out' }).frozen).toBe(true);
    expect(gameCardView(later(), NEW_YORK).frozen).toBe(false);
    expect(card({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null }).frozen).toBe(false);
  });

  it('says different picks when a model and the sportsbooks pick different sides', () => {
    const view = card({ line: priced(0.41) });

    expect(view.differentPicks).toBe(true);
    expect(view.chip).toBe('different-picks');
    expect(view.note).toBe('Points & Rest and Elo pick Detroit, the sportsbooks pick Boston.');
  });

  it('says different picks for Elo alone, although the card leads with the other model', () => {
    const view = card({ elo: 0.44 });

    expect(view.headline).toBe('points_rest');
    expect(view.chip).toBe('different-picks');
    expect(view.note).toBe('Elo picks Boston, the sportsbooks pick Detroit.');
  });

  it('says different picks before toss-up when both are so', () => {
    const view = card({ pointsRest: forecast({ p_home: 0.5 }), elo: 0.44 });

    expect(view.chip).toBe('different-picks');
    expect(view.home.picked).toBe(false);
  });

  it('has no chip when all three pick the same side', () => {
    expect(card().chip).toBeNull();
    expect(card().differentPicks).toBe(false);
  });

  it('carries whether the floor is neutral, and says it in the title', () => {
    expect(card().neutral).toBe(false);
    expect(gameCardView(later(), NEW_YORK).neutral).toBeNull();

    const neutral = card({ home: 'IND', away: 'DEN', neutral: true });
    expect(neutral.neutral).toBe(true);
    expect(neutral.title).toBe('Denver Nuggets against Indiana Pacers, on a neutral floor');
  });

  it('shows the code of a team it does not know', () => {
    const view = card({ home: 'SEA' });

    expect(view.home.name).toBe('SEA');
    expect(view.title).toBe('Boston Celtics at SEA');
    expect(row(view, 'elo')?.label).toBe('SEA 62%');
  });
});

describe('differingModels', () => {
  it('names the models whose pick is not the sportsbooks pick', () => {
    expect(differingModels(game())).toEqual([]);
    expect(differingModels(game({ line: priced(0.41) }))).toEqual(['points_rest', 'elo']);
    expect(differingModels(game({ elo: 0.44 }))).toEqual(['elo']);
    expect(differingModels(game({ pointsRest: forecast({ p_home: 0.44 }) }))).toEqual(['points_rest']);
  });

  it('counts a model without a pick as differing from nobody', () => {
    expect(differingModels(game({ pointsRest: forecast({ p_home: 0.5 }), elo: 0.5199, line: priced(0.41) }))).toEqual([]);
  });

  it('counts nothing against a line without a pick, or without a line', () => {
    expect(differingModels(game({ line: priced(0.5) }))).toEqual([]);
    expect(differingModels(game({ line: null }))).toEqual([]);
  });

  it('goes by the rule for a pick: 0.48 against 0.52 differ and 0.4801 against 0.52 do not', () => {
    expect(differingModels(later({ elo: 0.48, line: priced(0.52) }))).toEqual(['elo']);
    expect(differingModels(later({ elo: 0.4801, line: priced(0.52) }))).toEqual([]);
  });
});

describe('comparison', () => {
  it('says how many percentage points higher the model is on its pick than the sportsbooks, from five on', () => {
    expect(comparison(game())).toBe('Points & Rest is 8 percentage points higher on Detroit than the sportsbooks.');
  });

  it('says lower when the sportsbooks give the model’s pick more', () => {
    expect(comparison(game({ line: priced(0.81) }))).toBe('Points & Rest is 14 percentage points lower on Detroit than the sportsbooks.');
  });

  it('counts the points for the away team when that is the pick', () => {
    const away = game({ pointsRest: forecast({ p_home: 0.26 }), elo: 0.3, line: priced(0.33) });

    expect(comparison(away)).toBe('Points & Rest is 7 percentage points higher on Boston than the sportsbooks.');
  });

  it('speaks for Elo while the card leads with it', () => {
    expect(comparison(later({ elo: 0.7117 }))).toBe('Elo is 12 percentage points higher on Detroit than the sportsbooks.');
  });

  it('counts the points for the sportsbooks’ pick when the model has none', () => {
    expect(comparison(game({ pointsRest: forecast({ p_home: 0.4992 }), elo: 0.5273, line: priced(0.597) }))).toBe(
      'Points & Rest is 10 percentage points lower on Detroit than the sportsbooks.',
    );
  });

  it('counts the points for the model’s pick when the sportsbooks have none', () => {
    expect(comparison(game({ line: priced(0.5 ) }))).toBe('Points & Rest is 17 percentage points higher on Detroit than the sportsbooks.');
  });

  it.each([
    [0.6712, 0.6251, 4],
    [0.6712, 0.7149, 4],
  ])('says nothing when the two are %f and %f, which is %i points apart on the card', (model, line) => {
    expect(comparison(game({ pointsRest: forecast({ p_home: model }), line: priced(line) }))).toBeNull();
  });

  it('counts the points between the whole percents that the card shows', () => {
    // 54.6% and 50.4% are 4.2 points apart, and the card shows 55% and 50%.
    expect(comparison(game({ pointsRest: forecast({ p_home: 0.546 }), line: priced(0.504) }))).toBe(
      'Points & Rest is 5 percentage points higher on Detroit than the sportsbooks.',
    );
  });

  it('says who picks whom in place of the points when the picks differ', () => {
    expect(comparison(game({ line: priced(0.41) }))).toBe('Points & Rest and Elo pick Detroit, the sportsbooks pick Boston.');
    expect(comparison(game({ pointsRest: forecast({ p_home: 0.44 }) }))).toBe('Points & Rest picks Boston, the sportsbooks pick Detroit.');
    expect(comparison(later({ elo: 0.6267, line: priced(0.424) }))).toBe('Elo picks Detroit, the sportsbooks pick Boston.');
  });

  it('names the two teams of Los Angeles by their own names', () => {
    expect(comparison(game({ home: 'LAL', away: 'LAC', line: priced(0.41) }))).toBe(
      'Points & Rest and Elo pick the Lakers, the sportsbooks pick the Clippers.',
    );
  });

  it('counts a toss-up as the card writes it, which is never 52%', () => {
    // 51.99% reads 51% on the card and the line reads 57%.
    expect(comparison(game({ pointsRest: forecast({ p_home: 0.5199 }), elo: 0.5273, line: priced(0.5712) }))).toBe(
      'Points & Rest is 6 percentage points lower on Detroit than the sportsbooks.',
    );
  });

  it('says which line it is when the line is the one of the forecasts file, which is not the one the game is graded against', () => {
    expect(comparison(fromFile(), NEW_YORK)).toBe(
      'Points & Rest is 8 percentage points higher on Detroit than the sportsbooks were as of Mon 9:10 PM.',
    );
    expect(comparison(fromFile({ line: priced(0.41) }), NEW_YORK)).toBe(
      'Points & Rest and Elo pick Detroit, the sportsbooks picked Boston as of Mon 9:10 PM.',
    );
  });

  it('says nothing without a line, and nothing of the sportsbooks against themselves', () => {
    expect(comparison(game({ line: null }))).toBeNull();
    expect(comparison(game({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null }))).toBeNull();
  });
});

describe('headlineCaption', () => {
  it('says why Elo stands alone on a day when the other model is left out', () => {
    expect(headlineCaption('elo', 'left-out')).toBe('Elo alone: Points & Rest is left out today');
  });

  it('says that Elo’s number is not a frozen forecast when the morning has come and the game has none', () => {
    expect(headlineCaption('elo', 'none')).toBe(
      'Elo from its current ratings: no forecast is frozen for this game, so the models are not graded on it',
    );
  });

  it('says that the sportsbooks stand alone for a game that the models have nothing for', () => {
    expect(headlineCaption('market', 'none')).toBe('Sportsbooks alone: the models have no forecast for this game');
  });
});

describe('marginSum', () => {
  it('writes the expected margin as the sum of its three parts', () => {
    expect(marginSum(forecast(), 'DET', 'BOS')).toBe('Detroit by 5.1 = ratings +3.98, home court +1.16, rest 0.00.');
  });

  it('turns the signs around for the away team, so that the parts still add up to its margin', () => {
    const utah = forecast({ p_home: 0.3932, margin: -3.13, rating_edge: -6.43, home_court: 1.91, rest_edge: 1.39 });

    expect(marginSum(utah, 'UTA', 'CHA')).toBe('Charlotte by 3.1 = ratings +6.43, home court −1.91, rest −1.39.');
  });

  it('writes a part that takes points from the home team with a minus sign', () => {
    const tired = forecast({ margin: 3.47, rest_edge: -1.67 });

    expect(marginSum(tired, 'DET', 'BOS')).toBe('Detroit by 3.5 = ratings +3.98, home court +1.16, rest −1.67.');
  });

  it('calls a margin that rounds to nothing level, and gives the parts for the home team', () => {
    const level = forecast({ p_home: 0.4992, margin: -0.02, rating_edge: -1.58, home_court: 1.24, rest_edge: 0.32 });

    expect(marginSum(level, 'DET', 'LAC')).toBe('Level on points: for Detroit, ratings −1.58, home court +1.24, rest +0.32.');
  });

  it('writes no home court on a neutral floor', () => {
    const neutral = forecast({ margin: 3.98, home_court: 0 });

    expect(marginSum(neutral, 'IND', 'DEN')).toBe('Indiana by 4.0 = ratings +3.98, home court 0.00, rest 0.00.');
  });

  it('names a team that goes by its own name without an article, as a label does', () => {
    expect(marginSum(forecast({ margin: -5.14, rating_edge: -6.3 }), 'DET', 'LAL')).toMatch(/^Lakers by 5\.1 = /);
  });

  it('adds up as written for every forecast of the sample', () => {
    const hundredths = (points: string) => Math.round(Number(points.replace('−', '-')) * 100);

    for (const entry of samplePredictions('2026-11-08').games) {
      const sum = marginSum(entry.points_rest ?? forecast(), entry.home, entry.away);
      const parts = [...sum.matchAll(/(?:ratings|home court|rest) ([+−]?\d+\.\d\d)/g)].map((match) => hundredths(match[1]));
      const by = /by (\d+\.\d)/.exec(sum);

      expect(parts).toHaveLength(3);
      // The margin is written to a tenth, so the sum of the parts is within half a tenth of it.
      if (by) expect(Math.abs(parts[0] + parts[1] + parts[2] - Number(by[1]) * 100)).toBeLessThanOrEqual(5);
    }
  });
});

describe('madeLines', () => {
  it('has a line for each source, in the order of the page', () => {
    expect(madeLines(game(), NEW_YORK).map((line) => line.source)).toEqual(SOURCES.map((entry) => entry.key));
  });

  it('sets the numbers of a model off from what is to be known of them', () => {
    expect(madeLines(game(), NEW_YORK)).toEqual([
      {
        source: 'points_rest',
        figures: 'Detroit by 5.1 = ratings +3.98, home court +1.16, rest 0.00.',
        text: 'This expected margin is a number to compare games by, not a point spread.',
        link: null,
      },
      {
        source: 'elo',
        figures: 'Ratings: Boston 1500, Detroit 1548.',
        text: 'Home court adds 40 rating points for Detroit.',
        link: { href: '#/rankings/BOS-at-DET', label: 'See the sum in the matchup calculator' },
      },
      {
        source: 'market',
        figures: null,
        text:
          'The median of what 6 sportsbooks imply, with their margin taken out. They run from 57% to 60% for Detroit. ' +
          'The first line recorded here, on Oct 10, had Detroit at 55%.',
        link: null,
      },
    ]);
  });

  it('leads from the ratings of Elo to the calculator that does their sum, and not for a game on a neutral floor', () => {
    const inputs = { home: 1548, away: 1500, homeCourt: 40 };
    const link = (neutral: boolean | null) =>
      madeLines(game({ eloInputs: { ...inputs, neutral } }), NEW_YORK).find((line) => line.source === 'elo')?.link ?? null;

    expect(link(false)?.href).toBe('#/rankings/BOS-at-DET');
    // The model file does not say where a game is played, and the calculator says what its sum leaves out.
    expect(link(null)?.href).toBe('#/rankings/BOS-at-DET');
    // The calculator always adds the home court, which a neutral floor does not have.
    expect(link(true)).toBeNull();
  });

  it('gives the margin with its parts, and says that it is not a point spread', () => {
    expect(made({}, 'points_rest')).toBe(
      'Detroit by 5.1 = ratings +3.98, home court +1.16, rest 0.00. ' +
        'This expected margin is a number to compare games by, not a point spread.',
    );
  });

  it.each([
    ['not-yet', 'Made on the morning of the game and not before: it counts rest, and only then is it known who played the evening before.'],
    ['left-out', "Left out today, because the results on record did not pass this morning's checks."],
    ['none', 'No forecast of this model was frozen for the game on the morning of its day.'],
  ] as const)('says why the points-and-rest model has no forecast: %s', (missing, text) => {
    expect(made({ pointsRest: null, missing }, 'points_rest')).toBe(text);
  });

  it('gives Elo’s two ratings and what the home court adds', () => {
    expect(made({}, 'elo')).toBe('Ratings: Boston 1500, Detroit 1548. Home court adds 40 rating points for Detroit.');
  });

  it('says that a neutral floor adds nothing', () => {
    const neutral = { home: 'IND', away: 'DEN', neutral: true, eloInputs: { home: 1480, away: 1602, homeCourt: 0, neutral: true } };

    expect(made(neutral, 'elo')).toBe('Ratings: Denver 1602, Indiana 1480. On a neutral floor home court adds nothing.');
  });

  it('does not guess the floor of a game that only the model file knows the ratings of, and says that the chance can move', () => {
    expect(madeOf(later(), 'elo')).toBe(
      'Ratings: Boston 1500, Detroit 1548. Home court adds 40 rating points for Detroit, unless the floor is neutral. ' +
        'This early look can still move until the morning of the game.',
    );
  });

  it('says what Elo’s chance is when the morning has come and no forecast is frozen for the game', () => {
    expect(madeOf(later({ missing: 'none' }), 'elo')).toBe(
      'Ratings: Boston 1500, Detroit 1548. Home court adds 40 rating points for Detroit, unless the floor is neutral. ' +
        'This chance is what the ratings of the last daily run make of the game. ' +
        'It is not a frozen forecast, and the models are graded on frozen forecasts only.',
    );
  });

  it('leaves Elo out while the page does not hold its ratings', () => {
    expect(madeLines(game({ eloInputs: null }), NEW_YORK).map((line) => line.source)).toEqual(['points_rest', 'market']);
  });

  it('says only what there is to say before the models are built', () => {
    const unbuilt = game({ pointsRest: null, missing: 'not-built', elo: null, eloInputs: null });

    expect(madeLines(unbuilt, NEW_YORK).map((line) => line.source)).toEqual(['market']);
  });

  it('says how many sportsbooks the line is the median of, how far apart they are, and what the first line on record was', () => {
    expect(made({}, 'market')).toBe(
      'The median of what 6 sportsbooks imply, with their margin taken out. They run from 57% to 60% for Detroit. ' +
        'The first line recorded here, on Oct 10, had Detroit at 55%.',
    );
  });

  it('does not say that a line opened on the day the job first saw it', () => {
    // On the real board of 10 October every game has the time of the job's first snapshot as that of its first line.
    for (const key of ['points_rest', 'elo', 'market'] as const) expect(made({}, key)).not.toMatch(/\bopen(ed|s|ing)?\b/i);
  });

  it('writes the sportsbooks’ numbers for the team they pick', () => {
    const boston = { line: { p_home: 0.4109, lo: 0.4045, hi: 0.4188, n: 6 }, open: { p_home: 0.4137, at: '2026-10-18T02:10:23Z' } };

    expect(made(boston, 'market')).toBe(
      'The median of what 6 sportsbooks imply, with their margin taken out. They run from 58% to 60% for Boston. ' +
        'The first line recorded here, on Oct 17, had Boston at 59%.',
    );
  });

  it('says so when a single sportsbook quotes the game', () => {
    expect(made({ line: { p_home: 0.8109, lo: 0.8109, hi: 0.8109, n: 1 }, open: null }, 'market')).toBe(
      'One sportsbook quotes this game. The number is what its prices imply, with its margin taken out.',
    );
  });

  it('says so when the sportsbooks agree to the whole percent', () => {
    expect(made({ line: priced(0.6429), open: null }, 'market')).toBe(
      'The median of what 3 sportsbooks imply, with their margin taken out. They are within a point of each other.',
    );
  });

  it('says of a line from the forecasts file when it is from', () => {
    expect(madeOf(fromFile(), 'market')).toBe(
      'The median of what 6 sportsbooks imply, with their margin taken out. They run from 57% to 60% for Detroit. ' +
        'It is the line as of Mon 9:10 PM, which the job held when it froze the forecasts of the day.',
    );
  });

  it('says that no line has been recorded for a game that never had one', () => {
    expect(made({ line: null, lineAt: null, open: null }, 'market')).toBe('No line has been recorded for this game yet.');
  });

  it('says that the latest snapshot has no line for a game that had one, and gives the first line on record', () => {
    // pipeline/README.md: `line` is null when no sportsbook quoted both teams in this snapshot, and `open` only if it never had one.
    const portland = { home: 'CLE', away: 'POR', line: null, lineAt: null, open: { p_home: 0.4137, at: '2026-11-06T02:10:23Z' } };

    expect(made(portland, 'market')).toBe(
      'No sportsbook quoted both teams in the latest snapshot. The first line recorded here, on Nov 5, had Portland at 59%.',
    );
  });

  it('says of a game from the forecasts file only that the job held no line for it', () => {
    expect(madeOf(fromFile({ line: null, lineAt: null }), 'market')).toBe(
      'The job held no line for this game when it froze the forecasts of the day.',
    );
  });

  it('writes the day of the first line in the time zone of the visitor', () => {
    const late = { open: { p_home: 0.5541, at: '2026-10-11T02:10:00Z' } };

    expect(madeOf(game(late), 'market')).toContain('on Oct 10,');
    expect(madeOf(game(late), 'market', 'Europe/London')).toContain('on Oct 11,');
  });
});

describe('sportsbooksNote', () => {
  it('gives the range for the team the sportsbooks pick', () => {
    expect(sportsbooksNote({ p_home: 0.6429, lo: 0.6265, hi: 0.6542, n: 3 }, 'DET', 'BOS')).toBe('Median of 3 sportsbooks, DET 63% to 65%');
    expect(sportsbooksNote({ p_home: 0.3571, lo: 0.3458, hi: 0.3735, n: 3 }, 'DET', 'BOS')).toBe('Median of 3 sportsbooks, BOS 63% to 65%');
  });

  it('gives the range of a toss-up for the team the line leans to, and for the home team at exactly even', () => {
    expect(sportsbooksNote({ p_home: 0.4993, lo: 0.4947, hi: 0.5079, n: 6 }, 'TOR', 'BOS')).toBe('Median of 6 sportsbooks, BOS 49% to 51%');
    expect(sportsbooksNote({ p_home: 0.5, lo: 0.4871, hi: 0.5079, n: 4 }, 'TOR', 'BOS')).toBe('Median of 4 sportsbooks, TOR 49% to 51%');
  });

  it('says so when there is one sportsbook', () => {
    expect(sportsbooksNote({ p_home: 0.6429, lo: 0.6429, hi: 0.6429, n: 1 }, 'DET', 'BOS')).toBe('1 sportsbook');
  });

  it('says so when the sportsbooks agree to the whole percent', () => {
    expect(sportsbooksNote({ p_home: 0.6429, lo: 0.6391, hi: 0.6448, n: 4 }, 'DET', 'BOS')).toBe(
      '4 sportsbooks within a point of each other',
    );
  });
});

describe('startLabel', () => {
  it('is the time of day where the game starts on its own day', () => {
    expect(startLabel('2026-10-20T23:00:00Z', NEW_YORK)).toBe('7:00 PM EDT');
    expect(startLabel('2026-10-21T02:30:00Z', 'America/Los_Angeles')).toBe('7:30 PM PDT');
  });

  it('adds the date for a visitor in whose time zone the game starts on another date', () => {
    expect(startLabel('2026-10-20T23:00:00Z', 'Europe/London')).toBe('Wed, Oct 21, 12:00 AM GMT+1');
    expect(startLabel('2026-10-21T02:30:00Z', 'Asia/Tokyo')).toBe('Wed, Oct 21, 11:30 AM GMT+9');
  });

  it('keeps to the time of day for a late game on the west coast, which is still of its evening there', () => {
    // 22:30 in Los Angeles on Tuesday. In New York it is half past one on Wednesday morning.
    expect(startLabel('2026-10-21T05:30:00Z', 'America/Los_Angeles')).toBe('10:30 PM PDT');
    expect(startLabel('2026-10-21T05:30:00Z', NEW_YORK)).toBe('Wed, Oct 21, 1:30 AM EDT');
  });
});

describe('chipLabel', () => {
  it('writes the two chips as the page words them', () => {
    expect(chipLabel('different-picks')).toBe('Different picks');
    expect(chipLabel('toss-up')).toBe('Toss-up');
  });
});

describe('boardGame', () => {
  const board = sampleBoard();
  const files: FilesAtHand = { model: sampleModel(), predictions: samplePredictions('2026-11-08') };
  const nothing: FilesAtHand = { model: null, predictions: null };
  const named = (name: string) => {
    const found = board.games.find((entry) => `${entry.away} at ${entry.home}` === name);
    if (!found) throw new Error(`The sample has no ${name}`);
    return found;
  };

  it('takes a game of the frozen day with its forecast and the line of the snapshot', () => {
    const cleveland = boardGame(named('POR at CLE'), board, files);

    expect(cleveland).toMatchObject({
      id: '2ff3bb0a26d458b063af611abe3a697c',
      commence_time: '2026-11-09T00:10:00Z',
      home: 'CLE',
      away: 'POR',
      missing: null,
      elo: 0.6584,
      lineAt: '2026-11-08T23:10:21Z',
      lineFrom: 'snapshot',
      open: { p_home: 0.4137, at: '2026-11-06T02:10:23Z' },
    });
    expect(cleveland.pointsRest?.p_home).toBe(0.595);
    expect(cleveland.line).toMatchObject({ p_home: 0.4109, n: 6 });
  });

  it('takes Elo’s ratings and the floor of such a game from the forecasts file of its day', () => {
    const cleveland = boardGame(named('POR at CLE'), board, files);

    expect(cleveland.eloInputs).toEqual({ home: 1604, away: 1530, homeCourt: 40, neutral: false });
    expect(cleveland.neutral).toBe(false);
  });

  it('falls back to the model file for a game that no forecasts file holds, and does not say where it is played', () => {
    const later = boardGame(named('SAC at CHI'), board, files);
    const ratings = sampleModel().elo.ratings;

    expect(later.missing).toBe('not-yet');
    expect(later.pointsRest).toBeNull();
    expect(later.eloInputs).toEqual({ home: ratings.CHI.rating, away: ratings.SAC.rating, homeCourt: 40, neutral: null });
    expect(later.neutral).toBeNull();
    // The same holds for a game of the frozen day while its forecasts file is not on the page.
    expect(boardGame(named('POR at CLE'), board, { ...files, predictions: null }).eloInputs?.neutral).toBeNull();
  });

  it('gives no ratings while the page holds neither file', () => {
    expect(boardGame(named('SAC at CHI'), board, nothing).eloInputs).toBeNull();
    expect(boardGame(named('SAC at CHI'), board, nothing).elo).toBe(0.6267);
  });

  it('gives no ratings from a model file of another daily run than the board', () => {
    const stale = { ...sampleModel(), results_through: '2026-11-06' };

    expect(boardGame(named('SAC at CHI'), board, { model: stale, predictions: null }).eloInputs).toBeNull();
  });

  it('gives no ratings for a team that the model file does not rate', () => {
    const unknown = { ...named('SAC at CHI'), home: 'SEA' };

    expect(boardGame(unknown, board, files).eloInputs).toBeNull();
  });

  it('gives no ratings for a game that Elo has no chance for', () => {
    const unforecast = { ...named('SAC at CHI'), elo: null };

    expect(boardGame(unforecast, { ...board, models: null }, files)).toMatchObject({ elo: null, eloInputs: null, missing: 'not-built' });
  });

  it('carries a game without a line as it is', () => {
    const unquoted = board.games.find((entry) => entry.line === null);
    if (!unquoted) throw new Error('The sample has no game without a line');

    expect(boardGame(unquoted, board, files)).toMatchObject({ line: null, lineAt: null, open: null, lineFrom: 'snapshot' });
  });
});

describe('forecastGame', () => {
  it('takes a game of a forecasts file with the forecasts of its morning and the line as it stood then', () => {
    const detroit = forecastGame(samplePredictions('2026-11-08').games[1]);

    expect(detroit).toMatchObject({
      id: '1125672ec18b40642d961db4c84e8e93',
      home: 'DET',
      away: 'LAC',
      missing: null,
      elo: 0.5273,
      eloInputs: { home: 1559, away: 1580, homeCourt: 40, neutral: false },
      lineAt: '2026-11-08T02:10:53Z',
      lineFrom: 'morning',
      open: null,
      neutral: false,
    });
    expect(detroit.pointsRest?.p_home).toBe(0.4992);
    expect(detroit.line?.p_home).toBe(0.597);
  });

  it('says left out for a game of a day on which the points-and-rest model was left out', () => {
    const monday = samplePredictions('2026-11-02');

    expect(monday.status).toBe('degraded');
    expect(monday.games.map(forecastGame).map((entry) => entry.missing)).toEqual(monday.games.map(() => 'left-out'));
    expect(gameCardView(forecastGame(monday.games[0]), NEW_YORK).caption).toBe('Elo alone: Points & Rest is left out today');
  });

  it('knows a neutral floor, where neither model gives the home team anything', () => {
    const mexicoCity = samplePredictions('2026-11-07').games.find((entry) => entry.neutral);
    if (!mexicoCity) throw new Error('The sample has no game on a neutral floor');
    const view = gameCardView(forecastGame(mexicoCity), NEW_YORK);

    expect(view.neutral).toBe(true);
    expect(view.title).toBe('Denver Nuggets against Indiana Pacers, on a neutral floor');
    expect(view.made.find((line) => line.source === 'elo')?.text).toMatch(/On a neutral floor home court adds nothing\.$/);
    expect(view.made.find((line) => line.source === 'points_rest')?.figures).toContain('home court 0.00');
  });

  it('carries a game that no sportsbook had quoted by the morning', () => {
    const unquoted = samplePredictions('2026-11-07').games.find((entry) => entry.market === null);
    if (!unquoted) throw new Error('The sample has no forecast without a line');

    expect(forecastGame(unquoted)).toMatchObject({ line: null, lineAt: null, lineFrom: 'morning' });
    expect(gameCardView(forecastGame(unquoted), NEW_YORK).rows[2]).toMatchObject({
      kind: 'missing',
      label: 'No line that morning',
      qualifier: null,
    });
  });
});
