import { describe, expect, it } from 'vitest';
// The documentation of the job, read as text: the page must say what a coin scores as it does.
import readme from '../../../pipeline/README.md?raw';
import { sampleRecord } from '../data/sampleData';
import { modelScorecard, scorecard, seasonRecord } from './recordExamples';
import { baseline, COIN_SCORES, NOT_THE_SAME_GAMES, scorecards, scorecardView, shareInterval } from './recordScorecard';
import { source } from './sources';

describe('shareInterval', () => {
  it('writes both ends of an interval with one decimal', () => {
    expect(shareInterval([0.5299, 0.7038])).toBe('53.0% to 70.4%');
    expect(shareInterval([0.2065, 1])).toBe('20.7% to 100.0%');
  });
});

describe('the scorecards of the sample', () => {
  const [pointsRest, elo, sportsbooks] = scorecards(sampleRecord());

  it('are in the order of the page', () => {
    expect([pointsRest, elo, sportsbooks].map((card) => card.source.name)).toEqual(['Points & Rest', 'Elo', 'Sportsbooks']);
  });

  it('give the picks won and lost, and the share of them with the games it is of', () => {
    expect(pointsRest).toMatchObject({ tally: '72–44', picksText: 'of 116 picks' });
    expect(elo).toMatchObject({ tally: '73–43', picksText: 'of 116 picks' });
    expect(sportsbooks).toMatchObject({ tally: '83–48', picksText: 'of 131 picks' });

    expect(pointsRest.won).toEqual({ share: 0.6207, text: '62.1%', interval: [0.5299, 0.7038], intervalText: '53.0% to 70.4%' });
    expect(elo.won).toMatchObject({ text: '62.9%', intervalText: '53.9% to 71.2%' });
    expect(sportsbooks.won).toMatchObject({ text: '63.4%', intervalText: '54.8% to 71.1%' });
  });

  it('say in words what the track of the interval shows, and call the interval a 95% interval', () => {
    expect(pointsRest.trackLabel).toBe('62.1% of 116 picks won, 95% interval 53.0% to 70.4%');
    expect(sportsbooks.trackLabel).toBe('63.4% of 131 picks won, 95% interval 54.8% to 71.1%');
  });

  it('count the toss-ups and the games not graded, and give the two scores', () => {
    expect(pointsRest.rows.map((row) => [row.label, row.value])).toEqual([
      ['Toss-ups', '5'],
      ['Not graded', '22'],
      ['Brier score', '0.2174'],
      ['Log loss', '0.6198'],
    ]);
    expect(elo.rows.map((row) => [row.label, row.value])).toEqual([
      ['Toss-ups', '11'],
      ['Not graded', '16'],
      ['Brier score', '0.2178'],
      ['Log loss', '0.6192'],
    ]);
    expect(sportsbooks.rows.map((row) => [row.label, row.value])).toEqual([
      ['Toss-ups', '11'],
      ['Not graded', '1'],
      ['Brier score', '0.2176'],
      ['Log loss', '0.6210'],
    ]);
  });

  it('say why a game was not graded, and for a model how many forecasts were published too late', () => {
    const hint = (card: typeof elo, label: string) => card.rows.find((row) => row.label === label)?.hint;

    expect(hint(elo, 'Toss-ups')).toBe('neither team at 52%');
    expect(hint(elo, 'Not graded')).toBe('no forecast in time, 0 published too late');
    expect(hint(pointsRest, 'Not graded')).toBe('no forecast in time, 0 published too late');
    // The sportsbooks' line is the last one from before the start, so it cannot be late.
    expect(hint(sportsbooks, 'Not graded')).toBe('no line before the start');
  });

  it('say what the two scores are and which games they are of, that lower is better and what a coin scores', () => {
    const reading = 'Lower is better, and a coin flip for every game scores 0.25 and 0.6931.';

    expect(pointsRest.scoresNote).toBe(
      `Both scores say how far the chances were from what happened, over 121 games with a forecast. ${reading} ${NOT_THE_SAME_GAMES}`,
    );
    expect(sportsbooks.scoresNote).toBe(
      `Both scores say how far the chances were from what happened, over 142 games with a line. ${reading} ${NOT_THE_SAME_GAMES}`,
    );
  });

  it('say on every card that the scores of the cards are not over the same games, and where the same games are compared', () => {
    // Read across, 0.2174 over 121 games looks lower than the sportsbooks' 0.2176 over 142. Over the 120 games that both
    // have a chance for, the record gives the points-and-rest model the higher score, by 0.0028.
    expect(NOT_THE_SAME_GAMES).toBe(
      'The cards are not over the same games, so their scores are not to be compared with each other. ' +
        '"Against the sportsbooks" below sets each model next to the sportsbooks over the same games.',
    );
    for (const card of [pointsRest, elo, sportsbooks]) expect(card.scoresNote.endsWith(NOT_THE_SAME_GAMES)).toBe(true);
    expect(sampleRecord().points_rest?.brier_against_market).toMatchObject({ games: 120, difference: 0.0028 });
  });
});

