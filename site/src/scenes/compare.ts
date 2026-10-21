import { gsap } from 'gsap';
import { hierarchy, tree as d3tree } from 'd3-hierarchy';
import { cosine, distortion, hashingEmbed, indexTree, kNearest, neighbourPrecision, randomPairs, type TreeNode, type Vec2 } from 'poincare-ball';
import { C, ball, toPx, normSq2, drawGeodesic, drawDot, label, tag, badge, depthColor, rgba, glow, type Viewport } from '../lib/draw';
import { canAnimate } from '../lib/motion';
import { bigTree, bigTreeLayout, TAU1 } from '../lib/tree';
import type { Scene, SceneManager, World } from './manager';

const K = 6;
const RELATIVE_HOPS = 2;
const PAIRS = 400;
const DEBOUNCE_MS = 140;

/**
 * Chapter 02: the same ~200-node tree embedded two ways with the same edge length τ: a
 * radial tidy layout in the Euclidean plane (levels τ apart) and Sarkar's layout in the
 * Poincaré disk. A typed query picks a focus node by label (hashing embedder plus a
 * substring boost); each space shows the focus's six nearest neighbours by its own
 * distance, teal if within two tree edges, amber otherwise, with neighbour precision and
 * distortion computed live. Nothing is scripted: the numbers are whatever they are.
 */
export class CompareScene implements Scene {
  readonly id = 'compare';
  readonly layout = 'split';
  readonly diskAlpha = 1;
  presence = 0;

  private T = indexTree(bigTree());
  private n: number;
  private hy: Vec2[];
  /** Euclidean positions in model units (radius = depth × τ). */
  private eu: Vec2[];
  /** Label embeddings, filled by `warmLabels()` from idle time or on the first query. */
  private vecs: Array<number[] | null> = this.T.ids.map(() => null);
  private warmed = 0;
  readonly distortionE: number;
  readonly distortionH: number;
  private focus = -1;
  private nnE: number[] = [];
  private nnH: number[] = [];
  private rel = new Set<number>();
  private s = { hl: 0 };
  private timer = 0;

  private input = document.getElementById('cmp-query') as HTMLInputElement | null;
  private elFocus = document.getElementById('cmp-focus');
  private elE = { prec: document.getElementById('cmp-e-prec'), dist: document.getElementById('cmp-e-dist'), nn: document.getElementById('cmp-e-nn') };
  private elH = { prec: document.getElementById('cmp-h-prec'), dist: document.getElementById('cmp-h-dist'), nn: document.getElementById('cmp-h-nn') };

  constructor(private mgr: SceneManager) {
    const data = bigTree();
    const T = this.T;
    this.n = T.ids.length;
    const L = bigTreeLayout();
    this.hy = T.ids.map((id) => L.get(id)!.pos);

    const root = hierarchy<TreeNode>(data, (d) => d.children);
    d3tree<TreeNode>()
      .size([2 * Math.PI, 4 * TAU1])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / a.depth)(root);
    this.eu = new Array(this.n);
    root.each((d) => {
      this.eu[T.index.get(d.data.id)!] = [(d.y ?? 0) * Math.cos(d.x ?? 0), (d.y ?? 0) * Math.sin(d.x ?? 0)];
    });

    // Distortion, once per layout, over the same 400 random pairs.
    const pairs = randomPairs(this.n, PAIRS, 1);
    this.distortionE = distortion(pairs, (a, b) => this.dE(a, b), T.hops, TAU1);
    this.distortionH = distortion(pairs, (a, b) => this.dH(a, b), T.hops, TAU1);
    if (this.elE.dist) this.elE.dist.textContent = this.distortionE.toFixed(3);
    if (this.elH.dist) this.elH.dist.textContent = this.distortionH.toFixed(3);

