import type { Vec2 } from 'poincare-ball';
import type { gsap } from 'gsap';
import { Camera } from '../lib/camera';
import { canAnimate } from '../lib/motion';
import { fromPx, drawDiskBoundary, lerp, type Viewport } from '../lib/draw';

export interface PointerInfo {
  /** Position in disk coordinates (through the current placement, before the camera). */
  p: Vec2;
  px: number;
  py: number;
  pointerType: string;
}

/** Disk placements: where the disk sits while a chapter is primary. */
export type LayoutName = 'hero' | 'main' | 'split' | 'mini' | 'emblem';

/** Height of the mobile top bar (chapter progress + pause control), in CSS px. */
export const BAR_H = 44;
/** Fraction of the (small) viewport height, below the bar, that the drawing band occupies on narrow screens. */
const BAND = 0.52;

export interface Scene {
  readonly id: string;
  /** Disk placement while this scene is the primary one. */
  readonly layout: LayoutName;
  /** 0..1, tweened by the hand-offs between chapters. */
  presence: number;
  /** True if the scene drags things and needs `touch-action: none` while primary. */
  readonly touchNone?: boolean;
  /** True if the scene needs continuous frames (ambient motion, particles) while visible. */
  readonly loop?: boolean;
  /** Frame rate of the continuous loop while this scene is visible (default 60); slow ambient motion needs less. */
  readonly loopFps?: number;
  /** Alpha of the disk rim while this scene is primary; undefined = left to the scene's own timeline. */
  readonly diskAlpha?: number;
  /** Add tweens to the scroll-scrubbed timeline; time runs from 0 to steps − 1. */
  build(tl: gsap.core.Timeline, steps: number): void;
  /** Called whenever the active text step of this chapter changes (both motion modes). */
  setStep?(k: number): void;
  draw(ctx: CanvasRenderingContext2D, vp: Viewport, world: World, dt: number): void;
  onPointerDown?(e: PointerInfo): boolean;
  onPointerMove?(e: PointerInfo, dragging: boolean): void;
  onPointerUp?(e: PointerInfo): void;
  onPointerLeave?(): void;
}

export interface World {
  /** Hyperbolic camera shared by the disk scenes. */
  cam: Camera;
  /** Alpha of the disk rim and lens. */
  disk: { alpha: number };
  /**
   * Continuous position along the page's scene order (0 = hero, 1 = first chapter, …).
   * The disk placement is interpolated between the placements of the two scenes it lies
   * between, so a hand-off never detours through a third placement.
   */
  L: number;
  /** Seconds since start (only advances while a loop is running). */
  time: number;
  pointer: { x: number; y: number; on: boolean };
}

interface Placement {
  cx: number;
  cy: number;
  R: number;
}

/**
 * One fixed full-viewport canvas, one renderer, many scenes drawn together with their
 * presence alpha so that chapters crossfade inside the same world. Frames are drawn
 * when requested; a continuous loop runs only while a scene that needs one is visible
 * and the document is visible.
 */
export class SceneManager {
  readonly canvas: HTMLCanvasElement;
  readonly scenes: Scene[] = [];
  readonly world: World = {
    cam: Camera.identity(),
    disk: { alpha: 0 },
    L: 0,
    time: 0,
    pointer: { x: -1e4, y: -1e4, on: false },
  };
  vp: Viewport;
  onResize: ((vp: Viewport) => void) | null = null;
  /** Scenes drawn before the disk rim (the hero tiling) by id. */
  readonly underDisk = new Set<string>();

