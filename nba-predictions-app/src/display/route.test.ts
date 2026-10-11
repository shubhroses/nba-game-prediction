import { describe, expect, it } from 'vitest';
import { hrefOf, routeOf, titleOf, VIEWS } from './route';

describe('VIEWS', () => {
  it('lists the five views in the order of the tabs', () => {
    expect(VIEWS.map((view) => view.label)).toEqual(['Games', 'Results', 'Record', 'Rankings', 'How it works']);
    expect(VIEWS.map((view) => view.key)).toEqual(['games', 'results', 'record', 'rankings', 'method']);
  });
});

describe('routeOf', () => {
  it.each(VIEWS.map((view) => view.key))('shows the view %s at its address', (view) => {
    expect(routeOf(`#/${view}`)).toEqual({ view, param: null });
    expect(routeOf(hrefOf(view))).toEqual({ view, param: null });
  });

  it.each(['', '#', '#/', '#/standings', '#main', '#/record-book', '#//record', '#/constructor'])(
    'shows the games at %j, which names no view',
    (hash) => {
      expect(routeOf(hash)).toEqual({ view: 'games', param: null });
    },
  );

  it('is not put off by a capital, a slash at the end or a missing one at the start', () => {
    expect(routeOf('#/Record')).toEqual({ view: 'record', param: null });
    expect(routeOf('#/record/')).toEqual({ view: 'record', param: null });
    expect(routeOf('#record')).toEqual({ view: 'record', param: null });
  });

  it('gives the view what follows its name', () => {
    expect(routeOf('#/results/2026-11-07')).toEqual({ view: 'results', param: '2026-11-07' });
    expect(routeOf('#/rankings/points_rest')).toEqual({ view: 'rankings', param: 'points_rest' });
    expect(routeOf('#/games/2026-11-08/BOS')).toEqual({ view: 'games', param: '2026-11-08/BOS' });
  });

  it('reads back what hrefOf wrote, whatever is in it', () => {
    expect(routeOf(hrefOf('results', '2026-11-07'))).toEqual({ view: 'results', param: '2026-11-07' });
    expect(routeOf(hrefOf('games', 'a b/c%d'))).toEqual({ view: 'games', param: 'a b/c%d' });
  });

  it('keeps a part that is not encoded as it should be, and does not throw', () => {
    expect(routeOf('#/results/100%')).toEqual({ view: 'results', param: '100%' });
  });
});

describe('hrefOf', () => {
  it('is the address after the #', () => {
    expect(hrefOf('games')).toBe('#/games');
    expect(hrefOf('method')).toBe('#/method');
    expect(hrefOf('results', '2026-11-07')).toBe('#/results/2026-11-07');
  });
});

describe('titleOf', () => {
  it('is the name of the page for the games', () => {
    expect(titleOf('games')).toBe('NBA Game Predictions');
  });

  it('puts the name of any other view first', () => {
    expect(titleOf('record')).toBe('Record · NBA Game Predictions');
    expect(titleOf('method')).toBe('How it works · NBA Game Predictions');
  });
});
