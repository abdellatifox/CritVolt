#!/usr/bin/env node
/**
 * Collects portrait cover candidates for every game in the content, from
 * SteamGridDB, and lays them out as numbered contact sheets for review.
 *
 *   npm run posters:find
 *
 * Nothing is published by this script. It downloads candidates to a scratch
 * folder and writes one sheet per game, so a human can look at the options and
 * pick one. The choice then goes into POSTER_OVERRIDES in fetch-posters.mjs.
 *
 * Why candidates rather than "first result": the house rule bans female
 * characters, and official box art frequently breaks it. A source that returns
 * one image per game cannot satisfy that - SteamGridDB returns dozens, which
 * is the whole reason it was chosen over IGDB.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const CONTENT = join(ROOT, 'src', 'content');
const OUT = join(ROOT, '.poster-candidates');
const CATEGORIES = ['guides', 'news', 'reviews', 'setup'];

/** How many candidates to pull per game. */
const LIMIT = Number(
  (process.argv.find((a) => a.startsWith('--limit=')) ?? '--limit=12').split('=')[1],
);

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Minimal .env reader - avoids a dependency for one variable. */
function env(name) {
  if (process.env[name]) return process.env[name];
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return null;
  const line = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(name + '='));
  if (!line) return null;
  return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') || null;
}

const KEY = env('STEAMGRIDDB_API_KEY');

function gameSlug(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function gamesInContent() {
  const games = new Map();
  for (const cat of CATEGORIES) {
    const dir = join(CONTENT, cat);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => /\.mdx?$/.test(f))) {
      const fm = readFileSync(join(dir, file), 'utf8').split(/^---$/m)[1] ?? '';
      const game = fm.match(/^game:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
      if (game) games.set(game.trim(), gameSlug(game.trim()));
    }
  }
  return [...games].map(([name, slug]) => ({ name, slug }));
}

async function api(path) {
  const res = await fetch(`https://www.steamgriddb.com/api/v2${path}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function main() {
  if (!KEY) {
    console.error(
      c.red('\nNo STEAMGRIDDB_API_KEY.') +
        '\nGet one free at https://www.steamgriddb.com/profile/preferences/api' +
        '\nthen add it to .env\n',
    );
    process.exit(1);
  }

  const games = gamesInContent();
  console.log(c.bold(`\nFinding portrait candidates (${LIMIT} per game)\n`));

  mkdirSync(OUT, { recursive: true });

  for (const { name, slug } of games) {
    const search = await api(`/search/autocomplete/${encodeURIComponent(name)}`);
    const match = search?.data?.[0];
    if (!match) {
      console.log(`  ${c.red('fail')}  ${slug} — no match`);
      continue;
    }

    // 2:3 only. static excludes animated grids, which a poster cannot use.
    const grids = await api(
      `/grids/game/${match.id}?dimensions=600x900,660x930,512x512&types=static&nsfw=false&limit=${LIMIT}`,
    );
    const items = (grids?.data ?? []).filter((g) => g.height > g.width).slice(0, LIMIT);

    if (!items.length) {
      console.log(`  ${c.yellow('none')}  ${slug} — no portrait grids`);
      continue;
    }

    const thumbs = [];
    for (const [i, g] of items.entries()) {
      const res = await fetch(g.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      thumbs.push({
        n: i + 1,
        id: g.id,
        author: g.author?.name ?? '?',
        style: g.style ?? '?',
        size: `${g.width}x${g.height}`,
        url: g.url,
        buf,
      });
    }

    // One sheet per game, numbered so a choice can be named out loud.
    const TW = 240;
    const TH = 360;
    const cols = Math.min(thumbs.length, 6);
    const rows = Math.ceil(thumbs.length / cols);
    const sheet = sharp({
      create: {
        width: TW * cols,
        height: (TH + 26) * rows,
        channels: 3,
        background: { r: 15, g: 15, b: 18 },
      },
    });

    const composites = [];
    for (const [i, t] of thumbs.entries()) {
      const r = Math.floor(i / cols);
      const col = i % cols;
      const img = await sharp(t.buf).resize(TW - 6, TH - 6, { fit: 'cover' }).toBuffer();
      composites.push({ input: img, left: col * TW + 3, top: r * (TH + 26) + 3 });

      const label = Buffer.from(
        `<svg width="${TW}" height="24"><text x="4" y="17" font-family="sans-serif" font-size="14" fill="#dcdce6">${t.n}. ${t.style} · ${t.size}</text></svg>`,
      );
      composites.push({ input: label, left: col * TW, top: r * (TH + 26) + TH });
    }

    const sheetPath = join(OUT, `${slug}.png`);
    await sheet.composite(composites).png().toFile(sheetPath);

    writeFileSync(
      join(OUT, `${slug}.json`),
      JSON.stringify(
        thumbs.map(({ n, id, author, style, size, url }) => ({ n, id, author, style, size, url })),
        null,
        2,
      ) + '\n',
    );

    console.log(`  ${c.green('ok  ')}  ${slug} ${c.dim(`${thumbs.length} candidates`)}`);
  }

  console.log(c.bold(`\nSheets written to .poster-candidates/\n`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
