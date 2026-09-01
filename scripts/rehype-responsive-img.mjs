/**
 * Rehype plugin: gives every in-article <img> the same responsive treatment
 * Thumb.astro gives component-rendered images.
 *
 * Articles embed screenshots as raw HTML inside the markdown:
 *
 *   <figure><img src="/img/shots/foo.webp" ... /><figcaption>…</figcaption></figure>
 *
 * Those never touch Thumb, so they were shipping the full 1600px file to
 * phones - 32 of them, worth about 134 KiB on a single guide. Rather than
 * hand-editing every article and hoping the next one remembers, the srcset is
 * injected here at build time from the manifest responsive-images.mjs writes.
 *
 * Handles `raw` nodes as well as parsed elements: Astro keeps embedded HTML as
 * raw until rehype-raw runs, and plugin order is not guaranteed.
 *
 * It also rewrites `src` to the CDN. Articles keep root-relative paths so the
 * asset host is never baked into content - astro.config passes the base in,
 * mirroring what src/lib/cdn.ts does for component-rendered images.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const MANIFEST = join(ROOT, 'src', 'data', 'image-widths.json');

const widths = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

/** How wide an in-article image renders: the prose column, capped at 900px. */
const SIZES = '(max-width: 1000px) 100vw, 900px';

export default function rehypeResponsiveImg({ cdnBase = '' } = {}) {
  const base = String(cdnBase).trim().replace(/\/+$/, '');

  /** Same contract as src/lib/cdn.ts: only /img/ moves to the CDN. */
  const cdn = (p) => (base && p.startsWith('/img/') ? base + p : p);

  const srcsetFor = (src) => {
    const ws = widths[src];
    if (!ws?.length) return null;
    return ws
      .map((w) => `${cdn(src.replace(/\.webp$/, `@${w}w.webp`))} ${w}w`)
      .join(', ');
  };

  return (tree) => {
    visit(tree);
  };

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'element' && node.tagName === 'img') {
      const src = node.properties?.src;
      if (typeof src === 'string') {
        if (!node.properties.srcSet) {
          const set = srcsetFor(src);
          if (set) {
            node.properties.srcSet = set;
            node.properties.sizes = SIZES;
          }
        }
        node.properties.src = cdn(src);
      }
    }

    // Raw HTML that has not been parsed into elements yet.
    if (node.type === 'raw' && typeof node.value === 'string' && node.value.includes('<img')) {
      node.value = node.value.replace(/<img\b[^>]*>/g, (tag) => {
        if (/\ssrcset=/i.test(tag)) return tag;
        const src = tag.match(/\ssrc="([^"]+)"/)?.[1];
        if (!src) return tag;
        const set = srcsetFor(src);
        if (!set) return tag;
        return tag.replace(/<img\b/, `<img srcset="${set}" sizes="${SIZES}"`);
      });
    }

    for (const child of node.children ?? []) visit(child);
  }
}
