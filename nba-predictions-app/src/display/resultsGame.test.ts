import { describe, expect, it } from 'vitest';
import type { ResultLine, Verdict } from '../data/results';
import { sampleBoard } from '../data/sampleData';
import {
  chanceWords,
  chipsOf,
  gameDetails,
  gameRow,
  marginWords,
  missingOf,
  sourceCell,
  sportsbooksWords,
  type Fact,
  type SourceDetails,
} from './resultsGame';
import { SOURCES, type SourceKey } from './sources';

/**
 * A game of the documentation of the pipeline, changed as each test needs:
 * Dallas wins in Denver by nine, and all three sources had Denver.
 */
function line(changes: Partial<ResultLine> = {}): ResultLine {
  return {
    id: 'game-1',
    commence_time: '2026-10-22T01:10:12Z',
    home: 'DEN',
    away: 'DAL',
    home_pts: 101,
    away_pts: 110,
    recorded_at: '2026-10-22T09:10:07Z',
    market: { p_home: 0.6947, lo: 0.6823, hi: 0.7066, n: 4, at: '2026-10-21T22:10:38Z' },
    market_verdict: 'upset',
    elo: { p_home: 0.802, published_at: '2026-10-21T09:10:07Z' },
    elo_verdict: 'upset',
    points_rest: { p_home: 0.7944, margin: 9.74, published_at: '2026-10-21T09:10:07Z' },
    points_rest_verdict: 'upset',
    ...changes,
  };
}

const PUBLISHED = '2026-10-21T09:10:07Z';
const TEAMS = { home: 'DEN', away: 'DAL' };

/** The line with the sportsbooks' median at this chance for Denver, and the verdict that goes with it. */
function priced(p_home: number, market_verdict: Verdict): ResultLine {
  return line({ market: { p_home, lo: p_home, hi: p_home, n: 1, at: '2026-10-21T22:10:38Z' }, market_verdict });
}

/** The line with both models at these chances for Denver, each with its verdict. */
function forecast(pointsRest: number, elo: number, verdicts: [Verdict, Verdict]): ResultLine {
  return line({
    points_rest: { p_home: pointsRest, margin: 1, published_at: PUBLISHED },
    points_rest_verdict: verdicts[0],
    elo: { p_home: elo, published_at: PUBLISHED },
    elo_verdict: verdicts[1],
  });
}

function detailsOf(game: ResultLine, key: SourceKey): SourceDetails {
  const found = gameDetails(game).sources.find((entry) => entry.source === key);
  if (!found) throw new Error(`no details of ${key}`);
  return found;
}

function textOf(facts: Fact[], term: string): string | undefined {
  const fact = facts.find((entry) => entry.term === term);
  return fact && 'text' in fact ? fact.text : undefined;
}

function timeOf(facts: Fact[], term: string): string | undefined {
  const fact = facts.find((entry) => entry.term === term);
  return fact && 'time' in fact ? fact.time : undefined;
}

/** Every text that a value holds, however deep. */
function textsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(textsIn);
  return [];
}

