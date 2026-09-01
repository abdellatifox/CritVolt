/**
 * Records that an article was read. POST { path } -> D1 `page_views`.
 *
 * Counts are rolled up per path per day rather than stored per visit, so the
 * table stays small and no per-visitor record is ever written - no cookie, no
 * IP, no session id. What is kept is "this URL was read N times on this day",
 * which is all the trending list needs.
 *
 * The write goes to D1 rather than KV even though KV is the faster store:
 * KV coalesces writes to the same key and is eventually consistent, so
 * concurrent increments quietly lose counts. SQL `ON CONFLICT ... SET
 * count = count + 1` does not.
 */

import type { APIRoute } from 'astro';

export const prerender = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/**
 * Only count paths this site actually publishes.
 *
 * Without this the table is an open write endpoint: anyone can POST arbitrary
 * strings and both bloat the table and poison the trending list with URLs
 * that do not exist.
 */
const PATH = /^\/(guides|news|reviews|setup|games)\/[a-z0-9-]+\/$/;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime?.env;
  if (!env?.DB) return json({ ok: false }, 503);

  let path = '';
  try {
    const body = (await request.json()) as { path?: string };
    path = (body.path ?? '').trim();
  } catch {
    return json({ ok: false, error: 'Bad request.' }, 400);
  }

  if (!PATH.test(path)) {
    return json({ ok: false, error: 'Not a tracked path.' }, 400);
  }

  const day = new Date().toISOString().slice(0, 10);

  try {
    await env.DB.prepare(
      `INSERT INTO page_views (path, day, count)
       VALUES (?1, ?2, 1)
       ON CONFLICT(path, day) DO UPDATE SET count = count + 1`,
    )
      .bind(path, day)
      .run();

    return json({ ok: true });
  } catch (err) {
    console.error('view failed', err);
    // A lost analytics write must never surface to the reader, so this stays
    // a quiet 200 rather than an error the page has to handle.
    return json({ ok: true });
  }
};
