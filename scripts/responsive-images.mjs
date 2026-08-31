#!/usr/bin/env node
/**
 * Generates responsive widths for every image the site serves.
 *
 *   npm run images:responsive
 *
 * The problem this solves: a cover is stored once at 1600x900 and handed to
 * every device. A phone renders it about 375 CSS pixels wide, so the browser
 * downloads roughly seven times the pixels it can use. Across a homepage full
 * of cards that measured about 766 KiB of waste.
 *
 * Each source gets sibling files named `<name>@<w>w.webp` next to the
 * original. The `@` matters: shots are named like `counter-strike-2.webp`, so a
 * plain `-<number>` suffix cannot be told apart from a source filename, and a
 * first pass at this silently treated all 25 screenshots as variants and
 * skipped them. Thumb.astro builds a srcset from them, and the browser
 * picks the smallest file that still covers its layout width and DPR.
 *
 * The original is left in place as the srcset's largest entry and as the plain
 * `src` fallback, so nothing breaks if a variant is missing.
 */

import { readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const IMG = join(ROOT, 'public', 'img');
const MANIFEST = join(ROOT, 'src', 'data', 'image-widths.json');

const FORCE = process.argv.includes('--force');

/**
 * Widths per folder. Covers and shots are 16:9 and appear in card grids and
 * article heroes; posters are 2:3 and never render wider than a tile.
 */
const WIDTHS = {
  covers: [400, 800, 1200, 1600],
  shots: [400, 800, 1200, 1600],
  games: [200, 400, 600, 800],
};

const QUALITY = 78;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

async function main() {
  console.log(c.bold('\nGenerating responsive widths\n'));

  const manifest = {};
  let written = 0;
  let skipped = 0;
  let bytes = 0;

  for (const [folder, widths] of Object.entries(WIDTHS)) {
    const dir = join(IMG, folder);
    if (!existsSync(dir)) continue;

    // Ignore the variants themselves so a re-run does not build variants of
    // variants.
    const sources = readdirSync(dir).filter(
      (f) => f.endsWith('.webp') && !/@\d+w\.webp$/.test(f),
    );

    for (const file of sources) {
      const src = join(dir, file);
      const name = basename(file, extname(file));
      const meta = await sharp(src).metadata();
      const made = [];

      for (const w of widths) {
        // Never upscale: a 800px source gains nothing from a 1600px variant.
        if (w > (meta.width ?? 0)) continue;

        const out = join(dir, `${name}@${w}w.webp`);
        if (existsSync(out) && !FORCE) {
          made.push(w);
          skipped++;
          continue;
        }

        await sharp(src).resize({ width: w }).webp({ quality: QUALITY }).toFile(out);
        made.push(w);
        written++;
        bytes += statSync(out).size;
      }

      if (made.length) manifest[`/img/${folder}/${file}`] = made;
    }

    console.log(`  ${c.green('ok  ')}  ${folder} ${c.dim(sources.length + ' sources')}`);
  }

  mkdirSync(dirname(MANIFEST), { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    c.bold('\nDone.') +
      ` ${written} written, ${skipped} already present` +
      c.dim(` (+${Math.round(bytes / 1024)}KB on disk)\n`),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