describe('sourceCell', () => {
  it('writes a pick as the code of the team with its whole percent, and keeps the verdict of the line', () => {
    expect(sourceCell(line(), 'market')).toEqual({ source: 'market', said: 'DEN 69%', verdict: 'upset', tooLate: false, note: null });
    expect(sourceCell(line(), 'elo')).toMatchObject({ said: 'DEN 80%', verdict: 'upset' });
    expect(sourceCell(line(), 'points_rest')).toMatchObject({ said: 'DEN 79%', verdict: 'upset' });
  });

  it('names the away team when the chance of the home team is the lower one', () => {
    expect(sourceCell(priced(0.2505, 'favorite_won'), 'market')).toMatchObject({ said: 'DAL 75%', verdict: 'favorite_won' });
  });

  it.each([
    [0.52, 'DEN 52%'],
    [0.5201, 'DEN 52%'],
    [0.48, 'DAL 52%'],
    [0.4799, 'DAL 52%'],
  ])('calls %f a pick, as the job does from 52%% on', (p_home, said) => {
    expect(sourceCell(priced(p_home, 'upset'), 'market').said).toBe(said);
  });

  it.each([0.5199, 0.5117, 0.5, 0.4993, 0.4801])('calls %f a toss-up, where neither team is at 52%%', (p_home) => {
    expect(sourceCell(priced(p_home, 'toss_up'), 'market')).toEqual({
      source: 'market',
      said: 'Toss-up',
      verdict: 'toss_up',
      tooLate: false,
      note: null,
    });
  });

  it('never shows 100%: no source says that a team cannot lose', () => {
    expect(sourceCell(priced(0.9996, 'upset'), 'market').said).toBe('DEN 99%');
    expect(sourceCell(priced(0.0004, 'favorite_won'), 'market').said).toBe('DAL 99%');
  });

  it('has nothing to say for the sportsbooks when the game has no line', () => {
    const unquoted = line({ market: null, market_verdict: 'not_graded' });

    expect(sourceCell(unquoted, 'market')).toEqual({
      source: 'market',
      said: null,
      verdict: 'not_graded',
      tooLate: false,
      note: 'No line before the start',
    });
    // The models are graded on such a game all the same.
    expect(sourceCell(unquoted, 'elo')).toMatchObject({ said: 'DEN 80%', verdict: 'upset', note: null });
  });

  it('says that the points-and-rest model was left out when the line has the forecast of Elo alone', () => {
    const degraded = line({ points_rest: null, points_rest_verdict: 'not_graded' });

    expect(missingOf(degraded, 'points_rest')).toBe('left-out');
    expect(sourceCell(degraded, 'points_rest')).toEqual({
      source: 'points_rest',
      said: null,
      verdict: 'not_graded',
      tooLate: false,
      note: 'Left out that day',
    });
    expect(missingOf(degraded, 'elo')).toBeNull();
  });

  it('says that there is no forecast when the line has none of either model', () => {
    const unforecast = line({ points_rest: null, points_rest_verdict: 'not_graded', elo: null, elo_verdict: 'not_graded' });

    for (const key of ['points_rest', 'elo'] as const) {
      expect(missingOf(unforecast, key)).toBe('no-forecast');
      expect(sourceCell(unforecast, key)).toMatchObject({ said: null, verdict: 'not_graded', tooLate: false, note: 'No forecast for this game' });
    }
    expect(missingOf(unforecast, 'market')).toBeNull();
  });

  it('shows a forecast that was published at or after the start, and says that it came too late', () => {
    const late = line({ elo: { p_home: 0.802, published_at: '2026-10-22T01:10:12Z' }, elo_verdict: 'not_graded' });

    expect(sourceCell(late, 'elo')).toEqual({
      source: 'elo',
      said: 'DEN 80%',
      verdict: 'not_graded',
      tooLate: true,
      note: 'Published too late to count',
    });
    expect(sourceCell(late, 'points_rest')).toMatchObject({ tooLate: false, note: null });
  });

  it('takes the verdict from the line and does not grade the chance itself', () => {
    // Dallas won, and this line says that the favorite did. The page shows what the file holds.
    const odd = line({ elo_verdict: 'favorite_won' });

    expect(sourceCell(odd, 'elo')).toMatchObject({ said: 'DEN 80%', verdict: 'favorite_won' });
  });
});

describe('chipsOf', () => {
  it('marks an upset when the favorite of the sportsbooks lost, with the chance they gave it', () => {
    expect(chipsOf(line())).toEqual([{ kind: 'upset', label: 'Upset', text: 'Sportsbooks had Denver at 69%' }]);
  });

  it('names an away favorite that lost by its own chance', () => {
    const game = line({ home_pts: 110, away_pts: 101, market: { p_home: 0.38, lo: 0.37, hi: 0.39, n: 3, at: PUBLISHED } });

    expect(chipsOf(game)[0].text).toBe('Sportsbooks had Dallas at 62%');
  });

  it('gives the teams of Los Angeles their article', () => {
    expect(chipsOf(line({ home: 'LAC', away: 'PHX' }))[0].text).toBe('Sportsbooks had the Clippers at 69%');
  });

  it.each(['favorite_won', 'toss_up', 'not_graded'] as const)('marks no upset when the verdict on the sportsbooks is %s', (market_verdict) => {
    // Both models had the loser here. An upset is the sportsbooks' favorite losing, and nothing else.
    expect(chipsOf(line({ market_verdict })).map((chip) => chip.kind)).not.toContain('upset');
  });

  it('marks no upset for a game without a line', () => {
    expect(chipsOf(line({ market: null, market_verdict: 'not_graded' }))).toEqual([]);
  });

  it('marks the models as split when they picked different sides, the points-and-rest model first', () => {
    const split = forecast(0.4643, 0.5502, ['favorite_won', 'upset']);

    expect(chipsOf({ ...split, market_verdict: 'favorite_won' })).toEqual([
      { kind: 'split', label: 'Models split', text: 'Points & Rest had Dallas, Elo had Denver' },
    ]);
  });

  it.each([
    ['one of them has no pick', forecast(0.5168, 0.5757, ['toss_up', 'upset'])],
    ['both pick the same side', forecast(0.7, 0.6, ['upset', 'upset'])],
    ['the points-and-rest model was left out', line({ points_rest: null, points_rest_verdict: 'not_graded' })],
    ['neither has a forecast', line({ points_rest: null, points_rest_verdict: 'not_graded', elo: null, elo_verdict: 'not_graded' })],
    ['one forecast came too late to count', forecast(0.4643, 0.5502, ['favorite_won', 'not_graded'])],
  ])('does not mark them as split when %s', (_why, game) => {
    expect(chipsOf(game).map((chip) => chip.kind)).not.toContain('split');
  });

  it('has two chips at most, the upset first', () => {
    const both = forecast(0.4643, 0.5502, ['favorite_won', 'upset']);

    expect(chipsOf(both).map((chip) => chip.label)).toEqual(['Upset', 'Models split']);
  });
});

