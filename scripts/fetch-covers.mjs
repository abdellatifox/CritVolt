#!/usr/bin/env node
/**
 * Fills in cover art for any article that names a game.
 *
 *   npm run covers:dry     preview, download nothing
 *   npm run covers         fetch and write
 *   npm run covers -- --force    re-fetch even where a cover already exists
 *
 * Sources, in order of preference:
 *
 *   1. RAWG   — needs a free key in .env (RAWG_API_KEY). Best artwork, widest
 *              coverage, includes console-only titles.
 *   2. Steam  — no key at all. Uses Steam's public app search plus the store
 *              header image. PC titles only.
 *
 * Licensing: both return publisher-supplied store/press artwork, which is the
 * material publishers put out for coverage of their own games. The script
 * records where every image came from in `coverCredit`, and the article page
 * prints that under the image. Do not point this at fan art, YouTube
 * thumbnails, or anything a third party made — those belong to their authors.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const CONTENT = join(ROOT, 'src', 'content');
const COVERS = join(ROOT, 'public', 'img', 'covers');
const SHOTS = join(ROOT, 'public', 'img', 'shots');
const CATEGORIES = ['guides', 'news', 'reviews', 'setup'];

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
/** How many in-article screenshots to pull per game, on top of the cover. */
const SHOT_COUNT = Number(
  (process.argv.find((a) => a.startsWith('--shots=')) ?? '--shots=0').split('=')[1],
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

const RAWG_KEY = env('RAWG_API_KEY');

/**
 * Editorial rule for this site: no images of female characters.
 *
 * Store galleries are ordered, so a screenshot's position is stable. These are
 * the gallery positions (1-based) that were reviewed and rejected, and the
 * games whose art is built around female characters throughout. Without this
 * list a re-run would quietly pull them back in.
 *
 * Anything not listed here has been looked at and cleared.
 */
const BANNED_SHOTS = {
  'Resident Evil Requiem': [1, 4, 6, 9],
  "Assassin's Creed Shadows": [1, 4, 6],
  'Cyberpunk 2077': [1],
};

/** Games to never source art from at all. */
const BANNED_GAMES = new Set(['Apex Legends']);

/** Key art that was reviewed and rejected - fall straight through to a screenshot. */
const BANNED_KEY_ART = new Set([
  'Resident Evil Requiem',
  "Assassin's Creed Shadows",
  'Cyberpunk 2077',
  'Apex Legends',
]);

// ---------------------------------------------------------------- sources

async function fromRawg(game) {
  if (!RAWG_KEY) return null;
  const url =
    `https://api.rawg.io/api/games?key=${RAWG_KEY}` +
    `&search=${encodeURIComponent(game)}&page_size=1&search_precise=true`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`RAWG returned ${res.status}`);

  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit?.background_image) return null;

  return {
    url: hit.background_image,
    credit: `Artwork: ${hit.name} — via RAWG`,
    matched: hit.name,
    source: 'rawg',
  };
}

/**
 * Steam asset variants, widest and highest resolution first.
 *   library_hero      1920x620  - wide key art, centre-cropped by the layout
 *   capsule_616x353    616x353  - almost exactly 16:9, but soft on a big hero
 *   header             460x215  - last resort
 */
const STEAM_ASSETS = ['library_hero.jpg', 'capsule_616x353.jpg', 'header.jpg'];

