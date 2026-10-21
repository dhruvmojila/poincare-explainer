import { gsap } from 'gsap';
import type { Vec2 } from 'poincare-ball';
import { Camera, lerpCamera } from '../lib/camera';
import { C, ball, toPx, clampNorm, normSq2, drawHyperbolicCircle, drawGeodesic, drawDot, label, depthColor, rgba, glow, ORIGIN, type Viewport } from '../lib/draw';
import { canAnimate } from '../lib/motion';
import { setFig } from '../lib/fig';
import { anatomy, anatomyLayout, countNodes, TAU3 } from '../lib/tree';
import type { PointerInfo, Scene, SceneManager, World } from './manager';

const DEMO_ID = 'musculoskeletal';
const HIT_PX = 16;
const DRAG_MAX = 0.985;

interface HNode {
  id: string;
  depth: number;
  parent: number;
  children: number[];
  /** Sarkar position (world coordinates). */
  base: Vec2;
  /** 0 = not placed yet, 1 = fully placed; in between, the edge grows along the geodesic. */
  grow: number;
  /** Label opacity (fades in on hover). */
  la: number;
}

/**
 * Chapter 04: Sarkar's construction scrubbed by scroll on a small anatomy hierarchy,
 * including the "translate v to the origin, place its children, translate back" step,
 * done with the world camera; hover highlights ancestors and descendants; dragging the
 * disk translates the camera.
 */
export class HierarchyScene implements Scene {
  readonly id = 'hierarchy';
  readonly layout = 'main';
  readonly touchNone = true;
  readonly diskAlpha = 1;
  presence = 0;
  readonly nodeCount: number;

  private nodes: HNode[] = [];
  private byDepth: number[][] = [];
  private maxDepth = 0;
  private demo = -1;
  private step = -1;
  private hovered = -1;
  private ancestors = new Set<number>();
  private descendants = new Set<number>();
  private shift = { t: 0 };
  private ring = { a: 0 };
  private freeView = false;
  private dragLast: Vec2 | null = null;
  private resetTween: gsap.core.Tween | null = null;
  private readout = document.getElementById('hover-readout');

  constructor(private mgr: SceneManager) {
    this.nodeCount = countNodes(anatomy);
    const layout = anatomyLayout();
    const index = new Map<string, number>();
    for (const [id] of layout) index.set(id, index.size);
    for (const [id, ln] of layout) {
      const node: HNode = {
        id,
        depth: ln.depth,
        parent: ln.parentId ? index.get(ln.parentId)! : -1,
        children: ln.childIds.map((c) => index.get(c)!),
        base: [ln.pos[0], ln.pos[1]],
        grow: ln.depth === 0 ? 1 : 0,
        la: 0,
      };
      this.nodes.push(node);
      (this.byDepth[ln.depth] ??= []).push(this.nodes.length - 1);
      this.maxDepth = Math.max(this.maxDepth, ln.depth);
    }
    this.demo = index.get(DEMO_ID) ?? -1;
    for (const n of this.nodes) if (n.depth <= 1) n.la = 1;
    document.getElementById('reset-view')?.addEventListener('click', () => this.resetView());
  }

  // ---------- scroll timeline ----------

  private applyShift(): void {
    const t = this.shift.t;
    if (this.demo < 0) return;
    if (t <= 0) {
      if (!this.freeView) this.mgr.world.cam = Camera.identity();
      return;
    }
    const g = ball.geodesic(ORIGIN, this.nodes[this.demo].base, t);
    this.mgr.world.cam = Camera.toOrigin([g[0], g[1]]);
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    const grow = (i: number, at: number, dur: number) => tl.to(this.nodes[i], { grow: 1, duration: dur, ease: 'power2.out', onUpdate: render }, at);
    // step 0 → 1: the ring at τ and the root's children
    tl.to(this.ring, { a: 1, duration: 0.3, onUpdate: render }, 0.1);
    this.byDepth[1].forEach((i, k) => grow(i, 0.25 + k * 0.1, 0.35));
    // step 1 → 2: translate the demo node to the origin, place its children, translate back
    tl.to(this.ring, { a: 0, duration: 0.25, onUpdate: render }, 1.05);
    tl.to(this.shift, { t: 1, duration: 0.35, ease: 'power2.inOut', onUpdate: () => (this.applyShift(), render()) }, 1.1);
    this.nodes[this.demo].children.forEach((i, k) => grow(i, 1.47 + k * 0.06, 0.2));
    tl.to(this.shift, { t: 0, duration: 0.35, ease: 'power2.inOut', onUpdate: () => (this.applyShift(), render()) }, 1.65);
    // step 2 → 3: the rest, level by level
    const rest2 = this.byDepth[2].filter((i) => this.nodes[i].parent !== this.demo);
    rest2.forEach((i, k) => grow(i, 2.05 + k * 0.03, 0.25));
    // Every level is fully placed by time 3 (the reading position of step 3).
    let at = 2.3;
    for (let d = 3; d <= this.maxDepth; d++) {
      (this.byDepth[d] ?? []).forEach((i, k) => grow(i, at + k * 0.008, 0.2));
      at += 0.25;
    }
  }

