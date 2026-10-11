import { describe, expect, it } from 'vitest';
import type { Board, BoardGame } from '../data/board';
import type { DayPredictions } from '../data/predictions';
import { SAMPLE_NOW, sampleBoard, sampleModel, samplePredictions } from '../data/sampleData';
import { gameDay } from './day';
import type { FilesAtHand, GameCardView } from './gameCard';
import {
  dayHeading,
  filteredOut,
  gamesView,
  neighbors,
  NO_FILTERS,
  shownOf,
  startedGames,
  startedNote,
  unlistedGames,
  unlistedNote,
  upcomingGames,
  type GamesOptions,
  type GamesView,
} from './games';
import { gamesIntro, NO_RECORD_YET, recordSummary, recordTiles } from './gamesIntro';
import { unwantedWords } from './wordRules';

const NEW_YORK = 'America/New_York';
const SUNDAY = '2026-11-08';
/** Late on Sunday evening in the sample: the five games of the day that the board still lists have started. */
const LATE = Date.parse('2026-11-09T04:00:00Z');
/** Monday at six in the morning in New York: the page's day has turned, and the board is still the one of Sunday evening. */
const MONDAY_MORNING = Date.parse('2026-11-09T11:00:00Z');

const WAS_AT_NYK = '581e86cc9475dc891bd292041d4c6e43';
const LAC_AT_DET = '1125672ec18b40642d961db4c84e8e93';

function files(): FilesAtHand {
  return { model: sampleModel(), predictions: samplePredictions(SUNDAY) };
}

const NO_FILES: FilesAtHand = { model: null, predictions: null };

/** The view of the sample as a preview shows it, with what a test changes. */
function view(changes: Partial<GamesOptions> = {}): GamesView {
  return gamesView({
    board: sampleBoard(),
    now: SAMPLE_NOW,
    param: null,
    files: files(),
    myTeams: new Set(),
    filters: NO_FILTERS,
    timeZone: NEW_YORK,
    ...changes,
  });
}

const called = (card: GameCardView) => `${card.away.code} at ${card.home.code}`;
const counts = (shown: GamesView) => shown.days.map((chip) => chip.games);

/**
 * The board as it is ten days before opening night, made from the sample:
 * no result, no record, no frozen forecast, and Elo's chance for every game.
 */
function preseasonBoard(): Board {
  const board = sampleBoard();
  const nothing = { wins: 0, losses: 0 };
  return {
    ...board,
    generated_at: '2026-10-29T22:10:21Z',
    slot: '2026-10-29T18:10-04:00',
    next_due: '2026-10-29T21:10-04:00',
    games: board.games.map((game) => ({ ...game, points_rest: null })),
    models: { results_through: null, status: 'ok', predictions_day: null },
    record: { market: nothing, elo: nothing, points_rest: nothing },
    recent_results: [],
  };
}

const PRESEASON_NOW = Date.parse('2026-10-29T22:30:00Z');

const PHI_AT_LAL = 'PHI at LAL';
/** The last snapshot of a day is taken at 21:10 in New York. */
const LAST_SNAPSHOT = '2026-11-09T02:10:25Z';
/** Ten in the evening in New York on that Sunday, after the last snapshot of the day. */
const NIGHT = Date.parse('2026-11-09T03:00:00Z');

/**
 * The last snapshot of a lighter Sunday, on which every game had started by
 * 21:10 in New York: the board lists no game of the day any more.
 */
function nightBoard(): Board {
  const board = sampleBoard();
  return {
    ...board,
    generated_at: LAST_SNAPSHOT,
    slot: '2026-11-08T21:10-05:00',
    next_due: '2026-11-09T05:10-05:00',
    games: board.games.filter((game) => gameDay(game.commence_time) !== SUNDAY),
  };
}

/** The forecasts of that lighter Sunday: the ones of the sample without the one game that starts after 21:10. */
function nightForecasts(): DayPredictions {
  const file = samplePredictions(SUNDAY);
  return { ...file, games: file.games.filter((game) => game.commence_time < LAST_SNAPSHOT) };
}

/**
 * The board of Sunday evening after a morning on which the daily work was not
 * done: what the forecasts rest on is still of Saturday, and no game of
 * Sunday has a frozen forecast.
 */
function boardWithoutDailyWork(): Board {
  const board = sampleBoard();
  return {
    ...board,
    models: { results_through: '2026-11-06', status: 'ok', predictions_day: '2026-11-07' },
    games: board.games.map((game) => ({ ...game, points_rest: null })),
  };
}

/** The board of the sample without one of its games, as a feed that dropped the game would leave it. */
function boardWithout(name: string): Board {
  const board = sampleBoard();
  const games = board.games.filter((game) => `${game.away} at ${game.home}` !== name);
  if (games.length !== board.games.length - 1) throw new Error(`The sample has no ${name}`);
  return { ...board, games };
}

