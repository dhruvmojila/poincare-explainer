import { describe, expect, it } from 'vitest';
import { PoincareBall, distortion, indexTree, kNearest, neighbourPrecision, randomPairs, sarkarLayout, type TreeNode } from '../src/index.js';

const tree: TreeNode = {
  id: 'r',
  children: [
    { id: 'a', children: [{ id: 'a0' }, { id: 'a1', children: [{ id: 'a10' }, { id: 'a11' }] }] },
    { id: 'b', children: [{ id: 'b0' }, { id: 'b1' }] },
    { id: 'c' },
  ],
};

describe('indexTree', () => {
  const T = indexTree(tree);
  const i = (id: string) => T.index.get(id)!;

  it('indexes in pre-order with parents and depths', () => {
    expect(T.ids).toEqual(['r', 'a', 'a0', 'a1', 'a10', 'a11', 'b', 'b0', 'b1', 'c']);
    expect(T.parent[i('r')]).toBe(-1);
    expect(T.parent[i('a10')]).toBe(i('a1'));
    expect(T.depth[i('a10')]).toBe(3);
    expect(T.children[i('a')]).toEqual([i('a0'), i('a1')]);
  });

  it('hops counts tree edges through the lowest common ancestor', () => {
    expect(T.hops(i('a10'), i('a10'))).toBe(0);
    expect(T.hops(i('a10'), i('a11'))).toBe(2);
    expect(T.hops(i('a10'), i('a0'))).toBe(3);
    expect(T.hops(i('a10'), i('b0'))).toBe(5);
    expect(T.hops(i('r'), i('c'))).toBe(1);
    expect(T.hops(i('b0'), i('b'))).toBe(1);
  });

  it('within(i, 2) is the set of nodes at most two edges away', () => {
    const w = T.within(i('a1'), 2);
    expect([...w].map((k) => T.ids[k]).sort()).toEqual(['a', 'a0', 'a10', 'a11', 'r'].sort());
    expect(T.within(i('c'), 1).size).toBe(1);
    expect(T.within(i('r'), 0).size).toBe(0);
  });
});

describe('kNearest and neighbourPrecision', () => {
  it('returns the k nearest by the supplied distance, excluding the node itself', () => {
    const xs = [0, 1, 2, 10, 11, 12];
    const d = (a: number, b: number) => Math.abs(xs[a] - xs[b]);
    expect(kNearest(0, xs.length, 2, d)).toEqual([1, 2]);
    expect(kNearest(3, xs.length, 3, d)).toEqual([4, 5, 2]);
    expect(kNearest(0, xs.length, 10, d)).toHaveLength(5);
  });
  it('precision is the fraction of neighbours that are relatives', () => {
    expect(neighbourPrecision([1, 2, 3, 4], new Set([1, 4]))).toBe(0.5);
    expect(neighbourPrecision([1, 2], new Set([9]))).toBe(0);
    expect(neighbourPrecision([], new Set([1]))).toBe(0);
  });
});

describe('distortion', () => {
  it('is 0 when every embedded distance is exactly tau per tree edge', () => {
    const chain: TreeNode = { id: 'd0', children: [{ id: 'd1', children: [{ id: 'd2', children: [{ id: 'd3' }] }] }] };
    const T = indexTree(chain);
    const ball = new PoincareBall(1);
    const L = sarkarLayout(chain, { tau: 0.8, ball });
    const pos = T.ids.map((id) => L.get(id)!.pos);
    const pairs: Array<[number, number]> = [[0, 1], [0, 3], [1, 3], [2, 0]];
    const d = distortion(pairs, (a, b) => ball.distance(pos[a], pos[b]), T.hops, 0.8);
    expect(d).toBeLessThan(1e-6);
  });
  it('matches a hand computation and skips zero-distance pairs', () => {
    const dEmb = (a: number, b: number) => (a === b ? 0 : 3);
    const dTree = (a: number, b: number) => (a === b ? 0 : 2);
    // |3 / (1 · 2) − 1| = 0.5 for every off-diagonal pair
    expect(distortion([[0, 1], [1, 2], [2, 2]], dEmb, dTree, 1)).toBeCloseTo(0.5, 12);
    expect(() => distortion([[0, 1]], dEmb, dTree, 0)).toThrow(RangeError);
  });
  it('a crowded flat layout distorts more than the Sarkar layout of the same tree (tau in Sarkar\'s regime)', () => {
    // Full ternary tree of depth 4: radial layout (radius = depth × tau, angles by subtree) vs Sarkar.
    // Sarkar's low-distortion guarantee needs tau large relative to the degree; tau = 2 is enough here.
    const build = (d: number, id: string): TreeNode => (d === 0 ? { id } : { id, children: [0, 1, 2].map((k) => build(d - 1, `${id}.${k}`)) });
    const t = build(4, 'n');
    const T = indexTree(t);
    const n = T.ids.length;
    const tau = 2.0;
    // Euclidean radial: leaves evenly spaced by angle, internal nodes at the mean angle of their leaves.
    const angle = new Array<number>(n).fill(0);
    let leaf = 0;
    const leaves = T.ids.filter((_, i) => T.children[i].length === 0).length;
    const assign = (i: number): number => {
      if (T.children[i].length === 0) {
        angle[i] = (2 * Math.PI * leaf++) / leaves;
        return angle[i];
      }
      const a = T.children[i].map(assign);
      angle[i] = a.reduce((s, x) => s + x, 0) / a.length;
      return angle[i];
    };
    assign(0);
    const eu = T.ids.map((_, i) => [T.depth[i] * tau * Math.cos(angle[i]), T.depth[i] * tau * Math.sin(angle[i])]);
    const ball = new PoincareBall(1);
    const L = sarkarLayout(t, { tau, ball });
    const hy = T.ids.map((id) => L.get(id)!.pos);
    const pairs = randomPairs(n, 400, 3);
    const dE = distortion(pairs, (a, b) => Math.hypot(eu[a][0] - eu[b][0], eu[a][1] - eu[b][1]), T.hops, tau);
    const dH = distortion(pairs, (a, b) => ball.distance(hy[a], hy[b]), T.hops, tau);
    expect(dH).toBeLessThan(dE);
  });
});

describe('randomPairs', () => {
  it('is reproducible, has distinct indices and the requested count', () => {
    const a = randomPairs(50, 100, 11);
    const b = randomPairs(50, 100, 11);
    expect(a).toEqual(b);
    expect(a).toHaveLength(100);
    for (const [x, y] of a) {
      expect(x).not.toBe(y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(50);
    }
    expect(randomPairs(50, 10, 12)).not.toEqual(a.slice(0, 10));
    expect(randomPairs(1, 10)).toEqual([]);
  });
});
