import { gsap } from 'gsap';
import { canAnimate } from './motion';

export interface TweenOpts {
  duration?: number;
  ease?: string;
  delay?: number;
  onUpdate?: () => void;
  onComplete?: () => void;
}

/** Tween numeric properties of `target`, or set them instantly when animation is off. */
export function animateTo<T extends object>(target: T, props: Partial<T>, opts: TweenOpts = {}): gsap.core.Tween | null {
  if (!canAnimate()) {
    Object.assign(target, props);
    opts.onUpdate?.();
    opts.onComplete?.();
    return null;
  }
  return gsap.to(target, {
    ...(props as gsap.TweenVars),
    duration: opts.duration ?? 1,
    ease: opts.ease ?? 'power2.inOut',
    delay: opts.delay ?? 0,
    overwrite: 'auto',
    onUpdate: opts.onUpdate,
    onComplete: opts.onComplete,
  });
}

/**
 * A number shown in the DOM that ticks from its current value to a new one (0.45 s) when
 * animation is allowed, or jumps when it is not or when `immediate` is set (e.g. while dragging).
 */
export class Ticker {
  private v = NaN;
  private tween: gsap.core.Tween | null = null;
  private readonly el: HTMLElement | null;
  constructor(el: HTMLElement | null, private fmt: (v: number) => string = (v) => v.toFixed(3)) {
    this.el = el;
  }
  set(value: number, immediate = false): void {
    if (!this.el) return;
    if (!Number.isFinite(value)) return;
    this.tween?.kill();
    this.tween = null;
    if (immediate || !canAnimate() || !Number.isFinite(this.v) || Math.abs(value - this.v) < 1e-9) {
      this.v = value;
      this.el.textContent = this.fmt(value);
      return;
    }
    const proxy = { v: this.v };
    this.tween = gsap.to(proxy, {
      v: value,
      duration: 0.45,
      ease: 'power2.out',
      onUpdate: () => {
        this.v = proxy.v;
        this.el!.textContent = this.fmt(proxy.v);
      },
      onComplete: () => {
        this.v = value;
        this.el!.textContent = this.fmt(value);
      },
    });
  }
}
