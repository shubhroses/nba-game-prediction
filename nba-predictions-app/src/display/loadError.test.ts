import { describe, expect, it } from 'vitest';
import { explainLoadError } from './loadError';

describe('explainLoadError', () => {
  it('says that the server could not be reached', () => {
    expect(explainLoadError('The record', { kind: 'network' })).toBe(
      'The record could not be loaded: the server that holds the files could not be reached.',
    );
  });

  it('gives the status the server answered with', () => {
    expect(explainLoadError('The games', { kind: 'http', status: 503 })).toBe(
      'The games could not be loaded: the server that holds the files answered with HTTP 503.',
    );
  });

  it('says that the file cannot be read, and keeps what is wrong with it to itself', () => {
    expect(explainLoadError('The ratings', { kind: 'shape', problem: 'schema should be 1' })).toBe(
      'The ratings arrived in a form this page cannot read.',
    );
  });
});
