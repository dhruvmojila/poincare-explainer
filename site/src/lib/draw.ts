import { PoincareBall, geodesicArc, type Vec2 } from 'poincare-ball';

/** Observatory tokens (mirrors style.css). */
export const C = {
  ink: '#07090f',
  deep: '#0e1320',
  panel: '#151c2b',
  line: '#243049',
  mist: '#aeb7c7',
  fog: '#e6eaf2',
  brass: '#d8a657',
  teal: '#3dd6c1',
  amber: '#e8873a',
} as const;

export const FONT = {
  body: "'Inter Tight', ui-sans-serif, system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, monospace",
  display: "'Fraunces', Georgia, serif",
} as const;

/** Canvas viewport: pixel size, the stage rectangle and the current disk placement. */
export interface Viewport {
  w: number;
  h: number;
  dpr: number;
  /** Disk centre and radius in CSS px (tweened between layouts). */
  cx: number;
  cy: number;
  R: number;
  /** The drawing region: beside the text column on wide screens, the band below the top bar on narrow ones. */
  stage: { x: number; y: number; w: number; h: number };
  /** The second panel of the split layout (the Euclidean picture of chapter 02). */
  alt: { cx: number; cy: number; R: number };
  /** Narrow portrait screens: the stage is a band at the top and the cards scroll over it. */
  narrow: boolean;
}

/** The unit disk (curvature -1), exactly the paper's B^n with n = 2. */
export const ball = new PoincareBall(1);
export const ORIGIN: Vec2 = [0, 0];

export function toPx(vp: Viewport, p: Vec2): Vec2 {
  return [vp.cx + p[0] * vp.R, vp.cy - p[1] * vp.R];
}
export function fromPx(vp: Viewport, x: number, y: number): Vec2 {
  return [(x - vp.cx) / vp.R, -(y - vp.cy) / vp.R];
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function lerp2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
export function clampNorm(p: Vec2, max: number): Vec2 {
  const n = Math.hypot(p[0], p[1]);
  return n > max ? [(p[0] / n) * max, (p[1] / n) * max] : [p[0], p[1]];
}
export function normSq2(p: Vec2): number {
  return p[0] * p[0] + p[1] * p[1];
}
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
/** Linear ramp of `x` from `a` to `b`, clamped to [0, 1]. */
export const ramp = (x: number, a: number, b: number): number => clamp01((x - a) / (b - a));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbCache = new Map<string, [number, number, number]>();
export function rgba(hex: string, a: number): string {
  let c = rgbCache.get(hex);
  if (!c) {
    c = hexToRgb(hex);
    rgbCache.set(hex, c);
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}

/** Depth ramp: teal (shallow) through sage to brass (deep). 65 precomputed stops. */
const RAMP_STOPS: Array<[number, number, number]> = [hexToRgb(C.teal), hexToRgb('#8fcf99'), hexToRgb('#c9b96a'), hexToRgb(C.brass)];
const RAMP: Array<[number, number, number]> = Array.from({ length: 65 }, (_, i) => {
  const t = (i / 64) * (RAMP_STOPS.length - 1);
  const k = Math.min(Math.floor(t), RAMP_STOPS.length - 2);
  const f = t - k;
  const a = RAMP_STOPS[k];
  const b = RAMP_STOPS[k + 1];
  return [Math.round(lerp(a[0], b[0], f)), Math.round(lerp(a[1], b[1], f)), Math.round(lerp(a[2], b[2], f))];
});
export function depthRamp(t: number, alpha = 1): string {
  const c = RAMP[Math.round(clamp01(t) * 64)];
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
export function depthColor(depth: number, maxDepth: number, alpha = 1): string {
  return depthRamp(maxDepth <= 0 ? 0.5 : depth / maxDepth, alpha);
}

/** The disk as a lens: faint radial fill, a glowing rim. */
export function drawDiskBoundary(ctx: CanvasRenderingContext2D, vp: Viewport, alpha = 1): void {
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(vp.cx, vp.cy, vp.R * 0.2, vp.cx, vp.cy, vp.R);
  g.addColorStop(0, 'rgba(61,214,193,0.035)');
  g.addColorStop(0.75, 'rgba(61,214,193,0.012)');
  g.addColorStop(1, 'rgba(216,166,87,0.07)');
  ctx.beginPath();
  ctx.arc(vp.cx, vp.cy, vp.R, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = rgba(C.fog, 0.42);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = rgba(C.brass, 0.06);
  ctx.stroke();
  ctx.restore();
}

/** Hyperbolic circle centred at the origin with hyperbolic radius r (Euclidean radius tanh(r/2)). */
export function drawHyperbolicCircle(ctx: CanvasRenderingContext2D, vp: Viewport, r: number): void {
  ctx.beginPath();
  ctx.arc(vp.cx, vp.cy, Math.tanh(r / 2) * vp.R, 0, Math.PI * 2);
  ctx.stroke();
}

/** Add the geodesic between two disk points to a path (a context or a Path2D); nothing is stroked. */
export function pathGeodesic(ctx: CanvasPath, vp: Viewport, a: Vec2, b: Vec2): void {
  const g = geodesicArc(a, b, ball);
  if (g.kind === 'segment') {
    const p = toPx(vp, g.from);
    const q = toPx(vp, g.to);
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(q[0], q[1]);
  } else {
    const c = toPx(vp, g.center);
    // Canvas y points down, so angles flip sign and the sweep direction flips.
    ctx.arc(c[0], c[1], g.radius * vp.R, -g.startAngle, -g.endAngle, !g.anticlockwise);
  }
}

/** Stroke the geodesic between two disk points. The caller sets strokeStyle / lineWidth. */
export function drawGeodesic(ctx: CanvasRenderingContext2D, vp: Viewport, a: Vec2, b: Vec2): void {
  ctx.beginPath();
  pathGeodesic(ctx, vp, a, b);
  ctx.stroke();
}

export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string, lw = 1.5): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

/** Soft glow: a radial gradient disc. */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number): void {
  if (alpha <= 0.003 || r <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export interface LabelOpts {
  align?: CanvasTextAlign;
  color?: string;
  size?: number;
  weight?: string;
  baseline?: CanvasTextBaseline;
  font?: 'body' | 'mono' | 'display';
  alpha?: number;
  italic?: boolean;
}
export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: LabelOpts = {}): void {
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.font = `${o.italic ? 'italic ' : ''}${o.weight ?? '500'} ${o.size ?? 12}px ${FONT[o.font ?? 'body']}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'middle';
  ctx.fillStyle = o.color ?? rgba(C.fog, 0.9);
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** A small numbered badge (rank markers on the disk). */
export function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string = C.brass, color: string = C.ink, r = 7): void {
  drawDot(ctx, x, y, r, fill, rgba(C.ink, 0.85), 1);
  label(ctx, text, x, y + 0.5, { align: 'center', color, size: r * 1.35, weight: '600', font: 'mono' });
}

/** A label on a dark backing so it stays legible over drawings. */
export function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: LabelOpts & { pad?: number } = {}): void {
  const size = o.size ?? 11;
  ctx.save();
  ctx.font = `${o.weight ?? '500'} ${size}px ${FONT[o.font ?? 'body']}`;
  const w = ctx.measureText(text).width;
  const pad = o.pad ?? 4;
  const align = o.align ?? 'left';
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  roundRect(ctx, x0 - pad, y - size * 0.72, w + 2 * pad, size * 1.45, 3);
  ctx.fillStyle = rgba(C.ink, 0.82);
  ctx.fill();
  ctx.restore();
  label(ctx, text, x, y, o);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Cubic Bézier point for ribbons. */
export function bez(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
