import {
  type Vec,
  BALL_MARGIN,
  EPS,
  add,
  arcosh,
  artanh,
  dot,
  norm,
  normSq,
  scale,
  sub,
  tanh,
  zeros,
} from './math.js';

/**
 * The Poincaré ball model of hyperbolic space with constant negative curvature -c.
 *
 *   B^n_c = { x in R^n : c * ||x||^2 < 1 },   radius 1 / sqrt(c)
 *
 * with the conformal metric g_x = λ_x^2 g^E, λ_x = 2 / (1 - c ||x||^2).
 * For c = 1 this is exactly the unit ball used in the paper (Mojila, ICBDML 2026):
 *
 *   d(x, y) = arcosh( 1 + 2 ||x - y||^2 / ((1 - ||x||^2)(1 - ||y||^2)) ).
 *
 * The operations follow Ungar's gyrovector formalism as popularised for machine
 * learning by Ganea, Bécigneul & Hofmann (2018, "Hyperbolic Neural Networks").
 */
export class PoincareBall {
  /** Curvature magnitude c > 0. The ball has curvature -c. */
  readonly c: number;
  /** sqrt(c), cached. */
  readonly sqrtC: number;
  /** Euclidean radius of the ball, 1 / sqrt(c). */
  readonly radius: number;
  /** Largest Euclidean norm a point may have after `project`. */
  readonly maxNorm: number;

  constructor(c = 1) {
    if (!(c > 0) || !Number.isFinite(c)) {
      throw new RangeError(`curvature parameter c must be a positive finite number, got ${c}`);
    }
    this.c = c;
    this.sqrtC = Math.sqrt(c);
    this.radius = 1 / this.sqrtC;
    this.maxNorm = (1 - BALL_MARGIN) / this.sqrtC;
  }

  /** Conformal factor λ_x = 2 / (1 - c ||x||^2). */
  conformalFactor(x: Vec): number {
    return 2 / (1 - this.c * normSq(x));
  }

  /**
   * Rescale `x` radially so that it lies strictly inside the ball
   * (||x|| <= (1 - 1e-5) / sqrt(c)). Points already inside are returned unchanged
   * (as a copy).
   */
  project(x: Vec): Vec {
    const n = norm(x);
    if (n > this.maxNorm) return scale(x, this.maxNorm / n);
    return x.slice();
  }

  /** True if `x` is strictly inside the ball. */
  contains(x: Vec): boolean {
    return this.c * normSq(x) < 1;
  }

  /**
   * Möbius addition x ⊕_c y =
   *   ((1 + 2c<x,y> + c||y||^2) x + (1 - c||x||^2) y) / (1 + 2c<x,y> + c^2 ||x||^2 ||y||^2).
   *
   * Not commutative and not associative; z ↦ x ⊕ z is a hyperbolic isometry that
   * moves the origin to x (a "left gyrotranslation").
   */
  mobiusAdd(x: Vec, y: Vec): Vec {
    const c = this.c;
    const xy = dot(x, y);
    const x2 = normSq(x);
    const y2 = normSq(y);
    const num = add(scale(x, 1 + 2 * c * xy + c * y2), scale(y, 1 - c * x2));
    const den = 1 + 2 * c * xy + c * c * x2 * y2;
    return this.project(scale(num, 1 / den));
  }

  /**
   * Möbius scalar multiplication r ⊗_c x = (1/√c) tanh(r · artanh(√c ||x||)) x / ||x||.
   * Scales the hyperbolic distance from the origin by r along the same ray.
   */
  mobiusScalarMul(r: number, x: Vec): Vec {
    const n = norm(x);
    if (n < EPS) return zeros(x.length);
    const f = tanh(r * artanh(this.sqrtC * n)) / (this.sqrtC * n);
    return this.project(scale(x, f));
  }

  /**
   * Hyperbolic distance via the gyrovector formula
   *   d_c(x, y) = (2/√c) artanh(√c ||(−x) ⊕_c y||).
   */
  distance(x: Vec, y: Vec): number {
    const d = this.mobiusAdd(scale(x, -1), y);
    return (2 / this.sqrtC) * artanh(this.sqrtC * norm(d));
  }

  /**
   * Hyperbolic distance via the paper's arcosh formula, generalised to curvature -c:
   *   d_c(x, y) = (1/√c) arcosh( 1 + 2c ||x−y||^2 / ((1 − c||x||^2)(1 − c||y||^2)) ).
   * Agrees with `distance` to ~1e-9 away from the boundary.
   */
  distanceArcosh(x: Vec, y: Vec): number {
    const c = this.c;
    const diff2 = normSq(sub(x, y));
    const den = (1 - c * normSq(x)) * (1 - c * normSq(y));
    return (1 / this.sqrtC) * arcosh(1 + (2 * c * diff2) / den);
  }

