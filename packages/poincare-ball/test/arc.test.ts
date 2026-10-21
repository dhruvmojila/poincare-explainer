import { describe, expect, it } from 'vitest';
import { PoincareBall, geodesicArc, geodesicPolyline } from '../src/index.js';

describe('geodesicArc', () => {
  const ball = new PoincareBall(1);

  it('returns a straight segment for points collinear with the origin', () => {
    const a = geodesicArc([0.2, 0.2], [-0.5, -0.5], ball);
    expect(a.kind).toBe('segment');
    const b = geodesicArc([0, 0], [0.3, 0.7], ball);
    expect(b.kind).toBe('segment');
  });

  it('returns a circle orthogonal to the boundary through both points', () => {
    const x = [0.5, 0.1];
    const y = [-0.1, 0.6];
    const a = geodesicArc(x, y, ball);
    expect(a.kind).toBe('arc');
    if (a.kind !== 'arc') return;
    const [cx, cy] = a.center;
    // orthogonality: ||p||^2 = R^2 + 1
    expect(cx * cx + cy * cy).toBeCloseTo(a.radius * a.radius + 1, 10);
    // passes through x and y
    expect(Math.hypot(x[0] - cx, x[1] - cy)).toBeCloseTo(a.radius, 10);
    expect(Math.hypot(y[0] - cx, y[1] - cy)).toBeCloseTo(a.radius, 10);
    // start / end angles point at x and y
    expect(cx + a.radius * Math.cos(a.startAngle)).toBeCloseTo(x[0], 10);
    expect(cy + a.radius * Math.sin(a.startAngle)).toBeCloseTo(x[1], 10);
    expect(cx + a.radius * Math.cos(a.endAngle)).toBeCloseTo(y[0], 10);
    expect(cy + a.radius * Math.sin(a.endAngle)).toBeCloseTo(y[1], 10);
    // minor arc
    expect(Math.abs(a.endAngle - a.startAngle)).toBeLessThan(Math.PI);
  });

  it('every gyrovector geodesic sample lies on the arc, strictly between its end angles', () => {
    const x = [0.5, 0.1];
    const y = [-0.1, 0.6];
    const a = geodesicArc(x, y, ball);
    if (a.kind !== 'arc') throw new Error('expected arc');
    const lo = Math.min(a.startAngle, a.endAngle);
    const hi = Math.max(a.startAngle, a.endAngle);
    for (let i = 1; i < 16; i++) {
      const g = ball.geodesic(x, y, i / 16);
      expect(Math.hypot(g[0] - a.center[0], g[1] - a.center[1])).toBeCloseTo(a.radius, 8);
      const ang = Math.atan2(g[1] - a.center[1], g[0] - a.center[0]);
      expect(ang).toBeGreaterThan(lo);
      expect(ang).toBeLessThan(hi);
    }
  });

  it('scales correctly for c != 1', () => {
    const b2 = new PoincareBall(4); // radius 0.5
    const x = [0.25, 0.05];
    const y = [-0.05, 0.3];
    const a = geodesicArc(x, y, b2);
    if (a.kind !== 'arc') throw new Error('expected arc');
    const [cx, cy] = a.center;
    // orthogonal to the circle of radius 0.5: ||p||^2 = R^2 + 0.25
    expect(cx * cx + cy * cy).toBeCloseTo(a.radius * a.radius + 0.25, 10);
    expect(Math.hypot(x[0] - cx, x[1] - cy)).toBeCloseTo(a.radius, 10);
  });

  it('geodesicPolyline samples n+1 points from x to y', () => {
    const pts = geodesicPolyline([0.1, 0.2], [0.4, -0.3], 8, ball);
    expect(pts).toHaveLength(9);
    expect(pts[0][0]).toBeCloseTo(0.1, 10);
    expect(pts[8][1]).toBeCloseTo(-0.3, 9);
  });
});
