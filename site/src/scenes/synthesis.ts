import { gsap } from 'gsap';
import type { Vec2 } from 'poincare-ball';
import { C, label, rgba, glow, drawDot, roundRect, ramp, type Viewport } from '../lib/draw';
import { canAnimate } from '../lib/motion';
import { LiveFormula } from '../lib/formula';
import { candidates, OBJECTIVES, EPS, type Objective } from '../lib/tree';
import type { Scene, SceneManager, World } from './manager';

interface Point {
  id: string;
  x: number;
  y: number;
  /** displayed (tweened) */
  dx: number;
  dy: number;
  J: number;
  feasible: boolean;
  violated: Objective[];
}

/**
 * Chapter 08: response synthesis. Candidates are scored by the weighted objective of
 * eq. 7 subject to floors ε_j; plotted as cost score against weighted quality, the
 * undominated feasible ones form the Pareto front and the chosen R* (largest J) tweens
 * along it when the weights change.
 */
export class SynthesisScene implements Scene {
  readonly id = 'synthesis';
  readonly layout = 'mini';
  readonly diskAlpha = 0;
  presence = 0;

  private s = { dots: 0, front: 0, marker: 0, eps: 0 };
  private w: Record<Objective, number> = { coverage: 0.3, density: 0.2, agreement: 0.2, recency: 0.15, cost: 0.15 };
  private pts: Point[];
  private front: Point[] = [];
  private chosen: Point | null = null;
  /** Marker position along the front, interpolated between front vertices. */
  private marker = { u: 0, x: 0, y: 0 };
  private live = new LiveFormula(document.getElementById('eq-j-live'), ['J', 'wc']);

  constructor(private mgr: SceneManager) {
    this.pts = candidates.map((c) => ({ id: c.id, x: 0, y: 0, dx: 0, dy: 0, J: 0, feasible: true, violated: [] }));
    for (const o of OBJECTIVES) {
      const input = document.getElementById(`w-${o}`) as HTMLInputElement | null;
      const out = document.getElementById(`o-${o}`);
      if (!input) continue;
      this.w[o] = Number(input.value);
      input.addEventListener('input', () => {
        this.w[o] = Number(input.value);
        if (out) out.textContent = this.w[o].toFixed(2);
        this.recompute(false);
      });
    }
    this.recompute(true);
  }

  private recompute(instant: boolean): void {
    const w = this.w;
    const wq = w.coverage + w.density + w.agreement + w.recency;
    candidates.forEach((c, i) => {
      const p = this.pts[i];
      p.x = c.f.cost;
      p.y = wq > 0 ? (w.coverage * c.f.coverage + w.density * c.f.density + w.agreement * c.f.agreement + w.recency * c.f.recency) / wq : 0;
      p.J = OBJECTIVES.reduce((s, o) => s + w[o] * c.f[o], 0);
      p.violated = OBJECTIVES.filter((o) => EPS[o] !== undefined && c.f[o] < EPS[o]!);
      p.feasible = p.violated.length === 0;
    });
    // Pareto front among feasible candidates (maximise both x and y)
    const feas = this.pts.filter((p) => p.feasible).sort((a, b) => a.x - b.x);
    const front: Point[] = [];
    let best = -Infinity;
    for (let i = feas.length - 1; i >= 0; i--) {
      if (feas[i].y > best) {
        front.unshift(feas[i]);
        best = feas[i].y;
      }
    }
    this.front = front;
    const chosen = feas.reduce<Point | null>((b, p) => (b === null || p.J > b.J ? p : b), null);
    const prev = this.chosen;
    this.chosen = chosen;
    if (chosen) {
      this.live.set('J', chosen.J, instant);
      this.live.text('wc', chosen.id);
    }
    const render = () => this.mgr.requestRender();
    const targetU = chosen ? front.indexOf(chosen) : 0;
    if (instant || !canAnimate()) {
      for (const p of this.pts) {
        p.dx = p.x;
        p.dy = p.y;
      }
      this.marker.u = targetU;
      render();
      return;
    }
    for (const p of this.pts) gsap.to(p, { dx: p.x, dy: p.y, duration: 0.5, ease: 'power2.out', overwrite: 'auto', onUpdate: render });
    if (prev !== chosen) gsap.to(this.marker, { u: targetU, duration: 0.7, ease: 'power2.inOut', overwrite: 'auto', onUpdate: render });
    else this.marker.u = targetU;
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    // Dots by 0.65, the front by 0.9 and R* by 1 (step 1 reads about the marker), ε floors by 2.
    tl.to(this.s, { dots: 1, duration: 0.6, ease: 'power2.out', onUpdate: render }, 0.05);
    tl.to(this.s, { front: 1, duration: 0.4, ease: 'power2.inOut', onUpdate: render }, 0.5);
    tl.to(this.s, { marker: 1, duration: 0.3, ease: 'power2.out', onUpdate: render }, 0.7);
    tl.to(this.s, { eps: 1, duration: 0.5, ease: 'power2.out', onUpdate: render }, 1.5);
  }

  private geom(vp: Viewport) {
    const st = vp.stage;
    const padL = vp.narrow ? 54 : 110, padR = vp.narrow ? 16 : 50, padT = vp.narrow ? 24 : 70, padB = vp.narrow ? 44 : 110;
    const x0 = st.x + padL, x1 = st.x + st.w - padR;
    const y0 = st.y + padT, y1 = st.y + st.h - padB;
    return { x0, x1, y0, y1, X: (v: number) => x0 + v * (x1 - x0), Y: (v: number) => y1 - v * (y1 - y0) };
  }

