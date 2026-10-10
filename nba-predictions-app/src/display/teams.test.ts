import { describe, expect, it } from 'vitest';
// The pipeline's table, read as text. It is the other end of the same contract:
// the pipeline writes these codes into the board and this page reads them.
import pipelineTeams from '../../../pipeline/teams.py?raw';
import { TEAM_LOGOS } from '../utils/formatters';
import { TEAM_NAMES, teamName } from './teams';

describe('the team table', () => {
  it('has 30 teams, each with its own three-letter code and its own name', () => {
    expect(TEAM_NAMES.size).toBe(30);
    expect([...TEAM_NAMES.keys()].every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(new Set(TEAM_NAMES.values()).size).toBe(30);
  });

  it('spells every name as the logo table does', () => {
    expect([...TEAM_NAMES.values()].sort()).toEqual([...TEAM_LOGOS.keys()].sort());
  });

  it('gives every team the code the pipeline gives it', () => {
    const pipeline = [...pipelineTeams.matchAll(/^ {4}"([^"]+)": "([A-Z]{3})",$/gm)].map(([, name, code]) => [code, name]);

    expect(pipeline).toHaveLength(30);
    expect([...TEAM_NAMES.entries()].sort()).toEqual(pipeline.sort());
  });
});

describe('teamName', () => {
  it('turns a code into the full name', () => {
    expect(teamName('BOS')).toBe('Boston Celtics');
    expect(teamName('PHI')).toBe('Philadelphia 76ers');
  });

  it('shows a code it does not know as it is', () => {
    expect(teamName('SEA')).toBe('SEA');
  });
});
