import { flattenTree, type TreeNode } from './sarkar.js';

/**
 * Tree-structure helpers and the two layout metrics the explainer's comparison chapter
 * shows live: neighbour precision and distortion. Everything here is layout-agnostic;
 * the caller supplies the embedded distance.
 */

export interface TreeIndex {
  /** Node ids in pre-order. */
  ids: string[];
  index: Map<string, number>;
  /** Parent index per node, −1 for the root. */
  parent: number[];
  depth: number[];
  children: number[][];
  /** Number of tree edges between two nodes. */
  hops(a: number, b: number): number;
  /** Indices of every node within `radius` edges of `i` (excluding `i`). */
  within(i: number, radius: number): Set<number>;
}

/** Pre-order index of a tree with parent/depth arrays and a hop-distance function. */
export function indexTree(tree: TreeNode): TreeIndex {
  const nodes = flattenTree(tree);
  const ids = nodes.map((n) => n.id);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const parent = new Array<number>(ids.length).fill(-1);
  const depth = new Array<number>(ids.length).fill(0);
  const children: number[][] = ids.map(() => []);
  for (const n of nodes) {
    const i = index.get(n.id)!;
    for (const ch of n.children ?? []) {
      const j = index.get(ch.id)!;
      parent[j] = i;
      depth[j] = depth[i] + 1;
      children[i].push(j);
    }
  }
  const hops = (a: number, b: number): number => {
    let x = a, y = b, d = 0;
    while (depth[x] > depth[y]) {
      x = parent[x];
      d++;
    }
    while (depth[y] > depth[x]) {
      y = parent[y];
      d++;
    }
    while (x !== y) {
      x = parent[x];
      y = parent[y];
      d += 2;
    }
    return d;
  };
  const within = (i: number, radius: number): Set<number> => {
    const out = new Set<number>();
    const frontier: Array<[number, number]> = [[i, 0]];
    const seen = new Set<number>([i]);
    while (frontier.length) {
      const [n, d] = frontier.shift()!;
      if (d === radius) continue;
      const adj = parent[n] >= 0 ? [parent[n], ...children[n]] : children[n];
      for (const m of adj) {
        if (seen.has(m)) continue;
        seen.add(m);
        out.add(m);
        frontier.push([m, d + 1]);
      }
    }
    return out;
  };
  return { ids, index, parent, depth, children, hops, within };
}

/** Indices of the `k` nearest nodes to `i` (excluding `i`) under `dist`, nearest first. */
export function kNearest(i: number, n: number, k: number, dist: (a: number, b: number) => number): number[] {
  const cand: Array<[number, number]> = [];
  for (let j = 0; j < n; j++) if (j !== i) cand.push([dist(i, j), j]);
  cand.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return cand.slice(0, k).map((c) => c[1]);
}

/** Fraction of `neighbours` that belong to `relatives` (0 for an empty list). */
export function neighbourPrecision(neighbours: number[], relatives: Set<number>): number {
  if (neighbours.length === 0) return 0;
  let hit = 0;
  for (const j of neighbours) if (relatives.has(j)) hit++;
  return hit / neighbours.length;
}

/**
 * Mean |d_embedded(a, b) / (τ · d_tree(a, b)) − 1| over `pairs`; pairs at tree distance 0
 * are skipped. 0 means every sampled pair sits at exactly τ per tree edge.
 */
export function distortion(
  pairs: Array<[number, number]>,
  dEmbedded: (a: number, b: number) => number,
  dTree: (a: number, b: number) => number,
  tau: number,
): number {
  if (!(tau > 0)) throw new RangeError('tau must be positive');
  let sum = 0, count = 0;
  for (const [a, b] of pairs) {
    const t = dTree(a, b);
    if (t <= 0) continue;
    sum += Math.abs(dEmbedded(a, b) / (tau * t) - 1);
    count++;
  }
  return count ? sum / count : 0;
}

/** Deterministic PRNG (mulberry32) so sampled pairs are reproducible. */
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` random distinct-index pairs over `n` items, reproducible for a given seed. */
export function randomPairs(n: number, count: number, seed = 1): Array<[number, number]> {
  if (n < 2) return [];
  const rand = mulberry32(seed);
  const out: Array<[number, number]> = [];
  while (out.length < count) {
    const a = Math.floor(rand() * n);
    let b = Math.floor(rand() * n);
    if (a === b) b = (b + 1) % n;
    out.push([a, b]);
  }
  return out;
}