describe('upcomingGames', () => {
  const NOW = Date.parse('2026-10-20T23:30:00Z');
  const template = sampleBoard().games[0];
  const at = (id: string, commence_time: string): BoardGame => ({ ...template, id, commence_time });
  const ids = (games: BoardGame[]) => upcomingGames({ ...sampleBoard(), games }, NOW).map((game) => game.id);

  it('orders the games by start time, soonest first', () => {
    const games = [
      at('next-week', '2026-10-27T23:00:00Z'),
      at('tonight', '2026-10-21T02:00:00Z'),
      at('tomorrow', '2026-10-21T23:00:00Z'),
    ];

    expect(ids(games)).toEqual(['tonight', 'tomorrow', 'next-week']);
  });

  it('keeps games that start at the same time in the order of the board', () => {
    expect(ids([at('b', '2026-10-21T23:00:00Z'), at('a', '2026-10-21T23:00:00Z')])).toEqual(['b', 'a']);
  });

  it('leaves out a game that has started', () => {
    const games = [
      at('started-half-an-hour-ago', '2026-10-20T23:00:00Z'),
      at('starting-now', '2026-10-20T23:30:00Z'),
      at('in-a-minute', '2026-10-20T23:31:00Z'),
    ];

    expect(ids(games)).toEqual(['in-a-minute']);
  });

  it('is empty for a board without games', () => {
    expect(ids([])).toEqual([]);
  });

  it('is every game of the sample at the moment a preview looks at it', () => {
    expect(upcomingGames(sampleBoard(), SAMPLE_NOW)).toHaveLength(26);
  });
});

describe('startedGames', () => {
  it('finds the games of the day that have left the board in the forecasts file, with the line of the morning', () => {
    const started = startedGames(sampleBoard(), SAMPLE_NOW, files());

    expect(started.map((game) => game.id)).toEqual([WAS_AT_NYK, LAC_AT_DET]);
    expect(started.map((game) => game.lineFrom)).toEqual(['morning', 'morning']);
    expect(started[1].pointsRest?.p_home).toBe(0.4992);
  });

  it('knows of none of them while the forecasts file is not on the page', () => {
    expect(startedGames(sampleBoard(), SAMPLE_NOW, NO_FILES)).toEqual([]);
  });

  it('takes a late game that the board still lists from the board, with the line of the last snapshot', () => {
    const started = startedGames(sampleBoard(), LATE, files());

    expect(started.map((game) => `${game.away} at ${game.home}`)).toEqual([
      'WAS at NYK',
      'LAC at DET',
      'POR at CLE',
      'BOS at TOR',
      'MEM at MIN',
      'CHA at UTA',
      'PHI at LAL',
    ]);
    expect(started.map((game) => game.lineFrom)).toEqual([
      'morning',
      'morning',
      'snapshot',
      'snapshot',
      'snapshot',
      'snapshot',
      'snapshot',
    ]);
    // A game that is in both files is shown once.
    expect(new Set(started.map((game) => game.id)).size).toBe(7);
  });

  it('shows the late games of the board without the forecasts file as well', () => {
    expect(startedGames(sampleBoard(), LATE, NO_FILES)).toHaveLength(5);
  });

  it('leaves out a game of the forecasts file that has not started', () => {
    // Half past five in New York: the game in New York is under way, and the one in Detroit starts at six.
    const started = startedGames(sampleBoard(), Date.parse('2026-11-08T22:30:00Z'), files());

    expect(started.map((game) => game.id)).toEqual([WAS_AT_NYK]);
  });

  it('counts a game as started from the moment of its start', () => {
    const tipOff = Date.parse('2026-11-08T23:00:00Z');

    expect(startedGames(sampleBoard(), tipOff - 1, files()).map((game) => game.id)).toEqual([WAS_AT_NYK]);
    expect(startedGames(sampleBoard(), tipOff, files()).map((game) => game.id)).toEqual([WAS_AT_NYK, LAC_AT_DET]);
  });

  it('leaves out a game whose result is on the board', () => {
    const board = sampleBoard();
    board.recent_results.push({ ...board.recent_results[0], id: WAS_AT_NYK });

    expect(startedGames(board, SAMPLE_NOW, files()).map((game) => game.id)).toEqual([LAC_AT_DET]);
  });

  it('is over with the day: on the next morning the games of last night are no longer the started ones', () => {
    expect(startedGames(sampleBoard(), MONDAY_MORNING, files())).toEqual([]);
  });

  it('takes nothing from a forecasts file of another day', () => {
    const saturday = { model: null, predictions: samplePredictions('2026-11-07') };

    expect(startedGames(sampleBoard(), SAMPLE_NOW, saturday)).toEqual([]);
  });

  it('does not call a game started that a board taken before its start no longer lists', () => {
    // Philadelphia at the Lakers is set for 22:40 in New York, and the snapshot of 18:10 does not list it.
    const dropped = boardWithout(PHI_AT_LAL);
    const names = (now: number) => startedGames(dropped, now, files()).map((game) => `${game.away} at ${game.home}`);

    expect(names(SAMPLE_NOW)).toEqual(['WAS at NYK', 'LAC at DET']);
    // Twenty minutes after the scheduled start it is not among the started games either.
    expect(names(LATE)).toEqual(['WAS at NYK', 'LAC at DET', 'POR at CLE', 'BOS at TOR', 'MEM at MIN', 'CHA at UTA']);
  });
});

