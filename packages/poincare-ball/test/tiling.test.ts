import { describe, expect, it } from 'vitest';
import { PoincareBall, reflectAcrossGeodesic, regularTiling, tilingCircumradius, tilingEdgeLength } from '../src/index.js';

const ball = new PoincareBall(1);
const key = (p: number[]) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)}`;

describe('reflectAcrossGeodesic', () => {
  it('is an involution and an isometry', () => {
    const a = [0.3, 0.2];
    const b = [-0.1, 0.55];
    const pts = [
      [0.1, 0.1],
      [-0.4, -0.3],
      [0.7, 0.05],
      [0.0, 0.0],
    ];
    for (const z of pts) {
      const r = reflectAcrossGeodesic(z, a, b, ball);
      const back = reflectAcrossGeodesic(r, a, b, ball);
      expect(back[0]).toBeCloseTo(z[0], 10);
      expect(back[1]).toBeCloseTo(z[1], 10);
      // distances to the mirror's defining points are preserved
      expect(ball.distance(r, a)).toBeCloseTo(ball.distance(z, a), 9);
      expect(ball.distance(r, b)).toBeCloseTo(ball.distance(z, b), 9);
    }
  });

  it('fixes points on the geodesic and handles diameters', () => {
    const a = [0.3, 0.2];
    const b = [-0.1, 0.55];
    const mid = ball.geodesic(a, b, 0.5);
    const r = reflectAcrossGeodesic(mid, a, b, ball);
    expect(r[0]).toBeCloseTo(mid[0], 9);
    expect(r[1]).toBeCloseTo(mid[1], 9);
    // diameter along the x axis: mirror flips y
    const m = reflectAcrossGeodesic([0.2, 0.3], [-0.5, 0], [0.5, 0], ball);
    expect(m[0]).toBeCloseTo(0.2, 12);
    expect(m[1]).toBeCloseTo(-0.3, 12);
  });

  it('works in a ball of a different curvature', () => {
    const b2 = new PoincareBall(0.25); // radius 2
    const a = [0.6, 0.4];
    const b = [-0.2, 1.1];
    const z = [0.2, 0.2];
    const r = reflectAcrossGeodesic(z, a, b, b2);
    expect(b2.distance(r, a)).toBeCloseTo(b2.distance(z, a), 9);
    const back = reflectAcrossGeodesic(r, a, b, b2);
    expect(back[0]).toBeCloseTo(z[0], 9);
  });
});

describe('regularTiling', () => {
  it('rejects Euclidean and spherical {p,q}', () => {
    expect(() => regularTiling(4, 4, 1)).toThrow(RangeError);
    expect(() => regularTiling(3, 5, 1)).toThrow(RangeError);
    expect(() => regularTiling(2, 9, 1)).toThrow(RangeError);
  });

  it('{7,3}: circumradius and edge length follow the closed forms', () => {
    expect(tilingCircumradius(7, 3)).toBeCloseTo(Math.acosh(1 / (Math.tan(Math.PI / 7) * Math.tan(Math.PI / 3))), 12);
    // the hyperbolic sine rule in the same right triangle: sinh(s/2) = sinh(r) sin(π/p)
    expect(Math.sinh(tilingEdgeLength(7, 3) / 2)).toBeCloseTo(Math.sinh(tilingCircumradius(7, 3)) * Math.sin(Math.PI / 7), 12);
    expect(tilingEdgeLength(7, 3)).toBeCloseTo(2 * Math.acosh(Math.cos(Math.PI / 7) / Math.sin(Math.PI / 3)), 12);
  });

  for (const [p, q] of [
    [7, 3],
    [5, 4],
    [4, 5],
  ] as const) {
    it(`{${p},${q}}: every tile has p vertices, equal edges, and lies inside the disk`, () => {
      const tiles = regularTiling(p, q, 3);
      const s = tilingEdgeLength(p, q);
      const r = tilingCircumradius(p, q);
      expect(tiles[0].depth).toBe(0);
      expect(tiles.filter((t) => t.depth === 1)).toHaveLength(p);
      for (const t of tiles) {
        expect(t.vertices).toHaveLength(p);
        for (let i = 0; i < p; i++) {
          const a = t.vertices[i];
          const b = t.vertices[(i + 1) % p];
          expect(Math.hypot(a[0], a[1])).toBeLessThan(1);
          expect(ball.distance(a, b)).toBeCloseTo(s, 8);
          expect(ball.distance(t.center, a)).toBeCloseTo(r, 8);
        }
      }
      const centres = new Set(tiles.map((t) => key(t.center)));
      expect(centres.size).toBe(tiles.length);
    });

    it(`{${p},${q}}: exactly q tiles meet at each vertex of the central tile`, () => {
      const tiles = regularTiling(p, q, 3);
      for (const v of tiles[0].vertices) {
        const k = key(v);
        const incident = tiles.filter((t) => t.vertices.some((w) => key(w) === k));
        expect(incident).toHaveLength(q);
      }
    });
  }

  it('depth grows the tiling monotonically and depth 0 is a single tile', () => {
    expect(regularTiling(7, 3, 0)).toHaveLength(1);
    const a = regularTiling(7, 3, 1).length;
    const b = regularTiling(7, 3, 2).length;
    const c = regularTiling(7, 3, 3).length;
    expect(a).toBe(8);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('respects the rotation option', () => {
    const t = regularTiling(7, 3, 0, { angle: Math.PI / 2 })[0];
    expect(t.vertices[0][0]).toBeCloseTo(0, 12);
    expect(t.vertices[0][1]).toBeGreaterThan(0);
  });
});