  private markerPos(g: ReturnType<SynthesisScene['geom']>): Vec2 {
    const f = this.front;
    if (!f.length) return [g.X(0), g.Y(0)];
    const u = Math.max(0, Math.min(f.length - 1, this.marker.u));
    const i = Math.floor(u);
    const j = Math.min(f.length - 1, i + 1);
    const t = u - i;
    const x = f[i].dx + (f[j].dx - f[i].dx) * t;
    const y = f[i].dy + (f[j].dy - f[i].dy) * t;
    return [g.X(x), g.Y(y)];
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, _world: World): void {
    const a = this.presence;
    const { s } = this;
    const g = this.geom(vp);
    ctx.save();
    ctx.globalAlpha = a;

    // axes
    ctx.strokeStyle = rgba(C.line, 1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.x0, g.y0);
    ctx.lineTo(g.x0, g.y1);
    ctx.lineTo(g.x1, g.y1);
    ctx.stroke();
    for (const v of [0, 0.5, 1]) {
      label(ctx, v.toFixed(1), g.X(v), g.y1 + 12, { align: 'center', color: C.mist, size: 10, font: 'mono' });
      label(ctx, v.toFixed(1), g.x0 - 8, g.Y(v), { align: 'right', color: C.mist, size: 10, font: 'mono' });
    }
    label(ctx, 'cost score f_cost (right is cheaper)', (g.x0 + g.x1) / 2, g.y1 + 28, { align: 'center', color: C.mist, size: 11, font: 'mono' });
    // The rotated axis title sits clear of the tick labels (which end 8 px left of the axis).
    ctx.save();
    ctx.translate(g.x0 - (vp.narrow ? 42 : 46), (g.y0 + g.y1) / 2);
    ctx.rotate(-Math.PI / 2);
    label(ctx, 'weighted quality', 0, 0, { align: 'center', color: C.mist, size: 11, font: 'mono' });
    ctx.restore();

    // ε lines
    if (s.eps > 0) {
      ctx.save();
      ctx.globalAlpha *= s.eps;
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = rgba(C.amber, 0.8);
      const xe = g.X(EPS.cost!);
      ctx.beginPath();
      ctx.moveTo(xe, g.y0);
      ctx.lineTo(xe, g.y1);
      ctx.stroke();
      label(ctx, `ε cost = ${EPS.cost}`, xe + 6, g.y0 + 10, { color: C.amber, size: 10.5, font: 'mono' });
      ctx.setLineDash([]);
      label(ctx, `ε coverage = ${EPS.coverage} · hollow dots violate a floor`, g.x1, g.y0 - 10, { align: 'right', color: C.amber, size: 10.5, font: 'mono' });
      ctx.restore();
    }

    // front
    if (s.front > 0 && this.front.length > 1) {
      ctx.save();
      ctx.globalAlpha *= s.front;
      ctx.strokeStyle = rgba(C.teal, 0.7);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const n = this.front.length;
      const total = Math.ceil((n - 1) * s.front * 1.0001);
      for (let i = 0; i < n; i++) {
        const p = this.front[i];
        if (i === 0) ctx.moveTo(g.X(p.dx), g.Y(p.dy));
        else if (i <= total) ctx.lineTo(g.X(p.dx), g.Y(p.dy));
      }
      ctx.stroke();
      ctx.restore();
    }

    // candidates
    this.pts.forEach((p, i) => {
      const show = ramp(s.dots, i * 0.08, 0.5 + i * 0.08);
      if (show <= 0) return;
      const x = g.X(p.dx), y = g.Y(p.dy);
      const hollow = !p.feasible && s.eps > 0.5;
      ctx.save();
      ctx.globalAlpha *= show;
      if (p === this.chosen) glow(ctx, x, y, 24, C.brass, 0.45 * s.marker);
      if (hollow) drawDot(ctx, x, y, 6, rgba(C.ink, 0.9), C.amber, 1.5);
      else drawDot(ctx, x, y, 6, p.feasible ? C.teal : rgba(C.teal, 0.5), rgba(C.ink, 0.8));
      label(ctx, p.id, x + 9, y - 9, { color: hollow ? C.amber : C.fog, size: 11, font: 'mono' });
      label(ctx, `J ${p.J.toFixed(2)}`, x + 9, y + 4, { color: C.mist, size: 9.5, font: 'mono', alpha: 0.8 });
      if (hollow) label(ctx, p.violated.map((o) => `${o} < ε`).join(', '), x + 9, y + 16, { color: C.amber, size: 9.5, font: 'mono' });
      ctx.restore();
    });

    // the chosen marker, sliding along the front
    if (s.marker > 0 && this.chosen) {
      const [mx, my] = this.markerPos(g);
      ctx.save();
      ctx.globalAlpha *= s.marker;
      ctx.strokeStyle = C.brass;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 11, 0, Math.PI * 2);
      ctx.stroke();
      roundRect(ctx, mx - 30, my - 34, 60, 18, 4);
      ctx.fillStyle = rgba(C.panel, 0.95);
      ctx.fill();
      label(ctx, `R* = ${this.chosen.id}`, mx, my - 25, { align: 'center', color: C.brass, size: 11, font: 'mono', weight: '500' });
      ctx.restore();
    }

    ctx.restore();
  }
}
