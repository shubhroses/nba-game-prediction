import { describe, expect, it } from 'vitest';
// The document that the figures are copied from, read as text: the page must show what it says and nothing else.
import readme from '../../../pipeline/model/README.md?raw';
import { BACKTEST, backtestCount, type BacktestFigure, type BacktestRow } from './backtest';

/** The rows of the table of the backtest in the document, each as the text of its cells. */
function tableRows(): string[][] {
  const start = readme.indexOf('| | Winners picked | Log loss | Brier score |');
  if (start < 0) throw new Error('pipeline/model/README.md has no table of the backtest');

  const lines = readme.slice(start).split('\n');
  const table = lines.slice(2, lines.findIndex((line) => !line.startsWith('|')));
  return table.map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

/** A cell of the table as the document writes it, from the figures of the page. */
function winnersCell({ winners }: BacktestRow): string {
  return winners.games === null ? winners.figure : `${winners.figure}, ${winners.games} games (${winners.interval})`;
}

function scoreCell({ figure, interval }: BacktestFigure): string {
  return interval === null ? figure : `${figure} (${interval})`;
}

describe('the backtest as the page shows it', () => {
  const [pointsRest, elo, homeTeam] = BACKTEST.rows;

  it('has the three rows of the table of the document, with the two models in the order of the page', () => {
    expect(tableRows().map(([name]) => name)).toEqual([
      'Elo',
      'Points and rest',
      "The home team every time, at last season's home-win rate",
    ]);
    expect(BACKTEST.rows.map((row) => row.source ?? row.name)).toEqual(['points_rest', 'elo', 'The home team every time']);
    expect(homeTeam.note).toBe("at last season's home-win rate");
  });

  it('copies every figure of the table as the document writes it', () => {
    const [eloCells, pointsRestCells, homeTeamCells] = tableRows();

    expect([winnersCell(elo), scoreCell(elo.logLoss), scoreCell(elo.brier)]).toEqual(eloCells.slice(1));
    expect([winnersCell(pointsRest), scoreCell(pointsRest.logLoss), scoreCell(pointsRest.brier)]).toEqual(pointsRestCells.slice(1));
    expect([winnersCell(homeTeam), scoreCell(homeTeam.logLoss), scoreCell(homeTeam.brier)]).toEqual(homeTeamCells.slice(1));
  });

  it('gives every share the games it is of', () => {
    expect(readme).toContain(`On those ${BACKTEST.games} games, with 95% intervals from resampling the games:`);
    expect(BACKTEST.games).toBe('2,643');
    expect(BACKTEST.rows.map((row) => backtestCount(row.winners))).toEqual([
      '1,786 of 2,643 games',
      '1,762 of 2,643 games',
      'of 2,643 games',
    ]);
  });

  it('is labeled as a backtest of two earlier seasons that had no odds in it, and as no result of this season', () => {
    expect(readme).toContain(`The two seasons after that, ${BACKTEST.seasons[0]} and ${BACKTEST.seasons[1]}, were scored once`);
    expect(readme).toContain('The backtest had no odds.');
    expect(readme).toContain('No figure of the backtest is a result of 2026-27.');
    expect(BACKTEST.label).toBe(
      'A backtest on 2,643 games of 2024-25 and 2025-26, with no odds in it. It is not a result of this season.',
    );
  });

  it('says that the backtest counted a pick from 50% on, which the record does not', () => {
    expect(readme).toContain('A winner counts as picked here when it was given more than 50%.');
    expect(readme).toContain('The record on the data branch counts a pick from 52% on, so its shares of wins are not the same kind of number as these.');
    expect(BACKTEST.pickNote).toBe(
      'In the backtest a winner counted as picked when it was given more than 50%. ' +
        'The record counts a pick from 52% on, so its shares of wins are not the same kind of number as these.',
    );
  });

  it('says that lower is better for the two scores, and what a coin scores, with the decimals of the document', () => {
    const { logLoss, brier } = BACKTEST.coinFlip;

    expect(readme).toContain(`Lower is better for log loss and for the Brier score, and one half for every game scores ${logLoss} and ${brier}.`);
    expect(BACKTEST.scoresNote).toBe(
      'Lower is better for log loss and for the Brier score, and a coin flip for every game scores 0.6931 and 0.25.',
    );
  });

  it('copies what the document says of the difference between the two models', () => {
    const { winners, logLoss, brier } = BACKTEST.difference;

    expect(readme).toContain(
      `The gap of ${winners.games} games is within what chance produces: the 95% interval of the difference runs from ${winners.fewer} game fewer to ${winners.more} more.`,
    );
    expect(readme).toContain(
      `its log loss was lower by ${logLoss.lower}, with a 95% interval from ${logLoss.from} to ${logLoss.to} lower, and its Brier score by ${brier}`,
    );
  });

  it('counts the winners as the difference between the rows of the two models', () => {
    const picked = (row: BacktestRow) => Number((row.winners.games ?? '').replace(',', ''));

    expect(picked(pointsRest) - picked(elo)).toBe(BACKTEST.difference.winners.games);
  });

  it('carries the two plainest cautions of the document, in its words', () => {
    expect(readme).toContain('**It is not shown that the points-and-rest model picks more winners than Elo.**');
    expect(readme).toContain('Expect the two to pick about the same number of winners.');
    expect(readme).toContain('**Neither was tested against the sportsbooks.** The backtest had no odds.');

    expect(BACKTEST.cautions).toEqual({
      winners: {
        lead: 'It is not shown that Points & Rest picks more winners than Elo.',
        text:
          'The gap of 24 games is within what chance produces: the 95% interval of the difference runs from 1 game fewer to 49 more. ' +
          'Expect the two to pick about the same number of winners.',
      },
      sportsbooks: {
        lead: 'Neither model was tested against the sportsbooks.',
        text: 'The backtest had no odds.',
      },
    });
  });
});
