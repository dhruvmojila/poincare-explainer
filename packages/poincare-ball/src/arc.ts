import type { Vec } from './math.js';
import { PoincareBall } from './ball.js';

export type Vec2 = [number, number];

/** A geodesic through two points of the Poincaré disk, in a form a 2-D canvas can draw. */
export type GeodesicArc =
  | {
      kind: 'segment';
      from: Vec2;
      to: Vec2;
    }
  | {
      kind: 'arc';
      from: Vec2;
      to: Vec2;
      /** Centre of the circle orthogonal to the boundary (outside the disk). */
      center: Vec2;
      /** Euclidean radius of that circle. */
      radius: number;
      /** Angle (radians) of `from` as seen from `center`. */
      startAngle: number;
      /** Angle (radians) of `to` as seen from `center`; |end - start| < π. */
      endAngle: number;
      /** Pass to `CanvasRenderingContext2D.arc` so the minor arc inside the disk is drawn. */
      anticlockwise: boolean;
    };

/** Below this |x1 y2 − x2 y1| (in unit-disk coordinates) the geodesic is treated as a diameter. */
const COLLINEAR_EPS = 1e-9;

/**
 * Geodesic through two points of the 2-D Poincaré disk of curvature -c.
 *
 * Returns a straight segment when the geodesic passes through the origin (x, y and 0
 * collinear), otherwise the unique circle orthogonal to the boundary circle through
 * x and y, with the start/end angles of the minor arc between them.
 *
 * Derivation (unit disk): a circle with centre p and radius R is orthogonal to the
 * unit circle iff ||p||^2 = R^2 + 1. Combining with ||p − x||^2 = R^2 gives the linear
 * equation 2<p, x> = 1 + ||x||^2 (and likewise for y); solving the 2×2 system gives p.
 */
export function geodesicArc(x: Vec, y: Vec, ball: PoincareBall = new PoincareBall(1)): GeodesicArc {
  if (x.length !== 2 || y.length !== 2) throw new RangeError('geodesicArc is defined for 2-D points');
  const s = ball.sqrtC; // scale to the unit disk
  const x1 = x[0] * s, x2 = x[1] * s;
  const y1 = y[0] * s, y2 = y[1] * s;
  const from: Vec2 = [x[0], x[1]];
  const to: Vec2 = [y[0], y[1]];

  const det = x1 * y2 - x2 * y1;
  const dx = x1 - y1, dy = x2 - y2;
  if (Math.abs(det) < COLLINEAR_EPS || dx * dx + dy * dy < 1e-24) {
    return { kind: 'segment', from, to };
  }

  const ax = 1 + x1 * x1 + x2 * x2; // 1 + ||x||^2
  const ay = 1 + y1 * y1 + y2 * y2; // 1 + ||y||^2
  const p1 = (ax * y2 - ay * x2) / (2 * det);
  const p2 = (ay * x1 - ax * y1) / (2 * det);
  const R = Math.sqrt(Math.max(p1 * p1 + p2 * p2 - 1, 0));

  // Very flat arcs: fall back to a segment (a canvas cannot draw a radius of 1e9 well).
  if (!Number.isFinite(R) || R > 1e6) return { kind: 'segment', from, to };

  const a0 = Math.atan2(x2 - p2, x1 - p1);
  const a1 = Math.atan2(y2 - p2, y1 - p1);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da <= -Math.PI) da += 2 * Math.PI;

  return {
    kind: 'arc',
    from,
    to,
    center: [p1 / s, p2 / s],
    radius: R / s,
    startAngle: a0,
    endAngle: a0 + da,
    anticlockwise: da < 0,
  };
}

/**
 * Sample `n + 1` points along the geodesic from x to y (inclusive), using the
 * dimension-agnostic `PoincareBall.geodesic`. Useful for polylines in any dimension.
 */
export function geodesicPolyline(x: Vec, y: Vec, n = 32, ball: PoincareBall = new PoincareBall(1)): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) pts.push(ball.geodesic(x, y, i / n));
  return pts;
}
