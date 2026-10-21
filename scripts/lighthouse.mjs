#!/usr/bin/env node
/**
 * `npm run lighthouse`: audit the built site (site/dist, run `npm run build` first) with
 * Lighthouse 13 the way the recorded scores were produced:
 *
 *   - site/dist served statically on http://localhost:8787/ with gzip (what GitHub Pages and every
 *     CDN send; pass --no-compression to measure the raw transfer instead), no cache headers
 *   - headless Chrome (`--headless=new --no-sandbox --disable-gpu`), CHROME_PATH or google-chrome on PATH
 *   - the default mobile preset and `--preset=desktop`, simulated throttling
 *
 * Set LIGHTHOUSE_SPEC to pin a version (default lighthouse@latest). Reports go to site/lighthouse/{mobile,desktop}.report.json (full JSON, loadable in the
 * Lighthouse viewer) and the category scores and core metrics are printed. Exit code 1 if
 * either run fails. Lighthouse itself is fetched by npx (network needed the first time).
 */
import { spawn, execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'site', 'dist');
const outDir = path.join(root, 'site', 'lighthouse');
const PORT = 8787;
const LIGHTHOUSE = process.env.LIGHTHOUSE_SPEC ?? 'lighthouse@latest';
const CHROME_FLAGS = '--headless=new --no-sandbox --disable-gpu';
const COMPRESS = !process.argv.includes('--no-compression');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('site/dist/index.html not found: run `npm run build` first');
  process.exit(1);
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      return execSync(`command -v ${name}`, { encoding: 'utf8' }).trim();
    } catch {
      /* next */
    }
  }
  return null;
}

/** A static file server for site/dist: gzip when the client accepts it (as production hosts do), no caching. */
function serve() {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(dist, p));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const type = MIME[path.extname(file)] ?? 'application/octet-stream';
    const body = readFileSync(file);
    const compressible = COMPRESS && /^(text\/|application\/(json|javascript)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    if (compressible) {
      res.writeHead(200, { 'content-type': type, 'content-encoding': 'gzip', vary: 'accept-encoding' });
      res.end(gzipSync(body));
      return;
    }
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function run(cmd, args, env) {
  // asynchronous on purpose: a synchronous spawn would block this process's event loop and
  // the static server above would never answer Chrome
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function audit(name, extraArgs, chrome) {
  const out = path.join(outDir, `${name}.report.json`);
  const args = ['-y', LIGHTHOUSE, `http://localhost:${PORT}/`, '--quiet', `--chrome-flags=${CHROME_FLAGS}`, '--output', 'json', '--output-path', out, ...extraArgs];
  console.log(`\n$ npx ${args.join(' ')}`);
  const code = await run('npx', args, { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) });
  if (code !== 0) throw new Error(`lighthouse (${name}) exited with ${code}`);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  const c = report.categories;
  const a = report.audits;
  const score = (k) => Math.round(c[k].score * 100);
  console.log(
    `${name}: performance ${score('performance')} · accessibility ${score('accessibility')} · best-practices ${score('best-practices')} · SEO ${score('seo')}` +
      `\n  FCP ${a['first-contentful-paint'].displayValue} · LCP ${a['largest-contentful-paint'].displayValue} · TBT ${a['total-blocking-time'].displayValue}` +
      ` · CLS ${a['cumulative-layout-shift'].displayValue} · SI ${a['speed-index'].displayValue} · Lighthouse ${report.lighthouseVersion}`,
  );
  return { performance: score('performance'), accessibility: score('accessibility') };
}

mkdirSync(outDir, { recursive: true });
const chrome = chromePath();
if (!chrome) console.warn('no Chrome found on PATH; set CHROME_PATH');
const server = await serve();
let failed = false;
try {
  await audit('mobile', [], chrome);
  await audit('desktop', ['--preset=desktop'], chrome);
} catch (e) {
  console.error(e.message);
  failed = true;
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
