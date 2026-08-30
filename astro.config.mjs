// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // ⚠️ Change this to your real domain before deploying — it drives canonical URLs,
  // the sitemap and the RSS feed. SEO depends on it being correct.
  site: 'https://critvolt.com',

  integrations: [mdx(), sitemap()],

  markdown: {
    shikiConfig: { theme: 'github-dark', wrap: true },
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
    // Allow future remote product/press images (add hosts as you need them).
    domains: [],
  },
});
