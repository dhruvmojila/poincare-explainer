import { describe, expect, it } from 'vitest';
import { PoincareBall, shellDistance, shellSimilarity, toShell } from '../src/index.js';

const ball = new PoincareBall(1);

describe('shell projection', () => {
  it('puts every non-zero point at hyperbolic radius rho in the same direction', () => {
    for (const x of [
      [0.1, 0.05],
      [0.9, -0.2],
      [-0.3, 0.6],
    ]) {
      const s = toShell(x, 2, ball);
      expect(ball.distanceToOrigin(s)).toBeCloseTo(2, 9);
      const ang = Math.atan2(x[1], x[0]);
      expect(Math.atan2(s[1], s[0])).toBeCloseTo(ang, 12);
    }
    expect(toShell([0, 0], 2, ball)).toEqual([0, 0]);
  });

  it('shellDistance depends only on direction, is symmetric, zero for equal directions', () => {
    const x = [0.2, 0.1];
    const deeper = [0.8, 0.4]; // same direction as x, four times further out
    const y = [-0.1, 0.5];
    expect(shellDistance(x, deeper, 1.5, ball)).toBeCloseTo(0, 9);
    expect(shellDistance(x, y, 1.5, ball)).toBeCloseTo(shellDistance(y, x, 1.5, ball), 12);
    expect(shellDistance(x, y, 1.5, ball)).toBeCloseTo(shellDistance(deeper, y, 1.5, ball), 9);
    expect(shellDistance(x, y, 1.5, ball)).toBeGreaterThan(0);
  });

  it('shellDistance grows with the angle and with the shell radius', () => {
    const base = [0.3, 0];
    const d30 = shellDistance(base, [Math.cos(0.5), Math.sin(0.5)].map((v) => v * 0.3), 1, ball);
    const d60 = shellDistance(base, [Math.cos(1.0), Math.sin(1.0)].map((v) => v * 0.3), 1, ball);
    expect(d60).toBeGreaterThan(d30);
    const far = shellDistance(base, [Math.cos(0.5), Math.sin(0.5)].map((v) => v * 0.3), 3, ball);
    expect(far).toBeGreaterThan(d30);
  });

  it('shellSimilarity is 1 for equal directions and in (0, 1] otherwise', () => {
    expect(shellSimilarity([0.1, 0.2], [0.3, 0.6], 2)).toBeCloseTo(1, 9);
    const s = shellSimilarity([0.1, 0.2], [-0.3, 0.1], 2);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});
