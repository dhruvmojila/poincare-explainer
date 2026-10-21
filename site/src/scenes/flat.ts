import type { gsap } from 'gsap';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import { type TreeNode, type Vec2 } from 'poincare-ball';
import { C, ball, toPx, lerp2, normSq2, drawHyperbolicCircle, depthColor, label, rgba, glow, type Viewport } from '../lib/draw';
import { bigTree, bigTreeLayout, countNodes, countLeaves, TAU1 } from '../lib/tree';
import { setFig } from '../lib/fig';
import type { Scene, SceneManager, World } from './manager';

export { TAU1 };
const SAMPLES = 8;

interface Node1 {
  id: string;
  eu: Vec2;
  hy: Vec2;
  depth: number;
}
interface Edge1 {
  eu: Vec2[];
  hy: Vec2[];
}

/**
 * Chapter 01: a radial tidy tree in the Euclidean plane morphs into its Sarkar layout in
 * the Poincaré disk. Edges are polylines whose samples are interpolated between the
 * straight segment and the geodesic, so the morph is smooth and ends exactly on geodesics.
 * The morph is scrubbed by scroll.
 */
export class FlatScene implements Scene {
  readonly id = 'flat';
  readonly layout = 'main';
  presence = 0;
  readonly nodeCount: number;
  readonly leafCount: number;

  private nodes: Node1[] = [];
  private edges: Edge1[] = [];
  private maxDepth = 0;
  private state = { t: 0, rings: 0 };

  constructor(private mgr: SceneManager) {
    const data = bigTree();
    this.nodeCount = countNodes(data);
    this.leafCount = countLeaves(data);

    const root = hierarchy<TreeNode>(data, (d) => d.children);
    d3tree<TreeNode>()
      .size([2 * Math.PI, 0.93])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)(root);

    const layout = bigTreeLayout();

    const index = new Map<string, number>();
    root.each((n) => {
      index.set(n.data.id, this.nodes.length);
      const angle = n.x ?? 0;
      const r = n.y ?? 0;
      this.nodes.push({ id: n.data.id, eu: [r * Math.cos(angle), r * Math.sin(angle)], hy: layout.get(n.data.id)!.pos, depth: n.depth });
      this.maxDepth = Math.max(this.maxDepth, n.depth);
    });
    for (const link of root.links()) {
      const a = this.nodes[index.get(link.source.data.id)!];
      const b = this.nodes[index.get(link.target.data.id)!];
      const eu: Vec2[] = [];
      const hy: Vec2[] = [];
      for (let s = 0; s <= SAMPLES; s++) {
        eu.push(lerp2(a.eu, b.eu, s / SAMPLES));
        const g = ball.geodesic(a.hy, b.hy, s / SAMPLES);
        hy.push([g[0], g[1]]);
      }
      this.edges.push({ eu, hy });
    }
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => {
      setFig('flat-space', this.state.t < 0.5 ? 'Euclidean plane, radial tidy tree' : `Poincaré disk, Sarkar layout, τ = ${TAU1}`);
      this.mgr.requestRender();
    };
    tl.to(this.state, { t: 1, duration: 0.85, ease: 'power2.inOut', onUpdate: render }, 0.15);
    tl.to(this.mgr.world.disk, { alpha: 1, duration: 0.6, ease: 'none', onUpdate: render }, 0.3);
    tl.to(this.state, { rings: 1, duration: 0.5, ease: 'power1.out', onUpdate: render }, 1.3);
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, world: World): void {
    const { t, rings } = this.state;
    const a = this.presence;
    ctx.save();
    ctx.globalAlpha = a;

    if (rings > 0) {
      ctx.save();
      ctx.globalAlpha = a * rings;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.brass, 0.5);
      for (let r = 1; r <= 4; r++) {
        drawHyperbolicCircle(ctx, vp, r);
        const y = vp.cy - Math.tanh(r / 2) * vp.R;
        label(ctx, `r = ${r}`, vp.cx + 7, y - 9, { color: C.brass, size: vp.narrow ? 10 : 11, font: 'mono' });
      }
      ctx.restore();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(C.fog, 0.13 + 0.12 * t);
    ctx.beginPath();
    for (const e of this.edges) {
      for (let s = 0; s <= SAMPLES; s++) {
        const p = toPx(vp, t === 0 ? e.eu[s] : t === 1 ? e.hy[s] : lerp2(e.eu[s], e.hy[s], t));
        if (s === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
    }
    ctx.stroke();

    // Nodes: uniform radius in the plane, metric-scaled radius in the disk; proximity glow.
    const baseEu = vp.narrow ? 2.4 : 3.1;
    const ptr = world.pointer;
    let near = -1;
    let nearD = 70;
    let nearQ: Vec2 = [0, 0];
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const p = t === 0 ? n.eu : t === 1 ? n.hy : lerp2(n.eu, n.hy, t);
      const rH = 1.3 + 4.4 * (1 - normSq2(p));
      const r = baseEu + (rH - baseEu) * t;
      const q = toPx(vp, p);
      const col = depthColor(n.depth, this.maxDepth);
      if (ptr.on) {
        const d = Math.hypot(q[0] - ptr.x, q[1] - ptr.y);
        if (d < 70) {
          glow(ctx, q[0], q[1], 22, col, 0.45 * (1 - d / 70));
          if (d < nearD) {
            nearD = d;
            near = i;
            nearQ = q;
          }
        }
      }
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
    }
    if (near >= 0) {
      const n = this.nodes[near];
      const p = t === 0 ? n.eu : t === 1 ? n.hy : lerp2(n.eu, n.hy, t);
      const txt = t > 0.5 ? `${n.id} · depth ${n.depth} · d(0,·) = ${ball.distanceToOrigin(p).toFixed(2)}` : `${n.id} · depth ${n.depth}`;
      label(ctx, txt, nearQ[0] + 10, nearQ[1] - 12, { color: C.fog, size: 11, font: 'mono', alpha: Math.min(1, (70 - nearD) / 30) });
    }
    ctx.restore();
  }
}
