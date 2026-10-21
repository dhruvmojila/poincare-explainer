import type { gsap } from 'gsap';
import type { Vec2 } from 'poincare-ball';
import { C, ball, toPx, bez, roundRect, label, rgba, glow, drawHyperbolicCircle, drawDot, mulberry32, ramp, type Viewport } from '../lib/draw';
import { QUERY, subTasks, BUDGET_FRACTION } from '../lib/tree';
import type { Scene, SceneManager, World } from './manager';

interface Particle {
  ribbon: number;
  t: number;
  speed: number;
  leg: 0 | 1;
}

/**
 * Chapter 06: the metacognitive controller. A query decomposes into sub-tasks (eq. 5)
 * that flow as particles to specialist roles; the memory (the small disk) marks each
 * sub-task's depth; allocation bars grow with expected information gain per cost
 * (eq. 6), and a sub-task below budget is skipped.
 */
export class ControllerScene implements Scene {
  readonly id = 'controller';
  readonly layout = 'mini';
  readonly loop = true;
  readonly diskAlpha = 1;
  presence = 0;

  private s = { q: 0, fan: 0, roles: 0, bars: 0, skip: 0 };
  private ratio: number[];
  private maxRatio: number;
  private skipped: boolean[];
  private particles: Particle[] = [];
  private rand = mulberry32(5);
  private spawnAcc = 0;

  constructor(private mgr: SceneManager) {
    this.ratio = subTasks.map((q) => q.gain / q.cost);
    this.maxRatio = Math.max(...this.ratio);
    this.skipped = this.ratio.map((r) => r < BUDGET_FRACTION * this.maxRatio);
    const body = document.querySelector<HTMLTableSectionElement>('#alloc-table tbody');
    if (body) {
      subTasks.forEach((q, i) => {
        const tr = document.createElement('tr');
        if (this.skipped[i]) tr.className = 'skip-row';
        tr.innerHTML = `<td>${q.id} · ${q.role}${this.skipped[i] ? ' · skipped' : ''}</td><td>${q.gain.toFixed(2)}</td><td>${q.cost.toFixed(2)}</td><td>${this.ratio[i].toFixed(2)}</td>`;
        body.appendChild(tr);
      });
    }
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    tl.to(this.s, { q: 1, duration: 0.3, ease: 'power2.out', onUpdate: render }, 0.0);
    // Each step's state is complete at its integer time: fan by 0.85, roles by 1, bars and the skip by 2.
    tl.to(this.s, { fan: 1, duration: 0.6, ease: 'power2.inOut', onUpdate: render }, 0.25);
    tl.to(this.s, { roles: 1, duration: 0.45, ease: 'power2.out', onUpdate: render }, 0.55);
    tl.to(this.s, { bars: 1, duration: 0.55, ease: 'power2.out', onUpdate: render }, 1.3);
    tl.to(this.s, { skip: 1, duration: 0.3, ease: 'power1.out', onUpdate: render }, 1.65);
  }

  /** Geometry of the diagram inside the stage rectangle. */
  private geom(vp: Viewport) {
    const st = vp.stage;
    const pad = vp.narrow ? 14 : 40;
    const x0 = st.x + pad, x1 = st.x + st.w - pad;
    const y0 = st.y + pad, y1 = st.y + st.h - pad;
    const w = x1 - x0, h = y1 - y0;
    const qx = x0, qy = y0 + h * 0.46, qw = vp.narrow ? w * 0.26 : Math.min(w * 0.2, 150), qh = vp.narrow ? 56 : 74;
    const sx = x0 + w * (vp.narrow ? 0.4 : 0.42);
    const rows = subTasks.map((_, i) => y0 + h * (0.14 + 0.2 * i));
    const bx0 = x0 + w * (vp.narrow ? 0.66 : 0.7), bx1 = x1;
    return { x0, x1, y0, y1, w, h, qx, qy, qw, qh, sx, rows, bx0, bx1 };
  }

  private ribbon(g: ReturnType<ControllerScene['geom']>, i: number): [Vec2, Vec2, Vec2, Vec2] {
    const p0: Vec2 = [g.qx + g.qw, g.qy];
    const p3: Vec2 = [g.sx - 8, g.rows[i]];
    const mx = (p0[0] + p3[0]) / 2;
    return [p0, [mx, p0[1]], [mx, p3[1]], p3];
  }