describe('unlistedGames', () => {
  const names = (board: Board, now: number, at: FilesAtHand = files()) =>
    unlistedGames(board, now, at).map((game) => `${game.away} at ${game.home}`);

  it('is empty while the board lists every game of the morning that is still to start', () => {
    expect(names(sampleBoard(), SAMPLE_NOW)).toEqual([]);
    expect(names(sampleBoard(), LATE)).toEqual([]);
  });

  it('holds a game of the morning that a board taken before its start does not list, before and after the scheduled start', () => {
    const dropped = boardWithout(PHI_AT_LAL);

    expect(names(dropped, SAMPLE_NOW)).toEqual([PHI_AT_LAL]);
    expect(names(dropped, LATE)).toEqual([PHI_AT_LAL]);
    expect(unlistedGames(dropped, LATE, files())[0]).toMatchObject({ lineFrom: 'morning', missing: null });
  });

  it('does not hold a game that started before the board was taken: that one has left the board by starting', () => {
    // The two early games of the sample started before its snapshot of 18:10.
    expect(names(sampleBoard(), SAMPLE_NOW)).not.toContain('WAS at NYK');
  });

  it('knows of none without the forecasts file, and none once the day is over or the result is on the board', () => {
    const dropped = boardWithout(PHI_AT_LAL);
    const recorded = boardWithout(PHI_AT_LAL);
    const lakers = sampleBoard().games.find((game) => `${game.away} at ${game.home}` === PHI_AT_LAL);
    recorded.recent_results.push({ ...recorded.recent_results[0], id: lakers?.id ?? '' });

    expect(names(dropped, SAMPLE_NOW, NO_FILES)).toEqual([]);
    expect(names(dropped, MONDAY_MORNING)).toEqual([]);
    expect(names(recorded, SAMPLE_NOW)).toEqual([]);
  });
});