    this.input?.addEventListener('input', () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.query(this.input!.value), DEBOUNCE_MS);
    });
    document.querySelectorAll<HTMLButtonElement>('#cmp-chips .chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        if (this.input) this.input.value = chip.dataset.q ?? chip.textContent ?? '';
        this.query(chip.dataset.q ?? chip.textContent ?? '');
      }),
    );
  }

  private dE(a: number, b: number): number {
    return Math.hypot(this.eu[a][0] - this.eu[b][0], this.eu[a][1] - this.eu[b][1]);
  }
  private dH(a: number, b: number): number {
    return ball.distanceArcosh(this.hy[a], this.hy[b]);
  }

  /** Embed up to `n` more labels (about 0.25 ms each) and return how many are still pending. */
  warmLabels(n = Infinity): number {
    const ids = this.T.ids;
    const stop = Math.min(ids.length, this.warmed + n);
    for (; this.warmed < stop; this.warmed++) this.vecs[this.warmed] = hashingEmbed(ids[this.warmed]);
    return ids.length - this.warmed;
  }

  /** All label embeddings (finishes the warm-up synchronously if it has not completed). */
  private labelVectors(): number[][] {
    this.warmLabels();
    return this.vecs as number[][];
  }

  /** The best-matching node by label: cosine of the hashing embeddings plus a substring boost. */
  bestMatch(text: string): number {
    const q = text.trim().toLowerCase();
    if (!q) return -1;
    const qv = hashingEmbed(q);
    const vecs = this.labelVectors();
    let best = -1;
    let bestS = -Infinity;
    this.T.ids.forEach((id, i) => {
      const l = id.toLowerCase();
      let s = cosine(qv, vecs[i]);
      if (l === q) s += 1;
      else if (l.includes(q)) s += 0.5;
      else if (q.includes(l)) s += 0.25;
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    });
    return best;
  }

  query(text: string): void {
    this.setFocus(this.bestMatch(text));
  }

  setFocus(i: number): void {
    this.focus = i;
    const render = () => this.mgr.requestRender();
    if (i < 0) {
      this.nnE = [];
      this.nnH = [];
      this.rel.clear();
      if (this.elFocus) this.elFocus.textContent = 'no focus yet · type a concept or pick a chip';
      for (const el of [this.elE, this.elH]) {
        if (el.prec) el.prec.textContent = '—';
        if (el.nn) el.nn.textContent = '';
      }
      if (canAnimate()) gsap.to(this.s, { hl: 0, duration: 0.3, overwrite: 'auto', onUpdate: render });
      else this.s.hl = 0;
      render();
      return;
    }
    const T = this.T;
    this.rel = T.within(i, RELATIVE_HOPS);
    this.nnE = kNearest(i, this.n, K, (a, b) => this.dE(a, b));
    this.nnH = kNearest(i, this.n, K, (a, b) => this.dH(a, b));
    const pE = neighbourPrecision(this.nnE, this.rel);
    const pH = neighbourPrecision(this.nnH, this.rel);
    if (this.elFocus) {
      const kind = T.children[i].length === 0 ? 'leaf' : T.parent[i] < 0 ? 'root' : 'inner node';
      this.elFocus.textContent = `${T.ids[i]} · ${kind}, depth ${T.depth[i]} · ${this.rel.size} relatives within ${RELATIVE_HOPS} edges`;
    }
    this.fill(this.elE, this.nnE, pE, (a, b) => this.dE(a, b));
    this.fill(this.elH, this.nnH, pH, (a, b) => this.dH(a, b));
    if (canAnimate()) gsap.fromTo(this.s, { hl: 0 }, { hl: 1, duration: 0.45, ease: 'power2.out', overwrite: 'auto', onUpdate: render });
    else this.s.hl = 1;
    render();
  }

  private fill(el: { prec: HTMLElement | null; nn: HTMLElement | null }, nn: number[], p: number, d: (a: number, b: number) => number): void {
    const hits = nn.filter((j) => this.rel.has(j)).length;
    if (el.prec) el.prec.textContent = `${hits} / ${nn.length} = ${p.toFixed(2)}`;
    if (el.nn) {
      el.nn.textContent = '';
      nn.forEach((j, r) => {
        const li = document.createElement('li');
        li.className = this.rel.has(j) ? 'rel' : 'far';
        const name = document.createElement('span');
        name.className = 't';
        name.textContent = `${r + 1} ${this.T.ids[j]}`;
        const meta = document.createElement('span');
        meta.className = 's';
        meta.textContent = `${this.T.hops(this.focus, j)} edge${this.T.hops(this.focus, j) === 1 ? '' : 's'} · d ${d(this.focus, j).toFixed(2)}`;
        li.append(name, meta);
        el.nn!.appendChild(li);
      });
    }
  }

  /** Both pictures are present from the first step; the chapter hand-off fades the scene in. */
  build(_tl: gsap.core.Timeline): void {}

  private euPx(vp: Viewport, p: Vec2): Vec2 {
    const k = vp.alt.R / (4 * TAU1 * 1.04);
    return [vp.alt.cx + p[0] * k, vp.alt.cy - p[1] * k];
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, _world: World): void {
    const a = this.presence;
    const T = this.T;
    const maxDepth = 4;
    const hl = this.s.hl;
    const small = vp.narrow;
    ctx.save();
    ctx.globalAlpha = a;

    // ---- left / top: the Euclidean plane ----
    {
      ctx.save();
      const { cx, cy, R } = vp.alt;
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.line, 1);
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R * r) / 4 / 1.04, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(C.fog, 0.2);
      ctx.beginPath();
      for (let i = 0; i < this.n; i++) {
        const p = T.parent[i];
        if (p < 0) continue;
        const q0 = this.euPx(vp, this.eu[p]);
        const q1 = this.euPx(vp, this.eu[i]);
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
      }
      ctx.stroke();
      const r0 = small ? 1.7 : 2.4;
      for (let i = 0; i < this.n; i++) {
        const q = this.euPx(vp, this.eu[i]);
        ctx.beginPath();
        ctx.arc(q[0], q[1], r0, 0, Math.PI * 2);
        ctx.fillStyle = depthColor(T.depth[i], maxDepth, hl > 0 && this.focus >= 0 ? 0.55 : 1);
        ctx.fill();
      }
      this.highlight(ctx, vp, (i) => this.euPx(vp, this.eu[i]), this.nnE, false);
      this.title(ctx, vp, 'Euclidean plane · levels τ apart', cx, cy, R);
      ctx.restore();
    }

    // ---- right / bottom: the Poincaré disk ----
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(C.fog, 0.22);
    for (let i = 0; i < this.n; i++) {
      const p = T.parent[i];
      if (p < 0) continue;
      drawGeodesic(ctx, vp, this.hy[p], this.hy[i]);
    }
    for (let i = 0; i < this.n; i++) {
      const p = this.hy[i];
      const q = toPx(vp, p);
      const r = (1.2 + 4.2 * (1 - normSq2(p))) * (small ? 0.75 : 1) * (vp.R / 300 + 0.5);
      ctx.beginPath();
      ctx.arc(q[0], q[1], Math.max(0.9, r), 0, Math.PI * 2);
      ctx.fillStyle = depthColor(T.depth[i], maxDepth, hl > 0 && this.focus >= 0 ? 0.55 : 1);
      ctx.fill();
    }
    this.highlight(ctx, vp, (i) => toPx(vp, this.hy[i]), this.nnH, true);
    this.title(ctx, vp, `Poincaré disk · every edge τ = ${TAU1}`, vp.cx, vp.cy, vp.R);
    ctx.restore();
  }

  /** Panel title: centred above the panel on wide screens; a vertical label at the band's left edge when stacked. */
  private title(ctx: CanvasRenderingContext2D, vp: Viewport, text: string, cx: number, cy: number, R: number): void {
    if (!vp.narrow) {
      label(ctx, text, cx, cy - R - 16, { align: 'center', color: C.mist, size: 11, font: 'mono' });
      return;
    }
    ctx.save();
    ctx.translate(14, cy);
    ctx.rotate(-Math.PI / 2);
    label(ctx, text, 0, 0, { align: 'center', color: C.mist, size: 9.5, font: 'mono' });
    ctx.restore();
  }

  /** Focus glow, links to the six neighbours, rank badges coloured by kinship, the focus label. */
  private highlight(ctx: CanvasRenderingContext2D, vp: Viewport, at: (i: number) => Vec2, nn: number[], hyperbolic: boolean): void {
    const hl = this.s.hl;
    if (hl <= 0.004 || this.focus < 0) return;
    const f = at(this.focus);
    ctx.save();
    ctx.globalAlpha *= hl;
    nn.forEach((j, r) => {
      const q = at(j);
      const col = this.rel.has(j) ? C.teal : C.amber;
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba(col, 0.6);
      if (hyperbolic) drawGeodesic(ctx, vp, this.hy[this.focus], this.hy[j]);
      else {
        ctx.beginPath();
        ctx.moveTo(f[0], f[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(q[0], q[1], 5.5, 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.stroke();
      // Badge on the side away from the focus so it does not sit on the link.
      const dx = q[0] - f[0], dy = q[1] - f[1];
      const len = Math.hypot(dx, dy) || 1;
      badge(ctx, q[0] + (dx / len) * 11, q[1] + (dy / len) * 11, String(r + 1), col, C.ink, vp.narrow ? 6 : 7);
    });
    glow(ctx, f[0], f[1], 26, C.brass, 0.5);
    drawDot(ctx, f[0], f[1], 5, C.brass, rgba(C.ink, 0.9));
    // The focus label goes below the point in the upper half of the panel, above it otherwise.
    const cy = hyperbolic ? vp.cy : vp.alt.cy;
    const below = f[1] < cy;
    tag(ctx, this.T.ids[this.focus], f[0], f[1] + (below ? 16 : -15), { align: 'center', color: C.brass, size: vp.narrow ? 10 : 11.5, weight: '600' });
    ctx.restore();
  }
}