async function fromSteam(game) {
  // Steam's community app search is public and needs no key.
  const res = await fetch(
    `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(game)}`,
    { headers: { 'user-agent': 'critvolt-cover-fetcher' } },
  );
  if (!res.ok) throw new Error(`Steam returned ${res.status}`);

  const list = await res.json();
  const hit = list?.[0];
  if (!hit?.appid) return null;

  for (const asset of STEAM_ASSETS) {
    const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${hit.appid}/${asset}`;
    const head = await fetch(url, { method: 'HEAD' });
    // Steam answers 200 with a tiny placeholder for assets a game never shipped.
    if (head.ok && Number(head.headers.get('content-length') ?? 0) > 8000) {
      return {
        url,
        credit: `Artwork: ${hit.name} — via Steam`,
        matched: hit.name,
        source: 'steam',
        appid: hit.appid,
      };
    }
  }

  return null;
}

/** Steam appid lookup, memoised - the same game appears in several articles. */
const appidCache = new Map();
async function steamAppId(game) {
  if (appidCache.has(game)) return appidCache.get(game);
  const res = await fetch(
    `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(game)}`,
    { headers: { 'user-agent': 'critvolt-cover-fetcher' } },
  );
  const list = res.ok ? await res.json() : [];
  const id = list?.[0]?.appid ?? null;
  appidCache.set(game, id);
  return id;
}

/**
 * Official 1920x1080 store screenshots. These are the same images the publisher
 * puts on the store page for people to look at before buying - the material
 * intended to be seen and reproduced in coverage.
 */
const shotsCache = new Map();
async function screenshots(game, count) {
  if (count < 1) return [];
  if (shotsCache.has(game)) return shotsCache.get(game).slice(0, count);

  const appid = await steamAppId(game);
  if (!appid) return [];

  const res = await fetch(
    `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`,
    { headers: { 'user-agent': 'critvolt-cover-fetcher' } },
  );
  if (!res.ok) return [];

  const data = await res.json();
  const entry = data?.[appid];
  const shots = entry?.success ? (entry.data.screenshots ?? []) : [];
  const urls = shots.map((s) => s.path_full).filter(Boolean);

  const banned = new Set(BANNED_SHOTS[game] ?? []);
  // null keeps the slot so <game>-3.jpg always means gallery position 3.
  const vetted = urls.map((u, i) => (banned.has(i + 1) ? null : u));

  shotsCache.set(game, vetted);
  return vetted.slice(0, count);
}

/** URL-safe slug for a game name, used to name its shared screenshot pool. */
function gameSlug(game) {
  return game
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Matches scripts/optimize-images.mjs so both paths produce identical files. */
const MAX_WIDTH = 1600;
const QUALITY = 80;

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) return false;

  // Store art already resized and in WebP - roughly a quarter of the bytes,
  // and it means a fresh fetch never regresses page weight.
  const webp = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, webp);
  return true;
}

/**
 * How many covers this game has already handed out in this run. The first
 * article about a game gets the key art; the rest get distinct store
 * screenshots, so four pieces about the same title do not all look identical
 * on the homepage.
 */
const coverTurn = new Map();

async function resolve(game) {
  if (BANNED_GAMES.has(game)) {
    console.log(`  ${c.dim('    "' + game + '" is on the no-source list')}`);
    return null;
  }

  for (const fn of [fromRawg, fromSteam]) {
    try {
      const hit = await fn(game);
      if (!hit) continue;

      // Key art is the default cover, unless this game's key art was rejected.
      const turn = (coverTurn.get(game) ?? 0) + (BANNED_KEY_ART.has(game) ? 1 : 0);
      coverTurn.set(game, (coverTurn.get(game) ?? 0) + 1);
      if (turn === 0) return hit;

      // Second article onward: take a screenshot instead of the key art.
      // Picked from the END of the store gallery, because articles reference the
      // start of it for their in-body figures - this keeps a cover from
      // repeating an image that appears inside the same piece.
      const pool = (await screenshots(game, 20)).filter(Boolean);
      const alt = pool[pool.length - turn];
      if (!alt) return hit;

      return { ...hit, url: alt, credit: hit.credit.replace('Artwork:', 'Screenshot:') };
    } catch (err) {
      console.log(`  ${c.dim('(' + fn.name + ': ' + err.message + ')')}`);
    }
  }
  return null;
}

// ---------------------------------------------------------------- frontmatter

function splitFrontmatter(text) {
  const m = text.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!m) return null;
  return { open: m[1], body: m[2], close: m[3], rest: text.slice(m[0].length) };
}

function readKey(fm, key) {
  const m = fm.body.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/** Set a key if present, append it if not. Comments and ordering survive. */
function setKey(fm, key, value) {
  const line = `${key}: "${value.replace(/"/g, "'")}"`;
  const re = new RegExp(`^${key}:.*$`, 'm');
  fm.body = re.test(fm.body) ? fm.body.replace(re, line) : `${fm.body}\n${line}`;
}

// ---------------------------------------------------------------- run

