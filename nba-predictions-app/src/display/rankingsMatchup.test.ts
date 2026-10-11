import { describe, expect, it } from 'vitest';
import type { Board } from '../data/board';
import type { ModelRatings } from '../data/model';
import { SAMPLE_NOW, sampleBoard, sampleModel } from '../data/sampleData';
import {
  chanceFormula,
  defaultMatchup,
  matchupOf,
  matchupParam,
  matchupView,
  onBoard,
  onBoardNote,
  pickNote,
  swapped,
  teamChoices,
  wholeNumber,
  withTeam,
  type MatchupView,
} from './rankingsMatchup';

const RATINGS = sampleModel().elo.ratings;

/** The sample with two ratings of Elo replaced, so that a test can set a gap between two teams. */
function withRatings(home: number, away: number): ModelRatings {
  const model = sampleModel();
  model.elo.ratings.BOS = { rating: home, week_ago: home };
  model.elo.ratings.NYK = { rating: away, week_ago: away };
  return model;
}

/** New York at Boston with the two ratings, which is the worked game of pipeline/model/README.md at 1607 and 1720. */
function newYorkAtBoston(home: number, away: number): MatchupView {
  const view = matchupView(withRatings(home, away), { away: 'NYK', home: 'BOS' });
  if (view === null) throw new Error('The sample does not rate Boston and New York');
  return view;
}

/** A matchup of the sample that a test needs to go on. */
function viewOf(away: string, home: string): MatchupView {
  const view = matchupView(sampleModel(), { away, home });
  if (view === null) throw new Error(`The sample does not rate ${away} and ${home}`);
  return view;
}

describe('matchupOf', () => {
  it('reads the away team first, as a game is called', () => {
    expect(matchupOf('NYK-at-BOS', RATINGS)).toEqual({ away: 'NYK', home: 'BOS' });
  });

  it('takes the codes in small letters as well', () => {
    expect(matchupOf('nyk-at-bos', RATINGS)).toEqual({ away: 'NYK', home: 'BOS' });
  });

  it('is nothing when the address names no matchup', () => {
    expect(matchupOf(null, RATINGS)).toBeNull();
  });

  it.each(['NYK', 'NYK-BOS', 'NYK-at-', 'NYK-at-BOS-at-LAL', 'NYK at BOS', 'elo', '2026-11-07', ' NYK-at-BOS', 'NYKS-at-BOS'])(
    'is nothing for "%s", which is not two codes with "at" between them',
    (param) => {
      expect(matchupOf(param, RATINGS)).toBeNull();
    },
  );

  it('is nothing for a team that the file does not rate', () => {
    expect(matchupOf('SEA-at-BOS', RATINGS)).toBeNull();
    expect(matchupOf('BOS-at-SEA', RATINGS)).toBeNull();
  });

  it('is nothing for a team against itself', () => {
    expect(matchupOf('BOS-at-BOS', RATINGS)).toBeNull();
  });

  it('is nothing when the file rates no team', () => {
    expect(matchupOf('NYK-at-BOS', {})).toBeNull();
  });
});

describe('matchupParam', () => {
  it('writes what matchupOf reads', () => {
    expect(matchupParam({ away: 'NYK', home: 'BOS' })).toBe('NYK-at-BOS');
    expect(matchupOf(matchupParam({ away: 'POR', home: 'CLE' }), RATINGS)).toEqual({ away: 'POR', home: 'CLE' });
  });
});