describe('gamesView', () => {
  it('has a chip for each day that has a game, with the current day selected', () => {
    expect(view().days).toEqual([
      { day: '2026-11-08', label: 'Today', games: 7, selected: true },
      { day: '2026-11-09', label: 'Tomorrow', games: 8, selected: false },
      { day: '2026-11-10', label: 'Tue, Nov 10', games: 5, selected: false },
      { day: '2026-11-11', label: 'Wed, Nov 11', games: 8, selected: false },
    ]);
  });

  it('calls the day of the frozen forecasts today once the board carries them, before the day by the clock has turned', () => {
    // Half past nine UTC on that Sunday: the clock's day is still Saturday, and the board is the one of Sunday morning.
    const early = view({ now: Date.parse('2026-11-08T09:30:00Z') });

    expect(early.days.map((chip) => chip.label)).toEqual(['Today', 'Tomorrow', 'Tue, Nov 10', 'Wed, Nov 11']);
    expect(early.selected).toBe(SUNDAY);
    expect(early.heading).toBe('Today · Sun, Nov 8');
    // No game of the new day has started, so all seven are to come.
    expect(early.started).toEqual([]);
    expect(early.upcoming.every((card) => card.caption === 'Points & Rest, made this morning')).toBe(true);
  });

  it('shows the games of the current day: the ones to come as the board has them, and the ones that have started', () => {
    const shown = view();

    expect(shown.selected).toBe(SUNDAY);
    expect(shown.heading).toBe('Today · Sun, Nov 8');
    expect(shown.total).toBe(7);
    expect(shown.upcoming.map(called)).toEqual(['POR at CLE', 'BOS at TOR', 'MEM at MIN', 'CHA at UTA', 'PHI at LAL']);
    expect(shown.started.map(called)).toEqual(['WAS at NYK', 'LAC at DET']);
  });

  it('leads every card of the current day with the frozen forecast of the points-and-rest model', () => {
    const shown = view();

    for (const card of [...shown.upcoming, ...shown.started]) {
      expect(card.headline, called(card)).toBe('points_rest');
      expect(card.caption).toBe('Points & Rest, made this morning');
    }
    expect(shown.upcoming.map((card) => card.start)).toEqual(['7:10 PM EST', '7:40 PM EST', '8:40 PM EST', '9:10 PM EST', '10:40 PM EST']);
  });

  it('shows the states that the sample holds on the current day', () => {
    const shown = view();
    const of = (name: string) => [...shown.upcoming, ...shown.started].find((card) => called(card) === name);

    expect(of('POR at CLE')).toMatchObject({
      chip: 'different-picks',
      note: 'Points & Rest and Elo pick Cleveland, the sportsbooks pick Portland.',
    });
    expect(of('BOS at TOR')?.rows[2]).toMatchObject({ kind: 'toss-up', label: 'Toss-up' });
    expect(of('MEM at MIN')?.rows[2].note).toBe('1 sportsbook');
    expect(of('CHA at UTA')?.made[0].figures).toBe('Charlotte by 3.1 = ratings +6.43, home court −1.91, rest −1.39.');
    expect(of('PHI at LAL')?.rows.map((entry) => entry.label)).toEqual(['LAL 74%', 'LAL 74%', 'LAL 81%']);
    expect(of('LAC at DET')).toMatchObject({ chip: 'toss-up', home: { picked: false }, away: { picked: false } });
    // The line of a game that has left the board is the one of the forecasts file, taken at 21:10 the evening before.
    expect(of('WAS at NYK')?.rows[2]).toMatchObject({ label: 'NYK 94%', qualifier: 'as of Sat 9:10 PM' });
  });

  it('shows the games on the board alone until the forecasts file arrives', () => {
    const shown = view({ files: NO_FILES });

    expect(shown.days[0]).toMatchObject({ label: 'Today', games: 5, selected: true });
    expect(shown.upcoming).toHaveLength(5);
    expect(shown.started).toEqual([]);
    // The games of the day that have started are in that file alone.
    expect(shown.awaitingStarted).toBe(true);
    expect(view().awaitingStarted).toBe(false);
    // Elo's line of "How these numbers are made" is left out while the ratings are not on the page.
    expect(shown.upcoming[0].made.map((line) => line.source)).toEqual(['points_rest', 'market']);
  });

  it('shows another day when the address names it, with Elo’s early look for its games', () => {
    const shown = view({ param: '2026-11-10' });

    expect(shown.selected).toBe('2026-11-10');
    expect(shown.heading).toBe('Tue, Nov 10');
    expect(shown.days.map((chip) => chip.selected)).toEqual([false, false, true, false]);
    expect(shown.upcoming.map(called)).toEqual(['MIA at CHA', 'MIN at DAL', 'SAC at CHI', 'DET at UTA', 'BOS at POR']);
    expect(shown.started).toEqual([]);
    expect(shown.total).toBe(5);
    for (const card of shown.upcoming) {
      expect(card.headline).toBe('elo');
      expect(card.caption).toBe('Elo, early look: the full forecast comes on the morning of the game');
      expect(card.rows[0]).toMatchObject({ kind: 'missing', label: 'Morning of the game' });
      expect(card.neutral).toBeNull();
    }
    expect(shown.upcoming[2]).toMatchObject({ chip: 'different-picks', note: 'Elo picks Chicago, the sportsbooks pick Sacramento.' });
  });

  it('shows a game without a line with Elo alone, and says that there is no line yet', () => {
    const wednesday = view({ param: '2026-11-11' });
    const unquoted = wednesday.upcoming.filter((card) => card.rows[2].kind === 'missing');

    expect(wednesday.heading).toBe('Wed, Nov 11');
    expect(unquoted).toHaveLength(7);
    for (const card of unquoted) {
      expect(card.rows[2].label).toBe('No line yet');
      expect(card.headline).toBe('elo');
      expect(card.note).toBeNull();
      expect(card.chip === null || card.chip === 'toss-up').toBe(true);
    }
  });

  it.each(['2026-11-07', '2026-11-30', '2026-02-30', 'tomorrow', '../record', ''])(
    'goes back to the current day when the address names %j, which is no day with a game',
    (param) => {
      expect(view({ param }).selected).toBe(SUNDAY);
    },
  );

  it('keeps the current day while its last games are under way, with nothing more to come', () => {
    const shown = view({ now: LATE });

    expect(shown.days[0]).toEqual({ day: SUNDAY, label: 'Today', games: 7, selected: true });
    expect(shown.upcoming).toEqual([]);
    expect(shown.started).toHaveLength(7);
    expect(shown.total).toBe(7);
  });

  it('stays on the current day late in the evening, when the board lists none of its games and the forecasts file is still to come', () => {
    const waiting = view({ board: nightBoard(), now: NIGHT, files: NO_FILES });

    // Without the file the page knows no game of the day. It does not open on tomorrow, to replace its cards a moment later.
    expect(waiting.days.map((chip) => [chip.label, chip.games])).toEqual([
      ['Today', 0],
      ['Tomorrow', 8],
      ['Tue, Nov 10', 5],
      ['Wed, Nov 11', 8],
    ]);
    expect(waiting.selected).toBe(SUNDAY);
    expect(waiting.heading).toBe('Today · Sun, Nov 8');
    expect(waiting).toMatchObject({ upcoming: [], started: [], unlisted: [], total: 0, awaitingStarted: true });
    expect(filteredOut(waiting)).toBeNull();
  });

  it('shows the games of such an evening once the forecasts file is here', () => {
    const shown = view({ board: nightBoard(), now: NIGHT, files: { model: sampleModel(), predictions: nightForecasts() } });

    expect(shown.days[0]).toEqual({ day: SUNDAY, label: 'Today', games: 6, selected: true });
    expect(shown.started.map(called)).toEqual(['WAS at NYK', 'LAC at DET', 'POR at CLE', 'BOS at TOR', 'MEM at MIN', 'CHA at UTA']);
    expect(shown.awaitingStarted).toBe(false);
  });

  it('waits for no file when the board carries no forecasts of the current day', () => {
    expect(view({ board: preseasonBoard(), now: PRESEASON_NOW, files: NO_FILES }).awaitingStarted).toBe(false);
    expect(view({ now: MONDAY_MORNING, files: NO_FILES }).awaitingStarted).toBe(false);
  });

  it('shows a game that the latest snapshot no longer lists apart, and still counts it among the games of the day', () => {
    const shown = view({ board: boardWithout(PHI_AT_LAL), now: LATE });

    expect(shown.days[0]).toEqual({ day: SUNDAY, label: 'Today', games: 7, selected: true });
    expect(shown.unlisted.map(called)).toEqual([PHI_AT_LAL]);
    expect(shown.started.map(called)).not.toContain(PHI_AT_LAL);
    expect(shown.total).toBe(7);
    // It is of the current day alone.
    expect(view({ board: boardWithout(PHI_AT_LAL), now: LATE, param: '2026-11-09' }).unlisted).toEqual([]);
  });

  it('moves on to the next day when the page’s day turns, and shows the games of last night nowhere', () => {
    const shown = view({ now: MONDAY_MORNING });

    expect(shown.days.map((chip) => chip.label)).toEqual(['Today', 'Tomorrow', 'Wed, Nov 11']);
    expect(shown.selected).toBe('2026-11-09');
    expect(shown.heading).toBe('Today · Mon, Nov 9');
    expect(shown.started).toEqual([]);
    // The board is still the one of Sunday, on which the morning of these games had not come.
    expect(shown.upcoming[0].rows[0]).toMatchObject({ kind: 'missing', label: 'Morning of the game' });
    expect(shown.upcoming[0].headline).toBe('elo');
  });

  it('says so when the morning of a game has come and the board holds no forecast for it', () => {
    // The snapshot of noon on Monday, taken although the daily work of Monday was not done.
    const noon = {
      ...sampleBoard(),
      generated_at: '2026-11-09T17:10:21Z',
      slot: '2026-11-09T12:10-05:00',
      next_due: '2026-11-09T15:10-05:00',
    };
    const shown = view({ board: noon, now: Date.parse('2026-11-09T17:30:00Z') });

    expect(shown.heading).toBe('Today · Mon, Nov 9');
    expect(shown.upcoming[0].rows[0]).toMatchObject({ kind: 'missing', label: 'No forecast' });
    expect(shown.upcoming[0].caption).toBe('Elo from its current ratings: no forecast is frozen for this game, so the models are not graded on it');
    expect(shown.upcoming[0].rows[1]).toMatchObject({ kind: 'pick', qualifier: 'not frozen' });
  });

  it('offers the filter for different picks when a game has them, and the one for my teams when a team is followed', () => {
    expect(view().offered).toEqual({ myTeams: false, differentPicks: true });
    expect(view({ myTeams: new Set(['CLE']) }).offered).toEqual({ myTeams: true, differentPicks: true });
  });

  it('does not offer the filter for different picks when no game has them', () => {
    const board = sampleBoard();
    const agreeing = { ...board, games: board.games.map((game) => ({ ...game, line: null })) };

    expect(view({ board: agreeing, files: NO_FILES }).offered.differentPicks).toBe(false);
  });

  it('applies no filter that is not offered, although it is switched on', () => {
    const shown = view({ filters: { myTeams: true, differentPicks: false } });

    expect(shown.applied).toEqual(NO_FILTERS);
    expect(shown.upcoming).toHaveLength(5);
  });

  it('keeps the games with different picks, and counts them on every day', () => {
    const shown = view({ filters: { myTeams: false, differentPicks: true } });

    expect(shown.applied).toEqual({ myTeams: false, differentPicks: true });
    expect(shown.upcoming.map(called)).toEqual(['POR at CLE']);
    expect(shown.started).toEqual([]);
    expect(shown.total).toBe(7);
    expect(counts(shown)).toEqual([1, 0, 1, 0]);
  });

  it('keeps the games of the teams a visitor follows, at home and away, started or not', () => {
    const shown = view({ myTeams: new Set(['CLE', 'CHA', 'NYK']), filters: { myTeams: true, differentPicks: false } });

    expect(shown.upcoming.map(called)).toEqual(['POR at CLE', 'CHA at UTA']);
    expect(shown.started.map(called)).toEqual(['WAS at NYK']);
    expect(counts(shown)).toEqual([3, 0, 1, 2]);
  });

  it('keeps what passes both filters when both are on', () => {
    const shown = view({ myTeams: new Set(['CLE', 'CHA']), filters: { myTeams: true, differentPicks: true } });

    expect(shown.upcoming.map(called)).toEqual(['POR at CLE']);
    expect(counts(shown)).toEqual([1, 0, 0, 0]);
  });

  it('stays on the selected day when the filters hide all of its games', () => {
    const shown = view({ param: '2026-11-09', filters: { myTeams: false, differentPicks: true } });

    expect(shown.selected).toBe('2026-11-09');
    expect(shown.upcoming).toEqual([]);
    expect(shown.total).toBe(8);
  });

  it('shows the board of before the season: Elo’s early look for every game, on the first day that has one', () => {
    const shown = view({ board: preseasonBoard(), now: PRESEASON_NOW, files: NO_FILES });

    expect(shown.days.map((chip) => chip.label)).toEqual(['Sun, Nov 8', 'Mon, Nov 9', 'Tue, Nov 10', 'Wed, Nov 11']);
    expect(shown.selected).toBe(SUNDAY);
    expect(shown.heading).toBe('Sun, Nov 8');
    expect(shown.started).toEqual([]);
    expect(shown.upcoming).toHaveLength(5);
    for (const card of shown.upcoming) {
      expect(card.headline).toBe('elo');
      expect(card.rows[0]).toMatchObject({ kind: 'missing', label: 'Morning of the game' });
    }
  });

  it('has no day and no card for a board without a game and without forecasts of the current day', () => {
    const board = sampleBoard();
    const empty = { ...board, games: [], models: board.models && { ...board.models, predictions_day: null } };
    const shown = view({ board: empty, files: NO_FILES });

    expect(shown).toMatchObject({ days: [], selected: null, heading: null, upcoming: [], started: [], unlisted: [], total: 0 });
    expect(shown.awaitingStarted).toBe(false);
    expect(shown.offered).toEqual(NO_FILTERS);
  });

  it('shows the sportsbooks alone on a board without forecasts', () => {
    const board = sampleBoard();
    const unforecast = { ...board, models: null, games: board.games.map((game) => ({ ...game, elo: null, points_rest: null })) };
    const shown = view({ board: unforecast, files: NO_FILES });

    expect(shown.upcoming[0]).toMatchObject({ headline: 'market', caption: 'Sportsbooks alone: the models have not made a forecast yet' });
    expect(shown.upcoming[0].rows.map((entry) => entry.label)).toEqual(['No forecast yet', 'No forecast yet', 'POR 59%']);
    expect(shown.offered.differentPicks).toBe(false);
  });
});

