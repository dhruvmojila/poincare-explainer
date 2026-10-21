import type { Vec } from './math.js';
import { norm, scale } from './math.js';
import { PoincareBall } from './ball.js';

/**
 * Radial projection of `x` onto the shell of hyperbolic radius `rho` (same direction,
 * Euclidean norm tanh(√c ρ / 2) / √c). The origin has no direction and is left there.
 */
export function toShell(x: Vec, rho: number, ball: PoincareBall = new PoincareBall(1)): Vec {
  const n = norm(x);
  if (n < 1e-15) return scale(x, 0);
  return ball.pointAt(x, rho);
}

/**
 * Hyperbolic distance between the radial projections of `x` and `y` onto a common
 * reference shell. It depends only on the angle between the two points, never on their
 * depths, so it isolates "semantic" direction from "structural" depth.
 *
 * This is how the open-source reference implementation compares a free-text query
 * (which has no depth of its own) with stored memories: similarity on a shell, with
 * depth and ancestry then applied as explicit structure. It realises the paper's
 * "similarity measures that account for both semantic content and structural
 * relationships" without the artefact that a point near the centre of the ball is
 * close to everything.
 */
export function shellDistance(x: Vec, y: Vec, rho: number, ball: PoincareBall = new PoincareBall(1)): number {
  return ball.distanceArcosh(toShell(x, rho, ball), toShell(y, rho, ball));
}

/** exp(−shellDistance / scale): a similarity in (0, 1], 1 when x and y share a direction. */
export function shellSimilarity(x: Vec, y: Vec, rho: number, scaleLen = 1, ball: PoincareBall = new PoincareBall(1)): number {
  return Math.exp(-shellDistance(x, y, rho, ball) / scaleLen);
}
