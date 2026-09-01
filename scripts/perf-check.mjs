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

/**
 * Where images are served from, if not this origin.
 *
 * Every check below used to test `src.startsWith('/img/')` and skip anything
 * else. When the images moved to R2 that made every one of them invisible to
 * this budget: the site shipped with no srcset anywhere, pointing at an empty
 * bucket, and the build still reported "Budget met". A check that silently
 * stops checking is worse than no check, so image URLs are now normalised back
 * to their local path before anything is asserted about them.
 */
const CDN_BASE = (process.env.PUBLIC_CDN_URL ?? '').trim().replace(/\/+$/, '');

/** `/img/a.webp` and `https://cdn/img/a.webp` both come back as `/img/a.webp`. */
function localPath(url) {
  if (!url) return null;
  if (CDN_BASE && url.startsWith(CDN_BASE + '/')) return url.slice(CDN_BASE.length);
  if (url.startsWith('/img/')) return url;
  // A remote image on some other host is not ours to check.
  return /^https?:\/\//.test(url) ? null : url;
}

/** Is this an image this project is responsible for? */
function isOurImage(url) {
  const p = localPath(url);
  return !!p && p.startsWith('/img/');
}

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

/** Counted and reported so a check that stops seeing images is visible. */
let imagesChecked = 0;

/**
 * Absolute CDN URLs for images on the critical path (preloaded or eager).
 *
 * These get fetched for real at the end of the run. On-disk checks cannot tell
 * you whether an object was ever uploaded, and that gap is what shipped a site
 * whose every image 404'd while the build reported success. Checking all 265
 * over the network would be slow, but the eager ones are a handful and they
 * are the ones whose absence is immediately visible to a reader.
 */
const criticalRemote = new Set();

/** How many critical images were confirmed live on the CDN. */
let cdnLiveChecked = 0;

/** The GTM container id confirmed present in the build, if any. */
let gtmChecked = '';

/**
 * Read a variable straight out of the committed .env.production.
 *
 * Deliberately reads the file rather than process.env: the whole point is to
 * compare what the repository says against what actually built, and an
 * environment override would make those identical by definition.
 */
function readCommittedEnv(key) {
  const file = join(ROOT, '.env.production');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : null;
}

function fail(check, detail) {
  failures.push({ check, detail });
}