describe('dayHeading', () => {
  it('says today and tomorrow with the date, and any other day by its date', () => {
    expect(dayHeading('2026-11-08', SUNDAY)).toBe('Today · Sun, Nov 8');
    expect(dayHeading('2026-11-09', SUNDAY)).toBe('Tomorrow · Mon, Nov 9');
    expect(dayHeading('2026-11-10', SUNDAY)).toBe('Tue, Nov 10');
  });
});

describe('shownOf', () => {
  it('counts the games, and says of how many when some are hidden', () => {
    expect(shownOf(5, 5)).toBe('5 games');
    expect(shownOf(1, 1)).toBe('1 game');
    expect(shownOf(2, 5)).toBe('2 of 5 games');
    expect(shownOf(0, 1)).toBe('0 of 1 game');
  });
});

describe('neighbors', () => {
  it('gives the day before and the day after the selected one', () => {
    const { previous, next } = neighbors(view({ param: '2026-11-10' }).days);

    expect(previous).toMatchObject({ day: '2026-11-09', label: 'Tomorrow', games: 8 });
    expect(next).toMatchObject({ day: '2026-11-11', label: 'Wed, Nov 11', games: 8 });
  });

  it('has nothing before the first day and nothing after the last', () => {
    expect(neighbors(view().days)).toMatchObject({ previous: null, next: { day: '2026-11-09' } });
    expect(neighbors(view({ param: '2026-11-11' }).days)).toMatchObject({ previous: { day: '2026-11-10' }, next: null });
  });

  it('has nothing on either side without a day', () => {
    expect(neighbors([])).toEqual({ previous: null, next: null });
  });
});