describe('chanceWords', () => {
  it('names the side a chance leans to, with one decimal', () => {
    expect(chanceWords(0.6947, TEAMS)).toBe('Denver 69.5%');
    expect(chanceWords(0.2505, TEAMS)).toBe('Dallas 75.0%');
    expect(chanceWords(0.52, TEAMS)).toBe('Denver 52.0%');
    expect(chanceWords(0.48, TEAMS)).toBe('Dallas 52.0%');
  });

  it('calls a chance without a pick a toss-up, with the side it leans to', () => {
    expect(chanceWords(0.5117, TEAMS)).toBe('Toss-up, Denver 51.2%');
    expect(chanceWords(0.4993, TEAMS)).toBe('Toss-up, Dallas 50.1%');
    expect(chanceWords(0.5, TEAMS)).toBe('Toss-up, 50.0% each');
  });

  it.each([
    [0.5194, 'Toss-up, Denver 51.9%'],
    [0.5195, 'Toss-up, Denver 51.95%'],
    [0.5199, 'Toss-up, Denver 51.99%'],
    [0.4801, 'Toss-up, Dallas 51.99%'],
    [0.4806, 'Toss-up, Dallas 51.9%'],
  ])('never writes a toss-up as 52.0%%: %f is "%s"', (p_home, words) => {
    expect(chanceWords(p_home, TEAMS)).toBe(words);
  });

  it('never writes 100.0%', () => {
    expect(chanceWords(0.9996, TEAMS)).toBe('Denver 99.96%');
    expect(chanceWords(0.0004, TEAMS)).toBe('Dallas 99.96%');
    expect(chanceWords(0.9994, TEAMS)).toBe('Denver 99.9%');
  });
});

describe('sportsbooksWords', () => {
  const at = '2026-10-21T22:10:38Z';

  it('says how many sportsbooks a line is the median of and how far apart they were, for the side it leans to', () => {
    expect(sportsbooksWords({ p_home: 0.6947, lo: 0.6823, hi: 0.7066, n: 4, at }, TEAMS)).toBe(
      'It is the median of 4 sportsbooks, which had Denver from 68.2% to 70.7%.',
    );
  });

  it('turns the range round for a line that leans to the away team', () => {
    expect(sportsbooksWords({ p_home: 0.2505, lo: 0.2401, hi: 0.2648, n: 5, at }, TEAMS)).toBe(
      'It is the median of 5 sportsbooks, which had Dallas from 73.5% to 76.0%.',
    );
  });

  it('gives the range of the home team for a line at exactly even', () => {
    expect(sportsbooksWords({ p_home: 0.5, lo: 0.49, hi: 0.51, n: 2, at }, TEAMS)).toBe(
      'It is the median of 2 sportsbooks, which had Denver from 49.0% to 51.0%.',
    );
  });

  it('says so when there is one sportsbook, or when all of them agree', () => {
    expect(sportsbooksWords({ p_home: 0.6, lo: 0.6, hi: 0.6, n: 1, at }, TEAMS)).toBe('The line is from 1 sportsbook.');
    expect(sportsbooksWords({ p_home: 0.6, lo: 0.6, hi: 0.6, n: 3, at }, TEAMS)).toBe('All 3 sportsbooks had the same chance.');
  });

  it('gives the teams of Los Angeles their article', () => {
    expect(sportsbooksWords({ p_home: 0.6, lo: 0.58, hi: 0.61, n: 3, at }, { home: 'LAL', away: 'UTA' })).toContain(
      'which had the Lakers from',
    );
  });
});

