import { gsap, ScrollTrigger } from './lib/gsap-setup';
import type { SceneManager, Scene } from './scenes/manager';
import type { HeroScene } from './scenes/hero';
import { FlatScene, TAU1 } from './scenes/flat';
import { CompareScene } from './scenes/compare';
import { GeometryScene } from './scenes/geometry';
import { HierarchyScene } from './scenes/hierarchy';
import { TimeScene } from './scenes/time';
import { ControllerScene } from './scenes/controller';
import { EnsembleScene } from './scenes/ensemble';
import { SynthesisScene } from './scenes/synthesis';
import { CiteScene } from './scenes/cite';
import { Camera, lerpCamera } from './lib/camera';
import { canAnimate, onMotionChange } from './lib/motion';
import { nextIdle } from './lib/idle';

/** User-timing marks per mount phase (visible in a performance trace and in Lighthouse's user timings). */
function phase(name: string): void {
  performance.mark(`mount:${name}`);
}

function fillNumbers(flat: FlatScene, hier: HierarchyScene, cmp: CompareScene): void {
  const set = (sel: string, text: string) =>
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (el.textContent !== text) el.textContent = text;
    });
  set('[data-count="nodes"]', String(flat.nodeCount));
  set('[data-count="leaves"]', String(flat.leafCount));
  set('[data-count="anatomy"]', String(hier.nodeCount));
  set('[data-tau]', TAU1.toFixed(1));
  set('[data-distortion="e"]', cmp.distortionE.toFixed(3));
  set('[data-distortion="h"]', cmp.distortionH.toFixed(3));
  for (let r = 1; r <= 4; r++) {
    set(`[data-circ-e="${r}"]`, (2 * Math.PI * r).toFixed(1));
    set(`[data-circ-h="${r}"]`, (2 * Math.PI * Math.sinh(r)).toFixed(1));
  }
}

function wireCopy(): void {
  const btn = document.getElementById('copy-bib') as HTMLButtonElement | null;
  const pre = document.getElementById('bibtex');
  if (!btn || !pre) return;
  btn.addEventListener('click', async () => {
    const text = pre.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      btn.textContent = 'Select and copy';
    }
    window.setTimeout(() => (btn.textContent = 'Copy BibTeX'), 1600);
  });
}

interface Chapter {
  section: HTMLElement;
  scene: Scene;
  steps: HTMLElement[];
  tl: gsap.core.Timeline;
  railIndex: number;
  title: string;
}

const vh = () => window.innerHeight;
const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Mount the nine chapters on a manager that already draws the hero. The work is split into
 * slices separated by idle periods, so no single task is long on a slow phone, in this order:
 * the scenes and every DOM write they make (numbers, tables, the chart, the memory ranking),
 * then the steps are switched from `content-visibility: auto` to `visible` a few at a time so
 * each slice lays out only a few cards with their final content, then the scroll wiring
 * measures the finished layout once, then the remaining embeddings. The hero's ambient loop is
 * held meanwhile so that its frames never share a task with a mount slice.
 */
