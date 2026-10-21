import { gsap } from 'gsap';
import { cosine, hashingEmbed, makeDecay, placeBeyond, shellDistance, weightedScore, type DecayKind, type Vec2 } from 'poincare-ball';
import { Camera } from '../lib/camera';
import { C, ball, toPx, normSq2, drawGeodesic, drawDot, label, badge, depthColor, rgba, glow, ORIGIN, type Viewport } from '../lib/draw';
import { canAnimate } from '../lib/motion';
import { setFig } from '../lib/fig';
import { anatomyLayout, memories, STABILITY, TAU3, type MemoryKind } from '../lib/tree';
import type { Scene, SceneManager, World } from './manager';

/** Reference shell for query–memory similarity: the hyperbolic radius of the root level (one edge, τ). */
export const SHELL_RHO = TAU3;
const PARAM: Record<DecayKind, number> = { 'half-life': 14, ebbinghaus: 14, window: 21 };
const RAMP = 7;
const ZOOM_ID = 'lower limb';
const TOP = 5;
const DEBOUNCE_MS = 140;
const DEFAULT_QUERY = 'hamstring tightness after sprint sessions';

interface Mem {
  /** A tree node (structure, undated) or a dated memory of one of the three kinds. */
  kind: 'node' | MemoryKind;
  node: string;
  text: string;
  /** Age in days when the time control is at 0; null for undated structure. */
  age: number | null;
  pos: Vec2;
  nodePos: Vec2;
  /** 256-d hashing embedding of the memory text; null until `warm()` has reached it. */
  vec: number[] | null;
  w: number;
  d: number;
  score: number;
  /** Index of the dot in the decay chart (dated memories only). */
  dot: number;
  added: boolean;
}

/**
 * Chapter 05: time-weighted memory. Every memory (the anatomy nodes and the dated notes) is
 * embedded once with the reference implementation's offline hashing embedder; a typed query
 * is embedded the same way, compared on the reference shell (direction only), and scored
 * e^{−d} · w(Δt) under the chosen decay curve and time position. The top five are listed and
 * badged on the disk; a brass marker on the shell at the angle of the top match is a visual
 * proxy, since the disk draws the tree, not the 256-dimensional embedding. New notes can be
 * added: embedded, attached under the node whose name they match best, placed one depth step
 * beyond it, and ranked at once.
 *
 * The 55 embeddings (43 nodes, 12 notes) cost about 25 ms of BLAKE2b, so they are not computed
 * in the constructor: `warm()` embeds a few at a time from idle callbacks after the page has
 * painted, and any query or note arriving earlier finishes the job synchronously first.
 */
export class TimeScene implements Scene {
  readonly id = 'time';
  readonly layout = 'main';
  readonly diskAlpha = 1;
  presence = 0;

  private nodes: Array<{ id: string; depth: number; pos: Vec2; parent: string | null }> = [];
  private byId = new Map<string, { pos: Vec2; parent: string | null; depth: number }>();
  private nodeVecs = new Map<string, number[]>();
  private maxDepth = 0;
  private mems: Mem[] = [];
  private zoomTarget: Vec2;
  private s = { mem: 0, zoom: 0, query: 0 };
  private now = 0;
  private kind: DecayKind = 'half-life';
  private qvec: number[] | null = null;
  private queryText = '';
  private top: number[] = [];
  private timer = 0;
  private addedCount = 0;
  /** True once the default query has been run (after the embeddings are complete). */
  private primed = false;

  private elNow = document.getElementById('time-now');
  private chart = document.getElementById('decay-chart') as SVGSVGElement | null;
  private dots: SVGCircleElement[] = [];
  private curves = new Map<DecayKind, SVGPathElement>();
  private rankEl = document.getElementById('memory-rank');
  private rankItems = new Map<Mem, HTMLLIElement>();
  private input = document.getElementById('mem-query') as HTMLInputElement | null;
  private status = document.getElementById('mem-status');
  private noteText = document.getElementById('note-text') as HTMLInputElement | null;
  private noteAge = document.getElementById('note-age') as HTMLInputElement | null;
  private noteStatus = document.getElementById('note-status');