describe('startedNote', () => {
  const DUE = 'Results are due on the morning of Mon, Nov 9.';

  it('says that the forecasts are those frozen on the morning of the day, and when the results come, both by their dates', () => {
    expect(startedNote(view().started, SUNDAY)).toBe(
      `Under way or just over, with the forecasts as they were frozen on the morning of Sun, Nov 8. ${DUE}`,
    );
    expect(startedNote(view({ now: LATE }).started, SUNDAY)).toBe(
      `Under way or just over, with the forecasts as they were frozen on the morning of Sun, Nov 8. ${DUE}`,
    );
  });

  it('does not speak of forecasts on a board that has none', () => {
    const board = sampleBoard();
    const unforecast = { ...board, models: null, games: board.games.map((game) => ({ ...game, elo: null, points_rest: null })) };
    const started = view({ board: unforecast, now: LATE, files: NO_FILES }).started;

    expect(started).toHaveLength(5);
    expect(startedNote(started, SUNDAY)).toBe(`Under way or just over. ${DUE}`);
  });

  it('does not call a number of Elo a forecast of the morning on a day whose morning froze none', () => {
    const started = view({ board: boardWithoutDailyWork(), now: LATE, files: NO_FILES }).started;

    expect(started).toHaveLength(5);
    expect(started.every((card) => card.headline === 'elo' && !card.frozen)).toBe(true);
    expect(started[0].rows[1]).toMatchObject({ kind: 'pick', qualifier: 'not frozen' });
    expect(startedNote(started, SUNDAY)).toBe(
      `Under way or just over. No forecast was frozen for these games, so the models are not graded on them. ${DUE}`,
    );
    expect(startedNote(started.slice(0, 1), SUNDAY)).toBe(
      `Under way or just over. No forecast was frozen for this game, so the models are not graded on it. ${DUE}`,
    );
  });

  it('says which cards have no frozen forecast when only some of them have none', () => {
    // A game that the job did not know of on the morning of the day: the board has Elo's running number for it and nothing else.
    const board = sampleBoard();
    const late = { ...board, games: board.games.map((game, index) => (index === 0 ? { ...game, points_rest: null } : game)) };
    const started = view({ board: late, now: LATE }).started;

    expect(started.filter((card) => !card.frozen)).toHaveLength(1);
    expect(startedNote(started, SUNDAY)).toBe(
      'Under way or just over, with the forecasts as they were frozen on the morning of Sun, Nov 8. ' +
        `Where a card says "not frozen", no forecast was frozen for its game. ${DUE}`,
    );
  });
});

