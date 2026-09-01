/**
 * Newsletter sign-up. POST { email } -> D1 `subscribers`.
 *
 * This is one of only three routes on the site that run on demand. Everything
 * else is a prerendered file, and the sign-up form used to post to whatever
 * third-party endpoint PUBLIC_NEWSLETTER_ACTION happened to hold - which for
 * this site was an empty string, so the form did nothing at all.
 *
 * Rate limiting lives in KV rather than D1 on purpose: it is a hot, tiny,
 * expiring counter that nobody ever needs to query historically, which is
 * exactly the shape KV is good at and exactly the shape a SQL row is not.
 */

import type { APIRoute } from 'astro';

// Runs on the Worker rather than being baked into the build.
export const prerender = false;

/** Sign-ups allowed from one IP per window, before it starts refusing. */
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 3600;

/**
 * Deliberately permissive. The only thing worth rejecting here is input that
 * is obviously not an address; anything stricter starts refusing real, valid
 * addresses (plus-tags, long TLDs, unicode domains) and the confirmation mail
 * is what actually proves an address works.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Never let a CDN or browser cache a mutation's response.
      'cache-control': 'no-store',
    },
  });
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  const env = locals.runtime?.env;
  if (!env?.DB) {
    return json({ ok: false, error: 'Storage is not configured.' }, 503);
  }

  // Accept both fetch() JSON and a plain <form> post, so the page keeps
  // working with JavaScript disabled.
  let email = '';
  let source = 'site';
  const type = request.headers.get('content-type') ?? '';

  try {
    if (type.includes('application/json')) {
      const body = (await request.json()) as { email?: string; source?: string };
      email = (body.email ?? '').trim().toLowerCase();
      source = (body.source ?? source).slice(0, 64);
    } else {
      const form = await request.formData();
      email = String(form.get('email') ?? '').trim().toLowerCase();
      source = String(form.get('source') ?? source).slice(0, 64);
    }
  } catch {
    return json({ ok: false, error: 'Could not read that request.' }, 400);
  }

  if (!EMAIL.test(email) || email.length > 254) {
    return json({ ok: false, error: 'That does not look like an email address.' }, 400);
  }

  // ---- rate limit (KV) ----
  const ip = clientAddress || request.headers.get('cf-connecting-ip') || 'unknown';
  const rlKey = `rl:subscribe:${ip}`;

  if (env.CACHE) {
    const seen = Number((await env.CACHE.get(rlKey)) ?? '0');
    if (seen >= RATE_LIMIT) {
      return json({ ok: false, error: 'Too many sign-ups from here. Try again later.' }, 429);
    }
    await env.CACHE.put(rlKey, String(seen + 1), { expirationTtl: RATE_WINDOW_SECONDS });
  }

  // ---- persist (D1) ----
  try {
    // A repeat sign-up is not an error to the person doing it, so collapse it
    // to the same success response. The DO NOTHING also means re-submitting
    // cannot flip an `unsubscribed` row back to pending behind their back.
    await env.DB.prepare(
      `INSERT INTO subscribers (email, status, source)
       VALUES (?1, 'pending', ?2)
       ON CONFLICT(email) DO NOTHING`,
    )
      .bind(email, source)
      .run();

    return json({ ok: true, message: "You're on the list." });
  } catch (err) {
    console.error('subscribe failed', err);
    return json({ ok: false, error: 'Could not save that. Try again.' }, 500);
  }
};

/** A GET here is almost always a mistake, so say so rather than 404. */
export const GET: APIRoute = () =>
  json({ ok: false, error: 'POST an email address to this endpoint.' }, 405);