  private leg2(g: ReturnType<ControllerScene['geom']>, i: number): [Vec2, Vec2, Vec2, Vec2] {
    const p0: Vec2 = [g.sx + 8, g.rows[i]];
    const p3: Vec2 = [g.bx0 - 6, g.rows[i]];
    return [p0, [p0[0] + 30, p0[1]], [p3[0] - 30, p3[1]], p3];
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, world: World, dt: number): void {
    const a = this.presence;
    const g = this.geom(vp);
    const { s } = this;
    ctx.save();
    ctx.globalAlpha = a;

    // Query box
    if (s.q > 0) {
      ctx.save();
      ctx.globalAlpha *= s.q;
      roundRect(ctx, g.qx, g.qy - g.qh / 2, g.qw, g.qh, 6);
      ctx.fillStyle = rgba(C.panel, 0.9);
      ctx.fill();
      ctx.strokeStyle = rgba(C.brass, 0.8);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      label(ctx, 'Q', g.qx + 12, g.qy - g.qh / 2 + 16, { color: C.brass, size: 16, font: 'display', italic: true });
      wrap(ctx, QUERY, g.qx + 12, g.qy - g.qh / 2 + 34, g.qw - 22, vp.narrow ? 9.5 : 11, vp.narrow ? 2 : 3);
      ctx.restore();
    }

    // Ribbons Q → q_i
    const alloc = this.ratio.map((r) => r / this.maxRatio);
    subTasks.forEach((q, i) => {
      const [p0, p1, p2, p3] = this.ribbon(g, i);
      const draw = ramp(s.fan, i * 0.12, 0.55 + i * 0.12);
      if (draw <= 0) return;
      const skip = this.skipped[i] && s.skip > 0;
      ctx.save();
      ctx.globalAlpha *= draw;
      ctx.lineWidth = 1.5 + 9 * alloc[i] * s.bars * (skip ? 0.3 : 1);
      ctx.strokeStyle = skip ? rgba(C.amber, 0.25 + 0.3 * s.skip) : rgba(C.teal, 0.14 + 0.1 * s.bars);
      if (skip) ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      const n = 24;
      for (let k = 1; k <= n * draw; k++) {
        const p = bez(p0, p1, p2, p3, k / n);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.restore();

      // sub-task node
      const node = p3;
      ctx.save();
      ctx.globalAlpha *= ramp(draw, 0.6, 1);
      const r = 7;
      glow(ctx, node[0] + 8, node[1], 20, skip ? C.amber : C.teal, 0.3);
      drawDot(ctx, node[0] + 8, node[1], r, skip ? C.amber : C.teal, rgba(C.ink, 0.8));
      label(ctx, q.id, node[0] + 8, node[1] - 15, { color: C.fog, size: 11, font: 'mono', align: 'center' });
      label(ctx, q.focus, node[0] + 8, node[1] + 16, { color: C.mist, size: 10.5, align: 'center', alpha: vp.narrow ? 0 : 1 });
      ctx.restore();

      // leg 2: q_i → role / allocation bar
      if (s.roles > 0) {
        const [a0, a1, a2, a3] = this.leg2(g, i);
        ctx.save();
        ctx.globalAlpha *= s.roles;
        ctx.setLineDash(skip ? [4, 6] : []);
        ctx.lineWidth = 1 + 6 * alloc[i] * s.bars * (skip ? 0.3 : 1);
        ctx.strokeStyle = skip ? rgba(C.amber, 0.35) : rgba(C.teal, 0.14 + 0.1 * s.bars);
        ctx.beginPath();
        ctx.moveTo(a0[0], a0[1]);
        for (let k = 1; k <= 16; k++) {
          const p = bez(a0, a1, a2, a3, k / 16);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.stroke();
        ctx.restore();

        // role label and bar
        ctx.save();
        ctx.globalAlpha *= s.roles;
        const by = g.rows[i];
        label(ctx, q.role, g.bx0, by - 13, { color: skip ? C.amber : C.fog, size: 12, weight: '600' });
        const bw = g.bx1 - g.bx0;
        roundRect(ctx, g.bx0, by - 4, bw, 9, 3);
        ctx.fillStyle = rgba(C.fog, 0.08);
        ctx.fill();
        const fill = bw * alloc[i] * s.bars;
        if (fill > 0) {
          roundRect(ctx, g.bx0, by - 4, fill, 9, 3);
          ctx.fillStyle = skip ? rgba(C.amber, 0.35 + 0.4 * s.skip) : C.teal;
          ctx.fill();
        }
        const txt = skip && s.skip > 0.5 ? `G/C = ${this.ratio[i].toFixed(2)} · skipped (budget)` : `G/C = ${(this.ratio[i] * s.bars).toFixed(2)}`;
        label(ctx, txt, g.bx0, by + 16, { color: skip && s.skip > 0.5 ? C.amber : C.mist, size: 10.5, font: 'mono', alpha: s.bars });
        ctx.restore();
      }
    });

    // Memory (the mini disk): rings and each sub-task's depth
    if (s.roles > 0 && world.disk.alpha > 0) {
      ctx.save();
      ctx.globalAlpha *= s.roles;
      ctx.setLineDash([2, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.brass, 0.35);
      for (let r = 1; r <= 4; r++) drawHyperbolicCircle(ctx, vp, r * 0.9);
      ctx.setLineDash([]);
      subTasks.forEach((q, i) => {
        const ang = Math.PI / 2 - (i * 2 * Math.PI) / subTasks.length;
        const p = ball.pointAt([Math.cos(ang), Math.sin(ang)], q.depth * 0.9);
        const px = toPx(vp, [p[0], p[1]]);
        const col = this.skipped[i] && s.skip > 0 ? C.amber : C.teal;
        drawDot(ctx, px[0], px[1], 3.5, col);
        // tether to the sub-task node
        const node = this.ribbon(g, i)[3];
        ctx.strokeStyle = rgba(col, 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px[0], px[1]);
        ctx.lineTo(node[0] + 8, node[1]);
        ctx.stroke();
      });
      if (vp.narrow) label(ctx, 'memory · depth of q', Math.max(6, vp.cx - vp.R), vp.cy + vp.R + 12, { color: C.mist, size: 9.5, font: 'mono' });
      else label(ctx, 'memory · depth of each q', vp.cx, vp.cy + vp.R + 14, { align: 'center', color: C.mist, size: 10.5, font: 'mono' });
      ctx.restore();
    }

    // Particles (skipped under reduced motion: dt is 0 and the loop never runs)
    if (dt > 0 && s.fan > 0.3) this.stepParticles(dt, alloc, s);
    for (const p of this.particles) {
      const ctrl = p.leg === 0 ? this.ribbon(g, p.ribbon) : this.leg2(g, p.ribbon);
      const pos = bez(ctrl[0], ctrl[1], ctrl[2], ctrl[3], p.t);
      glow(ctx, pos[0], pos[1], 7, C.teal, 0.5);
      drawDot(ctx, pos[0], pos[1], 1.8, C.teal);
    }

    ctx.restore();
  }

  private stepParticles(dt: number, alloc: number[], s: typeof this.s): void {
    this.spawnAcc += dt * 14;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      // pick a ribbon in proportion to its allocation (skipped ones get nothing once flagged)
      const weights = alloc.map((w, i) => (this.skipped[i] && s.skip > 0.5 ? 0 : 0.35 + w * s.bars));
      const total = weights.reduce((x, y) => x + y, 0);
      let r = this.rand() * total;
      let pick = 0;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          pick = i;
          break;
        }
      }
      this.particles.push({ ribbon: pick, t: 0, speed: 0.5 + this.rand() * 0.35, leg: 0 });
    }
    for (const p of this.particles) p.t += dt * p.speed;
    this.particles = this.particles.filter((p) => {
      if (p.t < 1) return true;
      if (p.leg === 0 && s.roles > 0.5) {
        p.leg = 1;
        p.t = 0;
        return true;
      }
      return false;
    });
    if (this.particles.length > 140) this.particles.splice(0, this.particles.length - 140);
  }
}

/** Word-wrapped label, at most `maxLines` lines. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, size: number, maxLines: number): void {
  ctx.save();
  ctx.font = `500 ${size}px 'Inter Tight', ui-sans-serif, system-ui, sans-serif`;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > width && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  ctx.restore();
  lines.slice(0, maxLines).forEach((l, i) => label(ctx, i === maxLines - 1 && lines.length > maxLines ? `${l}…` : l, x, y + i * (size + 3), { color: C.mist, size }));
}
