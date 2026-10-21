import './style.css';
import { SceneManager } from './scenes/manager';
import { HeroScene } from './scenes/hero';
import { initMotion } from './lib/motion';
import { idle, nextIdle } from './lib/idle';

/*
 * Boot: the hero (the tiling, the manager, the motion toggle) needs no GSAP and no chapter
 * scene, so this entry chunk is small and paints the tiling as soon as it runs. Everything
 * else is loaded once the page is idle, in two chunks evaluated in separate tasks: GSAP +
 * ScrollTrigger, then `chapters.ts` (the nine scenes, d3-hierarchy, the hashing embedder),
 * which mounts in short slices. The built page starts this module only after its first
 * paint (see vite.config.ts).
 */
function boot(): void {
  initMotion(document.getElementById('motion-toggle') as HTMLButtonElement);
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const mgr = new SceneManager(canvas);
  const hero = new HeroScene();
  mgr.register(hero);
  mgr.underDisk.add('hero');
  mgr.setOrder([hero]);
  mgr.setPrimary('hero');
  mgr.maybeLoop();
  document.fonts?.ready.then(() => mgr.requestRender());
  idle(async () => {
    try {
      await import('./lib/gsap-setup');
      await nextIdle();
      const { mountChapters } = await import('./chapters');
      await mountChapters(mgr, hero);
    } catch (e) {
      console.error('chapters failed to load', e);
    }
  });
}

boot();
