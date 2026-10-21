#!/usr/bin/env node
/**
 * `npm run verify`: library tests, type checks, the production build, a gzip budget for the
 * site bundle (≤ 250 kB excluding fonts) and the Playwright end-to-end checks (overlaps,
 * console errors, screenshots).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_KB = 250;

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function gzipBudget() {
  const dist = path.join(root, 'site', 'dist');
  const rows = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(js|css|html|svg|json)$/.test(name)) rows.push([path.relative(dist, p), gzipSync(readFileSync(p)).length]);
    }
  };
  walk(dist);
  rows.sort((a, b) => b[1] - a[1]);
  let total = 0;
  for (const [file, bytes] of rows) {
    total += bytes;
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} kB  ${file}`);
  }
  console.log(`  ${(total / 1024).toFixed(1).padStart(7)} kB  total gzip, excluding fonts (budget ${BUDGET_KB} kB)`);
  if (total > BUDGET_KB * 1024) {
    console.error(`bundle over budget: ${(total / 1024).toFixed(1)} kB > ${BUDGET_KB} kB`);
    process.exit(1);
  }
}

run('npm', ['test']);
run('npm', ['run', 'typecheck']);
run('npm', ['run', 'build']);
console.log('\nbundle size (gzip):');
gzipBudget();
run(process.execPath, [path.join(root, 'scripts', 'e2e.mjs')]);
console.log('\nverify: all checks passed');