  private ctx: CanvasRenderingContext2D;
  private placements: Record<LayoutName, Placement>;
  private order: LayoutName[] = ['hero'];
  private orderIds: string[] = ['hero'];
  private dirty = false;
  private raf = 0;
  private looping = false;
  private lastT = 0;
  private lastDraw = 0;
  private dragging = false;
  private primaryId: string | null = null;
  private suspended = false;
  private lastW = 0;
  private lastH = 0;
  private narrowQuery = window.matchMedia('(max-width: 819px) and (orientation: portrait)');

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2-D canvas context unavailable');
    this.ctx = ctx;
    const z = { cx: 0, cy: 0, R: 1 };
    this.placements = { hero: z, main: z, split: z, mini: z, emblem: z };
    this.vp = { w: 1, h: 1, dpr: 1, cx: 0, cy: 0, R: 1, stage: { x: 0, y: 0, w: 1, h: 1 }, alt: { cx: 0, cy: 0, R: 1 }, narrow: false };
    window.addEventListener('resize', () => this.layout(false));
    window.addEventListener('orientationchange', () => this.layout(true));
    this.narrowQuery.addEventListener('change', () => this.layout(true));
    document.addEventListener('visibilitychange', () => this.maybeLoop());
    this.layout(true);
    this.bindPointer();
  }

  register(scene: Scene): void {
    this.scenes.push(scene);
  }

  /** The page order of the scenes (hero first); defines what `world.L` indexes. */
  setOrder(scenes: Scene[]): void {
    this.order = scenes.map((s) => s.layout);
    this.orderIds = scenes.map((s) => s.id);
    this.placeDisk();
  }

  /** Bottom edge of the drawing band (narrow screens) or of the viewport, in CSS px: the CSS --stage-h value. */
  get stageBottom(): number {
    return this.vp.stage.y + this.vp.stage.h;
  }

  /** Position of a scene in the page order (the value of `world.L` while it is primary). */
  indexOf(id: string): number {
    const i = this.orderIds.indexOf(id);
    return i < 0 ? 0 : i;
  }

  get(id: string): Scene | undefined {
    return this.scenes.find((s) => s.id === id);
  }

  /** The scene that receives pointer events and sets the cursor. */
  setPrimary(id: string | null): void {
    if (id === this.primaryId) return;
    this.primaryId = id;
    const s = id ? this.get(id) : undefined;
    this.canvas.style.touchAction = s?.touchNone ? 'none' : 'pan-y';
    this.canvas.style.cursor = 'default';
    this.requestRender();
  }

  get primary(): Scene | null {
    return this.primaryId ? this.get(this.primaryId) ?? null : null;
  }

  setCursor(cursor: string): void {
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  requestRender(): void {
    this.dirty = true;
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Hold the continuous loop (ambient motion) while start-up work runs, so frames and mount slices never share a task. */
  suspendLoop(on: boolean): void {
    this.suspended = on;
    this.maybeLoop();
  }

  /** Start or stop the continuous loop depending on what is visible. */
  maybeLoop(): void {
    const want = !this.suspended && document.visibilityState === 'visible' && canAnimate() && this.scenes.some((s) => s.loop && s.presence > 0.01);
    if (want && !this.looping) {
      this.looping = true;
      this.lastT = performance.now();
      this.requestRender();
    } else if (!want && this.looping) {
      this.looping = false;
      this.requestRender();
    }
  }

  /** The frame rate the visible looping scenes ask for (the fastest wins during a crossfade). */
  private loopFps(): number {
    let fps = 0;
    for (const s of this.scenes) if (s.loop && s.presence > 0.01) fps = Math.max(fps, s.loopFps ?? 60);
    return fps || 60;
  }

  private frame(now: number): void {
    this.raf = 0;
    if (this.looping && !this.dirty && now - this.lastDraw < 1000 / this.loopFps() - 2) {
      // Ambient frames only: wait for the next vsync; anything explicitly requested is drawn at once.
      this.raf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    const dt = this.looping ? Math.min(0.05, (now - this.lastT) / 1000) : 0;
    this.lastT = now;
    if (this.looping) this.world.time += dt;
    if (!this.dirty && !this.looping) return;
    this.dirty = false;
    this.lastDraw = now;
    this.placeDisk();
    const { ctx, vp, world } = this;
    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
    ctx.clearRect(0, 0, vp.w, vp.h);
    for (const s of this.scenes) {
      if (s.presence > 0.004 && this.underDisk.has(s.id)) s.draw(ctx, vp, world, dt);
    }
    drawDiskBoundary(ctx, vp, world.disk.alpha);
    for (const s of this.scenes) {
      if (s.presence > 0.004 && !this.underDisk.has(s.id)) s.draw(ctx, vp, world, dt);
    }
    if (this.looping) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Interpolate the disk placement between the two scenes `world.L` lies between. */
  private placeDisk(): void {
    const last = this.order.length - 1;
    const L = Math.max(0, Math.min(last, this.world.L));
    const k = Math.min(Math.floor(L), Math.max(0, last - 1));
    const f = last === 0 ? 0 : L - k;
    const a = this.placements[this.order[k]];
    const b = this.placements[this.order[Math.min(k + 1, last)]];
    const e = f * f * (3 - 2 * f);
    this.vp.cx = lerp(a.cx, b.cx, e);
    this.vp.cy = lerp(a.cy, b.cy, e);
    this.vp.R = lerp(a.R, b.R, e);
  }

  /** The smallest viewport height (100svh) on narrow screens, so the mobile URL bar never resizes the stage. */
  private viewportHeight(narrow: boolean): number {
    if (narrow) {
      const probe = document.getElementById('svh-probe');
      const h = probe?.getBoundingClientRect().height ?? 0;
      if (h > 0) return h;
    }
    return window.innerHeight;
  }

  /**
   * Size the canvas from the viewport (never the CSS vh unit), compute the stage rectangle
   * (desktop: between the text column and the rail; narrow portrait: the band below the
   * top bar) and the disk placements. The stylesheet derives the same numbers (--vhpx, --bar-h,
   * --stage-h) from 100svh, so nothing is written back to the DOM here and the page never
   * relayouts for it; `stageBottom` is the resolved value for scripts that need it.
   */
  private layout(force: boolean): void {
    const narrow = this.narrowQuery.matches;
    const w = window.innerWidth;
    const h = this.viewportHeight(narrow);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    if (!force && w === this.lastW && coarse && Math.abs(h - this.lastH) < 160) return;
    this.lastW = w;
    this.lastH = h;

    const bar = narrow ? BAR_H : 0;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    let stage: Viewport['stage'];
    if (narrow) {
      stage = { x: 0, y: bar, w, h: (h - bar) * BAND };
    } else {
      const colW = Math.min(0.44 * w, 520) + Math.min(0.04 * w, 64) + 16;
      // The chapter rail on the right: numerals only below 1100 px, numerals plus the current title above.
      const railW = w >= 1100 ? 136 : 96;
      stage = { x: colW, y: 0, w: w - colW - railW, h };
    }
    const sx = stage.x + stage.w / 2;
    const sy = stage.y + stage.h / 2;
    const mainR = Math.max(40, Math.min(stage.w, stage.h) / 2 - (narrow ? 22 : 56));
    let split: Placement;
    let alt: Placement;
    if (narrow) {
      // Stacked: the Euclidean picture above, the disk below, both inside the band.
      const R = Math.max(30, Math.min(stage.w * 0.3, stage.h * 0.225));
      alt = { cx: sx, cy: stage.y + stage.h * 0.27, R };
      split = { cx: sx, cy: stage.y + stage.h * 0.76, R };
    } else {
      const R = Math.max(40, Math.min(stage.w * 0.235, stage.h * 0.36));
      alt = { cx: stage.x + stage.w * 0.26, cy: sy, R };
      split = { cx: stage.x + stage.w * 0.74, cy: sy, R };
    }
    this.placements = {
      hero: narrow ? { cx: sx, cy: sy, R: mainR + 4 } : { cx: w * 0.66, cy: h * 0.5, R: Math.min(h * 0.47, w * 0.3) },
      main: { cx: sx, cy: sy, R: mainR },
      split,
      mini: narrow
        ? { cx: stage.x + stage.w * 0.17, cy: stage.y + stage.h * 0.78, R: Math.min(stage.w, stage.h) * 0.1 }
        : { cx: stage.x + stage.w * 0.13, cy: stage.y + stage.h * 0.8, R: Math.min(stage.w, stage.h) * 0.1 },
      emblem: narrow
        ? { cx: sx, cy: stage.y + stage.h * 0.5, R: Math.min(stage.w, stage.h) * 0.3 }
        : { cx: stage.x + stage.w * 0.5, cy: stage.y + stage.h * 0.46, R: Math.min(stage.w, stage.h) * 0.26 },
    };
    this.vp = { w, h, dpr, cx: sx, cy: sy, R: mainR, stage, alt, narrow };
    this.placeDisk();
    this.onResize?.(this.vp);
    this.requestRender();
  }

  private info(e: PointerEvent): PointerInfo {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { p: fromPx(this.vp, px, py), px, py, pointerType: e.pointerType };
  }

  private bindPointer(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      const s = this.primary;
      if (!s?.onPointerDown) return;
      const started = s.onPointerDown(this.info(e));
      if (started) {
        this.dragging = true;
        c.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    });
    c.addEventListener('pointermove', (e) => {
      const i = this.info(e);
      this.world.pointer = { x: i.px, y: i.py, on: true };
      this.primary?.onPointerMove?.(i, this.dragging);
      this.requestRender();
    });
    const end = (e: PointerEvent) => {
      if (this.dragging) {
        this.dragging = false;
        this.primary?.onPointerUp?.(this.info(e));
        if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      this.world.pointer.on = false;
      if (!this.dragging) this.primary?.onPointerLeave?.();
      this.requestRender();
    });
  }
}
