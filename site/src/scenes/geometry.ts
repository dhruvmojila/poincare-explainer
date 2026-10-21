import type { gsap } from 'gsap';
import type { Vec2 } from 'poincare-ball';
import { C, ball, toPx, fromPx, clampNorm, drawHyperbolicCircle, drawGeodesic, drawDot, label, rgba, glow, ORIGIN, type Viewport } from '../lib/draw';
import { Ticker } from '../lib/ticker';
import { LiveFormula } from '../lib/formula';
import { setFig } from '../lib/fig';
import type { PointerInfo, Scene, SceneManager, World } from './manager';

const HIT_PX = 18;
const MAX_NORM = 0.975;
const P_ANGLE = -0.7;

/**
 * Chapter 03: two draggable points with their geodesic, the paper's metric (eq. 2) and
 * distance (eq. 3) with live-substituted numbers, and a point sliding outward to show
 * "distance from the centre = depth".
 */
export class GeometryScene implements Scene {
  readonly id = 'geometry';
  readonly layout = 'main';
  readonly touchNone = true;
  readonly diskAlpha = 1;
  presence = 0;

  private A: Vec2 = [0.45, 0.18];
  private B: Vec2 = [-0.34, 0.5];
  private pNorm = 0.5;
  private drag: 'A' | 'B' | null = null;
  private hover: 'A' | 'B' | null = null;
  private state = { chord: 0, depth: 0 };

  private live = new LiveFormula(document.getElementById('eq-live'), ['dxy', 'ox', 'oy', 'd']);
  private metric = new LiveFormula(document.getElementById('eq-metric-live'), ['nx', 'lam']);
  private tDist = new Ticker(document.getElementById('live-dist'));
  private tChord = new Ticker(document.getElementById('live-chord'));
  private tDepthDist = new Ticker(document.getElementById('depth-dist'), (v) => v.toFixed(2));
  private tDepthLevel = new Ticker(document.getElementById('depth-level'), (v) => v.toFixed(2));
  private elNorm = document.getElementById('depth-norm');

  constructor(private mgr: SceneManager) {
    const slider = document.getElementById('depth-slider') as HTMLInputElement | null;
    if (slider) {
      this.pNorm = Number(slider.value);
      slider.addEventListener('input', () => {
        this.pNorm = Number(slider.value);
        this.update(true);
      });
    }
    this.update(true);
  }

  private get P(): Vec2 {
    return [this.pNorm * Math.cos(P_ANGLE), this.pNorm * Math.sin(P_ANGLE)];
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    tl.to(this.state, { chord: 1, duration: 0.5, ease: 'power1.out', onUpdate: render }, 0.3);
    tl.to(this.state, { depth: 1, duration: 0.5, ease: 'power1.out', onUpdate: render }, 1.3);
  }

