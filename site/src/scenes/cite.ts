import type { gsap } from 'gsap';
import { regularTiling } from 'poincare-ball';
import { Camera } from '../lib/camera';
import { C, pathGeodesic, drawHyperbolicCircle, depthRamp, rgba, type Viewport } from '../lib/draw';
import type { Scene, SceneManager, World } from './manager';

/**
 * Chapter 09: the disk settles into an emblem, the {7,3} tiling the page opened with,
 * with the depth rings of the memory inside it. Tiles are batched by depth.
 */
export class CiteScene implements Scene {
  readonly id = 'cite';
  readonly layout = 'emblem';
  readonly diskAlpha = 1;
  presence = 0;
  private tiles = regularTiling(7, 3, 4, { angle: Math.PI / 14 });
  private maxDepth = Math.max(...this.tiles.map((t) => t.depth));
  private s = { rot: 0, rings: 0 };

  constructor(private mgr: SceneManager) {}

  build(tl: gsap.core.Timeline): void {
    const render = () => this.mgr.requestRender();
    tl.to(this.s, { rot: 0.5, duration: 2, ease: 'none', onUpdate: render }, 0);
    tl.to(this.s, { rings: 1, duration: 0.6, ease: 'power2.out', onUpdate: render }, 0.2);
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport, _world: World): void {
    const a = this.presence;
    const cam = Camera.rotation(this.s.rot);
    ctx.save();
    ctx.globalAlpha = a;
    // No clip: the depth-4 tiling lies inside the disk. Tiles are batched by depth (232 tiles, small paths).
    const byDepth: Path2D[] = [];
    for (const tile of this.tiles) {
      const path = (byDepth[tile.depth] ??= new Path2D());
      const vs = tile.vertices.map((v) => cam.apply(v));
      for (let i = 0; i < vs.length; i++) pathGeodesic(path, vp, vs[i], vs[(i + 1) % vs.length]);
      path.closePath();
    }
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = rgba(C.brass, 0.4);
    byDepth.forEach((path, depth) => {
      ctx.fillStyle = depthRamp(1 - depth / Math.max(1, this.maxDepth), 0.07);
      ctx.fill(path);
      ctx.stroke(path);
    });
    if (this.s.rings > 0) {
      ctx.globalAlpha = a * this.s.rings;
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(C.teal, 0.6);
      for (let r = 1; r <= 3; r++) drawHyperbolicCircle(ctx, vp, r);
    }
    ctx.restore();
  }
}
