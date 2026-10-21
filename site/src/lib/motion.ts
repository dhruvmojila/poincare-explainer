/** Global motion state: system `prefers-reduced-motion` plus the user's pause toggle. No GSAP here, so the hero can boot without it. */
export const motion = { reduced: false, paused: false };

export function canAnimate(): boolean {
  return !motion.reduced && !motion.paused;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export function onMotionChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  listeners.forEach((fn) => fn());
}

/** The toggle shows a long label on wide screens and a short one in the mobile top bar (CSS picks). */
function syncButton(button: HTMLButtonElement) {
  let long = button.querySelector<HTMLElement>('.long');
  let short = button.querySelector<HTMLElement>('.short');
  if (!long || !short) {
    button.textContent = '';
    long = document.createElement('span');
    long.className = 'long';
    short = document.createElement('span');
    short.className = 'short';
    button.append(long, short);
  }
  if (motion.reduced) {
    long.textContent = 'Motion reduced (system setting)';
    short.textContent = 'Reduced motion';
    button.setAttribute('aria-pressed', 'true');
    button.disabled = true;
    return;
  }
  button.disabled = false;
  long.textContent = motion.paused ? 'Resume animations' : 'Pause animations';
  short.textContent = motion.paused ? 'Resume' : 'Pause';
  button.setAttribute('aria-pressed', motion.paused ? 'true' : 'false');
}

/**
 * Wire `prefers-reduced-motion` (a live media query) and the visible pause toggle.
 * With reduced motion or paused, scenes show static end states and only crossfade.
 */
export function initMotion(button: HTMLButtonElement): void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.reduced = mq.matches;
  mq.addEventListener('change', () => {
    motion.reduced = mq.matches;
    syncButton(button);
    notify();
  });
  button.addEventListener('click', () => {
    motion.paused = !motion.paused;
    syncButton(button);
    notify();
  });
  syncButton(button);
}
