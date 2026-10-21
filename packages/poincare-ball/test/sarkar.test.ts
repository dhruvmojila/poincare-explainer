import { describe, expect, it } from 'vitest';
import { PoincareBall, flattenTree, placeBeyond, sarkarLayout, type TreeNode } from '../src/index.js';

function makeTree(depth: number, branching: number, prefix = 'n'): TreeNode {
  const build = (d: number, id: string): TreeNode =>
    d === 0 ? { id } : { id, children: Array.from({ length: branching }, (_, k) => build(d - 1, `${id}.${k}`)) };
  return build(depth, prefix);
}

describe('sarkarLayout', () => {
  for (const tau of [0.5, 1, 1.7]) {
    for (const c of [1, 0.25]) {
      it(`places every child at hyperbolic distance tau=${tau} from its parent (c=${c})`, () => {
        const tree = makeTree(4, 3);
        const ball = new PoincareBall(c);
        const layout = sarkarLayout(tree, { tau, ball });
        expect(layout.size).toBe(flattenTree(tree).length);
        for (const node of layout.values()) {
          if (!node.parentId) continue;
          const parent = layout.get(node.parentId)!;
          expect(Math.abs(ball.distance(parent.pos, node.pos) - tau)).toBeLessThan(1e-6);
        }
      });
    }
  }

  it('with tau large relative to the degree, distance from the origin grows with depth (bounded by depth × tau)', () => {
    // Sarkar's guarantee needs tau to grow with the maximum degree; for degree 4 a
    // tau of 3 is comfortably enough for successive levels to occupy disjoint annuli.
    const tree = makeTree(4, 3);
    const ball = new PoincareBall(1);
    const tau = 3;
    const layout = sarkarLayout(tree, { tau, ball });
    for (const node of layout.values()) {
      const d0 = ball.distanceToOrigin(node.pos);
      if (node.depth === 1) expect(d0).toBeCloseTo(tau, 8);
      expect(d0).toBeLessThanOrEqual(node.depth * tau + 1e-9);
      if (node.parentId) {
        const parent = layout.get(node.parentId)!;
        expect(d0).toBeGreaterThan(ball.distanceToOrigin(parent.pos));
      }
    }
  });

  it('a single-child chain is laid out along one geodesic: distance = depth × tau exactly', () => {
    const chain: TreeNode = { id: 'd0', children: [{ id: 'd1', children: [{ id: 'd2', children: [{ id: 'd3' }] }] }] };
    const ball = new PoincareBall(1);
    const tau = 0.9;
    const layout = sarkarLayout(chain, { tau, ball });
    for (const node of layout.values()) {
      expect(ball.distanceToOrigin(node.pos)).toBeCloseTo(node.depth * tau, 7);
    }
  });

  it('places the root at the origin and root children at evenly spaced angles', () => {
    const tree = makeTree(1, 4);
    const layout = sarkarLayout(tree, { tau: 1, rootAngle: 0 });
    expect(layout.get('n')!.pos).toEqual([0, 0]);
    const angles = (tree.children ?? []).map((ch) => {
      const p = layout.get(ch.id)!.pos;
      return Math.atan2(p[1], p[0]);
    });
    expect(angles[0]).toBeCloseTo(0, 10);
    expect(angles[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(Math.abs(angles[2])).toBeCloseTo(Math.PI, 10);
    expect(angles[3]).toBeCloseTo(-Math.PI / 2, 10);
  });

  it('children avoid the direction of the parent (Sarkar slot rule)', () => {
    // Chain root -> a -> {b, c}: as seen from a, root and the two children occupy 3 even slots.
    const tree: TreeNode = { id: 'r', children: [{ id: 'a', children: [{ id: 'b' }, { id: 'c' }] }] };
    const ball = new PoincareBall(1);
    const layout = sarkarLayout(tree, { tau: 1, ball });
    const a = layout.get('a')!.pos;
    const negA = [-a[0], -a[1]];
    const dir = (id: string) => {
      const p = ball.mobiusAdd(negA, layout.get(id)!.pos);
      return Math.atan2(p[1], p[0]);
    };
    const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
    const thetaParent = dir('r');
    const db = wrap(dir('b') - thetaParent);
    const dc = wrap(dir('c') - thetaParent);
    expect(Math.abs(Math.abs(db) - (2 * Math.PI) / 3)).toBeLessThan(1e-9);
    expect(Math.abs(Math.abs(dc) - (2 * Math.PI) / 3)).toBeLessThan(1e-9);
    expect(Math.sign(db)).not.toBe(Math.sign(dc));
  });

  it('rejects duplicate ids', () => {
    const tree: TreeNode = { id: 'r', children: [{ id: 'x' }, { id: 'x' }] };
    expect(() => sarkarLayout(tree)).toThrow(/duplicate/);
  });
});

describe('placeBeyond', () => {
  const ball = new PoincareBall(1);
  it('places the new point at distance tau from v, on the geodesic through the parent, beyond v', () => {
    const tree: TreeNode = { id: 'r', children: [{ id: 'a', children: [{ id: 'b' }] }] };
    const L = sarkarLayout(tree, { tau: 1, ball, rootAngle: 0.3 });
    const a = L.get('a')!.pos;
    const b = L.get('b')!.pos;
    const q = placeBeyond(b, a, 0.7, { ball });
    expect(ball.distance(b, q)).toBeCloseTo(0.7, 8);
    // beyond b, away from a: d(a, q) = d(a, b) + d(b, q)
    expect(ball.distance(a, q)).toBeCloseTo(1 + 0.7, 6);
  });
  it('with an angle offset the point is still tau from v and turns toward the offset', () => {
    const v: [number, number] = [0.3, 0.1];
    const p: [number, number] = [0, 0];
    const q0 = placeBeyond(v, p, 0.5, { ball });
    const q1 = placeBeyond(v, p, 0.5, { ball, angleOffset: 0.8 });
    expect(ball.distance(v, q1)).toBeCloseTo(0.5, 8);
    expect(ball.distance(p, q1)).toBeLessThan(ball.distance(p, q0));
  });
  it('from the root (no parent) the direction is the offset itself', () => {
    const q = placeBeyond([0, 0], null, 1.2, { ball, angleOffset: Math.PI / 2 });
    expect(ball.distanceToOrigin(q)).toBeCloseTo(1.2, 8);
    expect(q[0]).toBeCloseTo(0, 10);
    expect(q[1]).toBeGreaterThan(0);
  });
  it('rejects a non-positive tau', () => {
    expect(() => placeBeyond([0, 0], null, 0)).toThrow(RangeError);
  });
});