describe('defaultMatchup', () => {
  it('is the next game on the board', () => {
    // Portland at Cleveland starts forty minutes after the moment the sample is looked at.
    expect(defaultMatchup(sampleBoard(), sampleModel(), SAMPLE_NOW)).toEqual({ away: 'POR', home: 'CLE' });
  });

  it('passes over the games that have started', () => {
    const lateEvening = Date.parse('2026-11-09T04:00:00Z');

    // Golden State at Orlando is the first game of 9 November.
    expect(defaultMatchup(sampleBoard(), sampleModel(), lateEvening)).toEqual({ away: 'GSW', home: 'ORL' });
  });

  it('does not depend on the order the board lists its games in', () => {
    const board = sampleBoard();
    board.games.reverse();

    expect(defaultMatchup(board, sampleModel(), SAMPLE_NOW)).toEqual({ away: 'POR', home: 'CLE' });
  });

  it('passes over a game of a team that the file does not rate', () => {
    const board = sampleBoard();
    const model = sampleModel();
    delete model.elo.ratings.POR;

    expect(defaultMatchup(board, model, SAMPLE_NOW)).toEqual({ away: 'BOS', home: 'TOR' });
  });

  it('is the two teams that Elo rates highest, the higher one at home, when no game is to come', () => {
    const empty: Board = { ...sampleBoard(), games: [] };

    expect(defaultMatchup(empty, sampleModel(), SAMPLE_NOW)).toEqual({ away: 'OKC', home: 'NYK' });
    expect(defaultMatchup(sampleBoard(), sampleModel(), Date.parse('2027-01-01T00:00:00Z'))).toEqual({ away: 'OKC', home: 'NYK' });
  });

  it('is nothing when the file rates fewer than two teams', () => {
    const model = sampleModel();
    model.elo.ratings = { BOS: { rating: 1600, week_ago: 1600 } };

    expect(defaultMatchup({ ...sampleBoard(), games: [] }, model, SAMPLE_NOW)).toBeNull();
    model.elo.ratings = {};
    expect(defaultMatchup({ ...sampleBoard(), games: [] }, model, SAMPLE_NOW)).toBeNull();
  });
});

describe('withTeam', () => {
  const matchup = { away: 'NYK', home: 'BOS' };

  it('puts another team on one side', () => {
    expect(withTeam(matchup, 'home', 'LAL')).toEqual({ away: 'NYK', home: 'LAL' });
    expect(withTeam(matchup, 'away', 'LAL')).toEqual({ away: 'LAL', home: 'BOS' });
  });

  it('lets the two teams change places when the team is the one on the other side', () => {
    expect(withTeam(matchup, 'home', 'NYK')).toEqual({ away: 'BOS', home: 'NYK' });
    expect(withTeam(matchup, 'away', 'BOS')).toEqual({ away: 'BOS', home: 'NYK' });
  });

  it('leaves the matchup as it is when the team is on that side already', () => {
    expect(withTeam(matchup, 'home', 'BOS')).toEqual(matchup);
  });
});

describe('swapped', () => {
  it('puts the other team at home', () => {
    expect(swapped({ away: 'NYK', home: 'BOS' })).toEqual({ away: 'BOS', home: 'NYK' });
  });
});

describe('teamChoices', () => {
  it('lists the 30 teams by name', () => {
    const choices = teamChoices(sampleModel());

    expect(choices).toHaveLength(30);
    expect(choices[0]).toEqual({ code: 'ATL', name: 'Atlanta Hawks' });
    expect(choices.at(-1)).toEqual({ code: 'WAS', name: 'Washington Wizards' });
    // By name and not by code: the Clippers and the Lakers come before Memphis, and Brooklyn after Boston.
    expect(choices.map((choice) => choice.code).slice(1, 3)).toEqual(['BOS', 'BKN']);
  });
});