describe('unlistedNote', () => {
  it('says what the page knows of such a game, and no more', () => {
    expect(unlistedNote(SUNDAY, 1)).toBe(
      "The latest snapshot of the sportsbooks' lines does not list this game, although it was taken before the scheduled start: " +
        'the game may have been put off or moved. The forecasts are the ones frozen on the morning of Sun, Nov 8.',
    );
    expect(unlistedNote(SUNDAY, 2)).toBe(
      "The latest snapshot of the sportsbooks' lines does not list these games, although it was taken before their scheduled start: " +
        'they may have been put off or moved. The forecasts are the ones frozen on the morning of Sun, Nov 8.',
    );
  });
});

describe('filteredOut', () => {
  const differentPicks = { myTeams: false, differentPicks: true };
  const mine = { myTeams: true, differentPicks: false };

  it('is nothing while the selected day shows a game', () => {
    expect(filteredOut(view())).toBeNull();
    expect(filteredOut(view({ filters: differentPicks }))).toBeNull();
    expect(filteredOut(view({ board: { ...sampleBoard(), games: [] }, files: NO_FILES }))).toBeNull();
  });

  it('says which filter hides the games of the day, and where it keeps one', () => {
    expect(filteredOut(view({ param: '2026-11-09', filters: differentPicks }))).toEqual({
      title: 'No game tomorrow has different picks',
      text: 'The filter Different picks hides the 8 games of the day.',
      showAll: 'Show all 8 games',
      elsewhere: { day: '2026-11-10', label: 'See the game on Tue, Nov 10' },
    });
  });

  it('leads to the next day that has a game of the visitor’s teams', () => {
    expect(filteredOut(view({ param: '2026-11-09', myTeams: new Set(['CLE', 'LAC']), filters: mine }))).toEqual({
      title: 'None of your teams plays tomorrow',
      text: 'The filter My teams hides the 8 games of the day.',
      showAll: 'Show all 8 games',
      elsewhere: { day: '2026-11-11', label: 'See the 2 games on Wed, Nov 11' },
    });
  });

  it('leads back to an earlier day when no later day has one', () => {
    const hidden = filteredOut(view({ param: '2026-11-11', filters: differentPicks }));

    expect(hidden?.title).toBe('No game on Wed, Nov 11 has different picks');
    expect(hidden?.elsewhere).toEqual({ day: '2026-11-10', label: 'See the game on Tue, Nov 10' });
  });

  it('says today for the current day, and leads nowhere when the filters keep no game on any day', () => {
    // Boston and Denver have a game on every day of the board, and in none of them the picks differ.
    const lonely = view({ myTeams: new Set(['BOS', 'DEN']), filters: { myTeams: true, differentPicks: true } });

    expect(filteredOut(lonely)).toEqual({
      title: 'No game of your teams today has different picks',
      text: 'The filters My teams and Different picks hide the 7 games of the day.',
      showAll: 'Show all 7 games',
      elsewhere: null,
    });
  });

  it('speaks of one game as one', () => {
    const board = sampleBoard();
    const single = { ...board, games: board.games.filter((game) => game.home === 'CLE' || game.home === 'CHI') };
    const hidden = filteredOut(view({ board: single, files: NO_FILES, param: '2026-11-11', filters: differentPicks }));

    expect(hidden?.text).toBe('The filter Different picks hides the one game of the day.');
    expect(hidden?.showAll).toBe('Show the game');
  });
});

