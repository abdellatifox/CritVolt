import { getAllPosts } from '../lib/posts';

/**
 * Static search index, built once at build time and fetched by the search
 * overlay the first time a reader opens it.
 *
 * Keys are single letters on purpose: this file is downloaded by every reader
 * who searches, and short keys cut it by roughly a third at a few hundred posts.
 * If the site grows past a few thousand articles, swap this for Pagefind.
 */
export async function GET() {
  const posts = await getAllPosts();

  const index = posts.map((p) => ({
    t: p.data.title,
    d: p.data.description,
    u: p.url,
    c: p.category,
    g: (p.data as any).game ?? '',
    k: p.data.tags.join(' '),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
