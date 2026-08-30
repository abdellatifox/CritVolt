#!/usr/bin/env node
/**
 * Converts every image under public/img to WebP and rewrites the articles that
 * point at them.
 *
 *   npm run images:dry     report what would change, touch nothing
 *   npm run images         convert, rewrite references, delete the originals
 *
 * Why this rather than astro:assets: the in-article figures are raw <figure>
 * blocks inside Markdown, and Astro's image pipeline only processes images it
 * can resolve at build time from an import or a relative Markdown link. Doing
 * the work at the source keeps one code path for covers and body images alike,
 * and the files that ship are already the files that are served.
 *
 * Cover art is capped at MAX_WIDTH because nothing on the site displays an
 * image wider than the 1300px content column - twice that is enough for a
 * high-density screen and everything beyond it is wasted bytes.
 */

import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const IMG = join(ROOT, 'public', 'img');
const CONTENT = join(ROOT, 'src', 'content');

const MAX_WIDTH = 1600;
const QUALITY = 80;
const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png']);

const DRY = process.argv.includes('--dry');

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const kb = (n) => Math.round(n / 1024);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

console.log(c.bold(DRY ? '\nDry run — no files will be written\n' : '\nOptimising images\n'));

const files = walk(IMG).filter((f) => SOURCE_EXT.has(extname(f).toLowerCase()));
if (files.length === 0) {
  console.log(c.dim('Nothing to convert — everything under public/img is already WebP.\n'));
  process.exit(0);
}

let before = 0;
let after = 0;
const renames = new Map();

for (const file of files) {
  const src = readFileSync(file);
  const meta = await sharp(src).metadata();

  const out = file.replace(/\.(jpe?g|png)$/i, '.webp');
  const buf = await sharp(src)
    // withoutEnlargement keeps small source art from being upscaled into noise.
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  before += src.length;
  after += buf.length;

  const rel = '/' + relative(join(ROOT, 'public'), file).split('\\').join('/');
  renames.set(rel, rel.replace(/\.(jpe?g|png)$/i, '.webp'));

  if (!DRY) {
    writeFileSync(out, buf);
    unlinkSync(file);
  }

  const w = Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH);
  console.log(
    `  ${c.green('conv')}  ${rel.padEnd(52)} ${c.dim(
      `${meta.width}px ${kb(src.length)}KB -> ${w}px ${kb(buf.length)}KB`,
    )}`,
  );
}

// Rewrite every article that points at a converted file.
let touched = 0;
for (const dir of readdirSync(CONTENT)) {
  const sub = join(CONTENT, dir);
  if (!statSync(sub).isDirectory()) continue;

  for (const name of readdirSync(sub)) {
    const path = join(sub, name);
    let text = readFileSync(path, 'utf8');
    const original = text;

    for (const [from, to] of renames) text = text.split(from).join(to);

    if (text !== original) {
      if (!DRY) writeFileSync(path, text);
      touched++;
    }
  }
}

const saved = before - after;
console.log(
  `\n${c.bold('Done.')} ${files.length} images, ${touched} article${touched === 1 ? '' : 's'} rewritten.`,
);
console.log(
  `${c.dim(`${kb(before)}KB -> ${kb(after)}KB — saved ${kb(saved)}KB (${Math.round((saved / before) * 100)}%)`)}\n`,
);
