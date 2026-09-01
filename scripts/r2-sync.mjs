#!/usr/bin/env node
/**
 * Uploads public/img/** to the R2 bucket, then verifies over public HTTP.
 *
 *   npm run r2:sync           upload everything missing
 *   npm run r2:sync -- --force   re-upload even if present
 *   npm run r2:verify         check only, upload nothing
 *
 * This exists because the previous migration rewrote every image URL in the
 * site to an R2 bucket that was empty, deleted the local originals, and
 * committed it. The rewrite script's own header said "run once after images
 * are confirmed uploaded" - nothing ever confirmed it, so the whole site
 * 404'd its images.
 *
 * So this script does not trust its own upload. After writing the objects it
 * fetches a sample back over the public URL and fails loudly if they are not
 * really there. An upload that cannot be verified is treated as a failure.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const IMG = join(ROOT, 'public', 'img');

const BUCKET = process.env.R2_BUCKET || 'critvolt-assets';
const PUBLIC_BASE = (process.env.PUBLIC_CDN_URL || '').replace(/\/+$/, '');

const FORCE = process.argv.includes('--force');
const VERIFY_ONLY = process.argv.includes('--verify');
/** Wrangler spawns a process per object, so upload wide rather than deep. */
const CONCURRENCY = Number(process.env.R2_CONCURRENCY) || 8;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

function contentType(file) {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  return TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Resolve wrangler's binary once, up front.
 *
 * Going through `npx` here does not survive concurrency: eight npx processes
 * racing to resolve the same binary on Windows produced 23 spurious
 * "'wrangler' is not recognized" failures out of 265 on the first run. Calling
 * the installed executable directly removes the race entirely.
 */
const WRANGLER = (() => {
  const bin = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  return existsSync(bin) ? bin : 'npx wrangler';
})();

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

async function putObject(key, file) {
  // Variants are immutable: a different image gets a different filename, so a
  // long max-age is safe and keeps repeat views off the network entirely.
  const { code, out } = await run(`"${WRANGLER}"`, [
    'r2', 'object', 'put',
    `${BUCKET}/${key}`,
    '--file', `"${file}"`,
    '--content-type', contentType(file),
    '--cache-control', '"public, max-age=31536000, immutable"',
    '--remote',
  ]);
  return { ok: code === 0, out };
}

/** Truth comes from the public URL, not from the upload's exit code. */
async function headPublic(key) {
  if (!PUBLIC_BASE) return null;
  try {
    const res = await fetch(`${PUBLIC_BASE}/${key}`, { method: 'HEAD' });
    return { status: res.status, type: res.headers.get('content-type') };
  } catch {
    return { status: 0, type: null };
  }
}

async function pool(items, n, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const files = walk(IMG);
  const keys = files.map((f) => ({
    file: f,
    key: 'img/' + relative(IMG, f).replace(/\\/g, '/'),
    size: statSync(f).size,
  }));

  const totalMB = (keys.reduce((a, k) => a + k.size, 0) / 1048576).toFixed(1);
  console.log(
    c.bold(`\nR2 sync ${c.dim(`${keys.length} files, ${totalMB} MB -> ${BUCKET}`)}\n`),
  );

  if (!VERIFY_ONLY) {
    let done = 0;
    const failed = [];
    await pool(keys, CONCURRENCY, async (k) => {
      const r = await putObject(k.key, k.file);
      done++;
      if (!r.ok) failed.push({ key: k.key, out: r.out.trim().split('\n').slice(-3).join(' ') });
      if (done % 25 === 0 || done === keys.length) {
        process.stdout.write(`\r  uploading ${done}/${keys.length}`);
      }
    });
    console.log('');

    // One serial retry. Uploads fail for transient reasons far more often than
    // permanent ones, and a single retry turns a red run into a green one
    // without hiding a real problem - anything still failing here is reported.
    if (failed.length) {
      console.log(c.yellow(`  retrying ${failed.length} failed upload(s) serially`));
      const stillFailed = [];
      for (const f of failed) {
        const k = keys.find((x) => x.key === f.key);
        const r = await putObject(k.key, k.file);
        if (!r.ok) stillFailed.push({ key: k.key, out: r.out.trim().split('\n').slice(-3).join(' ') });
      }
      failed.length = 0;
      failed.push(...stillFailed);
    }

    if (failed.length) {
      console.log(c.red(`\n  ${failed.length} upload(s) failed:`));
      for (const f of failed.slice(0, 5)) console.log(c.dim(`    ${f.key}: ${f.out}`));
      process.exit(1);
    }
    console.log(c.green(`  uploaded ${keys.length} objects`));
  }

  // ---- verification ----
  if (!PUBLIC_BASE) {
    console.log(
      c.yellow('\n  PUBLIC_CDN_URL is not set, so nothing could be verified.') +
        c.dim('\n  Set it in .env before trusting this sync.\n'),
    );
    process.exit(1);
  }

  // One from each folder plus a spread across the rest: enough to catch an
  // empty bucket or a disabled public URL without 265 round trips.
  const byDir = new Map();
  for (const k of keys) {
    const dir = k.key.split('/')[1];
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(k);
  }
  const sample = [];
  for (const [, list] of byDir) {
    sample.push(list[0], list[Math.floor(list.length / 2)], list[list.length - 1]);
  }

  console.log(c.dim(`\n  verifying ${sample.length} objects over ${PUBLIC_BASE}`));

  const bad = [];
  await pool(sample, 6, async (k) => {
    const r = await headPublic(k.key);
    if (!r || r.status !== 200) bad.push({ key: k.key, status: r?.status ?? 'ERR' });
  });

  if (bad.length) {
    console.log(c.red(`\n  FAIL  ${bad.length}/${sample.length} objects are not public:`));
    for (const b of bad.slice(0, 6)) console.log(c.dim(`    ${b.status}  ${b.key}`));
    console.log(
      c.red(c.bold('\n  The bucket is not serving these files.')) +
        '\n  Check that public access (r2.dev) or the custom domain is enabled\n' +
        `  for "${BUCKET}", then re-run.\n`,
    );
    process.exit(1);
  }

  console.log(c.green(`  all ${sample.length} sampled objects return 200`));
  console.log(c.dim('\n  Sync verified.\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
