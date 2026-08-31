#!/usr/bin/env node
/**
 * Portrait posters for the game hubs.
 *
 *   npm run posters:dry     preview, download nothing
 *   npm run posters         fetch and write
 *   npm run posters -- --force   re-fetch even where a poster exists
 *
 * To add a game: run `npm run posters:find` first. It pulls a dozen portrait
 * candidates per game from SteamGridDB and lays them out as numbered contact
 * sheets in .poster-candidates/. Look at them, pick one, and add it to PICKS
 * below using the id and url from the matching .json.
 *
 * Why every poster is pinned rather than auto-selected:
 *
 *   HOUSE RULE - no female characters in site imagery.
 *
 * No API can enforce that. Official box art frequently breaks it (Cyberpunk
 * 2077's capsule is female V; the Assassin's Creed Shadows capsule leads with
 * Naoe), and "first result" is a moving target - Steam reshuffles which
 * screenshot comes first whenever a store page is updated, which silently
 * swapped a poster mid-session once already. Pinning an exact asset URL is the
 * only arrangement where a re-run cannot change what ships.
 *
 * Format: 800x1200, 2:3 - the ratio every storefront uses for game covers, so
 * a pick drops in with no cropping at all.
 *
 * Licensing: these are SteamGridDB community uploads. Most are publisher art
 * re-hosted; some are fan edits. The uploader is recorded beside each pick.
 * Same editorial-use footing as the covers, but worth a look before adding one.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const CONTENT = join(ROOT, 'src', 'content');
const POSTERS = join(ROOT, 'public', 'img', 'games');
const MANIFEST = join(ROOT, 'src', 'data', 'posters.json');
const CATEGORIES = ['guides', 'news', 'reviews', 'setup'];

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

/** Cover ratio. Kept here so the tile CSS and this script cannot drift apart. */
const POSTER_W = 800;
const POSTER_H = 1200;
const QUALITY = 84;

/**
 * The chosen poster for each game: one exact SteamGridDB asset.
 * `id` traces back to steamgriddb.com/grid/<id>; `by` is the uploader.
 */
const PICKS = {
  'assassins-creed-shadows': {
    id: 554327,
    by: 'r_dsgnd',
    url: 'https://cdn2.steamgriddb.com/grid/e24824672a722a0e4a67b437e7aab84f.png',
  },
  'forza-horizon-6': {
    id: 703425,
    by: 'r_dsgnd',
    url: 'https://cdn2.steamgriddb.com/grid/cd98f0e279d66f4d9acf0e3df40be97a.png',
  },
  'resident-evil-requiem': {
    id: 727491,
    by: 'CluckenDip',
    url: 'https://cdn2.steamgriddb.com/grid/2d5094ace83e5a770819135e5b844c59.jpg',
  },
  'counter-strike-2': {
    id: 318700,
    by: 'Young_Glad',
    url: 'https://cdn2.steamgriddb.com/grid/0662aa1719017e0efa5fa8daf0880c6e.png',
  },
  'helldivers-2': {
    id: 606225,
    by: 'r_dsgnd',
    url: 'https://cdn2.steamgriddb.com/grid/c6e6ddea2f9f700241f1027167825bd4.png',
  },
  'grand-theft-auto-vi': {
    id: 750967,
    by: 'r_dsgnd',
    url: 'https://cdn2.steamgriddb.com/grid/9673af566613060bf3a5294410209886.png',
  },
  'arknights-endfield': {
    id: 665454,
    by: 'vietnick',
    url: 'https://cdn2.steamgriddb.com/grid/11b82b231234129c618112c1ff633ac2.png',
  },
  // SteamGridDB has no portrait grid for this one; Steam's own library capsule
  // is official art and already 2:3.
  'quantum-void': {
    id: 0,
    by: 'TacNours (Steam library capsule)',
    url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/2710650/library_600x900_2x.jpg',
  },
  'cyberpunk-2077': {
    id: 96259,
    by: 'The Duality System',
    url: 'https://cdn2.steamgriddb.com/grid/e8a68217f2c512a63bac2f9244d9c1b5.png',
  },
};

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** Mirrors gameSlug() in src/lib/posts.ts. */
function gameSlug(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Every distinct game named in the content. */
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

/**
 * Writes the poster at the house size.
 *
 * Sources are 2:3 already, so `cover` trims at most a hair off one edge when a
 * grid is 660x930 rather than 600x900. No compositing, no blur fill - that was
 * scaffolding for landscape sources, and pinned covers do not need it.
 */
async function write(buf, outPath) {
  const webp = await sharp(buf)
    .resize(POSTER_W, POSTER_H, { fit: 'cover', position: 'centre' })
    .webp({ quality: QUALITY })
    .toBuffer();

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, webp);
}

async function main() {
  const games = gamesInContent();
  console.log(c.bold(`\nFetching game posters (${POSTER_W}x${POSTER_H}, 2:3)\n`));

  const manifest = {};
  let got = 0;
  const unpinned = [];

  for (const { name, slug } of games) {
    const outPath = join(POSTERS, `${slug}.webp`);
    const publicPath = `/img/games/${slug}.webp`;
    const pick = PICKS[slug];

    if (!pick) {
      unpinned.push(`${slug}  (${name})`);
      console.log(`  ${c.red('none')}  ${slug} — no pick`);
      continue;
    }

    if (existsSync(outPath) && !FORCE) {
      manifest[slug] = publicPath;
      console.log(`  ${c.dim('skip')}  ${slug} ${c.dim('(exists)')}`);
      continue;
    }

    const res = await fetch(pick.url);
    if (!res.ok) {
      console.log(`  ${c.red('fail')}  ${slug} — HTTP ${res.status}`);
      continue;
    }

    if (!DRY) await write(Buffer.from(await res.arrayBuffer()), outPath);
    manifest[slug] = publicPath;
    got++;
    console.log(`  ${c.green('get ')}  ${slug} ${c.dim(`<- sgdb #${pick.id} by ${pick.by}`)}`);
  }

  if (!DRY) {
    mkdirSync(dirname(MANIFEST), { recursive: true });
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  }

  console.log(c.bold('\nDone.') + ` ${got} written, ${unpinned.length} without a pick.`);

  if (unpinned.length) {
    const list = unpinned.map((g) => '    - ' + g).join('\n');
    console.log(`
${c.red(c.bold('  NEEDS A PICK'))}
  These games have no poster and fall back to their article cover:
${list}

  Run: npm run posters:find
  Look at the sheet, choose one that follows the house rule, add it to PICKS.
`);
  } else {
    console.log(c.dim('  Every game is pinned to a reviewed image.\n'));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
