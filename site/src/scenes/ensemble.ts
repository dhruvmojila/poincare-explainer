import type { gsap } from 'gsap';
import type { Vec2 } from 'poincare-ball';
import { C, bez, roundRect, label, rgba, glow, drawDot, mulberry32, ramp, type Viewport } from '../lib/draw';
import { makeTraces, REQUESTS, type ProviderTrace } from '../lib/tree';
import { setFig } from '../lib/fig';
import type { Scene, SceneManager, World } from './manager';

const BASELINE = 8;
const THRESHOLD = 1.6;
const PROBE_AFTER = 7;

interface Req {
  lane: number;
  t: number;
  speed: number;
}

interface Stats {
  mean: number;
  sd: number;
}

/**
 * Chapter 07: the provider-agnostic ensemble. Three provider lanes with traces of
 * latency, response length and information density; provider-b degrades, the detector
 * (standardised against the provider's own baseline) flags it in amber, and request
 * particles fail over to the other two.
 */
export class EnsembleScene implements Scene {
  readonly id = 'ensemble';
  readonly layout = 'mini';
  readonly loop = true;
  readonly diskAlpha = 0;
  presence = 0;

  private traces: ProviderTrace[] = makeTraces();
  private s = { time: 0, profiles: 0 };
  private base: Array<{ lat: Stats; tok: Stats; den: Stats }>;
  /** Combined detector score per request for each provider. */
  private scores: number[][];
  readonly flagAt: number;
  private reqs: Req[] = [];
  private rand = mulberry32(9);
  private acc = 0;
  private rr = 0;
  private readout = document.getElementById('detector-readout');
  private flag = document.getElementById('detector-flag');
  private lastShown = -1;

  constructor(private mgr: SceneManager) {
    const stats = (xs: number[]): Stats => {
      const b = xs.slice(0, BASELINE);
      const mean = b.reduce((x, y) => x + y, 0) / b.length;
      // A floor on the spread keeps a very steady baseline from turning every wobble into a huge z.
      const sd = Math.max(Math.sqrt(b.reduce((x, y) => x + (y - mean) ** 2, 0) / b.length), 0.12 * Math.abs(mean), 1e-9);
      return { mean, sd };
    };
    this.base = this.traces.map((t) => ({ lat: stats(t.latency), tok: stats(t.tokens), den: stats(t.density) }));
    this.scores = this.traces.map((t, p) => t.latency.map((_, i) => this.score(p, i)));
    const b = this.scores[1];
    let flagAt = REQUESTS;
    for (let i = 0; i < REQUESTS; i++) {
      if (b[i] > THRESHOLD) {
        flagAt = i;
        break;
      }
    }
    this.flagAt = flagAt;
  }

  /** z-scores of the three signals against the provider's own baseline, combined. */
  private z(p: number, i: number): [number, number, number] {
    const t = this.traces[p];
    const b = this.base[p];
    return [(t.latency[i] - b.lat.mean) / b.lat.sd, (t.tokens[i] - b.tok.mean) / b.tok.sd, (t.density[i] - b.den.mean) / b.den.sd];
  }
  private score(p: number, i: number): number {
    const [zl, zt, zd] = this.z(p, i);
    // latency up, length down, density down all count as evidence; averaged over the last 3 requests
    const s = (Math.max(0, zl) + Math.max(0, -zt) + Math.max(0, -zd)) / 3;
    if (i === 0) return s;
    const prev = this.scores?.[p]?.[i - 1] ?? 0;
    return 0.6 * s + 0.4 * prev;
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    const onUpdate = () => {
      this.updateReadout();
      render();
    };
    tl.to(this.s, { profiles: 1, duration: 0.3, ease: 'power2.out', onUpdate: render }, 0);
    // time runs 0 → just past the flag during step 0→1 (so the flag is up when step 1 is read), then → end during step 1→2
    tl.to(this.s, { time: Math.min(REQUESTS, this.flagAt + 2.5), duration: 1.0, ease: 'none', onUpdate }, 0);
    tl.to(this.s, { time: REQUESTS, duration: 1.0, ease: 'none', onUpdate }, 1.0);
  }