export async function mountChapters(mgr: SceneManager, hero: HeroScene): Promise<void> {
  mgr.suspendLoop(true);
  phase('scenes');
  const flat = new FlatScene(mgr);
  const cmp = new CompareScene(mgr);
  const geo = new GeometryScene(mgr);
  const hier = new HierarchyScene(mgr);
  await nextIdle();
  const time = new TimeScene(mgr);
  const ctrl = new ControllerScene(mgr);
  const ens = new EnsembleScene(mgr);
  const syn = new SynthesisScene(mgr);
  const cite = new CiteScene(mgr);
  await nextIdle();

  phase('timelines');
  [flat, cmp, geo, hier, time, ctrl, ens, syn, cite].forEach((s) => mgr.register(s));
  fillNumbers(flat, hier, cmp);
  wireCopy();
  const render = () => mgr.requestRender();

  // ---------- chapters (in page order) and their scroll timelines ----------
  const chapters: Chapter[] = [];
  document.querySelectorAll<HTMLElement>('.chapter[data-scene]').forEach((section, i) => {
    const scene = mgr.get(section.dataset.scene!);
    if (!scene) return;
    const steps = Array.from(section.querySelectorAll<HTMLElement>('.step'));
    const tl = gsap.timeline({ paused: true, onUpdate: render });
    scene.build(tl, steps.length);
    tl.add(() => {}, Math.max(1, steps.length - 1)); // pin the duration to steps − 1
    chapters.push({ section, scene, steps, tl, railIndex: i + 1, title: section.dataset.title ?? '' });
  });
  const order: Scene[] = [hero, ...chapters.map((c) => c.scene)];
  mgr.setOrder(order);
  const total = chapters.length;

  // Rail (wide screens) and top bar (narrow screens) share one notion of the current chapter.
  const rail = document.querySelector<HTMLElement>('.rail');
  const railLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.rail a'));
  const railTitle = document.querySelector<HTMLElement>('.rail-title');
  const tbNum = document.querySelector<HTMLElement>('.tb-num');
  const tbTitle = document.querySelector<HTMLElement>('.tb-title');
  let current = 0;
  const showTitle = (index: number) => {
    const ch = chapters[index - 1];
    if (railTitle && railTitle.textContent !== (ch ? ch.title : '')) railTitle.textContent = ch ? ch.title : '';
  };
  const text = (el: HTMLElement | null, value: string) => {
    if (el && el.textContent !== value) el.textContent = value; // unchanged text must not invalidate layout
  };
  const setRail = (index: number) => {
    current = index;
    railLinks.forEach((a) => {
      const v = Number(a.dataset.rail) === index ? 'true' : 'false';
      if (a.getAttribute('aria-current') !== v) a.setAttribute('aria-current', v);
    });
    rail?.classList.toggle('is-hidden', index === 0);
    showTitle(index);
    const ch = chapters[index - 1];
    text(tbNum, ch ? `${pad2(index)} / ${pad2(total)}` : `00 / ${pad2(total)}`);
    text(tbTitle, ch ? ch.title : 'Interactive explainer');
  };
  railLinks.forEach((a) => {
    const peek = () => showTitle(Number(a.dataset.rail));
    const back = () => showTitle(current);
    a.addEventListener('mouseenter', peek);
    a.addEventListener('focus', peek);
    a.addEventListener('mouseleave', back);
    a.addEventListener('blur', back);
  });
  setRail(0);
  await nextIdle();

  // Chapter 05's embeddings first (a few per idle period): its ranking is part of the card's final layout.
  phase('embed');
  while (time.warm(14) > 0) await nextIdle();
  await nextIdle();

  // Reveal the steps: each one is laid out at once (a forced layout of that card and the document height,
  // deliberately inside the slice, so its cost is measured and the next frame has nothing pending), and a
  // slice stops after about 7 ms of work.
  phase('reveal');
  const steps = Array.from(document.querySelectorAll<HTMLElement>('.step'));
  for (let i = 0; i < steps.length; ) {
    const t0 = performance.now();
    do {
      steps[i].style.contentVisibility = 'visible';
      void steps[i].offsetHeight;
      i++;
    } while (i < steps.length && performance.now() - t0 < 7);
    await nextIdle();
  }
  phase('wire');

  /** Camera return used by hand-offs out of the camera chapters (hierarchy → time and time → controller). */
  const camReturn = () => {
    const st = { h: 0, saved: null as Camera | null };
    return {
      st,
      onUpdate: () => {
        if (st.h <= 0) {
          if (st.saved) mgr.world.cam = st.saved;
          st.saved = null;
          return;
        }
        if (!st.saved) st.saved = mgr.world.cam;
        mgr.world.cam = st.h >= 1 ? Camera.identity() : lerpCamera(st.saved, Camera.identity(), st.h);
      },
    };
  };

  let triggers: ScrollTrigger[] = [];
  let tweens: gsap.core.Tween[] = [];
  let masterCleanup: (() => void) | null = null;

  function wire(): void {
    triggers.forEach((t) => t.kill());
    tweens.forEach((t) => t.kill());
    masterCleanup?.();
    masterCleanup = null;
    triggers = [];
    tweens = [];
    const animate = canAnimate();

    // Step cards (both modes): activate the card while it sits in the reading band.
    chapters.forEach((ch) => {
      ch.steps.forEach((step, k) => {
        triggers.push(
          ScrollTrigger.create({
            trigger: step,
            start: () => (mgr.vp.narrow ? 'top 82%' : 'top 70%'),
            end: () => (mgr.vp.narrow ? 'bottom 28%' : 'bottom 30%'),
            onToggle: (self) => {
              step.classList.toggle('is-active', self.isActive);
              if (self.isActive) {
                ch.scene.setStep?.(k);
                if (!animate) {
                  ch.tl.progress(ch.steps.length > 1 ? k / (ch.steps.length - 1) : 1);
                  render();
                }
              }
            },
          }),
        );
      });
      // rail + primary scene while the chapter occupies the middle of the screen
      triggers.push(
        ScrollTrigger.create({
          trigger: ch.section,
          start: 'top 55%',
          end: 'bottom 45%',
          onToggle: (self) => {
            if (!self.isActive) return;
            setRail(ch.railIndex);
            mgr.setPrimary(ch.scene.id);
            if (!animate) {
              // Reduced motion: crossfade only, no camera or layout motion.
              mgr.scenes.forEach((s) => {
                tweens.push(gsap.to(s, { presence: s === ch.scene ? 1 : 0, duration: 0.4, ease: 'none', overwrite: 'auto', onUpdate: render }));
              });
              mgr.world.L = mgr.indexOf(ch.scene.id);
              if (ch.scene.diskAlpha !== undefined) tweens.push(gsap.to(mgr.world.disk, { alpha: ch.scene.diskAlpha, duration: 0.4, ease: 'none', overwrite: 'auto', onUpdate: render }));
              if (ch.scene.id !== 'hierarchy' && ch.scene.id !== 'time') mgr.world.cam = Camera.identity();
              mgr.maybeLoop();
              render();
            }
          },
        }),
      );
    });
    triggers.push(
      ScrollTrigger.create({
        trigger: '.hero',
        start: 'top 55%',
        end: 'bottom 45%',
        onToggle: (self) => {
          if (!self.isActive) return;
          setRail(0);
          mgr.setPrimary('hero');
          if (!animate) {
            mgr.scenes.forEach((s) => tweens.push(gsap.to(s, { presence: s === hero ? 1 : 0, duration: 0.4, ease: 'none', overwrite: 'auto', onUpdate: render })));
            tweens.push(gsap.to(mgr.world.disk, { alpha: 0, duration: 0.4, ease: 'none', overwrite: 'auto', onUpdate: render }));
            mgr.world.L = 0;
            mgr.maybeLoop();
            render();
          }
        },
      }),
    );

    if (!animate) {
      mgr.maybeLoop();
      return;
    }

    /*
     * One master timeline whose time unit is the page scroll position in pixels, scrubbed by a
     * single ScrollTrigger over the whole document. Chapter timelines (driven through proxies),
     * crossfades, disk placement, disk alpha and camera returns all live in it, so GSAP renders
     * every crossing in order and a fast jump can never leave two writers of the same property
     * disagreeing. It is rebuilt on every ScrollTrigger refresh (layout may have changed).
     */
    const master = gsap.timeline({ paused: true, onUpdate: render });
    const camReturns = new Map<string, ReturnType<typeof camReturn>>();
    /**
     * Reading position of a step, as a page scroll position: on wide screens the card is centred
     * in the viewport; on narrow screens its top sits just below the drawing band. Chapter
     * keyframes land exactly there, and a hand-off runs from the point where the previous
     * chapter's last card has left the band (narrow) or passed the centre (wide) to the point
     * where the next chapter's first card arrives.
     */
    const stageBottom = () => mgr.stageBottom;
    const cardOf = (step: HTMLElement) => step.querySelector<HTMLElement>('.card') ?? step;
    const anchor = (step: HTMLElement): number => {
      const card = cardOf(step);
      const top = card.getBoundingClientRect().top + window.scrollY;
      if (mgr.vp.narrow) return top - (stageBottom() + 10);
      return top + card.offsetHeight / 2 - vh() / 2;
    };
    const exitAnchor = (step: HTMLElement): number => {
      const card = cardOf(step);
      const top = card.getBoundingClientRect().top + window.scrollY;
      if (mgr.vp.narrow) return top + card.offsetHeight - stageBottom();
      return anchor(step) + 40;
    };
    const buildMaster = () => {
      master.clear();
      const H = vh();
      chapters.forEach((ch) => {
        // Piecewise-linear: the chapter timeline reaches integer time k exactly at step k's reading position.
        const n = ch.steps.length;
        const proxy = { t: 0 };
        const apply = () => ch.tl.progress(n > 1 ? proxy.t / (n - 1) : 1);
        if (n === 1) {
          master.fromTo(proxy, { t: 0 }, { t: 0, duration: 10, ease: 'none', immediateRender: false, onUpdate: apply }, anchor(ch.steps[0]));
          return;
        }
        let at = anchor(ch.steps[0]);
        for (let k = 0; k + 1 < n; k++) {
          const next = Math.max(anchor(ch.steps[k + 1]), at + 10);
          master.fromTo(proxy, { t: k }, { t: k + 1, duration: next - at, ease: 'none', immediateRender: false, onUpdate: apply }, at);
          at = next;
        }
      });
      for (let i = 0; i + 1 < order.length; i++) {
        const prev = order[i];
        const next = order[i + 1];
        const prevCh = chapters[i - 1];
        const nextCh = chapters[i];
        const s = prevCh ? exitAnchor(prevCh.steps[prevCh.steps.length - 1]) : H * 0.12;
        const e = anchor(nextCh.steps[0]) - 20;
        const d = Math.max(e - s, 10);
        const seg = (f0: number, f1: number) => ({ at: s + d * f0, dur: d * (f1 - f0) });
        let g = seg(0.05, 0.6);
        master.fromTo(prev, { presence: 1 }, { presence: 0, duration: g.dur, ease: 'none', immediateRender: false }, g.at);
        g = seg(0.4, 0.95);
        master.fromTo(next, { presence: 0 }, { presence: 1, duration: g.dur, ease: 'none', immediateRender: false }, g.at);
        // The layout parameter always walks one index per hand-off (a no-op when both placements agree).
        g = seg(0.1, 0.95);
        master.fromTo(mgr.world, { L: i }, { L: i + 1, duration: g.dur, ease: 'power2.inOut', immediateRender: false }, g.at);
        if (prev.diskAlpha !== undefined && next.diskAlpha !== undefined && prev.diskAlpha !== next.diskAlpha) {
          g = seg(0.2, 0.7);
          master.fromTo(mgr.world.disk, { alpha: prev.diskAlpha }, { alpha: next.diskAlpha, duration: g.dur, ease: 'none', immediateRender: false }, g.at);
        }
        if (prev === hero) master.fromTo(hero.par, { t: 0 }, { t: 1, duration: d, ease: 'none', immediateRender: false }, s);
        if (prev.id === 'hierarchy' || prev.id === 'time') {
          let cr = camReturns.get(prev.id);
          if (!cr) {
            cr = camReturn();
            camReturns.set(prev.id, cr);
          }
          g = seg(0.15, 0.75);
          master.fromTo(cr.st, { h: 0 }, { h: 1, duration: g.dur, ease: 'power2.inOut', immediateRender: false, onUpdate: cr.onUpdate }, g.at);
        }
        // primary scene / loop bookkeeping at the midpoint of the crossfade
        master.call(() => (mgr.setPrimary(next.id), mgr.maybeLoop()), [], s + d * 0.5);
        master.call(() => (mgr.setPrimary(prev.id), mgr.maybeLoop()), [], s + d * 0.5 - 1);
      }
      const maxScroll = Math.max(document.documentElement.scrollHeight - H, 1);
      master.add(() => {}, maxScroll);
    };
    buildMaster();
    ScrollTrigger.addEventListener('refreshInit', buildMaster);
    masterCleanup = () => ScrollTrigger.removeEventListener('refreshInit', buildMaster);
    triggers.push(
      ScrollTrigger.create({
        animation: master,
        scrub: 0.6,
        start: 0,
        end: () => Math.max(document.documentElement.scrollHeight - vh(), 1),
        onUpdate: () => mgr.maybeLoop(),
      }),
    );

    // Hero text: parallax and fade, scrubbed.
    tweens.push(
      gsap.to('#hero-text', {
        y: () => -vh() * 0.16,
        opacity: 0,
        ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom 35%', scrub: 0.6 },
      }),
    );
    mgr.maybeLoop();
  }

  wire();
  phase('wired');
  // Test hooks: presence of every scene and the layout parameter (read by the Playwright checks), and readiness.
  const w = window as unknown as {
    __presence: () => Array<[string, number]>;
    __layout: () => { L: number; narrow: boolean; stageBottom: number };
    __ready: boolean;
  };
  w.__presence = () => mgr.scenes.map((s) => [s.id, Number(s.presence.toFixed(3))]);
  w.__layout = () => ({ L: Number(mgr.world.L.toFixed(3)), narrow: mgr.vp.narrow, stageBottom: mgr.stageBottom });

  // Reading progress: scrubbed directly from scroll position.
  gsap.to('.progress', {
    scaleX: 1,
    ease: 'none',
    scrollTrigger: { trigger: document.documentElement, start: 'top top', end: 'bottom bottom', scrub: true },
  });

  onMotionChange(() => {
    wire();
    ScrollTrigger.refresh();
    render();
  });

  let refreshTimer = 0;
  const refreshSoon = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 120);
  };
  mgr.onResize = refreshSoon;
  // Layout can still change after mounting when fonts or the load event are still pending; when both are
  // done the triggers were created against the final layout and no second refresh is needed.
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(refreshSoon);
  if (document.readyState !== 'complete') window.addEventListener('load', refreshSoon);
  w.__ready = true;

  mgr.suspendLoop(false);
  phase('ready');

  // Chapter 02's label embeddings, a few per idle period; a query arriving earlier finishes them itself.
  await nextIdle();
  while (cmp.warmLabels(30) > 0) await nextIdle();
  phase('done');
}