  setStep(k: number): void {
    this.step = k;
    if (k < 3) this.setHover(-1);
    this.mgr.setCursor(k >= 3 ? 'grab' : 'default');
  }

  // ---------- hover / highlight ----------

  private setHover(i: number): void {
    if (i === this.hovered) return;
    this.hovered = i;
    this.ancestors.clear();
    this.descendants.clear();
    if (i >= 0) {
      let p = this.nodes[i].parent;
      while (p >= 0) {
        this.ancestors.add(p);
        p = this.nodes[p].parent;
      }
      const stack = [...this.nodes[i].children];
      while (stack.length) {
        const c = stack.pop()!;
        this.descendants.add(c);
        stack.push(...this.nodes[c].children);
      }
      const n = this.nodes[i];
      if (this.readout) {
        this.readout.textContent = `${n.id} · depth ${n.depth} · d(0, ·) = ${ball.distanceToOrigin(n.base).toFixed(2)} · ${this.ancestors.size} ancestors, ${this.descendants.size} descendants`;
      }
    } else if (this.readout) {
      this.readout.textContent = '—';
    }
    // Labels fade in for the highlighted lineage and out for the rest.
    const render = () => this.mgr.requestRender();
    this.nodes.forEach((n, k) => {
      const want = n.depth <= 1 || k === i || this.ancestors.has(k) || this.descendants.has(k) ? 1 : 0;
      if (canAnimate()) gsap.to(n, { la: want, duration: 0.3, overwrite: true, onUpdate: render });
      else n.la = want;
    });
    render();
  }

  private screen(p: Vec2, vp: Viewport): Vec2 {
    return toPx(vp, this.mgr.world.cam.apply(p));
  }