describe('matchupView', () => {
  it('works the worked game of the README out: Boston at 1607 hosting New York at 1720', () => {
    expect(newYorkAtBoston(1607, 1720)).toEqual({
      away: { code: 'NYK', name: 'New York Knicks', rating: 1720, chance: 60 },
      home: { code: 'BOS', name: 'Boston Celtics', rating: 1607, chance: 40 },
      homeCourt: 40,
      gap: -73,
      pHome: 0.3965,
      pick: { code: 'NYK', name: 'New York Knicks', rating: 1720, chance: 60 },
    });
  });

  it('gives the chance that the board has for the next game', () => {
    const view = viewOf('POR', 'CLE');

    expect(view).toMatchObject({ gap: 114, pHome: 0.6584, home: { rating: 1604, chance: 66 }, away: { rating: 1530, chance: 34 } });
    expect(view.pick?.code).toBe('CLE');
  });

  it('picks the side that Elo puts at 52% or more, and no side below that', () => {
    // A gap of 14 points is 52.01%, and one of 13 points is 51.87%.
    expect(newYorkAtBoston(1514, 1540)).toMatchObject({ gap: 14, pHome: 0.5201, pick: { code: 'BOS' } });
    expect(newYorkAtBoston(1513, 1540)).toMatchObject({ gap: 13, pHome: 0.5187, pick: null });
    expect(newYorkAtBoston(1487, 1540)).toMatchObject({ gap: -13, pHome: 0.4813, pick: null });
    expect(newYorkAtBoston(1486, 1540)).toMatchObject({ gap: -14, pHome: 0.4799, pick: { code: 'NYK' } });
  });

  it('shows two whole percents that add up to 100', () => {
    for (const [home, away] of [
      [1607, 1720],
      [1500, 1540],
      [1900, 1300],
      [1243, 1705],
    ]) {
      const view = newYorkAtBoston(home, away);
      expect(view.home.chance + view.away.chance).toBe(100);
    }
  });

  it('takes the home court from the file', () => {
    const model = withRatings(1607, 1720);
    model.elo.constants.home_court = 100;

    expect(matchupView(model, { away: 'NYK', home: 'BOS' })).toMatchObject({ homeCourt: 100, gap: -13, pHome: 0.4813 });
  });

  it('is nothing for a team that the file does not rate', () => {
    expect(matchupView(sampleModel(), { away: 'SEA', home: 'BOS' })).toBeNull();
    expect(matchupView(sampleModel(), { away: 'BOS', home: 'SEA' })).toBeNull();
  });
});

describe('pickNote', () => {
  it('names the team that Elo picks, with its whole percent', () => {
    expect(pickNote(viewOf('POR', 'CLE'))).toEqual({ lead: "Elo's pick: ", team: 'Cleveland Cavaliers', rest: ', at 66%' });
    expect(pickNote(newYorkAtBoston(1607, 1720))).toEqual({ lead: "Elo's pick: ", team: 'New York Knicks', rest: ', at 60%' });
  });

  it('gives a toss-up with every decimal of the chance, which the whole percent above it does not show', () => {
    // 51.87% is not a pick, so it is written as 51% above the note and not as the 52% it would round to.
    const home = newYorkAtBoston(1513, 1540);
    expect(home.home.chance).toBe(51);
    expect(home.away.chance).toBe(49);
    expect(pickNote(home)).toEqual({ lead: 'Toss-up: Elo has the home team at 51.87%, short of the 52% that makes a pick', team: null, rest: '' });

    const away = newYorkAtBoston(1487, 1540);
    expect(away.away.chance).toBe(51);
    expect(pickNote(away).lead).toBe('Toss-up: Elo has the away team at 51.87%, short of the 52% that makes a pick');
  });

  it('never rounds a toss-up up to the 52% that it is short of', () => {
    const view = { ...newYorkAtBoston(1513, 1540), pHome: 0.5199, pick: null };

    expect(pickNote(view).lead).toBe('Toss-up: Elo has the home team at 51.99%, short of the 52% that makes a pick');
    expect(pickNote({ ...view, pHome: 0.4801 }).lead).toBe('Toss-up: Elo has the away team at 51.99%, short of the 52% that makes a pick');
  });

  it('says so when Elo has the two teams level', () => {
    expect(pickNote(newYorkAtBoston(1500, 1540)).lead).toBe('Toss-up: Elo has the two teams level');
  });
});

