import { describe, expect, it } from 'vitest';
import { PoincareBall, norm, type Vec } from '../src/index.js';

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random point with Euclidean norm <= maxNorm·radius, in `dim` dimensions. */
function randomPoint(rand: () => number, dim: number, ball: PoincareBall, maxFrac = 0.95): Vec {
  const v = Array.from({ length: dim }, () => rand() * 2 - 1);
  const n = norm(v);
  const target = rand() * maxFrac * ball.radius;
  return v.map((x) => (x / n) * target);
}

const CURVATURES = [1, 0.5, 2.5];
const DIMS = [2, 3, 8];

describe('PoincareBall distances', () => {
  for (const c of CURVATURES) {
    const ball = new PoincareBall(c);
    for (const dim of DIMS) {
      const rand = rng(c * 1000 + dim);

      it(`is symmetric (c=${c}, dim=${dim})`, () => {
        for (let i = 0; i < 100; i++) {
          const x = randomPoint(rand, dim, ball);
          const y = randomPoint(rand, dim, ball);
          expect(ball.distance(x, y)).toBeCloseTo(ball.distance(y, x), 10);
        }
      });

      it(`satisfies the triangle inequality (c=${c}, dim=${dim})`, () => {
        for (let i = 0; i < 100; i++) {
          const x = randomPoint(rand, dim, ball);
          const y = randomPoint(rand, dim, ball);
          const z = randomPoint(rand, dim, ball);
          expect(ball.distance(x, z)).toBeLessThanOrEqual(ball.distance(x, y) + ball.distance(y, z) + 1e-9);
        }
      });

      it(`gyrovector and arcosh formulas agree to 1e-9 (c=${c}, dim=${dim})`, () => {
        for (let i = 0; i < 200; i++) {
          const x = randomPoint(rand, dim, ball);
          const y = randomPoint(rand, dim, ball);
          expect(Math.abs(ball.distance(x, y) - ball.distanceArcosh(x, y))).toBeLessThan(1e-9);
        }
      });

      it(`distanceToOrigin matches distance from the zero vector (c=${c}, dim=${dim})`, () => {
        for (let i = 0; i < 50; i++) {
          const x = randomPoint(rand, dim, ball);
          const zero = new Array(dim).fill(0);
          expect(ball.distanceToOrigin(x)).toBeCloseTo(ball.distance(zero, x), 10);
          expect(ball.distanceToOrigin(x)).toBeCloseTo(ball.distanceArcosh(zero, x), 9);
        }
      });
    }
  }

  it('reproduces the paper formula for c = 1 by hand', () => {
    const ball = new PoincareBall(1);
    const x = [0.3, 0.1];
    const y = [-0.2, 0.5];
    const diff2 = (0.5) ** 2 + (-0.4) ** 2;
    const expected = Math.acosh(1 + (2 * diff2) / ((1 - 0.1) * (1 - 0.29)));
    expect(ball.distanceArcosh(x, y)).toBeCloseTo(expected, 12);
    expect(ball.distance(x, y)).toBeCloseTo(expected, 9);
  });
});

