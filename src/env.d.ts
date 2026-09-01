/// <reference types="astro/client" />

/**
 * Cloudflare bindings, as declared in wrangler.toml.
 *
 * These are only present in code that actually runs on the Worker - that is,
 * the routes under src/pages/api/ marked `export const prerender = false`.
 * Every other page is prerendered at build time, where `locals.runtime` does
 * not exist, so anything reading these must be an on-demand route.
 */
type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

interface Env {
  /** Editorial mirror + the runtime tables (subscribers, page_views). */
  DB: import('@cloudflare/workers-types').D1Database;
  /** Trending cache and per-IP rate-limit counters. */
  CACHE: import('@cloudflare/workers-types').KVNamespace;
  /** Image bucket. Reads go over the public CDN URL; this is for writes. */
  MEDIA: import('@cloudflare/workers-types').R2Bucket;
}

declare namespace App {
  interface Locals extends Runtime {}
}

interface ImportMetaEnv {
  /** Public base URL for /img/ assets. Empty means serve from this origin. */
  readonly PUBLIC_CDN_URL: string;
  readonly PUBLIC_NEWSLETTER_ACTION: string;
  /** GTM container ID. Empty ships no analytics. */
  readonly PUBLIC_GTM_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
