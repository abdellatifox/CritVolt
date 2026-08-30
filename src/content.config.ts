import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * One collection per section. Adding a 5th section later = copy one block here
 * and add one entry to src/consts.ts. Nothing else changes.
 */

/** Fields every article shares, whatever the section. */
const base = {
  title: z.string(),
  /** Used as the meta description and the card excerpt. Keep it 120-160 chars. */
  description: z.string(),
  pubDate: z.coerce.date(),
  /** Set this whenever you refresh a post - Google rewards freshness on evergreen pages. */
  updatedDate: z.coerce.date().optional(),
  author: z.string().default('CritVolt Staff'),
  /** Path under /public, e.g. "/img/covers/elden-ring.jpg". Falls back to a generated cover. */
  cover: z.string().optional(),
  coverAlt: z.string().optional(),
  /** Where the artwork came from. Printed under the image - filled in automatically
      by scripts/fetch-covers.mjs, and required by most press-kit terms. */
  coverCredit: z.string().optional(),
  tags: z.array(z.string()).default([]),
  /** Pins the post to the homepage hero / section spotlight. */
  featured: z.boolean().default(false),
  draft: z.boolean().default(false),
};

/** A single monetised product. Reused by ProductCard everywhere. */
const product = z.object({
  name: z.string(),
  /** Short label on the badge: "Best Overall", "Best Value", "Best 1440p"... */
  award: z.string().optional(),
  image: z.string().optional(),
  /** Indicative price only - never hardcode a live price into prose. */
  price: z.string().optional(),
  specs: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  /** Raw retailer URL. The affiliate tag is injected at render time. */
  url: z.string(),
  network: z.enum(['amazon', 'awin', 'impact', 'direct']).default('amazon'),
  retailer: z.string().default('Amazon'),
});

const guides = defineCollection({
  loader: glob({ base: './src/content/guides', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    ...base,
    /** Which game this guide belongs to - powers "more guides for this game". */
    game: z.string().optional(),
    platforms: z.array(z.string()).default([]),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  }),
});

const news = defineCollection({
  loader: glob({ base: './src/content/news', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    ...base,
    game: z.string().optional(),
    source: z.string().optional(),
  }),
});

const reviews = defineCollection({
  loader: glob({ base: './src/content/reviews', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    ...base,
    game: z.string(),
    /** 0-10, one decimal. Drives the score badge colour and the Review schema. */
    score: z.number().min(0).max(10),
    verdict: z.string(),
    pros: z.array(z.string()).default([]),
    cons: z.array(z.string()).default([]),
    platforms: z.array(z.string()).default([]),
    developer: z.string().optional(),
    publisher: z.string().optional(),
    releaseDate: z.coerce.date().optional(),
    /** Optional "buy the game" links - same component as hardware. */
    products: z.array(product).default([]),
  }),
});

const setup = defineCollection({
  loader: glob({ base: './src/content/setup', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    ...base,
    /** gpu | cpu | prebuilt | monitor | peripheral | build - powers filtering later. */
    hardwareType: z.string().optional(),
    /** Set on "best hardware for <game>" pieces so the cover fetcher can find art. */
    game: z.string().optional(),
    /** Buying guides live or die on their product list. */
    products: z.array(product).default([]),
  }),
});

export const collections = { guides, news, reviews, setup };