describe('PoincareBall maps', () => {
  for (const c of CURVATURES) {
    const ball = new PoincareBall(c);
    const rand = rng(42 + c);

    it(`expMap0 ∘ logMap0 is the identity (c=${c})`, () => {
      for (let i = 0; i < 100; i++) {
        const y = randomPoint(rand, 3, ball);
        const back = ball.expMap0(ball.logMap0(y));
        back.forEach((v, k) => expect(v).toBeCloseTo(y[k], 10));
      }
    });

    it(`logMap0 ∘ expMap0 is the identity on tangent vectors (c=${c})`, () => {
      for (let i = 0; i < 100; i++) {
        const v = Array.from({ length: 3 }, () => (rand() * 2 - 1) * 2);
        const back = ball.logMap0(ball.expMap0(v));
        back.forEach((w, k) => expect(w).toBeCloseTo(v[k], 8));
      }
    });

    it(`expMap(x, logMap(x, y)) == y (c=${c})`, () => {
      for (let i = 0; i < 100; i++) {
        const x = randomPoint(rand, 3, ball, 0.8);
        const y = randomPoint(rand, 3, ball, 0.8);
        const back = ball.expMap(x, ball.logMap(x, y));
        back.forEach((v, k) => expect(v).toBeCloseTo(y[k], 8));
      }
    });

    it(`||logMap(x, y)||_x equals the distance (c=${c})`, () => {
      for (let i = 0; i < 50; i++) {
        const x = randomPoint(rand, 3, ball, 0.8);
        const y = randomPoint(rand, 3, ball, 0.8);
        const v = ball.logMap(x, y);
        const riemannianNorm = ball.conformalFactor(x) * norm(v);
        expect(riemannianNorm).toBeCloseTo(ball.distance(x, y), 8);
      }
    });

    it(`Lorentz round trip (c=${c})`, () => {
      for (let i = 0; i < 100; i++) {
        const x = randomPoint(rand, 4, ball);
        const z = ball.toLorentz(x);
        // On the hyperboloid: <z, z>_L = -1/c
        expect(PoincareBall.lorentzInner(z, z)).toBeCloseTo(-1 / c, 8);
        const back = ball.fromLorentz(z);
        back.forEach((v, k) => expect(v).toBeCloseTo(x[k], 10));
      }
    });

    it(`Lorentz distance agrees with the ball distance (c=${c})`, () => {
      for (let i = 0; i < 50; i++) {
        const x = randomPoint(rand, 3, ball, 0.9);
        const y = randomPoint(rand, 3, ball, 0.9);
        expect(ball.distanceLorentz(ball.toLorentz(x), ball.toLorentz(y))).toBeCloseTo(ball.distance(x, y), 7);
      }
    });

    it(`geodesic endpoints and additivity (c=${c})`, () => {
      for (let i = 0; i < 50; i++) {
        const x = randomPoint(rand, 2, ball, 0.9);
        const y = randomPoint(rand, 2, ball, 0.9);
        const g0 = ball.geodesic(x, y, 0);
        const g1 = ball.geodesic(x, y, 1);
        g0.forEach((v, k) => expect(v).toBeCloseTo(x[k], 10));
        g1.forEach((v, k) => expect(v).toBeCloseTo(y[k], 9));
        const mid = ball.geodesic(x, y, 0.5);
        const d = ball.distance(x, y);
        expect(ball.distance(x, mid)).toBeCloseTo(d / 2, 8);
        expect(ball.distance(mid, y)).toBeCloseTo(d / 2, 8);
      }
    });

    it(`pointAt places a point at the requested hyperbolic radius (c=${c})`, () => {
      for (const r of [0.1, 1, 3, 7]) {
        const p = ball.pointAt([1, 2, -1], r);
        expect(ball.distanceToOrigin(p)).toBeCloseTo(r, 9);
        expect(norm(p)).toBeCloseTo(Math.tanh((ball.sqrtC * r) / 2) / ball.sqrtC, 12);
      }
    });
  }

  it('project keeps points strictly inside the ball with margin 1e-5', () => {
    const ball = new PoincareBall(1);
    const p = ball.project([3, 4]);
    expect(norm(p)).toBeCloseTo(1 - 1e-5, 12);
    expect(ball.contains(p)).toBe(true);
    const q = ball.project([0.2, 0.1]);
    expect(q).toEqual([0.2, 0.1]);
    const far = new PoincareBall(4).project([10, 0]);
    expect(norm(far)).toBeCloseTo((1 - 1e-5) / 2, 12);
  });

  it('clamps artanh and tanh inputs instead of producing non-finite values', () => {
    const ball = new PoincareBall(1);
    expect(Number.isFinite(ball.distanceToOrigin([1, 0]))).toBe(true);
    expect(Number.isFinite(ball.distanceToOrigin([5, 0]))).toBe(true);
    const far = ball.expMap0([1e6, 0]);
    expect(Number.isFinite(far[0])).toBe(true);
    expect(ball.contains(far)).toBe(true);
  });

  it('rejects invalid curvature', () => {
    expect(() => new PoincareBall(0)).toThrow(RangeError);
    expect(() => new PoincareBall(-1)).toThrow(RangeError);
    expect(() => new PoincareBall(Number.NaN)).toThrow(RangeError);
  });
});
