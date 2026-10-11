import { describe, expect, it } from 'vitest';
import { onTrack, reachOf, sharedBar, TRACK_LENGTH, trackMarks } from './recordTrack';

describe('onTrack', () => {
  it('puts a share on a track from 0% to 100%', () => {
    expect(onTrack(0, 0, 1)).toBe(0);
    expect(onTrack(0.5, 0, 1)).toBe(TRACK_LENGTH / 2);
    expect(onTrack(1, 0, 1)).toBe(TRACK_LENGTH);
    expect(onTrack(0.25, 0, 1)).toBe(50);
  });

  it('puts zero in the middle of a track that reaches as far on both sides', () => {
    expect(onTrack(0, -0.03, 0.03)).toBe(100);
    expect(onTrack(-0.03, -0.03, 0.03)).toBe(0);
    expect(onTrack(0.015, -0.03, 0.03)).toBe(150);
  });

  it('keeps a number beyond an end at that end', () => {
    expect(onTrack(-0.2, 0, 1)).toBe(0);
    expect(onTrack(1.2, 0, 1)).toBe(TRACK_LENGTH);
  });
});

describe('trackMarks', () => {
  it('gives where the interval starts, how long it is and where the number lies, each to a hundredth', () => {
    const marks = trackMarks(0, 1, 0.6207, [0.5299, 0.7038]);

    expect(marks).toEqual({ span: { x: 105.98, width: 34.78 }, point: 124.14 });
  });

  it('has a number without an interval, and neither', () => {
    expect(trackMarks(-0.05, 0.05, 0.025, null)).toEqual({ span: null, point: 150 });
    expect(trackMarks(0, 1, null, null)).toEqual({ span: null, point: null });
  });
});

describe('reachOf', () => {
  it('rounds the largest of the numbers up to one digit', () => {
    expect(reachOf([0.0067, -0.0128, 0.027])).toBe(0.03);
    expect(reachOf([0.0028, -0.0168, 0.0229])).toBe(0.03);
    expect(reachOf([-0.0412])).toBe(0.05);
    expect(reachOf([0.11, -0.3])).toBe(0.3);
    expect(reachOf([0.1234])).toBe(0.2);
  });

  it('leaves a number that is one digit already as it is', () => {
    expect(reachOf([0.03])).toBe(0.03);
    expect(reachOf([-0.2])).toBe(0.2);
    expect(reachOf([1])).toBe(1);
  });

  it('goes by the size of a number, whichever side of zero it is on', () => {
    expect(reachOf([-0.027, 0.0067])).toBe(0.03);
  });

  it('is never less than 0.01, and passes over what is not there', () => {
    expect(reachOf([0.0003, -0.0041])).toBe(0.01);
    expect(reachOf([null, null])).toBe(0.01);
    expect(reachOf([])).toBe(0.01);
    expect(reachOf([null, 0.04, null])).toBe(0.04);
  });
});

describe('sharedBar', () => {
  it('shares the bar out by the two counts, with a gap between the two parts', () => {
    // Seven of fifteen and eight of fifteen.
    expect(sharedBar(7, 8)).toEqual({ left: { x: 0, width: 92.33 }, right: { x: 94.33, width: 105.67 } });
    expect(sharedBar(1, 1)).toEqual({ left: { x: 0, width: 99 }, right: { x: 101, width: 99 } });
  });

  it('gives the whole bar to the one count when the other is none, without a gap', () => {
    expect(sharedBar(0, 5)).toEqual({ left: { x: 0, width: 0 }, right: { x: 0, width: TRACK_LENGTH } });
    expect(sharedBar(3, 0)).toEqual({ left: { x: 0, width: TRACK_LENGTH }, right: { x: TRACK_LENGTH, width: 0 } });
  });

  it('is not there when both counts are none', () => {
    expect(sharedBar(0, 0)).toBeNull();
  });

  it('keeps a count of one among hundreds long enough to be seen, and inside the bar', () => {
    expect(sharedBar(1, 1000)).toEqual({ left: { x: 0, width: 2 }, right: { x: 4, width: 196 } });
    expect(sharedBar(1000, 1)).toEqual({ left: { x: 0, width: 196 }, right: { x: 198, width: 2 } });
    expect(sharedBar(1, 199)).toEqual({ left: { x: 0, width: 2 }, right: { x: 4, width: 196 } });
  });
});