async function main() {
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

    // 2. Every raster in /img/ should carry a srcset, wherever it is hosted.
    //    A missing one means responsive-images has not run for that file, and
    //    phones get the full 1600px original.
    for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
      const t = tag[0];
      const src = t.match(/src="([^"]+)"/)?.[1] ?? '';
      if (!isOurImage(src)) continue;
      imagesChecked++;
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
        .map((u) => localPath(String(u)))
        .filter(Boolean)
        .map((u) => join(DIST, u.replace(/^\//, '')))
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
    //
    //    On-disk existence is the check even when the URL is on the CDN,
    //    because public/img is what gets uploaded there. It is a build-time
    //    proxy, not proof the objects are live - `npm run r2:verify` is what
    //    actually asks the bucket.
    for (const m of html.matchAll(/srcset="([^"]+)"/g)) {
      for (const part of m[1].split(',')) {
        const url = part.trim().split(/\s+/)[0];
        const p = localPath(url);
        if (!p || !p.startsWith('/')) continue;
        if (!existsSync(join(DIST, p.replace(/^\//, '')))) {
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

    const preload = html.match(/<link[^>]+rel="preload"[^>]+as="image"[^>]*>/)?.[0];
    if (!preload) {
      fail('missing LCP preload', page);
      continue;
    }

    // The preloaded cover is the LCP image by definition, so these are the
    // URLs whose absence from the CDN is most immediately visible. Collect
    // them here rather than from the <img>, because this tag is the one the
    // browser acts on first.
    const urls = [
      preload.match(/href="([^"]+)"/)?.[1],
      ...(preload.match(/imagesrcset="([^"]+)"/)?.[1]?.split(',') ?? []).map((p) =>
        p.trim().split(/\s+/)[0],
      ),
    ].filter(Boolean);

    for (const u of urls) {
      if (CDN_BASE && u.startsWith(CDN_BASE)) criticalRemote.add(u);
    }
  }

  // 6. Serving images from another origin costs a DNS lookup, a TCP connect
  //    and a TLS handshake before the LCP image can even start downloading -
  //    the same chain that made the Google Fonts <link> so expensive. A
  //    preconnect overlaps that with HTML parsing and buys most of it back.
  //    Without one, moving images to a CDN is a net LCP loss on mobile.
  if (CDN_BASE) {
    const origin = new URL(CDN_BASE).origin;
    for (const page of ['index.html']) {
      const file = join(DIST, page);
      if (!existsSync(file)) continue;
      const html = readFileSync(file, 'utf8');
      const has = new RegExp(
        `<link[^>]+rel="preconnect"[^>]+href="${origin}`,
      ).test(html);
      if (!has) fail('no preconnect to the image CDN', `${page} -> ${origin}`);
    }
  }

  // 7. Self-hosted fonts must actually be in the output.
  const fontDir = join(DIST, 'fonts');
  const fonts = existsSync(fontDir)
    ? readdirSync(fontDir).filter((f) => f.endsWith('.woff2'))
    : [];
  if (!fonts.length) fail('no self-hosted fonts in dist/fonts', 'run: npm run fonts');

  // 8. The critical images must actually be served by the CDN. Everything
  //    above this point only proves the build is internally consistent; a
  //    consistent build pointing at an empty bucket still renders a site with
  //    no images. Set PERF_SKIP_NETWORK=1 to skip when offline.
  if (CDN_BASE && criticalRemote.size && process.env.PERF_SKIP_NETWORK !== '1') {
    const urls = [...criticalRemote];
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          const res = await fetch(url, { method: 'HEAD' });
          return { url, status: res.status };
        } catch {
          // A network failure is not the site's fault, so it warns instead of
          // failing - otherwise a flaky connection blocks an honest build.
          return { url, status: null };
        }
      }),
    );

    const missing = results.filter((r) => r.status !== null && r.status !== 200);
    const unreachable = results.filter((r) => r.status === null);

    for (const m of missing) {
      fail('critical image is not on the CDN', `${m.status} ${m.url}`);
    }
    if (unreachable.length) {
      notes.push(`could not reach the CDN for ${unreachable.length} image(s) — not checked`);
    }
    if (!missing.length && !unreachable.length) {
      cdnLiveChecked = urls.length;
    }
  }

  // 9. Analytics integrity.
  //
  //    A dashboard variable silently overrides .env.production - verified by
  //    building with both set to different values, and the environment won.
  //    That is the right precedence, but it means a typo in a web form nobody
  //    can see from the repo can replace the container ID, or blank it, with
  //    no error anywhere. GTM failing is invisible by design: the page still
  //    renders perfectly, it just stops measuring.
  const gtmEnv = (process.env.PUBLIC_GTM_ID ?? '').trim();
  const home = join(DIST, 'index.html');

  if (existsSync(home)) {
    const html = readFileSync(home, 'utf8');
    const inPage = [...html.matchAll(/GTM-[A-Z0-9]+/g)].map((m) => m[0]);
    const unique = [...new Set(inPage)];

    if (gtmEnv) {
      if (!/^GTM-[A-Z0-9]+$/.test(gtmEnv)) {
        fail('PUBLIC_GTM_ID is malformed', `"${gtmEnv}" is not a GTM container ID`);
      } else if (!unique.length) {
        fail('GTM configured but absent from the build', `expected ${gtmEnv} in index.html`);
      } else if (unique.length > 1 || unique[0] !== gtmEnv) {
        fail(
          'GTM id in the build does not match the environment',
          `env=${gtmEnv} build=${unique.join(', ')}`,
        );
      } else {
        gtmChecked = gtmEnv;
      }

      // Divergence between the committed file and whatever actually built is
      // not automatically wrong - a dashboard override is a legitimate way to
      // change it - but it must never pass unremarked.
      const committed = readCommittedEnv('PUBLIC_GTM_ID');
      if (committed && committed !== gtmEnv) {
        notes.push(
          `PUBLIC_GTM_ID differs from .env.production (file=${committed}, effective=${gtmEnv}) — ` +
            'an environment override is in play',
        );
      }
    } else if (unique.length) {
      fail('GTM in the build with no PUBLIC_GTM_ID set', unique.join(', '));
    }
  }

  // Same divergence check for the image host, where a mismatch is worse: the
  // build would point every image at a bucket the budget then cannot verify.
  {
    const committed = readCommittedEnv('PUBLIC_CDN_URL');
    if (committed && CDN_BASE && committed.replace(/\/+$/, '') !== CDN_BASE) {
      notes.push(
        `PUBLIC_CDN_URL differs from .env.production (file=${committed}, effective=${CDN_BASE})`,
      );
    }
  }

  // ---- report ----
  console.log(c.bold(`\nPerformance budget ${c.dim(`(${pages.length} pages)`)}\n`));

  // State where images are being served from. A budget that quietly checks
  // nothing looks identical to one that passes, which is how the CDN
  // migration shipped green.
  console.log(
    c.dim(`  images: ${CDN_BASE ? CDN_BASE : 'same origin (PUBLIC_CDN_URL unset)'}\n`),
  );

  if (!failures.length) {
    console.log(`  ${c.green('pass')}  no external stylesheets`);
    console.log(`  ${c.green('pass')}  ${imagesChecked} /img/ images, all with a srcset`);
    console.log(`  ${c.green('pass')}  every srcset variant exists on disk`);
    console.log(`  ${c.green('pass')}  home preloads its LCP image`);
    if (CDN_BASE) console.log(`  ${c.green('pass')}  home preconnects to the image CDN`);
    if (gtmChecked) console.log(`  ${c.green('pass')}  ${gtmChecked} present and matches the environment`);
    if (cdnLiveChecked)
      console.log(
        `  ${c.green('pass')}  ${cdnLiveChecked} critical image(s) confirmed live on the CDN`,
      );
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