  constructor(private mgr: SceneManager) {
    const layout = anatomyLayout();
    for (const [id, ln] of layout) {
      const pos: Vec2 = [ln.pos[0], ln.pos[1]];
      this.nodes.push({ id, depth: ln.depth, pos, parent: ln.parentId });
      this.byId.set(id, { pos, parent: ln.parentId, depth: ln.depth });
      this.maxDepth = Math.max(this.maxDepth, ln.depth);
      this.mems.push({ kind: 'node', node: id, text: id, age: null, pos, nodePos: pos, vec: null, w: 1, d: 0, score: 0, dot: -1, added: false });
    }
    this.zoomTarget = this.byId.get(ZOOM_ID)!.pos;
    for (const m of memories) {
      const nodePos = this.byId.get(m.node)!.pos;
      const local = ball.pointAt([Math.cos(m.angle), Math.sin(m.angle)], 0.32);
      const p = ball.mobiusAdd(nodePos, local);
      this.mems.push({
        kind: m.kind,
        node: m.node,
        text: m.text,
        age: m.age,
        pos: [p[0], p[1]],
        nodePos,
        vec: null,
        w: 1,
        d: 0,
        score: 0,
        dot: -1,
        added: false,
      });
    }

    const slider = document.getElementById('time-slider') as HTMLInputElement | null;
    slider?.addEventListener('input', () => {
      this.now = Number(slider.value);
      this.update();
    });
    document.querySelectorAll<HTMLInputElement>('input[name="decay-kind"]').forEach((r) =>
      r.addEventListener('change', () => {
        if (r.checked) {
          this.kind = r.value as DecayKind;
          this.update();
        }
      }),
    );
    this.input?.addEventListener('input', () => {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.setQuery(this.input!.value), DEBOUNCE_MS);
    });
    document.querySelectorAll<HTMLButtonElement>('#mem-chips .chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const q = chip.dataset.q ?? chip.textContent ?? '';
        if (this.input) this.input.value = q;
        this.setQuery(q);
      }),
    );
    document.getElementById('note-add')?.addEventListener('click', () => this.addNote());
    this.noteText?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.addNote();
      }
    });
    this.buildChart();
    this.update();
  }

  /** Embed one memory (a node by its name, a note by its text and node). */
  private embed(m: Mem): void {
    m.vec = hashingEmbed(m.kind === 'node' ? m.text : `${m.text} · ${m.node}`);
    if (m.kind === 'node') this.nodeVecs.set(m.node, m.vec);
  }

  /**
   * Embed up to `n` memories that have no vector yet and return how many are still pending.
   * When the last one is done the default query is run, so the card's ranking appears.
   */
  warm(n = Infinity): number {
    let done = 0;
    let pending = 0;
    for (const m of this.mems) {
      if (m.vec) continue;
      if (done < n) {
        this.embed(m);
        done++;
      } else pending++;
    }
    if (pending === 0 && !this.primed) {
      this.primed = true;
      this.setQuery(this.input?.value || DEFAULT_QUERY, true);
    }
    return pending;
  }

  private ensureReady(): void {
    this.primed = true;
    this.warm();
  }

  // ---------- model ----------

  private weightOf(m: Mem, age: number): number {
    if (m.kind === 'node') return 1;
    const k = STABILITY[m.kind];
    return makeDecay(this.kind, PARAM[this.kind] * k, RAMP * k)(age);
  }

  /** Embed the query and measure every memory on the reference shell (direction only). */
  setQuery(text: string, silent = false): void {
    this.ensureReady();
    this.queryText = text.trim();
    this.qvec = this.queryText ? hashingEmbed(this.queryText) : null;
    if (this.qvec && this.qvec.every((x) => x === 0)) this.qvec = null;
    for (const m of this.mems) m.d = this.qvec && m.vec ? shellDistance(this.qvec, m.vec, SHELL_RHO, ball) : 0;
    this.update();
    if (!silent && this.status) {
      this.status.textContent = this.qvec
        ? `query embedded (256-d, hashing) · shell ρ = ${SHELL_RHO.toFixed(1)} · ${this.mems.length} memories scored`
        : 'type a query to rank the memories';
    }
  }

  private update(): void {
    for (const m of this.mems) {
      m.w = this.weightOf(m, (m.age ?? 0) + this.now);
      m.score = this.qvec ? weightedScore(m.d, m.w, 1) : 0;
    }
    this.top = this.qvec
      ? this.mems
          .map((_, i) => i)
          .sort((a, b) => this.mems[b].score - this.mems[a].score || a - b)
          .slice(0, TOP)
      : [];
    if (this.elNow) this.elNow.textContent = `${this.now % 1 === 0 ? this.now : this.now.toFixed(1)} d`;
    setFig('time-kind', this.kind);
    setFig('time-t', String(Math.round(this.now)));
    setFig('time-top', this.top.length ? this.mems[this.top[0]].node : '—');
    this.updateChart();
    this.updateRank();
    this.mgr.requestRender();
  }

  /** Embed a new note, attach it under the node whose name it matches best, place it one step beyond, rank it. */
  private addNote(): void {
    const text = (this.noteText?.value ?? '').trim();
    const age = Math.max(0, Number(this.noteAge?.value ?? 0) || 0);
    if (!text) {
      if (this.noteStatus) this.noteStatus.textContent = 'write a note first';
      return;
    }
    this.ensureReady();
    const vec = hashingEmbed(text);
    const lower = text.toLowerCase();
    let bestId = '';
    let bestS = -Infinity;
    for (const [id, nv] of this.nodeVecs) {
      let s = cosine(vec, nv);
      const l = id.toLowerCase();
      if (lower.includes(l)) s += 0.5;
      else if (l.includes(lower)) s += 0.25;
      if (s > bestS) {
        bestS = s;
        bestId = id;
      }
    }
    const node = this.byId.get(bestId)!;
    const parentPos = node.parent ? this.byId.get(node.parent)!.pos : null;
    // Successive notes under the same node fan out so they never stack.
    const offset = ((this.addedCount % 5) - 2) * 0.45;
    this.addedCount++;
    const pos = placeBeyond(node.pos, parentPos, TAU3, { ball, angleOffset: offset });
    const m: Mem = {
      kind: 'note',
      node: bestId,
      text,
      age,
      pos,
      nodePos: node.pos,
      vec: hashingEmbed(`${text} · ${bestId}`),
      w: 1,
      d: this.qvec ? 0 : 0,
      score: 0,
      dot: -1,
      added: true,
    };
    m.d = this.qvec && m.vec ? shellDistance(this.qvec, m.vec, SHELL_RHO, ball) : 0;
    this.mems.push(m);
    this.addDot(m);
    if (this.noteStatus) {
      this.noteStatus.textContent = `attached under ${bestId} (depth ${node.depth}), placed one step beyond at depth ${node.depth + 1}, ${age} d old · now ranked`;
    }
    if (this.noteText) this.noteText.value = '';
    this.update();
  }

  // ---------- SVG chart in the card ----------

  private xOf(age: number): number {
    return 36 + Math.min(1, age / 100) * 412;
  }
  private yOf(w: number): number {
    return 12 + (1 - w) * 126;
  }

  private svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    this.chart!.appendChild(e);
    return e;
  }

  private addDot(m: Mem): void {
    if (!this.chart || m.age === null) return;
    const c = this.svgEl('circle', { class: 'dot', r: 3.5, cx: 0, cy: 0 }) as SVGCircleElement;
    m.dot = this.dots.length;
    this.dots.push(c);
  }

  private buildChart(): void {
    const svg = this.chart;
    if (!svg) return;
    this.svgEl('line', { class: 'axis', x1: 36, y1: 138, x2: 448, y2: 138 });
    this.svgEl('line', { class: 'axis', x1: 36, y1: 12, x2: 36, y2: 138 });
    for (const [v, t] of [
      [1, '1'],
      [0.5, '½'],
      [0, '0'],
    ] as const) {
      const te = this.svgEl('text', { x: 30, y: this.yOf(v) + 3.5, 'text-anchor': 'end' });
      te.textContent = t;
    }
    for (const d of [0, 25, 50, 75, 100]) {
      const te = this.svgEl('text', { x: this.xOf(d), y: 156, 'text-anchor': 'middle' });
      te.textContent = `${d} d`;
    }
    const kinds: DecayKind[] = ['half-life', 'ebbinghaus', 'window'];
    for (const kind of kinds) {
      const f = makeDecay(kind, PARAM[kind], RAMP);
      let d = '';
      for (let age = 0; age <= 100; age += 1) d += `${age === 0 ? 'M' : 'L'}${this.xOf(age).toFixed(1)},${this.yOf(f(age)).toFixed(1)}`;
      const p = this.svgEl('path', { class: 'curve', d }) as SVGPathElement;
      this.curves.set(kind, p);
    }
    for (const m of this.mems) this.addDot(m);
  }

  private updateChart(): void {
    if (!this.chart) return;
    for (const [kind, p] of this.curves) p.classList.toggle('on', kind === this.kind);
    for (const m of this.mems) {
      if (m.dot < 0 || m.age === null) continue;
      const c = this.dots[m.dot];
      c.setAttribute('cx', this.xOf(m.age + this.now).toFixed(1));
      c.setAttribute('cy', this.yOf(m.w).toFixed(1));
      c.setAttribute('opacity', (0.35 + 0.65 * m.w).toFixed(2));
      c.setAttribute('fill', m.kind === 'fact' ? C.brass : C.teal);
    }
  }

  // ---------- ranked list (FLIP) ----------

  private updateRank(): void {
    const ol = this.rankEl;
    if (!ol) return;
    const order = this.top.map((i) => this.mems[i]);
    const before = new Map<Mem, number>();
    for (const [m, li] of this.rankItems) before.set(m, li.getBoundingClientRect().top);
    const keep = new Set(order);
    for (const [m, li] of this.rankItems) {
      if (!keep.has(m)) {
        li.remove();
        this.rankItems.delete(m);
      }
    }
    order.forEach((m, rank) => {
      let li = this.rankItems.get(m);
      if (!li) {
        li = document.createElement('li');
        li.innerHTML = `<span class="n"></span><span class="t"></span><span class="s"></span>`;
        li.querySelector('.t')!.textContent = m.kind === 'node' ? `${m.text} (node)` : m.added ? `${m.text} (added · ${m.node})` : m.text;
        this.rankItems.set(m, li);
      }
      li.querySelector('.n')!.textContent = String(rank + 1);
      const age = m.age === null ? 'undated' : `${Math.round(m.age + this.now)} d`;
      li.querySelector('.s')!.textContent = `score ${m.score.toFixed(3)} · d ${m.d.toFixed(2)} · ${age} · w ${m.w.toFixed(2)}`;
      li.classList.toggle('fading', m.w < 0.35);
      ol.appendChild(li);
    });
    if (!canAnimate()) return;
    for (const [m, li] of this.rankItems) {
      const prev = before.get(m);
      if (prev === undefined) {
        gsap.fromTo(li, { opacity: 0 }, { opacity: 1, duration: 0.4, overwrite: true });
        continue;
      }
      const dy = prev - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5) gsap.fromTo(li, { y: dy }, { y: 0, duration: 0.45, ease: 'power2.out', overwrite: true });
    }
  }

  // ---------- scroll timeline ----------

  private applyZoom(): void {
    const t = this.s.zoom;
    if (t <= 0) {
      this.mgr.world.cam = Camera.identity();
      return;
    }
    const g = ball.geodesic(ORIGIN, this.zoomTarget, 0.8 * t);
    this.mgr.world.cam = Camera.toOrigin([g[0], g[1]]);
  }

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    tl.to(this.s, { mem: 1, duration: 0.6, ease: 'power2.out', onUpdate: render }, 0.1);
    tl.to(this.s, { zoom: 1, duration: 0.75, ease: 'power2.inOut', onUpdate: () => (this.applyZoom(), render()) }, 0.25);
    tl.to(this.s, { query: 1, duration: 0.5, ease: 'power2.out', onUpdate: render }, 1.45);
  }

  // ---------- drawing ----------

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, world: World): void {
    const cam = world.cam;
    const a = this.presence;
    const small = vp.narrow;
    ctx.save();
    ctx.globalAlpha = a;

    const disp = new Map<string, Vec2>();
    for (const n of this.nodes) disp.set(n.id, cam.apply(n.pos));

    // The anatomy tree, quiet.
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = rgba(C.fog, 0.16);
    for (const n of this.nodes) {
      if (!n.parent) continue;
      drawGeodesic(ctx, vp, disp.get(n.parent)!, disp.get(n.id)!);
    }
    for (const n of this.nodes) {
      const p = disp.get(n.id)!;
      const q = toPx(vp, p);
      const size = 1.8 + 4.5 * (1 - normSq2(p));
      drawDot(ctx, q[0], q[1], size, depthColor(n.depth, this.maxDepth, 0.85));
      const inFocus = 1 - normSq2(p) > 0.6;
      if (n.depth <= 1 || inFocus) {
        label(ctx, n.id, q[0] + size + 5, q[1] - 2, { color: n.depth <= 1 ? C.fog : C.mist, size: n.depth <= 1 ? (small ? 11 : 12) : small ? 10 : 11, alpha: 0.75 });
      }
    }

    // Dated memories: opacity by weight, tether to the node, age label.
    const memA = this.s.mem;
    if (memA > 0) {
      for (const m of this.mems) {
        if (m.kind === 'node') continue;
        const p = cam.apply(m.pos);
        const q = toPx(vp, p);
        const np = toPx(vp, cam.apply(m.nodePos));
        const vis = memA * (0.22 + 0.78 * m.w);
        const col = m.kind === 'fact' ? C.brass : C.teal;
        ctx.save();
        ctx.globalAlpha *= vis;
        ctx.setLineDash([2, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(col, 0.6);
        ctx.beginPath();
        ctx.moveTo(np[0], np[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        const r = (2.5 + 3.5 * m.w) * (1 - 0.5 * normSq2(p));
        glow(ctx, q[0], q[1], r * 3.2, col, 0.35 * m.w);
        drawDot(ctx, q[0], q[1], r, col, m.added ? C.fog : undefined, 1);
        if (1 - normSq2(p) > 0.45) {
          label(ctx, `${Math.round((m.age ?? 0) + this.now)} d`, q[0] + r + 4, q[1] + 1, { color: col, size: 10, font: 'mono' });
        }
        ctx.restore();
      }
    }

    // The query: a marker on the reference shell at the angle of the top match, links and rank badges.
    if (this.s.query > 0 && this.top.length) {
      const topMem = this.mems[this.top[0]];
      const ang = Math.atan2(topMem.pos[1], topMem.pos[0]);
      const shellPt = ball.pointAt([Math.cos(ang), Math.sin(ang)], SHELL_RHO);
      const p = cam.apply([shellPt[0], shellPt[1]]);
      const q = toPx(vp, p);
      ctx.save();
      ctx.globalAlpha *= this.s.query;
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = rgba(C.brass, 0.45);
      ctx.lineWidth = 1;
      for (const i of this.top.slice(0, 3)) {
        const mp = toPx(vp, cam.apply(this.mems[i].pos));
        ctx.beginPath();
        ctx.moveTo(q[0], q[1]);
        ctx.lineTo(mp[0], mp[1]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      glow(ctx, q[0], q[1], 30, C.brass, 0.45);
      ctx.fillStyle = C.brass;
      ctx.strokeStyle = rgba(C.ink, 0.8);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(q[0], q[1] - 8);
      ctx.lineTo(q[0] + 8, q[1]);
      ctx.lineTo(q[0], q[1] + 8);
      ctx.lineTo(q[0] - 8, q[1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      label(ctx, `query · shell ρ = ${SHELL_RHO.toFixed(1)}`, q[0] + 12, q[1] - 10, { color: C.brass, size: small ? 10 : 11, font: 'mono' });
      this.top.forEach((i, rank) => {
        const m = this.mems[i];
        const mp = toPx(vp, cam.apply(m.pos));
        const col = m.kind === 'node' ? C.fog : m.kind === 'fact' ? C.brass : C.teal;
        ctx.beginPath();
        ctx.arc(mp[0], mp[1], 7, 0, Math.PI * 2);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        // Badges fan out by rank so that neighbouring memories never stack their numbers.
        const ba = -Math.PI * 0.75 + rank * (Math.PI * 2) / 5;
        badge(ctx, mp[0] + 13 * Math.cos(ba), mp[1] + 13 * Math.sin(ba), String(rank + 1), C.brass, C.ink, small ? 6 : 7);
      });
      ctx.restore();
    }
    ctx.restore();
  }
}
