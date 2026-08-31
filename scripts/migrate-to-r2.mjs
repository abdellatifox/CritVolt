/**
 * One-shot migration: replaces every /img/ path in content files with the R2 CDN URL.
 * Also updates component references to mark.webp and game images.
 * Run once after images are confirmed uploaded to R2.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const CDN = 'https://pub-29b2020ad2a44fcfb6073ca4a9925842.r2.dev';

// Files to scan and update
const TARGETS = [
  'src/content',
  'src/pages',
  'src/components',
];

// Extensions to process
const EXTS = new Set(['.md', '.mdx', '.astro', '.ts', '.tsx']);

let totalFiles = 0;
let changedFiles = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (EXTS.has(extname(name))) {
      processFile(full);
    }
  }
}

function processFile(path) {
  const original = readFileSync(path, 'utf8');
  // Replace "/img/ with CDN/img/ (handles both " and ' quotes)
  let updated = original
    .replace(/["']\/img\//g, (m) => m[0] + CDN + '/img/')
    // Replace bare /mark.webp and /og-default.png that are NOT logo/favicon
    .replace(/["']\/mark\.webp["']/g, (m) => m[0] + CDN + '/mark.webp' + m[m.length - 1]);

  totalFiles++;
  if (updated !== original) {
    writeFileSync(path, updated, 'utf8');
    changedFiles++;
    console.log('Updated:', path.replace(process.cwd() + '\\', ''));
  }
}

const root = process.cwd();
for (const target of TARGETS) {
  walk(join(root, target));
}

console.log(`\nDone: ${changedFiles} files changed out of ${totalFiles} scanned.`);
console.log(`CDN: ${CDN}`);
