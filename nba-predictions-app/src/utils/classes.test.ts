import { describe, expect, it } from 'vitest';
import { classes } from './classes';

describe('classes', () => {
  it('joins the names it is given', () => {
    expect(classes('rounded-xl', 'border border-line')).toBe('rounded-xl border border-line');
  });

  it('leaves out what a condition turned off', () => {
    const padded = false as boolean;

    expect(classes('rounded-xl', padded && 'p-4', undefined, null, '', 'bg-surface')).toBe('rounded-xl bg-surface');
    expect(classes()).toBe('');
  });
});
