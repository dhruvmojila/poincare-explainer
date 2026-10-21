#!/usr/bin/env node
/**
 * End-to-end checks of the built site (site/dist) with Playwright + Chromium:
 *
 *   - serves site/dist with `vite preview` on port 4173
 *   - at five viewports (1440×900, 768×1024, 414×896, 390×844, 360×640) scrolls to every
 *     chapter step, asserts the card is active, collects the bounding boxes of every visible
 *     text-bearing element (cards, top bar, pause control, rail, hero text, footer) and fails if
 *     any two that are not nested intersect by more than 2 px or if any extends outside the
 *     viewport width (boxes are clipped to the region below the opaque mobile top bar, which
 *     the page lays out under)
 *   - fails on any console error or page error, in normal and in reduced-motion mode
 *   - writes screenshots of every step at 1440×900 and 390×844, plus the query box and the
 *     comparison in use, to site/screenshots/
 *
 * Run `npm run build` first, or use `npm run verify` which does tests + build + this script.
 * Playwright comes from the repo's devDependencies; set PLAYWRIGHT_DIR to use another install.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const URL = `http://127.0.0.1:${PORT}/`;
const SHOT_DIR = path.join(root, 'site', 'screenshots');
const OVERLAP_PX = 2;
const SETTLE_MS = 900;

function loadPlaywright() {
  const dir = process.env.PLAYWRIGHT_DIR;
  if (dir) return createRequire(path.join(path.resolve(dir), 'package.json'))('playwright');
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('playwright not found: run npm install, or set PLAYWRIGHT_DIR to a directory whose node_modules contains playwright');
  }
}

async function startPreview() {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const proc = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
    cwd: path.join(root, 'site'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(URL);
      if (r.ok) return proc;
    } catch {
      /* not up yet */
    }
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview did not start on port ${PORT}:\n${log}`);
}

const VIEWPORTS = [
  { tag: 'd', w: 1440, h: 900, shots: true, dpr: 1, mobile: false },
  { tag: 't768', w: 768, h: 1024, shots: false, dpr: 1, mobile: true },
  { tag: 'p414', w: 414, h: 896, shots: false, dpr: 2, mobile: true },
  { tag: 'm', w: 390, h: 844, shots: true, dpr: 2, mobile: true },
  { tag: 's360', w: 360, h: 640, shots: false, dpr: 2, mobile: true },
];

/** Runs in the page: scroll so that the given step is in its reading position. */
const scrollToStep = (index) => {
  const step = document.querySelectorAll('.step')[index];
  const card = step.querySelector('.card');
  const r = card.getBoundingClientRect();
  const vh = window.innerHeight;
  const layout = window.__layout ? window.__layout() : { narrow: false, stageBottom: 0 };
  const stageH = layout.stageBottom || 0;
  const narrow = layout.narrow;
  let target;
  if (narrow) target = window.scrollY + r.top - (stageH + 10); // the card just below the drawing band
  else target = window.scrollY + r.top + r.height / 2 - vh / 2; // the card centred
  // a card taller than the reading band: keep its top in view rather than its centre
  if (!narrow && r.height > vh * 0.8) target = window.scrollY + r.top - vh * 0.1;
  window.scrollTo(0, Math.max(0, target));
  return { ch: step.closest('.chapter')?.id ?? '', step: step.dataset.step };
};

/** Runs in the page: bounding boxes of visible text-bearing elements and their pairwise overlaps. */
const collectOverlaps = (limit) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const selector = '.card, .topbar, .motion-toggle, .rail, .footer-inner, .hero-inner, .hero-fig, .rail-title, .tb-chapter';
  const topbar = document.querySelector('.topbar');
  const barBox = topbar && getComputedStyle(topbar).position === 'fixed' ? topbar.getBoundingClientRect() : null;
  const describe = (el) => {
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48);
    return `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.id ? '#' + el.id : ''} "${text}"`;
  };
  const items = [];
  for (const el of document.querySelectorAll(selector)) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.display === 'contents') continue;
    if (Number(cs.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom <= 0 || r.top >= vh) continue;
    // Content scrolls under the opaque top bar (the page is laid out below it); only the visible part counts.
    let top = r.top;
    if (barBox && !topbar.contains(el) && cs.position !== 'fixed') top = Math.max(top, barBox.bottom);
    if (r.bottom - top < 2) continue;
    items.push({ el, name: describe(el), left: r.left, right: r.right, top, bottom: r.bottom });
  }
  const problems = [];
  for (const it of items) {
    if (it.left < -1 || it.right > vw + 1) problems.push(`outside viewport width (${Math.round(it.left)}..${Math.round(it.right)} of ${vw}): ${it.name}`);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > limit && h > limit) problems.push(`overlap ${Math.round(w)}×${Math.round(h)} px: ${a.name} × ${b.name}`);
    }
  }
  return { count: items.length, problems };
};

async function settle(page, ms = SETTLE_MS) {
  await page.waitForTimeout(ms);
}

async function run() {
  const { chromium } = loadPlaywright();
  mkdirSync(SHOT_DIR, { recursive: true });
  const server = await startPreview();
  const browser = await chromium.launch();
  const failures = [];
  const summary = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: vp.dpr,
        isMobile: vp.mobile,
        hasTouch: vp.mobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.goto(URL, { waitUntil: 'networkidle' });
      // The chapters mount in idle slices after the first paint; wait for them.
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
      await page.evaluate(() => document.fonts.ready);
      await settle(page, 600);
      const narrow = await page.evaluate(() => window.__layout().narrow);
      const steps = await page.evaluate(() => document.querySelectorAll('.step').length);
      let checked = 0;
      let maxItems = 0;

      // Hero
      {
        const { problems, count } = await page.evaluate(collectOverlaps, OVERLAP_PX);
        maxItems = Math.max(maxItems, count);
        problems.forEach((p) => failures.push(`[${vp.w}×${vp.h} hero] ${p}`));
        if (vp.shots) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}00-hero.png`) });
        checked++;
      }
      for (let i = 0; i < steps; i++) {
        const info = await page.evaluate(scrollToStep, i);
        await settle(page);
        const active = await page.evaluate((k) => document.querySelectorAll('.step')[k].classList.contains('is-active'), i);
        if (!active) failures.push(`[${vp.w}×${vp.h} ${info.ch} step ${info.step}] card did not activate at its reading position`);
        const { problems, count } = await page.evaluate(collectOverlaps, OVERLAP_PX);
        maxItems = Math.max(maxItems, count);
        problems.forEach((p) => failures.push(`[${vp.w}×${vp.h} ${info.ch} step ${info.step}] ${p}`));
        const n = info.ch.replace('ch-', '').padStart(2, '0');
        if (vp.shots) await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}${n}-${info.ch}-step${info.step}.png`) });
        else if ((info.ch === 'ch-2' || info.ch === 'ch-5' || info.ch === 'ch-7') && info.step === '0') {
          // A few review shots at the viewports that are only overlap-tested.
          await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}${n}-${info.ch}-step${info.step}.png`) });
        }
        checked++;
      }

      // Interactions: the comparison query and the memory query, on the screenshot viewports.
      if (vp.shots) {
        const stepIndex = await page.evaluate(() => [...document.querySelectorAll('.step')].findIndex((s) => s.closest('#ch-2')));
        await page.evaluate(scrollToStep, stepIndex);
        await settle(page, 500);
        await page.click('#cmp-chips .chip:nth-child(1)');
        await page.evaluate(scrollToStep, stepIndex);
        await settle(page, 700);
        const focus = await page.textContent('#cmp-focus');
        const prec = await page.evaluate(() => [document.getElementById('cmp-e-prec')?.textContent, document.getElementById('cmp-h-prec')?.textContent]);
        summary.push(`[${vp.w}×${vp.h}] compare leaf → ${focus} · precision E ${prec[0]} · H ${prec[1]}`);
        {
          const { problems } = await page.evaluate(collectOverlaps, OVERLAP_PX);
          problems.forEach((p) => failures.push(`[${vp.w}×${vp.h} compare-in-use] ${p}`));
        }
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}02-compare-leaf.png`) });
        await page.fill('#cmp-query', 'knee');
        await page.evaluate(scrollToStep, stepIndex);
        await settle(page, 600);
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}02-compare-typed-knee.png`) });

        const memIndex = await page.evaluate(() => [...document.querySelectorAll('.step')].findIndex((s) => s.closest('#ch-5') && s.dataset.step === '2'));
        await page.evaluate(scrollToStep, memIndex);
        await settle(page, 600);
        await page.fill('#mem-query', 'resting heart rate');
        await page.evaluate(scrollToStep, memIndex);
        await settle(page, 700);
        const top = await page.evaluate(() => [...document.querySelectorAll('#memory-rank li')].slice(0, 3).map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
        summary.push(`[${vp.w}×${vp.h}] memory "resting heart rate" → ${top.join(' | ')}`);
        {
          const { problems } = await page.evaluate(collectOverlaps, OVERLAP_PX);
          problems.forEach((p) => failures.push(`[${vp.w}×${vp.h} memory-query-in-use] ${p}`));
        }
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}05-memory-query.png`) });
        await page.evaluate(scrollToStep, memIndex + 1);
        await settle(page, 600);
        await page.fill('#note-text', 'calf cramped again after hill sprints');
        await page.fill('#note-age', '3');
        await page.click('#note-add');
        await page.evaluate(scrollToStep, memIndex + 1);
        await settle(page, 700);
        const noteStatus = await page.textContent('#note-status');
        summary.push(`[${vp.w}×${vp.h}] add note → ${noteStatus}`);
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}05-memory-note-added.png`) });
        await page.evaluate(scrollToStep, memIndex);
        await settle(page, 600);
        await page.screenshot({ path: path.join(SHOT_DIR, `${vp.tag}05-memory-rank-after-note.png`) });
      }

      // Keyboard focus order: the first stops, in DOM order (no positive tabindex anywhere).
      if (vp.tag === 'd') {
        await page.evaluate(() => window.scrollTo(0, 0));
        await settle(page, 300);
        // Start from the skip link (first in the DOM) and walk the first stops of the tab sequence.
        await page.focus('.skip');
        const stops = ['a.skip'];
        for (let i = 0; i < 9; i++) {
          await page.keyboard.press('Tab');
          stops.push(await page.evaluate(() => {
            const el = document.activeElement;
            return el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ')[0] : ''}` : 'none';
          }));
        }
        summary.push(`[focus order] ${stops.join(' → ')}`);
      }

      errors.forEach((e) => failures.push(`[${vp.w}×${vp.h}] ${e}`));
      summary.push(`[${vp.w}×${vp.h}] narrow=${narrow} · ${checked} positions checked · up to ${maxItems} text elements per position · ${errors.length} console/page errors`);
      await context.close();
    }

    // Reduced motion: every step, zero errors, a few screenshots.
    for (const vp of VIEWPORTS.filter((v) => v.shots)) {
      const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await page.goto(URL, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 });
      await settle(page, 500);
      const label = await page.evaluate(() => document.getElementById('motion-toggle')?.innerText ?? '');
      const steps = await page.evaluate(() => document.querySelectorAll('.step').length);
      for (let i = 0; i < steps; i++) {
        const info = await page.evaluate(scrollToStep, i);
        await settle(page, 500);
        const { problems } = await page.evaluate(collectOverlaps, OVERLAP_PX);
        problems.forEach((p) => failures.push(`[${vp.w}×${vp.h} reduced ${info.ch} step ${info.step}] ${p}`));
        if ((info.ch === 'ch-2' || info.ch === 'ch-5') && info.step === '0') {
          await page.screenshot({ path: path.join(SHOT_DIR, `r${vp.tag}-${info.ch}-step0.png`) });
        }
      }
      errors.forEach((e) => failures.push(`[${vp.w}×${vp.h} reduced] ${e}`));
      summary.push(`[${vp.w}×${vp.h} reduced motion] toggle reads "${label.trim()}" · ${errors.length} console/page errors`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(summary.join('\n'));
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):`);
    failures.forEach((f) => console.error('  ' + f));
    process.exit(1);
  }
  console.log(`\nno overlaps, nothing outside the viewport, no console errors · screenshots in ${path.relative(root, SHOT_DIR)}/`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
