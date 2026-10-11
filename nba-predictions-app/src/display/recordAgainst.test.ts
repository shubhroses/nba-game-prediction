import { describe, expect, it } from 'vitest';
// The documentation of the job, read as text: the page must read the difference the way the job means it.
import readme from '../../../pipeline/README.md?raw';
import type { DifferentPick, ModelScorecard } from '../data/record';
import { sampleRecord } from '../data/sampleData';
import { brierView, differentPicks, INTERVAL_FROM, LATEST_SHOWN } from './recordAgainst';
import { recordedGame } from './recordExamples';
import { source } from './sources';
import { winningSide } from './verdict';

const ELO = source('elo');
const POINTS_REST = source('points_rest');

type Against = ModelScorecard['brier_against_market'];
type Picks = ModelScorecard['picks_against_market'];

function must<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`The sample has no ${what}`);
  return value;
}

/** A game in which the model picked the home team and the sportsbooks the away team, which won. */
function differentPick(changes: Partial<DifferentPick> = {}): DifferentPick {
  return { ...recordedGame(), pick: 'DEN', market_pick: 'DAL', right: 'market', ...changes };
}

describe('brierView', () => {
  it('reads the difference as the job means it: the model minus the sportsbooks, with an interval from 30 games on', () => {
    expect(readme).toContain("`brier_against_market` is the model's Brier score minus the sportsbooks'");
    expect(readme).toContain("Below zero, the model's probabilities were the better ones.");
    expect(readme).toContain('From 30 games on it comes with a 95% interval');
    expect(INTERVAL_FROM).toBe(30);
  });

  it('says of both models in the sample that no difference can be told, because both intervals include zero', () => {
    const record = sampleRecord();
    const elo = brierView(ELO, must(record.elo, "record of Elo's picks").brier_against_market);
    const pointsRest = brierView(POINTS_REST, must(record.points_rest, "record of the other model's picks").brier_against_market);

    expect(elo).toMatchObject({
      reading: 'no-difference',
      headline: 'No difference can be told',
      detail: 'The 95% interval includes zero, so over these 126 games the two cannot be told apart.',
      difference: '+0.0067',
      interval: '−0.0128 to +0.0270',
      games: '126 games with a chance from both',
      point: 0.0067,
      span: [-0.0128, 0.027],
      trackLabel: 'Difference +0.0067, 95% interval −0.0128 to +0.0270',
    });
    expect(pointsRest).toMatchObject({
      reading: 'no-difference',
      headline: 'No difference can be told',
      detail: 'The 95% interval includes zero, so over these 120 games the two cannot be told apart.',
      difference: '+0.0028',
      interval: '−0.0168 to +0.0229',
    });
  });

  it('says which way the difference reads, with the name of the model', () => {
    const view = brierView(POINTS_REST, { games: 120, difference: 0.0028, interval: [-0.0168, 0.0229] });

    expect(view.axisNote).toBe(
      "Points & Rest's Brier score minus the sportsbooks'. Lower is better for a Brier score: " +
        'below zero Points & Rest had the lower one, and above zero the sportsbooks had.',
    );
  });

  it('has nothing to compare before a game has a chance from both, as in the file of 10 October', () => {
    const view = brierView(ELO, { games: 0, difference: null, interval: null });

    expect(view).toMatchObject({
      reading: 'nothing',
      headline: 'Nothing to compare yet',
      detail: 'No game has a chance from both Elo and the sportsbooks yet.',
      difference: null,
      interval: null,
      point: null,
      span: null,
      trackLabel: 'No difference yet',
    });
  });

  it('reads nothing into a difference that has no interval yet', () => {
    const few: Against = { games: 12, difference: -0.0417, interval: null };
    const view = brierView(ELO, few);

    expect(view).toMatchObject({
      reading: 'too-few',
      headline: 'Too few games to tell',
      detail: 'The record gives the difference a 95% interval from 30 games on, and 12 games have a chance from both so far.',
      difference: '−0.0417',
      interval: null,
      trackLabel: 'Difference −0.0417, no interval yet',
    });
    expect(brierView(ELO, { ...few, games: 1 }).detail).toContain('and 1 game has a chance from both so far.');
  });

  it('says so when the whole interval is below zero, of these games and of this score only, and calls no source the better one', () => {
    const view = brierView(ELO, { games: 400, difference: -0.0121, interval: [-0.0214, -0.0031] });

    expect(view.reading).toBe('model-lower');
    expect(view.headline).toBe("Lower than the sportsbooks' score");
    expect(view.detail).toBe(
      'The whole 95% interval is below zero: over these 400 games Elo had the lower Brier score of the two. ' +
        'That is said of these games, not of the ones to come. ' +
        'A 95% interval that is read every day lies on one side of zero now and then by chance alone.',
    );
    expect(`${view.headline} ${view.detail}`).not.toMatch(/better|beat/i);
  });

  it('says only where the interval leaves zero out that a daily reading does so by chance now and then', () => {
    const chance = 'by chance alone';

    expect(brierView(ELO, { games: 400, difference: -0.0085, interval: [-0.0162, -0.0009] }).detail).toContain(chance);
    expect(brierView(ELO, { games: 400, difference: 0.0085, interval: [0.0009, 0.0162] }).detail).toContain(chance);
    expect(brierView(ELO, { games: 400, difference: 0.0028, interval: [-0.0168, 0.0229] }).detail).not.toContain(chance);
    expect(brierView(ELO, { games: 12, difference: 0.0028, interval: null }).detail).not.toContain(chance);
  });

  it('says so when the whole interval is above zero', () => {
    const view = brierView(POINTS_REST, { games: 1100, difference: 0.0121, interval: [0.0031, 0.0214] });

    expect(view.reading).toBe('model-higher');
    expect(view.headline).toBe("Higher than the sportsbooks' score");
    expect(view.detail).toBe(
      'The whole 95% interval is above zero: over these 1,100 games the sportsbooks had the lower Brier score of the two. ' +
        'That is said of these games, not of the ones to come. ' +
        'A 95% interval that is read every day lies on one side of zero now and then by chance alone.',
    );
  });

  it.each([
    [[-0.01, 0], 'no-difference'],
    [[0, 0.01], 'no-difference'],
    [[-0.01, -0.0001], 'model-lower'],
    [[0.0001, 0.01], 'model-higher'],
  ] as const)('counts an interval of %j as %s: zero at an end is in it', (interval, reading) => {
    expect(brierView(ELO, { games: 60, difference: 0.001, interval: [...interval] }).reading).toBe(reading);
  });

  it('never words a reading as one side winning', () => {
    const readings: Against[] = [
      { games: 0, difference: null, interval: null },
      { games: 12, difference: -0.0417, interval: null },
      { games: 126, difference: 0.0067, interval: [-0.0128, 0.027] },
      { games: 400, difference: -0.0121, interval: [-0.0214, -0.0031] },
      { games: 400, difference: 0.0121, interval: [0.0031, 0.0214] },
    ];

    for (const against of readings) {
      const { headline, detail, axisNote } = brierView(ELO, against);
      expect(`${headline} ${detail} ${axisNote}`).not.toMatch(/\b(?:beats?|beating|wins?|winning|outperforms?)\b/i);
    }
  });
});