describe('the words of the view', () => {
  const EVERY_FILTER = [
    { myTeams: true, differentPicks: false },
    { myTeams: false, differentPicks: true },
    { myTeams: true, differentPicks: true },
  ];

  /** Everything that the view writes for one moment of a board, from the introduction to the last card. */
  function words(board: Board, now: number, at: FilesAtHand): string[] {
    const intro = gamesIntro(board, now);
    const cards = view({ board, now, files: at }).days.flatMap((chip) => {
      const day = view({ board, now, files: at, param: chip.day });
      return [...day.upcoming, ...day.started, ...day.unlisted];
    });
    return [
      ...intro.sentences,
      intro.leftOut?.title ?? '',
      intro.leftOut?.text ?? '',
      NO_RECORD_YET,
      recordSummary(recordTiles(board)),
      startedNote(view({ board, now, files: at }).started, SUNDAY),
      unlistedNote(SUNDAY, 1),
      unlistedNote(SUNDAY, 2),
      ...EVERY_FILTER.flatMap((filters) => {
        const hidden = filteredOut(view({ board, now, files: at, myTeams: new Set(['SEA']), filters }));
        return [hidden?.title ?? '', hidden?.text ?? '', hidden?.showAll ?? '', hidden?.elsewhere?.label ?? ''];
      }),
      ...cards.flatMap((card) => [
        card.title,
        card.caption,
        card.note ?? '',
        ...card.rows.flatMap((entry) => [entry.label, entry.qualifier ?? '', entry.note ?? '']),
        ...card.made.flatMap((line) => [line.figures ?? '', line.text]),
      ]),
    ];
  }

  const degraded: Board = { ...sampleBoard(), models: { results_through: '2026-11-07', status: 'degraded', predictions_day: SUNDAY } };
  const MOMENTS: [string, string[]][] = [
    ['the sample', words(sampleBoard(), SAMPLE_NOW, files())],
    ['the sample late in the evening', words(sampleBoard(), LATE, files())],
    ['the board before the season', words(preseasonBoard(), PRESEASON_NOW, NO_FILES)],
    ['a day with one model left out', words(degraded, SAMPLE_NOW, NO_FILES)],
    ['a day whose morning froze no forecast', words(boardWithoutDailyWork(), LATE, NO_FILES)],
    ['a game that the latest snapshot no longer lists', words(boardWithout(PHI_AT_LAL), LATE, files())],
  ];

  it.each(MOMENTS)('are plain for %s: no word of betting advice and none that oversells the models', (_moment, written) => {
    expect(written.length).toBeGreaterThan(20);
    expect(written.flatMap(unwantedWords)).toEqual([]);
  });

  it.each(MOMENTS)('show no number that is not one for %s', (_moment, written) => {
    expect(written.filter((text) => /NaN|undefined|null|Infinity/.test(text))).toEqual([]);
  });
});
