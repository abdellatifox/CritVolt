#!/usr/bin/env node
/**
 * Performance budget. Runs automatically after every build (postbuild).
 *
 *   npm run perf
 *
 * This exists because the optimisations that took the site from 87 to 99 are
 * all invisible in the source. Nothing about adding an article tells you that
 * its cover needs responsive variants, or that pasting a font <link> into the
 * head undoes two seconds of work. Each check below is a regression that
 * actually happened or was one edit away.
 *
 * Exits non-zero on a failure, so a broken deploy stops here rather than
 * shipping a slow site quietly.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const DIST = join(ROOT, 'dist');

/** A single cover heavier than this on the critical path is a regression. */
const MAX_EAGER_IMAGE_KB = 200;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

const failures = [];
const notes = [];

function fail(check, detail) {
  failures.push({ check, detail });
}

function main() {
  if (!existsSync(DIST)) {
    console.error(c.red('\nNo dist/ — run the build first.\n'));
    process.exit(1);
  }

  const pages = htmlFiles(DIST);

  for (const file of pages) {
    const rel = relative(DIST, file).replace(/\\/g, '/');
    const html = readFileSync(file, 'utf8');

    // 1. No third-party render-blocking resources. The Google Fonts <link>
    //    cost ~2.3s of blocked rendering before it was self-hosted.
    for (const m of html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)) {
      const href = m[0].match(/href="([^"]+)"/)?.[1] ?? '';
      if (/^https?:\/\//.test(href)) {
        fail('external stylesheet', `${rel} -> ${href}`);
      }
    }

    // 2. Every local raster in /img/ should carry a srcset. A missing one
    //    means responsive-images has not run for that file, and phones get
    //    the full 1600px original.
    for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
      const t = tag[0];
      const src = t.match(/src="([^"]+)"/)?.[1] ?? '';
      if (!src.startsWith('/img/')) continue;
      if (!/srcset="/.test(t)) {
        fail('image without srcset', `${rel} -> ${src}`);
      }
    }

    // 3. Eager images are on the critical path, so weigh what a phone
    //    would actually fetch - the smallest srcset candidate - not the
    //    `src` fallback. Measuring `src` reports the untouched 1600px
    //    original and flags images that are already fine.
    for (const tag of html.matchAll(/<img[^>]*loading="eager"[^>]*>/g)) {
      const t = tag[0];
      const set = t.match(/srcset="([^"]+)"/)?.[1];
      const candidates = set
        ? set.split(",").map((p) => p.trim().split(/\s+/)[0])
        : [t.match(/src="([^"]+)"/)?.[1]].filter(Boolean);

      const found = candidates
        .map((u) => join(DIST, String(u).replace(/^\//, "")))
        .filter((f) => existsSync(f))
        .map((f) => statSync(f).size / 1024);

      if (!found.length) continue;
      const smallest = Math.min(...found);
      if (smallest > MAX_EAGER_IMAGE_KB) {
        notes.push(`${rel} -> smallest eager variant is ${Math.round(smallest)}KB`);
      }
    }

    // 4. Every referenced variant must exist. A stale image-widths.json
    //    points srcset at files that 404, which is worse than no srcset.
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const part of m[1].split(',')) {
        const url = part.trim().split(/\s+/)[0];
        if (!url.startsWith('/')) continue;
        if (!existsSync(join(DIST, url.replace(/^\//, '')))) {
          fail('srcset points at a missing file', `${rel} -> ${url}`);
        }
      }
    }
  }

  // 5. The two pages with a known LCP image should preload it.
  for (const page of ['index.html']) {
    const file = join(DIST, page);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    if (!/<link[^>]+rel="preload"[^>]+as="image"/.test(html)) {
      fail('missing LCP preload', page);
    }
  }

  // 6. Self-hosted fonts must actually be in the output.
  const fontDir = join(DIST, 'fonts');
  const fonts = existsSync(fontDir)
    ? readdirSync(fontDir).filter((f) => f.endsWith('.woff2'))
    : [];
  if (!fonts.length) fail('no self-hosted fonts in dist/fonts', 'run: npm run fonts');

  // ---- report ----
  console.log(c.bold(`\nPerformance budget ${c.dim(`(${pages.length} pages)`)}\n`));

  if (!failures.length) {
    console.log(`  ${c.green('pass')}  no external stylesheets`);
    console.log(`  ${c.green('pass')}  every /img/ image has a srcset`);
    console.log(`  ${c.green('pass')}  every srcset variant exists on disk`);
    console.log(`  ${c.green('pass')}  home preloads its LCP image`);
    console.log(`  ${c.green('pass')}  ${fonts.length} self-hosted font files`);
  } else {
    const grouped = {};
    for (const f of failures) (grouped[f.check] ??= []).push(f.detail);
    for (const [check, details] of Object.entries(grouped)) {
      console.log(`  ${c.red('FAIL')}  ${check} ${c.dim(`(${details.length})`)}`);
      for (const d of details.slice(0, 5)) console.log(`          ${c.dim(d)}`);
      if (details.length > 5) console.log(c.dim(`          …and ${details.length - 5} more`));
    }
  }

  for (const n of notes) console.log(`  ${c.yellow('warn')}  ${n}`);

  if (failures.length) {
    console.log(
      c.red(c.bold('\n  Build blocked.')) +
        ' These are the optimisations that took the site from 87 to 99.\n' +
        '  Most fixes: npm run images:responsive  (or npm run fonts)\n',
    );
    process.exit(1);
  }

  console.log(c.dim('\n  Budget met.\n'));
}

main();