console.log(c.bold(DRY ? '\nDry run — nothing will be downloaded\n' : '\nFetching cover art\n'));
console.log(
  RAWG_KEY
    ? c.dim('Source: RAWG (key found), falling back to Steam\n')
    : c.yellow('No RAWG_API_KEY in .env — using Steam only (PC titles).\n'),
);

let done = 0;
let missed = 0;
let skipped = 0;
let shots = 0;
/** Games whose screenshot pool has already been pulled this run. */
const shotPools = new Set();

for (const cat of CATEGORIES) {
  const dir = join(CONTENT, cat);
  if (!existsSync(dir)) continue;

  const files = readdirSync(dir).filter((f) => extname(f) === '.md' || extname(f) === '.mdx');
  if (files.length === 0) continue;

  console.log(c.bold(cat.toUpperCase()));

  for (const file of files) {
    const path = join(dir, file);
    const slug = basename(file, extname(file));
    const text = readFileSync(path, 'utf8');
    const fm = splitFrontmatter(text);
    if (!fm) continue;

    const game = readKey(fm, 'game');
    const cover = readKey(fm, 'cover');
    const hasReal = cover && !cover.includes('FILENAME');

    if (!game) {
      console.log(`  ${c.dim('----')}  ${slug} ${c.dim('— no game: field, nothing to look up')}`);
      skipped++;
      continue;
    }
    // In-article screenshots. Named after the GAME, not the article, so every
    // piece about the same title shares one pool at a predictable path:
    // /img/shots/<game>-1.jpg, -2.jpg ... An article picks whichever it needs.
    if (SHOT_COUNT > 0) {
      const g = gameSlug(game);
      if (!shotPools.has(g)) {
        shotPools.add(g);
        const urls = await screenshots(game, SHOT_COUNT);

        if (urls.length === 0) {
          console.log(`  ${c.dim('    no store screenshots for "' + game + '"')}`);
        }

        for (const [i, url] of urls.entries()) {
          if (!url) continue; // rejected slot, number stays reserved
          const shotPath = join(SHOTS, `${g}-${i + 1}.webp`);
          if (DRY) {
            console.log(`  ${c.dim('    shot -> /img/shots/' + g + '-' + (i + 1) + '.webp')}`);
            continue;
          }
          if (await download(url, shotPath)) {
            shots++;
            console.log(
              `  ${c.dim('    shot ' + (i + 1) + '  ' + Math.round(statSync(shotPath).size / 1024) + 'KB')}`,
            );
          }
        }
      }
    }

    if (hasReal && !FORCE) {
      console.log(`  ${c.dim('keep')}  ${slug} ${c.dim('— already has a cover')}`);
      skipped++;
      continue;
    }

    const hit = await resolve(game);
    if (!hit) {
      console.log(`  ${c.red('miss')}  ${slug} ${c.dim('— no artwork found for "' + game + '"')}`);
      missed++;
      continue;
    }

    const outName = `${slug}.webp`;
    const outPath = join(COVERS, outName);

    if (!DRY) {
      if (!(await download(hit.url, outPath))) {
        console.log(`  ${c.red('fail')}  ${slug} — cover download failed`);
        missed++;
        continue;
      }

      setKey(fm, 'cover', `/img/covers/${outName}`);
      if (!readKey(fm, 'coverAlt')) setKey(fm, 'coverAlt', `${hit.matched} key art`);
      setKey(fm, 'coverCredit', hit.credit);
      writeFileSync(path, fm.open + fm.body + fm.close + fm.rest);
    }

    const size = !DRY && existsSync(outPath) ? ` ${c.dim(Math.round(statSync(outPath).size / 1024) + 'KB')}` : '';
    console.log(
      `  ${c.green('get ')}  ${slug} ${c.dim('<- ' + hit.matched + ' (' + hit.source + ')')}${size}`,
    );
    done++;

  }

  console.log('');
}

console.log(
  `${c.bold('Done.')} ${done} cover${done === 1 ? '' : 's'}` +
    (SHOT_COUNT > 0 ? `, ${shots} screenshot${shots === 1 ? '' : 's'}` : '') +
    `, ${missed} not found, ${skipped} skipped.`,
);
if (missed > 0) {
  console.log(
    c.dim(
      'Not found usually means the game name does not match a real title.\n' +
        'Check spelling, or set the cover by hand for that article.\n',
    ),
  );
}