describe('wholeNumber', () => {
  it('writes a number below zero with the minus sign', () => {
    expect(wholeNumber(-73)).toBe('−73');
    expect(wholeNumber(114)).toBe('114');
    expect(wholeNumber(0)).toBe('0');
  });
});

describe('chanceFormula', () => {
  it('turns the sign of the gap, as the formula does', () => {
    expect(chanceFormula(viewOf('POR', 'CLE'))).toEqual({ exponent: '−114 / 400', chance: '0.6584' });
    expect(chanceFormula(newYorkAtBoston(1607, 1720))).toEqual({ exponent: '73 / 400', chance: '0.3965' });
  });

  it('writes an even game without a sign and with its four decimals', () => {
    expect(chanceFormula(newYorkAtBoston(1500, 1540))).toEqual({ exponent: '0 / 400', chance: '0.5000' });
  });
});

describe('onBoard', () => {
  it('finds the game on the board, where Elo has the chance that the sum gives', () => {
    const found = onBoard(sampleBoard(), viewOf('POR', 'CLE'), SAMPLE_NOW);

    expect(found).toEqual({ day: 'Sun, Nov 8', team: 'Cleveland Cavaliers', chance: 66, same: true });
  });

  it('names the team that Elo leans to there, which can be the away team', () => {
    // Charlotte at Utah: the board has Utah at 32.37%.
    expect(onBoard(sampleBoard(), viewOf('CHA', 'UTA'), SAMPLE_NOW)).toEqual({
      day: 'Sun, Nov 8',
      team: 'Charlotte Hornets',
      chance: 68,
      same: true,
    });
  });

  it('is nothing for the same two teams with the other one at home', () => {
    expect(onBoard(sampleBoard(), viewOf('CLE', 'POR'), SAMPLE_NOW)).toBeNull();
  });

  it('is nothing once the game has started', () => {
    expect(onBoard(sampleBoard(), viewOf('POR', 'CLE'), Date.parse('2026-11-09T00:10:00Z'))).toBeNull();
  });

  it('is nothing when the board has no chance of Elo for the game', () => {
    const board = sampleBoard();
    for (const game of board.games) game.elo = null;

    expect(onBoard(board, viewOf('POR', 'CLE'), SAMPLE_NOW)).toBeNull();
  });

  it('says so when the board has another chance, as it does for a game on a neutral floor', () => {
    const board = sampleBoard();
    const game = board.games.find((entry) => entry.home === 'CLE' && entry.away === 'POR');
    if (!game) throw new Error('The sample has no game of Portland at Cleveland');
    // What Elo gives Cleveland without the home court: 1604 against 1530.
    game.elo = { p_home: 0.6049 };

    expect(onBoard(board, viewOf('POR', 'CLE'), SAMPLE_NOW)).toEqual({ day: 'Sun, Nov 8', team: 'Cleveland Cavaliers', chance: 60, same: false });
  });

  it('goes by the day of the game, which a late start does not move to the next date', () => {
    // Philadelphia at the Lakers starts at 03:40 UTC on the 9th, which is the evening of the 8th.
    expect(onBoard(sampleBoard(), viewOf('PHI', 'LAL'), SAMPLE_NOW)?.day).toBe('Sun, Nov 8');
  });
});

describe('onBoardNote', () => {
  it('says that the card of the game has the same number', () => {
    expect(onBoardNote({ day: 'Sun, Nov 8', team: 'Cleveland Cavaliers', chance: 66, same: true })).toBe(
      "This game is to be played on Sun, Nov 8, and Elo's chance on its card is the same number.",
    );
  });

  it('gives the number of the card when it is another one, and says which of the two counts', () => {
    const note = onBoardNote({ day: 'Sat, Nov 7', team: 'Denver Nuggets', chance: 79, same: false });

    expect(note).toContain('and its card has Denver Nuggets at 79% for Elo. That is the number that counts.');
    expect(note).toContain('a game on a neutral floor has no home court');
  });
});
