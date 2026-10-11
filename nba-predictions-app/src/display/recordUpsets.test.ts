import { describe, expect, it } from 'vitest';
import { sampleRecord } from '../data/sampleData';
import { modelScorecard, recordedGame, scorecard, seasonRecord } from './recordExamples';
import { biggestUpsets } from './recordUpsets';

describe('biggestUpsets', () => {
  const [pointsRest, elo, sportsbooks] = biggestUpsets(sampleRecord());

  it('lists up to three for each source, in the order of the page, the highest chance first', () => {
    expect([pointsRest, elo, sportsbooks].map((upsets) => upsets.source.name)).toEqual(['Points & Rest', 'Elo', 'Sportsbooks']);
    expect(pointsRest.rows.map((row) => row.chance)).toEqual(['80.7%', '77.5%', '75.5%']);
    expect(elo.rows.map((row) => row.chance)).toEqual(['82.4%', '78.7%', '76.1%']);
    expect(sportsbooks.rows.map((row) => row.chance)).toEqual(['87.9%', '84.4%', '79.7%']);
    expect([pointsRest, elo, sportsbooks].map((upsets) => upsets.none)).toEqual([null, null, null]);
  });

  it('names the pick that lost, its chance, the score with its own points first and the game', () => {
    // Chicago at Miami on Thursday 5 November: the sportsbooks had Miami at 87.86%, and Chicago won 109 to 104.
    expect(sportsbooks.rows[0]).toEqual({
      id: '46e36f1a9c7a66a59068c441ba2a95e1',
      favorite: 'MIA',
      chance: '87.9%',
      outcome: 'Lost 104–109 to the Chicago Bulls',
      game: 'CHI at MIA, Thu, Nov 5',
    });
  });

  it('words a pick that lost on the road the same way', () => {
    // San Antonio at Milwaukee on Saturday 31 October: both models picked San Antonio, which lost by 20.
    expect(pointsRest.rows[0]).toMatchObject({
      favorite: 'SAS',
      outcome: 'Lost 109–129 to the Milwaukee Bucks',
      game: 'SAS at MIL, Sat, Oct 31',
    });
  });

  it('never writes the chance of a pick that lost as 100%: it keeps the two decimals of the file', () => {
    const record = seasonRecord({
      games: 1,
      market: scorecard({ games: 1, losses: 1, biggest_upsets: [{ ...recordedGame(), favorite: 'DEN', p_favorite: 0.9997 }] }),
    });

    expect(biggestUpsets(record)[2].rows[0].chance).toBe('99.97%');
  });

  it('says so when no pick of a source has been graded, as in the file of 10 October', () => {
    expect(biggestUpsets(seasonRecord()).map((upsets) => [upsets.rows.length, upsets.none])).toEqual([
      [0, 'No pick of Points & Rest has been graded yet.'],
      [0, 'No pick of Elo has been graded yet.'],
      [0, 'No pick of the sportsbooks has been graded yet.'],
    ]);
  });

  it('says so when every pick of a source has won so far', () => {
    const record = seasonRecord({
      games: 3,
      market: scorecard({ games: 3, wins: 3 }),
      elo: modelScorecard({
        games: 3,
        wins: 2,
        losses: 1,
        biggest_upsets: [{ ...recordedGame(), favorite: 'DEN', p_favorite: 0.802 }],
      }),
    });
    const [, elo, sportsbooks] = biggestUpsets(record);

    expect(sportsbooks.none).toBe('No pick of the sportsbooks has lost yet.');
    expect(elo.none).toBeNull();
    expect(elo.rows).toEqual([
      {
        id: '3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c',
        favorite: 'DEN',
        chance: '80.2%',
        outcome: 'Lost 101–110 to the Dallas Mavericks',
        game: 'DAL at DEN, Wed, Oct 21',
      },
    ]);
  });
});
