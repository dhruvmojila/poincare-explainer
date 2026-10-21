import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import katex from 'katex';

// `BASE_PATH=/poincare-explainer/ npm run build` for GitHub Pages project sites.
const base = process.env.BASE_PATH ?? '/';

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Class names that the prerendered KaTeX markup uses; the KaTeX stylesheet is pruned to these. */
const katexClasses = new Set<string>();

/**
 * Typeset every `data-tex` element at build time so the page ships no KaTeX runtime.
 * `<div class="eq" data-tex="..."></div>` becomes the rendered HTML; `data-display="inline"`
 * renders inline. `\htmlClass{lf-name}{0.000}` spans survive, so the live formula can
 * swap digits in place at runtime.
 */
function katexPrerender(): Plugin {
  return {
    name: 'katex-prerender',
    transformIndexHtml: {
      // 'pre': runs while the HTML is transformed, before generateBundle prunes the KaTeX stylesheet.
      order: 'pre',
      handler(html) {
        return html.replace(/<(div|span)([^>]*?)\sdata-tex="([^"]*)"([^>]*)><\/\1>/g, (_m, tag: string, pre: string, tex: string, post: string) => {
        const inline = /data-display="inline"/.test(pre + post);
        const out = katex.renderToString(decode(tex), { displayMode: !inline, throwOnError: true, trust: true, strict: false });
        for (const m of out.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) katexClasses.add(c);
        return `<${tag}${pre}${post}>${out}</${tag}>`;
        });
      },
    },
  };
}

const katexDist = fileURLToPath(new URL('../node_modules/katex/dist/', import.meta.url));

/** Split a flat (depth-1) stylesheet into `{ selector, body }` blocks, respecting quotes. */
function cssBlocks(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let j = open + 1;
    let quote = '';
    for (; j < css.length; j++) {
      const ch = css[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '{') throw new Error('katex.min.css: nested block, the pruner expects a flat stylesheet');
      else if (ch === '}') break;
    }
    out.push({ selector: css.slice(i, open).trim(), body: css.slice(open + 1, j).trim() });
    i = j + 1;
  }
  return out;
}

/**
 * Keep only the KaTeX rules whose selectors use classes present in the prerendered markup, and
 * only the @font-face blocks (woff2 source only) of the font families those rules still name.
 * Returns the stylesheet with `url(fonts/X.woff2)` references and the list of font files.
 */
function pruneKatexCss(css: string, used: Set<string>): { css: string; fonts: string[] } {
  const faces = new Map<string, string[]>();
  const rules: string[] = [];
  const families = new Set<string>(['KaTeX_Main']);
  for (const { selector, body } of cssBlocks(css)) {
    if (selector === '@font-face') {
      const family = /font-family:\s*"?([^;"]+)"?/.exec(body)?.[1]?.trim();
      const woff2 = /url\((fonts\/[^)]+\.woff2)\)\s*format\("woff2"\)/.exec(body);
      if (!family || !woff2) continue;
      const decls = body.split(';').filter((d) => d && !/^src:/.test(d.trim()));
      decls.push(`src:url(${woff2[1]}) format("woff2")`);
      (faces.get(family) ?? faces.set(family, []).get(family)!).push(`@font-face{${decls.join(';')}}`);
      continue;
    }
    if (selector.startsWith('@')) throw new Error(`katex.min.css: unexpected at-rule ${selector.slice(0, 30)}`);
    const keep = selector.split(',').filter((sel) => [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].every((m) => used.has(m[1])));
    if (!keep.length) continue;
    rules.push(`${keep.join(',')}{${body}}`);
    for (const m of body.matchAll(/font-family:([^;]+)/g)) {
      for (const f of m[1].split(',')) {
        const name = f.trim().replace(/^["']|["']$/g, '');
        if (name.startsWith('KaTeX_')) families.add(name);
      }
    }
  }
  const faceCss: string[] = [];
  const fonts: string[] = [];
  for (const family of families) {
    for (const face of faces.get(family) ?? []) {
      faceCss.push(face);
      const f = /url\(fonts\/([^)]+)\)/.exec(face)?.[1];
      if (f) fonts.push(f);
    }
  }
  return { css: faceCss.join('') + rules.join(''), fonts };
}

