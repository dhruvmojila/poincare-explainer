import { PoincareBall } from './ball.js';
import type { Vec2 } from './arc.js';

/** Minimal tree shape accepted by `sarkarLayout`. Ids must be unique. */
export interface TreeNode {
  id: string;
  children?: TreeNode[];
}

export interface SarkarOptions {
  /** Hyperbolic edge length between a node and each of its children. Default 1. */
  tau?: number;
  /** Curvature magnitude of the ball (or pass a `PoincareBall`). Default 1. */
  c?: number;
  ball?: PoincareBall;
  /** Direction (radians) of the root's first child. Default 0. */
  rootAngle?: number;
  /**
   * Total angular span, centred opposite the parent, over which a node's children are
   * evenly spread. 2π (default) reproduces Sarkar's construction, in which the parent
   * and the children occupy evenly spaced angular slots around the node. Smaller values
   * (e.g. π) push children away from the parent, trading angular resolution for clarity.
   */
  fan?: number;
}

export interface LayoutNode {
  id: string;
  /** Position in the Poincaré disk (Euclidean coordinates, ||pos|| < 1/√c). */
  pos: Vec2;
  depth: number;
  parentId: string | null;
  childIds: string[];
}

export type SarkarLayout = Map<string, LayoutNode>;

/**
 * Sarkar's combinatorial construction (R. Sarkar, "Low distortion Delaunay embedding
 * of trees in hyperbolic plane", Graph Drawing 2011) in two dimensions.
 *
 *  1. The root is placed at the origin; its children at hyperbolic distance τ at evenly
 *     spaced angles.
 *  2. For every other node v with parent p: Möbius-translate the plane so v sits at the
 *     origin (z ↦ (−v) ⊕ z), note the direction θ of the translated parent, place the
 *     children at hyperbolic distance τ at evenly spaced angles that avoid θ, then
 *     translate back (z ↦ v ⊕ z). Because both translations are isometries every child
 *     ends up exactly τ from v.
 *
 * With τ large enough relative to the maximum degree the embedding has arbitrarily low
 * distortion. Distance from the origin is exactly τ for the root's children, at most
 * depth × τ in general (equality along single-child chains), and strictly increasing
 * from parent to child, so successive levels occupy successive annuli: this is the
 * property the paper's memory relies on ("distance from the centre encodes depth").
 */
export function sarkarLayout(tree: TreeNode, options: SarkarOptions = {}): SarkarLayout {
  const tau = options.tau ?? 1;
  const ball = options.ball ?? new PoincareBall(options.c ?? 1);
  const rootAngle = options.rootAngle ?? 0;
  const fan = options.fan ?? 2 * Math.PI;
  if (!(tau > 0)) throw new RangeError('tau must be positive');

  const out: SarkarLayout = new Map();
  const seen = new Set<string>();

  const register = (node: TreeNode, pos: Vec2, depth: number, parentId: string | null) => {
    if (seen.has(node.id)) throw new Error(`duplicate node id in tree: ${node.id}`);
    seen.add(node.id);
    out.set(node.id, {
      id: node.id,
      pos,
      depth,
      parentId,
      childIds: (node.children ?? []).map((ch) => ch.id),
    });
  };

  register(tree, [0, 0], 0, null);

  // Root: children spread over the full circle.
  const rootKids = tree.children ?? [];
  const stack: Array<{ node: TreeNode; depth: number }> = [];
  rootKids.forEach((child, k) => {
    const angle = rootAngle + (2 * Math.PI * k) / rootKids.length;
    const p = ball.pointAt([Math.cos(angle), Math.sin(angle)], tau) as Vec2;
    register(child, p, 1, tree.id);
    stack.push({ node: child, depth: 1 });
  });

  while (stack.length) {
    const { node, depth } = stack.pop()!;
    const kids = node.children ?? [];
    if (kids.length === 0) continue;
    const me = out.get(node.id)!;
    const parent = out.get(me.parentId!)!;
    const v = me.pos;
    const negV: Vec2 = [-v[0], -v[1]];

    // Translate so that v is at the origin and find the parent's direction.
    const pPrime = ball.mobiusAdd(negV, parent.pos);
    const thetaParent = Math.atan2(pPrime[1], pPrime[0]);

    const m = kids.length;
    kids.forEach((child, k) => {
      // Children occupy slots 1..m of m+1 evenly spaced slots; slot 0 is the parent.
      const offset = ((k + 1) - (m + 1) / 2) * (fan / (m + 1));
      const angle = thetaParent + Math.PI + offset;
      const local = ball.pointAt([Math.cos(angle), Math.sin(angle)], tau);
      const world = ball.mobiusAdd(v, local) as Vec2; // translate back
      register(child, [world[0], world[1]], depth + 1, node.id);
      stack.push({ node: child, depth: depth + 1 });
    });
  }

  return out;
}

/** Depth-first list of every node id in `tree` (pre-order). */
export function flattenTree(tree: TreeNode): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(tree);
  return out;
}

/**
 * One Sarkar step for a single new node: the point at hyperbolic distance `tau` from `v`,
 * in the direction away from `v`'s parent (translate v to the origin, take the direction
 * opposite the translated parent plus `angleOffset`, place at τ, translate back). With no
 * parent (v is the root) the direction is `angleOffset` itself. Used to attach a new memory
 * one depth step beyond the node it is about.
 */
export function placeBeyond(v: Vec2, parent: Vec2 | null, tau: number, options: { ball?: PoincareBall; angleOffset?: number } = {}): Vec2 {
  if (!(tau > 0)) throw new RangeError('tau must be positive');
  const ball = options.ball ?? new PoincareBall(1);
  const offset = options.angleOffset ?? 0;
  let angle = offset;
  if (parent) {
    const negV: Vec2 = [-v[0], -v[1]];
    const pPrime = ball.mobiusAdd(negV, parent);
    angle = Math.atan2(pPrime[1], pPrime[0]) + Math.PI + offset;
  }
  const local = ball.pointAt([Math.cos(angle), Math.sin(angle)], tau);
  const world = ball.mobiusAdd(v, local);
  return [world[0], world[1]];
}
