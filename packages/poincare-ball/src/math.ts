/**
 * Numerically guarded scalar helpers and small dense-vector utilities.
 *
 * All vectors are plain `number[]` so the library has no runtime dependency
 * and works identically in Node, browsers and workers.
 */

export type Vec = number[];

/** artanh is clamped to |x| <= 1 - 1e-15 so it never returns ±Infinity. */
export const ARTANH_CLAMP = 1 - 1e-15;
/** tanh is clamped to |x| <= 15 (tanh(15) == 1 to double precision). */
export const TANH_CLAMP = 15;
/** Points are kept strictly inside the ball: ||x|| <= (1 - BALL_MARGIN) / sqrt(c). */
export const BALL_MARGIN = 1e-5;
/** Below this norm a vector is treated as the zero vector. */
export const EPS = 1e-15;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Inverse hyperbolic tangent with input clamped to ±(1 - 1e-15). */
export function artanh(x: number): number {
  const y = clamp(x, -ARTANH_CLAMP, ARTANH_CLAMP);
  return 0.5 * Math.log((1 + y) / (1 - y));
}

/** Hyperbolic tangent with input clamped to ±15. */
export function tanh(x: number): number {
  return Math.tanh(clamp(x, -TANH_CLAMP, TANH_CLAMP));
}

/** Inverse hyperbolic cosine with input clamped below at 1 (guards rounding). */
export function arcosh(x: number): number {
  return Math.acosh(x < 1 ? 1 : x);
}

export function dot(a: Vec, b: Vec): number {
  if (a.length !== b.length) throw new RangeError(`dimension mismatch: ${a.length} vs ${b.length}`);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function normSq(a: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return s;
}

export function norm(a: Vec): number {
  return Math.sqrt(normSq(a));
}

export function add(a: Vec, b: Vec): Vec {
  if (a.length !== b.length) throw new RangeError(`dimension mismatch: ${a.length} vs ${b.length}`);
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] + b[i];
  return out;
}

export function sub(a: Vec, b: Vec): Vec {
  if (a.length !== b.length) throw new RangeError(`dimension mismatch: ${a.length} vs ${b.length}`);
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] - b[i];
  return out;
}

export function scale(a: Vec, s: number): Vec {
  const out = new Array<number>(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] * s;
  return out;
}

export function neg(a: Vec): Vec {
  return scale(a, -1);
}

export function zeros(n: number): Vec {
  return new Array<number>(n).fill(0);
}

/** Unit vector in the direction of `a`, or the zero vector if `a` is (numerically) zero. */
export function normalize(a: Vec): Vec {
  const n = norm(a);
  return n < EPS ? zeros(a.length) : scale(a, 1 / n);
}
