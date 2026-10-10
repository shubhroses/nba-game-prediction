import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { boardReducer, INITIAL_STATE, type BoardState } from './boardState';

const board = (generated_at: string): Board => ({
  schema: 1,
  sport: 'basketball_nba',
  generated_at,
  slot: '2026-10-20T12:10-04:00',
  next_due: '2026-10-20T15:10-04:00',
  games: [],
});

const NOON = board('2026-10-20T16:12:00Z');
const AFTERNOON = board('2026-10-20T19:11:00Z');

const ready: BoardState = { status: 'ready', board: NOON, fetchedAt: 1000, refreshing: false };
const failed: BoardState = { status: 'error', error: { kind: 'network' }, refreshing: false };

describe('boardReducer', () => {
  it('starts with nothing to show', () => {
    expect(INITIAL_STATE).toEqual({ status: 'loading', refreshing: false });
  });

  it('stays on the first spinner while the first check runs', () => {
    expect(boardReducer(INITIAL_STATE, { type: 'check_started' })).toEqual(INITIAL_STATE);
  });

  it('shows the board of the first check with the time it arrived', () => {
    const state = boardReducer(INITIAL_STATE, { type: 'check_succeeded', board: NOON, at: 1000 });

    expect(state).toEqual(ready);
  });

  it('reports why the first check failed', () => {
    const state = boardReducer(INITIAL_STATE, { type: 'check_failed', error: { kind: 'http', status: 404 } });

    expect(state).toEqual({ status: 'error', error: { kind: 'http', status: 404 }, refreshing: false });
  });

  it('keeps the board on screen while a later check runs', () => {
    expect(boardReducer(ready, { type: 'check_started' })).toEqual({ ...ready, refreshing: true });
  });

  it('replaces the board when a later check brings a new one', () => {
    const checking = boardReducer(ready, { type: 'check_started' });
    const state = boardReducer(checking, { type: 'check_succeeded', board: AFTERNOON, at: 2000 });

    expect(state).toEqual({ status: 'ready', board: AFTERNOON, fetchedAt: 2000, refreshing: false });
  });

  it.each([{ kind: 'network' }, { kind: 'http', status: 503 }, { kind: 'shape', problem: 'schema should be 1' }] as const)(
    'keeps the last good board when a later check fails: $kind',
    (error) => {
      const checking = boardReducer(ready, { type: 'check_started' });

      expect(boardReducer(checking, { type: 'check_failed', error })).toEqual(ready);
    },
  );

  it('keeps the error on screen while another attempt runs', () => {
    expect(boardReducer(failed, { type: 'check_started' })).toEqual({ ...failed, refreshing: true });
  });

  it('leaves the error for the board when another attempt succeeds', () => {
    const retrying = boardReducer(failed, { type: 'check_started' });

    expect(boardReducer(retrying, { type: 'check_succeeded', board: NOON, at: 1000 })).toEqual(ready);
  });

  it('shows the latest reason when another attempt fails', () => {
    const retrying = boardReducer(failed, { type: 'check_started' });
    const state = boardReducer(retrying, { type: 'check_failed', error: { kind: 'http', status: 429 } });

    expect(state).toEqual({ status: 'error', error: { kind: 'http', status: 429 }, refreshing: false });
  });
});