  /** d_c(0, x) = (2/√c) artanh(√c ||x||). In a Sarkar layout this is depth × τ. */
  distanceToOrigin(x: Vec): number {
    return (2 / this.sqrtC) * artanh(this.sqrtC * norm(x));
  }

  /** Exponential map at the origin: exp_0(v) = tanh(√c ||v||) v / (√c ||v||). */
  expMap0(v: Vec): Vec {
    const n = norm(v);
    if (n < EPS) return zeros(v.length);
    return this.project(scale(v, tanh(this.sqrtC * n) / (this.sqrtC * n)));
  }

  /** Logarithmic map at the origin: log_0(y) = artanh(√c ||y||) y / (√c ||y||). */
  logMap0(y: Vec): Vec {
    const n = norm(y);
    if (n < EPS) return zeros(y.length);
    return scale(y, artanh(this.sqrtC * n) / (this.sqrtC * n));
  }

  /**
   * Exponential map at x:
   *   exp_x(v) = x ⊕_c ( tanh(√c λ_x ||v|| / 2) v / (√c ||v||) ).
   */
  expMap(x: Vec, v: Vec): Vec {
    const n = norm(v);
    if (n < EPS) return x.slice();
    const lam = this.conformalFactor(x);
    const second = scale(v, tanh((this.sqrtC * lam * n) / 2) / (this.sqrtC * n));
    return this.mobiusAdd(x, second);
  }

  /**
   * Logarithmic map at x:
   *   log_x(y) = (2 / (√c λ_x)) artanh(√c ||(−x) ⊕ y||) ((−x) ⊕ y) / ||(−x) ⊕ y||.
   */
  logMap(x: Vec, y: Vec): Vec {
    const d = this.mobiusAdd(scale(x, -1), y);
    const n = norm(d);
    if (n < EPS) return zeros(x.length);
    const lam = this.conformalFactor(x);
    return scale(d, ((2 / (this.sqrtC * lam)) * artanh(this.sqrtC * n)) / n);
  }

  /**
   * Point on the geodesic from x (t = 0) to y (t = 1):
   *   γ(t) = x ⊕_c ( t ⊗_c ((−x) ⊕_c y) ).
   * t may lie outside [0, 1] to extend the geodesic.
   */
  geodesic(x: Vec, y: Vec, t: number): Vec {
    const d = this.mobiusAdd(scale(x, -1), y);
    return this.mobiusAdd(x, this.mobiusScalarMul(t, d));
  }

  /**
   * The point at hyperbolic distance r from the origin in the given direction.
   * Its Euclidean norm is tanh(√c r / 2) / √c.
   */
  pointAt(direction: Vec, hyperbolicRadius: number): Vec {
    const n = norm(direction);
    if (n < EPS) throw new RangeError('direction must be a non-zero vector');
    const euclid = tanh((this.sqrtC * hyperbolicRadius) / 2) / this.sqrtC;
    return this.project(scale(direction, euclid / n));
  }

  /**
   * Map to the hyperboloid (Lorentz) model with the same curvature, i.e. the sheet
   * {z : -z_0^2 + ||z_{1:n}||^2 = -1/c, z_0 > 0}. Returns [z_0, z_1, …, z_n].
   */
  toLorentz(x: Vec): Vec {
    const c = this.c;
    const x2 = normSq(x);
    const den = 1 - c * x2;
    const out = new Array<number>(x.length + 1);
    out[0] = (1 + c * x2) / (this.sqrtC * den);
    for (let i = 0; i < x.length; i++) out[i + 1] = (2 * x[i]) / den;
    return out;
  }

  /** Inverse of `toLorentz`: x = z_{1:n} / (1 + √c z_0). */
  fromLorentz(z: Vec): Vec {
    const den = 1 + this.sqrtC * z[0];
    const out = new Array<number>(z.length - 1);
    for (let i = 1; i < z.length; i++) out[i - 1] = z[i] / den;
    return this.project(out);
  }

  /** Minkowski inner product <a, b>_L = -a_0 b_0 + Σ a_i b_i. */
  static lorentzInner(a: Vec, b: Vec): number {
    let s = -a[0] * b[0];
    for (let i = 1; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  /** Hyperbolic distance between two hyperboloid points: (1/√c) arcosh(-c <a,b>_L). */
  distanceLorentz(a: Vec, b: Vec): number {
    return (1 / this.sqrtC) * arcosh(-this.c * PoincareBall.lorentzInner(a, b));
  }
}
