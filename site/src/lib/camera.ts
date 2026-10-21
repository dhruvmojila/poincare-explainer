import type { Vec2 } from 'poincare-ball';
import { ball } from './draw';

/**
 * An orientation-preserving isometry of the Poincaré disk, M(z) = (αz + β) / (β̄z + ᾱ)
 * with |α|² − |β|² = 1, used as the world camera. Every such map is a rotation after a
 * Möbius translation that brings one point (the focus) to the origin, so "zoom" in this
 * world is a move of the focus toward the origin, never a change of scale.
 */
export class Camera {
  constructor(
    readonly ar: number,
    readonly ai: number,
    readonly br: number,
    readonly bi: number,
  ) {}

  static identity(): Camera {
    return new Camera(1, 0, 0, 0);
  }

  /** z ↦ (z − p) / (1 − p̄ z): brings p to the origin. Equals (−p) ⊕ z. */
  static toOrigin(p: Vec2): Camera {
    const s = 1 / Math.sqrt(Math.max(1 - (p[0] * p[0] + p[1] * p[1]), 1e-12));
    return new Camera(s, 0, -p[0] * s, -p[1] * s);
  }

  /** z ↦ (z + p) / (1 + p̄ z): the inverse of `toOrigin(p)`, i.e. p ⊕ z. */
  static fromOrigin(p: Vec2): Camera {
    const s = 1 / Math.sqrt(Math.max(1 - (p[0] * p[0] + p[1] * p[1]), 1e-12));
    return new Camera(s, 0, p[0] * s, p[1] * s);
  }

  static rotation(theta: number): Camera {
    return new Camera(Math.cos(theta / 2), Math.sin(theta / 2), 0, 0);
  }

  /** Rotation by `theta` after the translation that brings `focus` to the origin. */
  static fromFocusTheta(focus: Vec2, theta: number): Camera {
    return Camera.rotation(theta).compose(Camera.toOrigin(focus));
  }

  apply(p: Vec2): Vec2 {
    const { ar, ai, br, bi } = this;
    // numerator (α z + β)
    const nr = ar * p[0] - ai * p[1] + br;
    const ni = ar * p[1] + ai * p[0] + bi;
    // denominator (β̄ z + ᾱ)
    const dr = br * p[0] + bi * p[1] + ar;
    const di = br * p[1] - bi * p[0] - ai;
    const dd = dr * dr + di * di || 1e-18;
    const x = (nr * dr + ni * di) / dd;
    const y = (ni * dr - nr * di) / dd;
    const n = Math.hypot(x, y);
    const max = ball.maxNorm;
    return n > max ? [(x / n) * max, (y / n) * max] : [x, y];
  }

  /** this ∘ other: apply `other` first, then this. */
  compose(other: Camera): Camera {
    const a1r = this.ar, a1i = this.ai, b1r = this.br, b1i = this.bi;
    const a2r = other.ar, a2i = other.ai, b2r = other.br, b2i = other.bi;
    // α = α1 α2 + β1 conj(β2)
    const ar = a1r * a2r - a1i * a2i + (b1r * b2r + b1i * b2i);
    const ai = a1r * a2i + a1i * a2r + (b1i * b2r - b1r * b2i);
    // β = α1 β2 + β1 conj(α2)
    const br = a1r * b2r - a1i * b2i + (b1r * a2r + b1i * a2i);
    const bi = a1r * b2i + a1i * b2r + (b1i * a2r - b1r * a2i);
    return new Camera(ar, ai, br, bi).normalized();
  }

  inverse(): Camera {
    return new Camera(this.ar, -this.ai, -this.br, -this.bi);
  }

  private normalized(): Camera {
    const n = Math.sqrt(Math.max(this.ar * this.ar + this.ai * this.ai - (this.br * this.br + this.bi * this.bi), 1e-18));
    return new Camera(this.ar / n, this.ai / n, this.br / n, this.bi / n);
  }

  /** The world point shown at the centre of the disk, M⁻¹(0) = −β/α. */
  focus(): Vec2 {
    const d = this.ar * this.ar + this.ai * this.ai;
    const fr = -(this.br * this.ar + this.bi * this.ai) / d;
    const fi = -(this.bi * this.ar - this.br * this.ai) / d;
    return [fr, fi];
  }

  /** Rotation angle, 2·arg α. */
  theta(): number {
    return 2 * Math.atan2(this.ai, this.ar);
  }

  isIdentity(eps = 1e-9): boolean {
    return Math.abs(this.br) < eps && Math.abs(this.bi) < eps && Math.abs(this.ai) < eps;
  }
}

/** Camera that moves the focus along the geodesic from `a`'s focus to `b`'s and turns the shortest way. */
export function lerpCamera(a: Camera, b: Camera, t: number): Camera {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const fa = a.focus();
  const fb = b.focus();
  const g = ball.geodesic(fa, fb, t);
  let dth = b.theta() - a.theta();
  while (dth > Math.PI) dth -= 2 * Math.PI;
  while (dth < -Math.PI) dth += 2 * Math.PI;
  return Camera.fromFocusTheta([g[0], g[1]], a.theta() + dth * t);
}
