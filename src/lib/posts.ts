import { getCollection, type CollectionEntry } from 'astro:content';
import type { CategoryId } from '../consts';

/** A post from any section, normalised so components never care which one. */
export type Post = CollectionEntry<'guides' | 'news' | 'reviews' | 'setup'> & {
  category: CategoryId;
  /** Final public URL, e.g. /guides/elden-ring-boss-order/ */
  url: string;
};

const isLive = ({ data }: { data: { draft: boolean } }) =>
  import.meta.env.DEV || !data.draft;

function decorate(entries: any[], category: CategoryId): Post[] {
  return entries.map((e) => ({ ...e, category, url: `/${category}/${e.id}/` }));
}

/** Newest first. */
const byDate = (a: Post, b: Post) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf();

/** All live posts of one section, newest first. */
export async function getSection(category: CategoryId): Promise<Post[]> {
  const entries = await getCollection(category as any, isLive as any);
  return decorate(entries, category).sort(byDate);
}

/** Every live post across every section, newest first. */
export async function getAllPosts(): Promise<Post[]> {
  const sections: CategoryId[] = ['guides', 'news', 'reviews', 'setup'];
  const all = await Promise.all(sections.map(getSection));
  return all.flat().sort(byDate);
}

/**
 * Homepage hero picks: featured posts first, then the newest.
 * Never returns duplicates, so the hero and the feed below it can share a source.
 */
export function pickFeatured(posts: Post[], count: number): Post[] {
  const featured = posts.filter((p) => p.data.featured);
  const rest = posts.filter((p) => !p.data.featured);
  return [...featured, ...rest].slice(0, count);
}

/** Posts related to `post` - same game first, then same tags, then same section. */
export function related(post: Post, pool: Post[], count = 4): Post[] {
  const game = (post.data as any).game;
  const tags = new Set(post.data.tags);

  const scored = pool
    .filter((p) => p.url !== post.url)
    .map((p) => {
      let score = 0;
      if (game && (p.data as any).game === game) score += 10;
      score += p.data.tags.filter((t) => tags.has(t)).length * 3;
      if (p.category === post.category) score += 1;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, count).map((x) => x.p);
}

/** en-GB-ish date used across cards and bylines. */
export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Rough reading time. Readers trust it and it lifts dwell time. */
export function readingTime(body: string | undefined): string {
  return `${readingMinutes(body)} min read`;
}

/** Just the number, for bylines that render their own unit. */
export function readingMinutes(body: string | undefined): number {
  const words = (body ?? '').trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 220));
}

/**
 * Previous / next post inside the same section.
 * Keeps readers moving through an archive instead of bouncing, and gives every
 * article two more internal links - which is free crawl depth for search.
 */
export function adjacent(post: Post, section: Post[]) {
  const i = section.findIndex((p) => p.url === post.url);
  return {
    // The list is newest-first, so "previous" is the older post below it.
    prev: i >= 0 && i < section.length - 1 ? section[i + 1] : null,
    next: i > 0 ? section[i - 1] : null,
  };
}

/** One game and everything published about it. */
export type GameHub = {
  name: string;
  slug: string;
  count: number;
  cover?: string;
  latest: Date;
  /** Which sections cover it, in publication order - "Guides, Reviews". */
  sections: string[];
};

export function gameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Groups every post that names a game into a hub.
 *
 * The counts are real, which matters: a row of cards that all say the same
 * number is the surest sign a page was generated rather than published.
 */
export function gamesCovered(posts: Post[]): GameHub[] {
  const map = new Map<string, GameHub>();

  for (const p of posts) {
    const name = (p.data as any).game as string | undefined;
    if (!name) continue;

    const hub =
      map.get(name) ??
      ({ name, slug: gameSlug(name), count: 0, cover: undefined, latest: new Date(0), sections: [] } as GameHub);

    hub.count++;
    if (!hub.cover && p.data.cover) hub.cover = p.data.cover;
    if (p.data.pubDate > hub.latest) hub.latest = p.data.pubDate;
    if (!hub.sections.includes(p.category)) hub.sections.push(p.category);

    map.set(name, hub);
  }

  // Most covered first, then most recently touched.
  return [...map.values()].sort(
    (a, b) => b.count - a.count || +b.latest - +a.latest,
  );
}

/** Every post about one game, newest first. */
export function postsForGame(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => {
    const g = (p.data as any).game as string | undefined;
    return g ? gameSlug(g) === slug : false;
  });
}
