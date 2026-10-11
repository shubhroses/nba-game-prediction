import { describe, expect, it } from 'vitest';
// The pipeline's table, read as text. It is the other end of the same contract:
// the pipeline writes these codes into the board and this page reads them.
import pipelineTeams from '../../../pipeline/teams.py?raw';
import { TEAM_LOGOS } from '../utils/formatters';
import { nameInSentence, shortName, TEAM_NAMES, teamName } from './teams';

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

describe('shortName', () => {
  it('names a team by the place it plays for', () => {
    expect(shortName('DET')).toBe('Detroit');
    expect(shortName('GSW')).toBe('Golden State');
    expect(shortName('OKC')).toBe('Oklahoma City');
    expect(shortName('UTA')).toBe('Utah');
  });

  it('names the two teams of Los Angeles by their own names, because the city would not tell them apart', () => {
    expect(shortName('LAL')).toBe('Lakers');
    expect(shortName('LAC')).toBe('Clippers');
  });

  it.each([...TEAM_NAMES])('has a name for %s that is the start or the end of %s', (code, name) => {
    const short = shortName(code);

    expect(short).not.toBe(code);
    expect(name.startsWith(`${short} `) || name.endsWith(` ${short}`)).toBe(true);
  });

  it('gives every team a name of its own', () => {
    expect(new Set([...TEAM_NAMES.keys()].map(shortName)).size).toBe(30);
  });

  it('shows a code that is not in the table as it is', () => {
    expect(shortName('SEA')).toBe('SEA');
  });
});

describe('nameInSentence', () => {
  it('is the short name, which a sentence takes as it is', () => {
    expect(nameInSentence('DEN')).toBe('Denver');
    expect(nameInSentence('NYK')).toBe('New York');
    expect(nameInSentence('GSW')).toBe('Golden State');
  });

  it('gives the two teams that go by their own names their article', () => {
    expect(nameInSentence('LAC')).toBe('the Clippers');
    expect(nameInSentence('LAL')).toBe('the Lakers');
  });

  it('gives an article to those two teams and to no other', () => {
    expect([...TEAM_NAMES.keys()].filter((code) => nameInSentence(code).startsWith('the '))).toEqual(['LAC', 'LAL']);
  });

  it('shows a code that is not in the table as it is', () => {
    expect(nameInSentence('SEA')).toBe('SEA');
  });
});