  private update(immediate: boolean): void {
    const { A, B } = this;
    const dxy = (A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2;
    const nx = A[0] ** 2 + A[1] ** 2;
    const ox = 1 - nx;
    const oy = 1 - (B[0] ** 2 + B[1] ** 2);
    const d = ball.distanceArcosh(A, B);
    this.live.set('dxy', dxy, immediate);
    this.live.set('ox', ox, immediate);
    this.live.set('oy', oy, immediate);
    this.live.set('d', d, immediate);
    this.metric.set('nx', nx, immediate);
    this.metric.set('lam', (2 / ox) ** 2, immediate);
    this.tDist.set(d, immediate);
    this.tChord.set(Math.sqrt(dxy), immediate);
    setFig('geo-d', d.toFixed(3));
    const d0 = ball.distanceToOrigin(this.P);
    if (this.elNorm) this.elNorm.textContent = this.pNorm.toFixed(3);
    this.tDepthDist.set(d0, immediate);
    this.tDepthLevel.set(d0, immediate);
    this.mgr.requestRender();
  }

  private hit(px: number, py: number): 'A' | 'B' | null {
    const vp = this.mgr.vp;
    const a = toPx(vp, this.A);
    const b = toPx(vp, this.B);
    const da = Math.hypot(a[0] - px, a[1] - py);
    const db = Math.hypot(b[0] - px, b[1] - py);
    if (Math.min(da, db) > HIT_PX) return null;
    return da <= db ? 'A' : 'B';
  }

  onPointerDown(e: PointerInfo): boolean {
    this.drag = this.hit(e.px, e.py);
    if (this.drag) this.mgr.setCursor('grabbing');
    return this.drag !== null;
  }

  onPointerMove(e: PointerInfo, dragging: boolean): void {
    if (dragging && this.drag) {
      const p = clampNorm(fromPx(this.mgr.vp, e.px, e.py), MAX_NORM);
      if (this.drag === 'A') this.A = p;
      else this.B = p;
      this.update(true);
      return;
    }
    const h = this.hit(e.px, e.py);
    if (h !== this.hover) {
      this.hover = h;
      this.mgr.setCursor(h ? 'grab' : 'default');
      this.mgr.requestRender();
    }
  }

  onPointerUp(): void {
    this.drag = null;
    this.mgr.setCursor(this.hover ? 'grab' : 'default');
  }

  onPointerLeave(): void {
    if (this.hover) {
      this.hover = null;
      this.mgr.requestRender();
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, _world: World): void {
    const { chord, depth } = this.state;
    ctx.save();
    ctx.globalAlpha = this.presence;

    if (depth > 0) {
      ctx.save();
      ctx.globalAlpha *= depth;
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.mist, 0.4);
      for (let r = 1; r <= 5; r++) {
        drawHyperbolicCircle(ctx, vp, r);
        label(ctx, `${r}`, vp.cx - 5, vp.cy - Math.tanh(r / 2) * vp.R - 8, { align: 'right', color: C.mist, size: 10, font: 'mono' });
      }
      ctx.restore();
    }

    if (chord > 0) {
      const a = toPx(vp, this.A);
      const b = toPx(vp, this.B);
      ctx.save();
      ctx.globalAlpha *= chord;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.mist, 0.7);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.restore();
    }

    ctx.lineWidth = 2.2;
    ctx.strokeStyle = rgba(C.fog, 0.95);
    drawGeodesic(ctx, vp, this.A, this.B);

    if (depth > 0) {
      ctx.save();
      ctx.globalAlpha *= depth;
      const P = this.P;
      const o = toPx(vp, ORIGIN);
      const q = toPx(vp, P);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = rgba(C.fog, 0.8);
      ctx.beginPath();
      ctx.moveTo(o[0], o[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
      drawDot(ctx, o[0], o[1], 3.5, C.fog);
      glow(ctx, q[0], q[1], 18, C.fog, 0.3);
      drawDot(ctx, q[0], q[1], 6.5, C.fog, rgba(C.ink, 0.8));
      label(ctx, `p · d(0,p) = ${ball.distanceToOrigin(P).toFixed(2)}`, q[0] + 12, q[1] + 2, { color: C.fog, size: 12, weight: '600', font: 'mono' });
      label(ctx, '0', o[0] - 8, o[1] - 10, { color: C.mist, size: 11, font: 'mono' });
      ctx.restore();
    }

    const a = toPx(vp, this.A);
    const b = toPx(vp, this.B);
    const haloA = this.hover === 'A' || this.drag === 'A';
    const haloB = this.hover === 'B' || this.drag === 'B';
    glow(ctx, a[0], a[1], 26, C.brass, haloA ? 0.5 : 0.22);
    glow(ctx, b[0], b[1], 26, C.teal, haloB ? 0.5 : 0.22);
    drawDot(ctx, a[0], a[1], 8, C.brass, rgba(C.ink, 0.85));
    drawDot(ctx, b[0], b[1], 8, C.teal, rgba(C.ink, 0.85));
    label(ctx, 'x', a[0] + 12, a[1] - 11, { color: C.brass, size: 16, weight: '500', font: 'display', italic: true });
    label(ctx, 'y', b[0] + 12, b[1] - 11, { color: C.teal, size: 16, weight: '500', font: 'display', italic: true });

    ctx.restore();
  }
}
