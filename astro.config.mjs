// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import rehypeResponsiveImg from './scripts/rehype-responsive-img.mjs';

// The rehype plugin runs in plain Node, outside Vite's import.meta.env, so the
// CDN base is read here and handed to it explicitly. Components get the same
// value through src/lib/cdn.ts.
const { PUBLIC_CDN_URL = '' } = loadEnv(process.env.NODE_ENV ?? '', process.cwd(), '');

// https://astro.build/config
export default defineConfig({
  // Drives canonical URLs, the sitemap and the RSS feed. SEO depends on it.
  site: 'https://critvolt.com',

  /**
   * Static, with an adapter.
   *
   * In Astro 5 `output: 'static'` plus an adapter is the hybrid mode: every
   * page is prerendered to HTML at build time, and only the routes that opt
   * out with `export const prerender = false` run on demand. Here that is
   * exactly the /api/ endpoints that talk to D1 and KV.
   *
   * Switching to `output: 'server'` would invert that default and start
   * rendering articles per request. Do not - the 99 mobile score comes from
   * those pages being files on the CDN, not from anything a Worker can do.
   */
  output: 'static',
  adapter: cloudflare({
    // Bindings from wrangler.toml are available in `astro dev` too, so an
    // endpoint that reads D1 can be tested without deploying.
    platformProxy: { enabled: true },
    // sharp cannot run on the Cloudflare runtime. "compile" confines image
    // processing to build time, where it is safe. This site does its resizing
    // in scripts/responsive-images.mjs anyway, so nothing needs it at runtime -
    // but left unset the adapter warns on every build about a service that
    // would fail if anything ever did reach for it.
    imageService: 'compile',
  }),

  integrations: [mdx(), sitemap()],

  markdown: {
    shikiConfig: { theme: 'github-dark', wrap: true },
    // Screenshots embedded in article HTML never pass through Thumb, so they
    // get their srcset - and their CDN host - here instead of relying on
    // whoever writes the next article remembering to add one.
    rehypePlugins: [[rehypeResponsiveImg, { cdnBase: PUBLIC_CDN_URL }]],
  },

  server: {
    // Listen on every loopback address. Left to its default this binds ::1
    // only, and anything resolving "localhost" to 127.0.0.1 - including the
    // HMR websocket - cannot reach the server.
    host: true,
    // Honour PORT so a second dev server can run alongside the first.
    port: Number(process.env.PORT) || 4321,
  },

  build: {
    // Emit /guides/slug/index.html so URLs stay clean and trailing-slash consistent.
    format: 'directory',
  },

  // Stated rather than left to the default, because the host enforces it:
  // directory format serves /guides/, and Cloudflare Pages 308s /guides to
  // /guides/. Declaring it keeps dev honest about the URLs production serves.
  trailingSlash: 'always',

  image: {
    // Remote covers are already sized by scripts/responsive-images.mjs before
    // upload; this only authorises the host for any future Astro-side work.
    domains: ['pub-29b2020ad2a44fcfb6073ca4a9925842.r2.dev'],
  },
});