describe('differentPicks', () => {
  const record = sampleRecord();
  const elo = must(record.elo, "record of Elo's picks");
  const pointsRest = must(record.points_rest, "record of the other model's picks");

  it('says how many games there are and how often each was right', () => {
    const view = differentPicks(POINTS_REST, pointsRest.picks_against_market);

    expect(view).toMatchObject({
      differ: 15,
      modelRight: 7,
      marketRight: 8,
      summary: "In 15 games the two picked different winners. Points & Rest's pick won 7 of them and the sportsbooks' pick 8.",
      barLabel: "Points & Rest's pick won 7 of 15 games, the sportsbooks' pick 8",
      listTitle: 'The latest 5 of the 15',
    });
  });

  it('lists the latest of them, the latest first, each with its day, its score and the two picks', () => {
    const view = differentPicks(ELO, elo.picks_against_market);

    expect(LATEST_SHOWN).toBe(5);
    expect(view.latest).toHaveLength(5);
    // Dallas at Chicago on Saturday 7 November: both models picked Chicago, the sportsbooks Dallas, and Dallas won.
    expect(view.latest[0]).toEqual({
      id: '1a20c36414d0a2b65a914da38cde8743',
      dayText: 'Nov 7',
      final: 'DAL 130, CHI 119',
      modelPick: 'CHI',
      marketPick: 'DAL',
      modelRight: false,
    });
    expect(view.latest.map((game) => game.dayText)).toEqual(['Nov 7', 'Nov 6', 'Nov 4', 'Nov 1', 'Oct 31']);
    // The sportsbooks' pick won all five. Elo's pick won seven of the ten games before them.
    expect(view.latest.map((game) => game.modelRight)).toEqual([false, false, false, false, false]);
  });

  it('marks a game in which the pick of the model won', () => {
    const view = differentPicks(POINTS_REST, pointsRest.picks_against_market);

    // Houston at Orlando on Tuesday 3 November: the model picked Houston, the sportsbooks Orlando, and Houston won.
    expect(view.latest.filter((game) => game.modelRight)).toEqual([
      {
        id: 'e1779871656e85418d78a9e7b59ee6f3',
        dayText: 'Nov 3',
        final: 'HOU 114, ORL 105',
        modelPick: 'HOU',
        marketPick: 'ORL',
        modelRight: true,
      },
    ]);
  });

  it('takes who was right from the record, which agrees with the score in every game of the sample', () => {
    for (const model of [elo, pointsRest]) {
      for (const game of model.picks_against_market.latest) {
        const winner = winningSide(game) === 'home' ? game.home : game.away;

        expect(game.right === 'model' ? game.pick : game.market_pick).toBe(winner);
        expect(game.pick).not.toBe(game.market_pick);
      }
    }
  });

  it('says so when the two have not picked different winners yet, as in the file of 10 October', () => {
    const none: Picks = { differ: 0, model_right: 0, market_right: 0, latest: [] };

    expect(differentPicks(ELO, none)).toMatchObject({
      differ: 0,
      summary: 'The two have not picked different winners in a game yet.',
      listTitle: null,
      latest: [],
    });
  });

  it('words one game as one game', () => {
    const lost: Picks = { differ: 1, model_right: 0, market_right: 1, latest: [differentPick()] };
    const won: Picks = {
      differ: 1,
      model_right: 1,
      market_right: 0,
      latest: [differentPick({ pick: 'DAL', market_pick: 'DEN', right: 'model' })],
    };

    expect(differentPicks(ELO, lost).summary).toBe("In 1 game the two picked different winners. The sportsbooks' pick won it.");
    expect(differentPicks(ELO, won).summary).toBe("In 1 game the two picked different winners. Elo's pick won it.");
    expect(differentPicks(ELO, lost).listTitle).toBe('That game');
    expect(differentPicks(ELO, won).latest[0]).toMatchObject({ final: 'DAL 110, DEN 101', modelPick: 'DAL', modelRight: true });
  });

  it('says that the list is all of them when it is', () => {
    const three: Picks = {
      differ: 3,
      model_right: 1,
      market_right: 2,
      latest: [
        differentPick({ id: 'c' }),
        differentPick({ id: 'b' }),
        differentPick({ id: 'a', right: 'model', pick: 'DAL', market_pick: 'DEN' }),
      ],
    };

    expect(differentPicks(ELO, three).listTitle).toBe('All 3 of them');
    expect(differentPicks(ELO, three).latest.map((game) => game.id)).toEqual(['c', 'b', 'a']);
  });
});