describe('marginWords', () => {
  it('names the team that is ahead, the home team for a margin above zero', () => {
    expect(marginWords(9.74, TEAMS, 1)).toBe('Denver by 9.7 points');
    expect(marginWords(-8.93, TEAMS, 1)).toBe('Dallas by 8.9 points');
    expect(marginWords(-9, TEAMS, 0)).toBe('Dallas by 9 points');
    expect(marginWords(31, TEAMS, 0)).toBe('Denver by 31 points');
  });

  it('writes one point as one point', () => {
    expect(marginWords(1, TEAMS, 0)).toBe('Denver by 1 point');
    expect(marginWords(-1, TEAMS, 0)).toBe('Dallas by 1 point');
    expect(marginWords(1, TEAMS, 1)).toBe('Denver by 1.0 points');
  });

  it('calls a margin that rounds to nothing even', () => {
    expect(marginWords(0, TEAMS, 1)).toBe('Even');
    expect(marginWords(-0.03, TEAMS, 1)).toBe('Even');
    expect(marginWords(0.05, TEAMS, 1)).toBe('Denver by 0.1 points');
  });
});

describe('gameDetails', () => {
  it('gives the start of the game and the time its result was recorded, as the line writes them', () => {
    expect(gameDetails(line()).game).toEqual([
      { term: 'Started', time: '2026-10-22T01:10:12Z' },
      { term: 'Result recorded', time: '2026-10-22T09:10:07Z' },
    ]);
  });

  it('has the details of each source in the order of the page', () => {
    expect(gameDetails(line()).sources.map((entry) => entry.source)).toEqual(SOURCES.map((entry) => entry.key));
  });

  it('gives the line that the game was graded against, and when it was taken', () => {
    expect(detailsOf(line(), 'market')).toEqual({
      source: 'market',
      facts: [
        { term: 'Line', text: 'Denver 69.5%' },
        { term: 'Taken', time: '2026-10-21T22:10:38Z' },
      ],
      notes: ['It is the median of 4 sportsbooks, which had Denver from 68.2% to 70.7%.'],
    });
  });

  it("gives Elo's chance and when it was published", () => {
    expect(detailsOf(line(), 'elo')).toEqual({
      source: 'elo',
      facts: [
        { term: 'Chance', text: 'Denver 80.2%' },
        { term: 'Published', time: PUBLISHED },
      ],
      notes: [],
    });
  });

  it('puts the expected margin of the points-and-rest model next to the real one, with what its scale is', () => {
    const { facts, notes } = detailsOf(line(), 'points_rest');

    expect(facts).toEqual([
      { term: 'Chance', text: 'Denver 79.4%' },
      { term: 'Expected margin', text: 'Denver by 9.7 points' },
      { term: 'Final margin', text: 'Dallas by 9 points' },
      { term: 'Published', time: PUBLISHED },
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('counts a blowout as 22 points');
    // Elo has no margin, and the note is not put under it.
    expect(textsIn(detailsOf(line(), 'elo')).join(' ')).not.toContain('22 points');
  });

  it('says of a toss-up that there was no pick to grade', () => {
    const noPick = 'Neither team was at 52%, so there was no pick to grade.';
    const line48 = detailsOf(priced(0.4843, 'toss_up'), 'market');
    const even = forecast(0.5, 0.5187, ['toss_up', 'toss_up']);

    expect(textOf(line48.facts, 'Line')).toBe('Toss-up, Dallas 51.6%');
    expect(line48.notes).toEqual(['The line is from 1 sportsbook.', noPick]);
    expect(textOf(detailsOf(even, 'elo').facts, 'Chance')).toBe('Toss-up, Denver 51.9%');
    expect(detailsOf(even, 'elo').notes).toEqual([noPick]);
    expect(textOf(detailsOf(even, 'points_rest').facts, 'Chance')).toBe('Toss-up, 50.0% each');
    expect(detailsOf(even, 'points_rest').notes[0]).toBe(noPick);
  });

  it('says of a forecast that came too late that it does not count, and still shows it', () => {
    const late = line({ elo: { p_home: 0.802, published_at: '2026-10-22T01:30:00Z' }, elo_verdict: 'not_graded' });
    const { facts, notes } = detailsOf(late, 'elo');

    expect(textOf(facts, 'Chance')).toBe('Denver 80.2%');
    expect(timeOf(facts, 'Published')).toBe('2026-10-22T01:30:00Z');
    expect(notes).toEqual(['It was published at or after the start of the game, so it does not count.']);
  });

  it('has a sentence and no number for a source that said nothing', () => {
    const bare = line({
      market: null,
      market_verdict: 'not_graded',
      elo: null,
      elo_verdict: 'not_graded',
      points_rest: null,
      points_rest_verdict: 'not_graded',
    });

    expect(detailsOf(bare, 'market')).toEqual({
      source: 'market',
      facts: [],
      notes: ['No line was recorded for this game from before its start, so the sportsbooks are not graded on it.'],
    });
    for (const key of ['points_rest', 'elo'] as const) {
      expect(detailsOf(bare, key)).toEqual({
        source: key,
        facts: [],
        notes: ['There is no forecast for this game: the forecasts of its day were not made, or were made without it.'],
      });
    }
    expect(textsIn(gameDetails(bare).sources).join(' ')).not.toMatch(/\d%/);
  });

  it('says that the points-and-rest model was left out on a day that has the forecast of Elo alone', () => {
    const degraded = line({ points_rest: null, points_rest_verdict: 'not_graded' });

    expect(detailsOf(degraded, 'points_rest')).toEqual({
      source: 'points_rest',
      facts: [],
      notes: ['Points & Rest was left out that day: the results it is built from did not pass the checks of that morning.'],
    });
    expect(detailsOf(degraded, 'elo').facts).toHaveLength(2);
  });
});

describe('gameRow', () => {
  it('gives both teams with the final score and marks the winner', () => {
    const row = gameRow(line());

    expect(row.id).toBe('game-1');
    expect(row.away).toEqual({ code: 'DAL', name: 'Dallas Mavericks', points: 110, won: true });
    expect(row.home).toEqual({ code: 'DEN', name: 'Denver Nuggets', points: 101, won: false });
  });

  it('marks the home team when it won', () => {
    const row = gameRow(line({ home_pts: 112, away_pts: 104 }));

    expect([row.away.won, row.home.won]).toEqual([false, true]);
  });

  it('has a cell for each source in the order of the page, the chips and the details', () => {
    const row = gameRow(line());

    expect(row.cells.map((cell) => cell.source)).toEqual(['points_rest', 'elo', 'market']);
    expect(row.chips).toEqual(chipsOf(line()));
    expect(row.details).toEqual(gameDetails(line()));
  });
});

describe('the recent results of the sample', () => {
  const results = sampleBoard().recent_results;
  const called = (name: string) => {
    const [away, home] = name.split(' at ');
    const found = results.filter((entry) => entry.away === away && entry.home === home);
    if (found.length !== 1) throw new Error(`The sample has ${found.length} results of ${name}`);
    return found[0];
  };

  it('show a game that all three had right, and one that all three had wrong', () => {
    const right = gameRow(called('BKN at MIA'));
    const wrong = gameRow(called('MIL at ATL'));

    expect(right.cells.map((cell) => [cell.said, cell.verdict])).toEqual([
      ['MIA 79%', 'favorite_won'],
      ['MIA 81%', 'favorite_won'],
      ['MIA 88%', 'favorite_won'],
    ]);
    expect(right.chips).toEqual([]);
    expect(wrong.cells.map((cell) => [cell.said, cell.verdict])).toEqual([
      ['ATL 62%', 'upset'],
      ['ATL 69%', 'upset'],
      ['ATL 58%', 'upset'],
    ]);
    expect(wrong.chips).toEqual([{ kind: 'upset', label: 'Upset', text: 'Sportsbooks had Atlanta at 58%' }]);
  });

  it('show the game that no sportsbook quoted with a dash for them and both models graded', () => {
    const row = gameRow(called('ORL at CHA'));

    expect(row.cells.map((cell) => [cell.said, cell.verdict, cell.note])).toEqual([
      ['CHA 65%', 'upset', null],
      ['CHA 62%', 'upset', null],
      [null, 'not_graded', 'No line before the start'],
    ]);
    // Both models had the loser, and that alone is not an upset.
    expect(row.chips).toEqual([]);
  });

  it('show the game in which the models picked one side and the sportsbooks the other, without a chip for it', () => {
    const row = gameRow(called('DAL at CHI'));

    expect(row.cells.map((cell) => [cell.said, cell.verdict])).toEqual([
      ['CHI 59%', 'upset'],
      ['CHI 58%', 'upset'],
      ['DAL 56%', 'favorite_won'],
    ]);
    expect(row.chips).toEqual([]);
  });

  it('show a line that was a toss-up next to two picks', () => {
    const row = gameRow(called('GSW at PHX'));

    expect(row.cells.map((cell) => [cell.said, cell.verdict])).toEqual([
      ['PHX 69%', 'upset'],
      ['PHX 70%', 'upset'],
      ['Toss-up', 'toss_up'],
    ]);
    expect(textOf(row.details.sources[2].facts, 'Line')).toBe('Toss-up, Phoenix 51.2%');
    expect(textOf(row.details.sources[0].facts, 'Expected margin')).toBe('Phoenix by 5.8 points');
    expect(textOf(row.details.sources[0].facts, 'Final margin')).toBe('Golden State by 4 points');
  });

  it('name the biggest upset with the chance that the sportsbooks gave the loser', () => {
    expect(gameRow(called('CHI at MIA')).chips).toEqual([{ kind: 'upset', label: 'Upset', text: 'Sportsbooks had Miami at 88%' }]);
  });

  it('have the two games in which the models split, each with one of them right', () => {
    const split = results.filter((entry) => chipsOf(entry).some((chip) => chip.kind === 'split'));

    expect(split.map((entry) => `${entry.away} at ${entry.home}`)).toEqual(['ORL at TOR', 'HOU at ORL']);
    expect(gameRow(called('HOU at ORL')).chips).toEqual([
      { kind: 'upset', label: 'Upset', text: 'Sportsbooks had Orlando at 65%' },
      { kind: 'split', label: 'Models split', text: 'Points & Rest had Houston, Elo had Orlando' },
    ]);
    // Two picks of different sides in a game that has a winner: one is right and one is wrong.
    const mixed = results.filter((entry) => [entry.points_rest_verdict, entry.elo_verdict].sort().join() === 'favorite_won,upset');
    expect(split).toEqual(mixed);
  });

  it('mark an upset in exactly the games in which the favorite of the sportsbooks lost', () => {
    const upsets = results.filter((entry) => chipsOf(entry).some((chip) => chip.kind === 'upset'));

    expect(upsets).toEqual(results.filter((entry) => entry.market_verdict === 'upset'));
    expect(upsets.length).toBeGreaterThan(10);
  });

  it('show the six games of the day on which the points-and-rest model was left out', () => {
    const leftOut = results.filter((entry) => missingOf(entry, 'points_rest') === 'left-out');

    expect(leftOut).toHaveLength(6);
    for (const entry of leftOut) {
      expect(sourceCell(entry, 'points_rest')).toMatchObject({ said: null, verdict: 'not_graded', note: 'Left out that day' });
      expect(sourceCell(entry, 'elo').said).not.toBeNull();
    }
  });

  it('say nothing where the line holds nothing, and something where it holds a forecast', () => {
    for (const entry of results) {
      for (const cell of gameRow(entry).cells) {
        expect(cell.said === null).toBe(entry[cell.source] === null);
        expect(cell.note === null).toBe(entry[cell.source] !== null);
        // The sample has no forecast that came too late.
        expect(cell.tooLate).toBe(false);
      }
    }
  });

  it('never have more than two chips', () => {
    expect(Math.max(...results.map((entry) => chipsOf(entry).length))).toBe(2);
  });

  it('use none of the words that the page keeps away from', () => {
    const words = results.flatMap((entry) => textsIn(gameRow(entry))).join(' ');

    expect(words).not.toMatch(/\b(?:lock|best bet|value|edge|beat the books|sharp|guaranteed|bookmakers?|bookies?|Vegas)\b/i);
    expect(words).not.toMatch(/\bAI\b|machine learning|algorithm/i);
    expect(words).not.toMatch(/undefined|null|NaN/);
  });
});
