import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../consts';
import { getAllPosts } from '../lib/posts';

/**
 * Full-site feed. Google Discover, Feedly and news aggregators all read this,
 * and it costs nothing to keep current.
 */
export async function GET(context: APIContext) {
  const posts = await getAllPosts();

  return rss({
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    site: context.site ?? SITE.url,
    items: posts.slice(0, 50).map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.pubDate,
      link: p.url,
      categories: [p.category, ...p.data.tags],
    })),
    customData: '<language>en-us</language>',
  });
}
