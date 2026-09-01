/**
 * Where image assets are served from.
 *
 * Every image in this project is authored as a root-relative path
 * (`/img/covers/foo.webp`) in content frontmatter, in markdown, and in the
 * generated manifests. This module is the only place that decides which host
 * actually serves them.
 *
 * That indirection exists because of a real incident: a previous migration
 * wrote the R2 hostname directly into 19 articles and ~30 <img> tags. When the
 * bucket turned out to be empty, every image on the site 404'd, and undoing it
 * meant editing 19 content files. With this module, switching between R2, a
 * custom CDN domain and same-origin is one environment variable.
 *
 * Set PUBLIC_CDN_URL to serve from R2. Leave it empty to serve from the
 * deployment itself, which is what dev does and what production falls back to
 * if the variable is ever missing — a missing variable degrades to a working
 * site rather than a broken one.
 */

const RAW = import.meta.env.PUBLIC_CDN_URL ?? '';

/** Normalised base with no trailing slash. Empty string means same-origin. */
export const CDN_BASE: string = RAW.trim().replace(/\/+$/, '');

/** True when images come from a different origin, so the page should preconnect. */
export const CDN_IS_REMOTE: boolean = /^https?:\/\//.test(CDN_BASE);

/**
 * Resolve an asset path to the URL the browser should request.
 *
 * Only `/img/...` paths are rewritten. Everything else — the logo, favicons,
 * fonts, OG images — deliberately stays on the deployment's own origin: they
 * are small, on the critical path, and a cross-origin hop for them would cost
 * more than it saves.
 */
export function cdn(path: string | undefined): string | undefined {
  if (!path) return path;
  if (!CDN_BASE) return path;
  if (!path.startsWith('/img/')) return path;
  return CDN_BASE + path;
}