describe('scorecardView', () => {
  it('takes what a coin scores from the documentation of the job', () => {
    expect(readme).toContain('A line of 0.5 for every game scores 0.25 and 0.6931.');
    expect(COIN_SCORES).toBe('a coin flip for every game scores 0.25 and 0.6931');
  });

  it('shows no share, no interval and no score before the first game, as with the file of 10 October', () => {
    const record = seasonRecord();

    for (const view of scorecards(record)) {
      expect(view.tally).toBe('0–0');
      expect(view.picksText).toBe('of 0 picks');
      expect(view.won).toBeNull();
      expect(view.trackLabel).toBe('No pick has been graded yet');
      expect(view.rows.filter((row) => row.value === 'None yet').map((row) => row.label)).toEqual(['Brier score', 'Log loss']);
    }
    expect(scorecards(record)[0].scoresNote).toBe(
      'Both scores say how far the chances were from what happened, and there is none before the first game with a forecast. ' +
        `Lower is better, and a coin flip for every game scores 0.25 and 0.6931. ${NOT_THE_SAME_GAMES}`,
    );
    expect(scorecards(record)[2].scoresNote).toContain('and there is none before the first game with a line.');
  });

  it('counts a model that was not graded on opening night, and gives it no share', () => {
    const view = scorecardView(source('elo'), modelScorecard({ not_graded: 6 }));

    expect(view.won).toBeNull();
    expect(view.rows.find((row) => row.label === 'Not graded')?.value).toBe('6');
  });

  it('shows the interval of one game, which is as wide as the record says it is', () => {
    // The example of pipeline/README.md: one pick, which won.
    const one = scorecard({
      games: 1,
      wins: 1,
      accuracy: 1,
      accuracy_interval: [0.2065, 1],
      with_line: 1,
      brier: 0.1275,
      log_loss: 0.4418,
    });
    const view = scorecardView(source('market'), one);

    expect(view.tally).toBe('1–0');
    expect(view.picksText).toBe('of 1 pick');
    expect(view.won).toEqual({ share: 1, text: '100.0%', interval: [0.2065, 1], intervalText: '20.7% to 100.0%' });
    expect(view.trackLabel).toBe('100.0% of 1 pick won, 95% interval 20.7% to 100.0%');
    expect(view.scoresNote).toContain('over 1 game with a line.');
  });

  it('says how many of the games not graded had a forecast that was published too late', () => {
    const view = scorecardView(source('points_rest'), modelScorecard({ not_graded: 9, late: 4 }));

    expect(view.rows.find((row) => row.label === 'Not graded')).toEqual({
      label: 'Not graded',
      hint: 'no forecast in time, 4 published too late',
      value: '9',
    });
  });

  it('writes a share without an interval when the file gives none', () => {
    const view = scorecardView(source('market'), scorecard({ games: 2, wins: 1, losses: 1, accuracy: 0.5 }));

    expect(view.won).toEqual({ share: 0.5, text: '50.0%', interval: null, intervalText: null });
    expect(view.trackLabel).toBe('50.0% of 2 picks won');
  });

  it('puts a comma in a count of a whole season', () => {
    const view = scorecardView(source('market'), scorecard({ games: 1150, wins: 760, losses: 390, with_line: 1228, toss_ups: 78 }));

    expect(view.picksText).toBe('of 1,150 picks');
    expect(view.scoresNote).toContain('1,228 games with a line');
  });

  it('shows the sportsbooks alone in a sport that is not forecast, with no word of other cards', () => {
    const alone = scorecards(seasonRecord({ elo: null, points_rest: null }));

    expect(alone.map((view) => view.source.key)).toEqual(['market']);
    expect(alone[0].scoresNote).not.toContain('cards');
  });

  it.each([
    // The file rounds 6 of 11 to 0.5455, which would read 54.6% to one decimal. It is 54.545%.
    [6, 11, 0.5455, '54.5%'],
    [56, 101, 0.5545, '55.4%'],
    [64, 102, 0.6275, '62.7%'],
    [7, 13, 0.5385, '53.8%'],
    [72, 116, 0.6207, '62.1%'],
  ])('works the share of %i picks won of %i out from the two counts, and not from the rounded %f', (wins, games, accuracy, text) => {
    const view = scorecardView(source('market'), scorecard({ games, wins, losses: games - wins, accuracy }));

    expect(view.won?.text).toBe(text);
    expect(view.trackLabel).toBe(`${text} of ${games} picks won`);
    // The track is drawn from the share as the file gives it.
    expect(view.won?.share).toBe(accuracy);
  });
});

describe('baseline', () => {
  it('is what the home team every time would have won, with the games it is of', () => {
    expect(baseline(sampleRecord())).toEqual({ count: '81 of 143 games', share: '56.6%' });
  });

  it('is not there before the first game', () => {
    expect(baseline(seasonRecord())).toBeNull();
  });

  it('is of every recorded game, graded or not', () => {
    const record = seasonRecord({ games: 4, market: scorecard({ not_graded: 4 }), baseline_home: { games: 4, wins: 1 } });

    expect(baseline(record)).toEqual({ count: '1 of 4 games', share: '25.0%' });
  });

  it('rounds the share once: 12 of 22 games is 54.5% and not 54.6%', () => {
    expect(baseline(seasonRecord({ games: 22, baseline_home: { games: 22, wins: 12 } }))).toEqual({ count: '12 of 22 games', share: '54.5%' });
    expect(baseline(seasonRecord({ games: 31, baseline_home: { games: 31, wins: 29 } }))?.share).toBe('93.5%');
  });
});