  private updateReadout(): void {
    const i = Math.max(0, Math.min(REQUESTS - 1, Math.floor(this.s.time) - 1));
    if (i === this.lastShown) return;
    this.lastShown = i;
    setFig('ens-req', String(i + 1));
    if (this.readout) {
      const [zl, zt, zd] = this.z(1, i);
      const sc = this.scores[1][i];
      const bs = this.readout.querySelectorAll('b');
      const f = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
      if (bs.length >= 4) {
        bs[0].textContent = f(zl);
        bs[1].textContent = f(zt);
        bs[2].textContent = f(zd);
        bs[3].textContent = sc.toFixed(2);
        bs[3].classList.toggle('warn', sc > THRESHOLD);
      }
    }
    this.flag?.classList.toggle('on', i >= this.flagAt);
  }

  private laneGeom(vp: Viewport, k: number) {
    const st = vp.stage;
    const pad = vp.narrow ? 10 : 36;
    const x0 = st.x + pad + (vp.narrow ? 0 : 70), x1 = st.x + st.w - pad;
    const top = st.y + (vp.narrow ? 16 : 60);
    const bottom = st.y + st.h - (vp.narrow ? 26 : 90);
    const lh = (bottom - top) / 3;
    const y = top + lh * k;
    return { x0, x1, y, h: lh - 10, routerX: st.x + pad + 12, routerY: (top + bottom) / 2 };
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, _world: World, dt: number): void {
    const a = this.presence;
    const { s } = this;
    const time = s.time;
    ctx.save();
    ctx.globalAlpha = a;

    const g0 = this.laneGeom(vp, 0);
    // Router
    ctx.save();
    ctx.globalAlpha *= s.profiles;
    glow(ctx, g0.routerX, g0.routerY, 26, C.brass, 0.35);
    drawDot(ctx, g0.routerX, g0.routerY, 9, C.brass, rgba(C.ink, 0.8));
    if (!vp.narrow) label(ctx, 'router', g0.routerX, g0.routerY + 22, { align: 'center', color: C.mist, size: 11, font: 'mono' });
    ctx.restore();

    const flagged = time >= this.flagAt + 1;
    const probing = time >= this.flagAt + 1 + PROBE_AFTER;

    this.traces.forEach((tr, k) => {
      const g = this.laneGeom(vp, k);
      const bad = k === 1;
      const col = bad && flagged ? C.amber : C.teal;
      // lane background
      roundRect(ctx, g.x0, g.y, g.x1 - g.x0, g.h, 6);
      ctx.fillStyle = rgba(C.panel, 0.55);
      ctx.fill();
      ctx.strokeStyle = bad && flagged ? rgba(C.amber, 0.7) : rgba(C.line, 1);
      ctx.lineWidth = 1;
      ctx.stroke();

      // name and status
      ctx.save();
      ctx.globalAlpha *= s.profiles;
      label(ctx, tr.id, g.x0 + 10, g.y + 13, { color: C.fog, size: 12, weight: '600', font: 'mono' });
      let status = 'in rotation';
      if (bad && flagged) status = probing ? 'probing · cooling down' : 'throttling suspected · out of rotation';
      else if (!bad && flagged) status = 'in rotation · taking failover';
      label(ctx, status, g.x1 - 10, g.y + 13, { align: 'right', color: bad && flagged ? C.amber : C.mist, size: 10.5, font: 'mono' });
      if (!vp.narrow) label(ctx, '→ standard schema', g.x1 - 10, g.y + g.h - 10, { align: 'right', color: rgba(C.mist, 0.7), size: 10, font: 'mono' });
      ctx.restore();

      // three sparklines: latency, length, density
      const px0 = g.x0 + 10, pw = g.x1 - g.x0 - 20;
      const panelW = pw / 3 - 8;
      const py0 = g.y + 38, ph = g.h - 54;
      const series: Array<{ name: string; xs: number[]; max: number; up: boolean }> = [
        { name: 'latency ms', xs: tr.latency, max: 2400, up: true },
        { name: 'length tok', xs: tr.tokens, max: 200, up: false },
        { name: 'density', xs: tr.density, max: 0.8, up: false },
      ];
      series.forEach((sr, j) => {
        const x = px0 + j * (panelW + 12);
        label(ctx, sr.name, x, py0 - 2, { color: rgba(C.mist, 0.75), size: 9.5, font: 'mono' });
        ctx.strokeStyle = rgba(C.line, 1);
        ctx.beginPath();
        ctx.moveTo(x, py0 + ph);
        ctx.lineTo(x + panelW, py0 + ph);
        ctx.stroke();
        const n = Math.min(REQUESTS, time);
        if (n < 1) return;
        ctx.beginPath();
        for (let i = 0; i < Math.ceil(n); i++) {
          const f = Math.min(1, n - i);
          const v = sr.xs[i] / sr.max;
          const xx = x + (i / (REQUESTS - 1)) * panelW;
          const yy = py0 + ph - v * ph;
          if (i === 0) ctx.moveTo(xx, yy);
          else if (f >= 1) ctx.lineTo(xx, yy);
          else {
            // partial segment while a request is still arriving
            const vp0 = sr.xs[i - 1] / sr.max;
            const xp = x + ((i - 1) / (REQUESTS - 1)) * panelW;
            const yp = py0 + ph - vp0 * ph;
            ctx.lineTo(xp + (xx - xp) * f, yp + (yy - yp) * f);
          }
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = bad && time > this.flagAt - 2 ? rgba(C.amber, 0.9) : rgba(C.teal, 0.85);
        ctx.stroke();
        // the flag marker
        if (bad && flagged) {
          const xf = x + (this.flagAt / (REQUESTS - 1)) * panelW;
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = rgba(C.amber, 0.8);
          ctx.beginPath();
          ctx.moveTo(xf, py0);
          ctx.lineTo(xf, py0 + ph);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // latest value
        const li = Math.max(0, Math.min(REQUESTS - 1, Math.floor(n) - 1));
        const val = sr.xs[li];
        label(ctx, sr.name.startsWith('density') ? val.toFixed(2) : String(Math.round(val)), x + panelW, py0 - 2, { align: 'right', color: col, size: 9.5, font: 'mono' });
      });
    });

    // Request particles
    if (dt > 0 && s.profiles > 0.5) this.stepRequests(dt, time);
    for (const r of this.reqs) {
      const g = this.laneGeom(vp, r.lane);
      const p0: Vec2 = [g0.routerX, g0.routerY];
      const p3: Vec2 = [g.x0 - 4, g.y + g.h / 2];
      const pos = bez(p0, [p0[0] + 40, p0[1]], [p3[0] - 40, p3[1]], p3, r.t);
      glow(ctx, pos[0], pos[1], 7, C.teal, 0.5);
      drawDot(ctx, pos[0], pos[1], 1.8, C.teal);
    }

    ctx.restore();
  }

  private stepRequests(dt: number, time: number): void {
    this.acc += dt * 6;
    const flagged = time >= this.flagAt + 1;
    while (this.acc >= 1) {
      this.acc -= 1;
      let lane = this.rr % 3;
      this.rr++;
      if (flagged && lane === 1) lane = this.rr % 2 === 0 ? 0 : 2;
      this.reqs.push({ lane, t: 0, speed: 0.9 + this.rand() * 0.4 });
    }
    for (const r of this.reqs) r.t += dt * r.speed;
    this.reqs = this.reqs.filter((r) => r.t < 1);
  }
}
