import { describe, expect, it } from 'vitest';
import { parseBoard, type Board } from '../data/board';
import { examplesOf } from '../data/pipelineExamples';
import { missingPointsRest } from './pointsRest';

/**
 * The board of the example in pipeline/README.md, of Wednesday 21 October at
 * 21:10 in New York: a game of that evening with its forecast, and a game of
 * Thursday without one.
 */
function exampleBoard(): Board {
  const parsed = parseBoard(examplesOf('slate.json')[0]);
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.value;
}

describe('missingPointsRest', () => {
  it('is nothing for a game that has its forecast', () => {
    const board = exampleBoard();

    expect(missingPointsRest(board.games[0], board)).toBeNull();
  });

  it('says not yet for a game of a later day, whose morning is still to come', () => {
    const board = exampleBoard();

    expect(board.games[1].commence_time).toBe('2026-10-22T23:30:00Z');
    expect(missingPointsRest(board.games[1], board)).toBe('not-yet');
  });

  it('says not yet for every game before the season, when no forecast has ever been frozen', () => {
    const board = exampleBoard();
    board.slot = '2026-10-10T18:10-04:00';
    board.models = { results_through: null, status: 'ok', predictions_day: null };
    const opener = { ...board.games[1], commence_time: '2026-10-20T23:00:00Z' };

    expect(missingPointsRest(opener, board)).toBe('not-yet');
  });

  it('says left out for a game of the frozen day when the results did not pass the checks', () => {
    const board = exampleBoard();
    board.models = { results_through: '2026-10-20', status: 'degraded', predictions_day: '2026-10-21' };
    const tonight = { ...board.games[0], points_rest: null };

    expect(missingPointsRest(tonight, board)).toBe('left-out');
  });

  it('does not blame the checks of today for a game of tomorrow', () => {
    const board = exampleBoard();
    board.models = { results_through: '2026-10-20', status: 'degraded', predictions_day: '2026-10-21' };

    expect(missingPointsRest(board.games[1], board)).toBe('not-yet');
  });

  it('says none for a game of the frozen day that the job had no forecast for', () => {
    const board = exampleBoard();
    const added = { ...board.games[0], id: 'added-in-the-afternoon', points_rest: null };

    expect(missingPointsRest(added, board)).toBe('none');
  });

  it('says none for a game of a day whose morning has come without its forecasts', () => {
    // Thursday at noon in New York, and the board still carries the forecasts of Wednesday.
    const board = exampleBoard();
    board.slot = '2026-10-22T12:10-04:00';

    expect(missingPointsRest(board.games[1], board)).toBe('none');
  });

  it('goes by the day of the game, which a late start does not move to the next date', () => {
    // 22:30 in Los Angeles on Wednesday is Thursday in UTC and in New York, and a game of Wednesday.
    const board = exampleBoard();
    const late = { ...board.games[0], commence_time: '2026-10-22T05:30:00Z', points_rest: null };

    expect(missingPointsRest(late, board)).toBe('none');
  });

  it('says not built when the models have never been built, or the sport is not forecast', () => {
    const board = { ...exampleBoard(), models: null };

    expect(missingPointsRest(board.games[1], board)).toBe('not-built');
  });
});