  private hit(px: number, py: number): number {
    const vp = this.mgr.vp;
    let best = -1;
    let bestD = HIT_PX;
    this.nodes.forEach((n, i) => {
      if (n.grow < 0.99) return;
      const q = this.screen(n.base, vp);
      const d = Math.hypot(q[0] - px, q[1] - py);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  // ---------- pointer ----------

  onPointerDown(e: PointerInfo): boolean {
    if (this.step < 3) return false;
    const h = this.hit(e.px, e.py);
    if (h >= 0) {
      this.setHover(h === this.hovered && e.pointerType === 'touch' ? -1 : h);
      return false;
    }
    this.resetTween?.kill();
    this.dragLast = clampNorm(e.p, DRAG_MAX);
    this.mgr.setCursor('grabbing');
    return true;
  }

  onPointerMove(e: PointerInfo, dragging: boolean): void {
    if (dragging && this.dragLast) {
      const d1 = clampNorm(e.p, DRAG_MAX);
      const d0 = this.dragLast;
      if (d0[0] === d1[0] && d0[1] === d1[1]) return;
      // Hyperbolic translation taking d0 to d1, composed onto the camera: an isometry, so
      // every edge stays a geodesic and every parent–child distance stays τ.
      const L = Camera.fromOrigin(d1).compose(Camera.toOrigin(d0));
      this.mgr.world.cam = L.compose(this.mgr.world.cam);
      this.dragLast = d1;
      this.freeView = true;
      this.mgr.requestRender();
      return;
    }
    if (this.step < 3) return;
    const h = this.hit(e.px, e.py);
    this.mgr.setCursor(h >= 0 ? 'pointer' : 'grab');
    if (e.pointerType !== 'touch') this.setHover(h);
  }

  onPointerUp(): void {
    this.dragLast = null;
    this.mgr.setCursor(this.step >= 3 ? 'grab' : 'default');
  }

  onPointerLeave(): void {
    if (this.hovered >= 0) this.setHover(-1);
  }

  /** Tween the camera home along a geodesic (an exact isometry at every frame). */
  private resetView(): void {
    if (!this.freeView) return;
    const from = this.mgr.world.cam;
    const home = Camera.identity();
    const finish = () => {
      this.mgr.world.cam = home;
      this.freeView = false;
      this.mgr.requestRender();
    };
    if (!canAnimate()) {
      finish();
      return;
    }
    const s = { v: 0 };
    this.resetTween = gsap.to(s, {
      v: 1,
      duration: 1.1,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.mgr.world.cam = lerpCamera(from, home, s.v);
        this.mgr.requestRender();
      },
      onComplete: finish,
    });
  }

  // ---------- drawing ----------

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, world: World): void {
    const cam = world.cam;
    const hl = this.hovered >= 0;
    ctx.save();
    ctx.globalAlpha = this.presence;

    if (this.ring.a > 0) {
      ctx.save();
      ctx.globalAlpha *= this.ring.a;
      ctx.setLineDash([4, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.brass, 0.6);
      drawHyperbolicCircle(ctx, vp, TAU3);
      label(ctx, `d = τ = ${TAU3.toFixed(1)}`, vp.cx + 7, vp.cy - Math.tanh(TAU3 / 2) * vp.R - 10, { color: C.brass, size: 11, font: 'mono' });
      ctx.restore();
    }

    if (this.shift.t > 0) {
      const o = toPx(vp, ORIGIN);
      ctx.save();
      ctx.globalAlpha *= this.shift.t;
      ctx.strokeStyle = rgba(C.brass, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(o[0] - 10, o[1]);
      ctx.lineTo(o[0] + 10, o[1]);
      ctx.moveTo(o[0], o[1] - 10);
      ctx.lineTo(o[0], o[1] + 10);
      ctx.stroke();
      label(ctx, 'v → origin', o[0] + 14, o[1] + 18, { color: C.brass, size: 11, font: 'mono' });
      ctx.restore();
    }

    // Edges (world geodesics through the camera; the camera is an isometry so they stay geodesics)
    const disp: Vec2[] = this.nodes.map((n) => cam.apply(n.base));
    const endpoints: Vec2[] = new Array(this.nodes.length);
    this.nodes.forEach((n, i) => {
      if (n.parent < 0 || n.grow <= 0) return;
      let end = disp[i];
      if (n.grow < 1) {
        const g = ball.geodesic(this.nodes[n.parent].base, n.base, n.grow);
        end = cam.apply([g[0], g[1]]);
      }
      endpoints[i] = end;
      let color = rgba(C.fog, 0.22);
      let width = 1.2;
      if (hl) {
        if (i === this.hovered || this.ancestors.has(i)) {
          color = C.brass;
          width = 2.2;
        } else if (this.descendants.has(i)) {
          color = C.teal;
          width = 1.8;
        } else {
          color = rgba(C.fog, 0.07);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      drawGeodesic(ctx, vp, disp[n.parent], end);
    });

    // Nodes, proximity glow, labels
    const ptr = world.pointer;
    this.nodes.forEach((n, i) => {
      if (n.grow <= 0) return;
      const p = n.parent < 0 ? disp[i] : endpoints[i] ?? disp[i];
      const q = toPx(vp, p);
      const size = (2.2 + 5.5 * (1 - normSq2(p))) * Math.min(1, n.grow * 1.2);
      const fill = depthColor(n.depth, this.maxDepth);
      let stroke: string | undefined;
      let alpha = 1;
      if (hl) {
        if (i === this.hovered || this.ancestors.has(i)) stroke = C.brass;
        else if (this.descendants.has(i)) stroke = C.teal;
        else alpha = 0.3;
      }
      if (ptr.on && this.step >= 3 && !hl) {
        const d = Math.hypot(q[0] - ptr.x, q[1] - ptr.y);
        if (d < 60) glow(ctx, q[0], q[1], 20, fill, 0.4 * (1 - d / 60));
      }
      if (i === this.hovered) glow(ctx, q[0], q[1], 26, C.brass, 0.4);
      ctx.save();
      ctx.globalAlpha *= alpha;
      drawDot(ctx, q[0], q[1], i === this.hovered ? size + 3 : size, fill, stroke);
      ctx.restore();

      const inFocus = 1 - normSq2(p) > 0.55;
      const la = Math.max(n.la, inFocus ? 1 : 0) * (n.grow >= 0.99 ? 1 : 0);
      if (la > 0.01) {
        const dim = hl && !(i === this.hovered || this.ancestors.has(i) || this.descendants.has(i));
        const color = i === this.hovered ? C.brass : dim ? rgba(C.mist, 0.35) : n.depth <= 1 ? C.fog : C.mist;
        const dir = normSq2(p) < 1e-6 ? [0, -1] : [p[0], -p[1]];
        const len = Math.hypot(dir[0], dir[1]) || 1;
        const ux = dir[0] / len;
        const uy = dir[1] / len;
        const off = size + 6;
        const align: CanvasTextAlign = Math.abs(ux) < 0.3 ? 'center' : ux > 0 ? 'left' : 'right';
        label(ctx, n.id, q[0] + ux * off, q[1] + uy * off, {
          align,
          color,
          size: n.depth <= 1 ? 13 : 11.5,
          weight: n.depth <= 1 || i === this.hovered ? '600' : '500',
          alpha: la,
        });
      }
    });

    setFig('hier-view', this.freeView ? 'translated view · every edge still has length τ' : 'drag the empty disk to translate the camera');
    ctx.restore();
  }
}