/**
 * How the built page is delivered, all in the service of a first paint that depends on the
 * HTML alone and a main thread that is free when it happens:
 *  - the site stylesheet is inlined into <head> (no render-blocking request);
 *  - the three fonts used above the fold are preloaded;
 *  - the KaTeX stylesheet, pruned to the rules and fonts the prerendered formulas use (all far
 *    below the fold), is loaded without blocking rendering and applied once it arrives;
 *  - the entry module and the lazy chunks (GSAP, the chapters) are fetched early (modulepreload)
 *    but the entry is started by an inline bootstrap after the first frame has painted, so no
 *    script runs before the hero text is on screen.
 */
function delivery(): Plugin {
  let config: ResolvedConfig;
  let katexCssFile = '';
  const katexCssPath = path.join(katexDist, 'katex.min.css');
  return {
    name: 'delivery',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server || !ctx.bundle) {
          // Dev server: the unpruned KaTeX stylesheet, served from node_modules.
          return html.replace('</head>', `    <link rel="stylesheet" href="/@fs${katexCssPath}" />\n  </head>`);
        }
        const bundle = ctx.bundle;
        const b = config.base;
        const head: string[] = [];
        for (const file of Object.keys(bundle)) {
          if (/(fraunces-latin-wght-normal|inter-tight-latin-wght-normal|jetbrains-mono-latin-400-normal)-[\w-]+\.woff2$/.test(file)) {
            head.push(`<link rel="preload" as="font" type="font/woff2" crossorigin href="${b}${file}">`);
          }
        }
        html = html.replace(/\s*<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/, (m, href: string) => {
          const asset = bundle[href.startsWith(b) ? href.slice(b.length) : href];
          if (!asset || asset.type !== 'asset') return m;
          head.push(`<style>${asset.source.toString()}</style>`);
          delete bundle[asset.fileName];
          return '';
        });
        html = html.replace(/\s*<script type="module" crossorigin src="([^"]+)"><\/script>/, (_m, src: string) => {
          head.push(`<link rel="modulepreload" crossorigin href="${src}">`);
          for (const c of Object.values(bundle)) {
            if (c.type === 'chunk' && !c.isEntry) head.push(`<link rel="modulepreload" crossorigin href="${b}${c.fileName}">`);
          }
          head.push(
            `<script>(function(){var d=!1;function g(){if(!d){d=!0;var s=document.createElement("script");s.type="module";s.crossOrigin="anonymous";s.src=${JSON.stringify(src)};document.head.appendChild(s)}}requestAnimationFrame(function(){setTimeout(g,0)});setTimeout(g,1200)})()</script>`,
          );
          return '';
        });
        if (katexCssFile) {
          const href = `${b}${katexCssFile}`;
          head.push(`<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="${href}"></noscript>`);
        }
        return html.replace('</head>', `    ${head.join('\n    ')}\n  </head>`);
      },
    },
    generateBundle() {
      if (!katexClasses.size) throw new Error('delivery: no KaTeX markup was prerendered, cannot prune its stylesheet');
      const { css, fonts } = pruneKatexCss(readFileSync(katexCssPath, 'utf8'), katexClasses);
      const urls = new Map<string, string>();
      for (const f of fonts) {
        const ref = this.emitFile({ type: 'asset', name: f, source: readFileSync(path.join(katexDist, 'fonts', f)) });
        urls.set(f, `${config.base}${this.getFileName(ref)}`);
      }
      const out = css.replace(/url\(fonts\/([^)]+)\)/g, (_m, f: string) => `url(${urls.get(f)})`);
      katexCssFile = this.getFileName(this.emitFile({ type: 'asset', name: 'katex.css', source: out }));
    },
  };
}

export default defineConfig({
  base,
  plugins: [katexPrerender(), delivery()],
  resolve: {
    alias: {
      // Build straight from the library source so `npm run dev` needs no prior package build.
      'poincare-ball': fileURLToPath(new URL('../packages/poincare-ball/src/index.ts', import.meta.url)),
      // Font files are referenced from style.css through these aliases (latin subsets only).
      '@fonts-variable': fileURLToPath(new URL('../node_modules/@fontsource-variable', import.meta.url)),
      '@fonts': fileURLToPath(new URL('../node_modules/@fontsource', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 600,
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
});
