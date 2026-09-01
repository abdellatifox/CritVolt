/**
 * The most-read articles of the last week. GET -> JSON.
 *
 * This is the route that justifies having both stores. The aggregate is a
 * GROUP BY over page_views joined back to the article mirror - cheap, but not
 * something worth running on every request when the answer barely moves. So
 * D1 computes it, KV holds the result for a few minutes, and almost every
 * request is answered from the edge without touching the database.
 *
 * The article titles come from the mirror tables the build seeds, which is
 * what makes this a single query instead of a join against the filesystem.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

/** How long a computed list stays good. Trending does not need to be exact. */
const TTL_SECONDS = 300;
const WINDOW_DAYS = 7;
const LIMIT = 8;

const KEY = `trending:v1:${WINDOW_DAYS}d:${LIMIT}`;

interface TrendingRow {
  url: string;
  title: string;
  category: string;
  cover: string | null;
  views: number;
}

export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime?.env;
  if (!env?.DB) return new Response('[]', { status: 503 });

  // Let the CDN and the browser hold it too - a stale trending list is fine,
  // and this keeps repeat visits off the Worker entirely.
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=60, s-maxage=${TTL_SECONDS}`,
  };

  if (env.CACHE) {
    const hit = await env.CACHE.get(KEY);
    if (hit) {
      return new Response(hit, { headers: { ...headers, 'x-cache': 'HIT' } });
    }
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10);

  try {
    const { results } = await env.DB.prepare(
      `SELECT a.url, a.title, c.slug AS category, a.cover, SUM(v.count) AS views
         FROM page_views v
         JOIN articles   a ON a.url = v.path
         JOIN categories c ON c.id  = a.category_id
        WHERE v.day >= ?1
          AND a.draft = 0
        GROUP BY a.id
        ORDER BY views DESC
        LIMIT ?2`,
    )
      .bind(since, LIMIT)
      .all<TrendingRow>();

    const body = JSON.stringify(results ?? []);

    if (env.CACHE) {
      await env.CACHE.put(KEY, body, { expirationTtl: TTL_SECONDS });
    }

    return new Response(body, { headers: { ...headers, 'x-cache': 'MISS' } });
  } catch (err) {
    console.error('trending failed', err);
    // An empty list degrades to "no trending section", which is a fine page.
    return new Response('[]', { headers });
  }
};
