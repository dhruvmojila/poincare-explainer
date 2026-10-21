import { describe, expect, it } from 'vitest';
import { decayWeight, ebbinghausWeight, makeDecay, timeWeightedScore, validityWindowWeight, weightedScore } from '../src/index.js';

describe('decayWeight', () => {
  it('is 1 at age 0 and 1/2 at one half-life', () => {
    expect(decayWeight(0, 10)).toBe(1);
    expect(decayWeight(10, 10)).toBeCloseTo(0.5, 12);
    expect(decayWeight(20, 10)).toBeCloseTo(0.25, 12);
    expect(decayWeight(30, 10)).toBeCloseTo(0.125, 12);
  });

  it('is monotone decreasing in age', () => {
    let prev = 1;
    for (let a = 1; a < 100; a++) {
      const w = decayWeight(a, 7);
      expect(w).toBeLessThan(prev);
      prev = w;
    }
  });

  it('disables decay for non-positive half-life and negative age', () => {
    expect(decayWeight(100, 0)).toBe(1);
    expect(decayWeight(100, -5)).toBe(1);
    expect(decayWeight(-3, 5)).toBe(1);
  });

  it('timeWeightedScore multiplies proximity by recency', () => {
    expect(timeWeightedScore(0, 0, 10)).toBe(1);
    expect(timeWeightedScore(1, 10, 10)).toBeCloseTo(Math.exp(-1) * 0.5, 12);
    expect(weightedScore(1, 0.5)).toBeCloseTo(Math.exp(-1) * 0.5, 12);
  });
});

describe('ebbinghausWeight', () => {
  it('is 1 at age 0 and 1/e at one stability', () => {
    expect(ebbinghausWeight(0, 5)).toBe(1);
    expect(ebbinghausWeight(5, 5)).toBeCloseTo(Math.exp(-1), 12);
    expect(ebbinghausWeight(10, 5)).toBeCloseTo(Math.exp(-2), 12);
  });
  it('is disabled for non-positive stability', () => {
    expect(ebbinghausWeight(50, 0)).toBe(1);
  });
  it('falls faster than a half-life curve of the same parameter at first', () => {
    // exp(-t/S) < 2^(-t/S) for all t > 0
    for (const t of [0.1, 1, 3, 10]) expect(ebbinghausWeight(t, 4)).toBeLessThan(decayWeight(t, 4));
  });
});

describe('validityWindowWeight', () => {
  it('is 1 inside the window and 0 after a hard cut', () => {
    expect(validityWindowWeight(0, 10)).toBe(1);
    expect(validityWindowWeight(10, 10)).toBe(1);
    expect(validityWindowWeight(10.001, 10)).toBe(0);
  });
  it('ramps linearly to 0 over `ramp`', () => {
    expect(validityWindowWeight(12, 10, 4)).toBeCloseTo(0.5, 12);
    expect(validityWindowWeight(13, 10, 4)).toBeCloseTo(0.25, 12);
    expect(validityWindowWeight(14, 10, 4)).toBe(0);
    expect(validityWindowWeight(99, 10, 4)).toBe(0);
  });
  it('is disabled for a non-positive window', () => {
    expect(validityWindowWeight(99, 0)).toBe(1);
  });
});

describe('makeDecay', () => {
  it('dispatches to the three curves', () => {
    expect(makeDecay('half-life', 10)(10)).toBeCloseTo(0.5, 12);
    expect(makeDecay('ebbinghaus', 10)(10)).toBeCloseTo(Math.exp(-1), 12);
    expect(makeDecay('window', 10, 2)(11)).toBeCloseTo(0.5, 12);
  });
  it('throws on an unknown kind', () => {
    expect(() => makeDecay('nope' as never, 1)).toThrow(RangeError);
  });
});
