/**
 * Single source of truth for site identity + navigation.
 * Adding a 5th section later = add one entry here. Nothing else needs to change:
 * nav, category pages, colours, badges and the sitemap all read from this file.
 */

export const SITE = {
  name: 'CritVolt',
  tagline: 'Guides, News, Reviews & Gaming Setups',
  description:
    'Deep game guides, breaking gaming news, honest reviews and tested hardware picks for your setup.',
  url: 'https://critvolt.com',
  locale: 'en',
  twitter: '@critvolt',
  themeColor: '#0A0A0C',
} as const;

export type CategoryId = 'guides' | 'news' | 'reviews' | 'setup';

export interface Category {
  id: CategoryId;
  label: string;
  href: string;
  /** CSS custom-property name holding this category's accent colour. */
  color: string;
  blurb: string;
  /** Long-form intro shown on the category archive page (good for SEO). */
  intro: string;
}

export const CATEGORIES: Category[] = [
  {
    id: 'guides',
    label: 'Guides',
    href: '/guides/',
    color: 'var(--cat-guides)',
    blurb: 'Walkthroughs, boss strategies, collectibles and builds.',
    intro:
      'Step-by-step walkthroughs, boss strategies, collectible maps and endgame builds — written by players who actually finished the game.',
  },
  {
    id: 'news',
    label: 'News',
    href: '/news/',
    color: 'var(--cat-news)',
    blurb: 'Releases, patches, leaks and everything breaking right now.',
    intro:
      'Release dates, patch notes, leaks and industry moves. Everything that matters in gaming, as it happens.',
  },
  {
    id: 'reviews',
    label: 'Reviews',
    href: '/reviews/',
    color: 'var(--cat-reviews)',
    blurb: 'Scored verdicts on new and classic games.',
    intro:
      'Full playthroughs before we score. Honest verdicts on new releases, remasters and hidden gems — with a clear buy / skip call.',
  },
  {
    id: 'setup',
    label: 'Setup',
    href: '/setup/',
    color: 'var(--cat-setup)',
    blurb: 'GPUs, gaming PCs, peripherals and build guides.',
    intro:
      'Benchmarked graphics cards, prebuilt and custom gaming PCs, monitors, mice and headsets. Tested picks at every budget.',
  },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, Category>;

/** Secondary links — footer + "More" menu. Keep marketing/legal pages here. */
export const SECONDARY_NAV = [
  { label: 'About', href: '/about/' },
  { label: 'Newsletter', href: '/signup/' },
  { label: 'Affiliate Disclosure', href: '/affiliate-disclosure/' },
  // Reachable from the footer as well as the consent bar: once someone has
  // answered, the bar never shows again, and a policy you can only find before
  // dismissing it is not a policy anyone can consult.
  { label: 'Cookie Policy', href: '/cookie-policy/' },
  { label: 'RSS', href: '/rss.xml' },
];

export const SOCIALS = [
  { label: 'X', href: 'https://x.com/' },
  { label: 'YouTube', href: 'https://youtube.com/' },
  { label: 'Discord', href: 'https://discord.com/' },
];

/** Posts per archive page. One knob for every section archive. */
export const PAGE_SIZE = 12;

/**
 * Where the sign-up form POSTs.
 *
 * Defaults to this site's own /api/subscribe, which writes to the D1
 * `subscribers` table. It used to default to an empty string, which made both
 * sign-up forms silently inert: they looked like working forms, accepted an
 * address, and threw it away.
 *
 * Set PUBLIC_NEWSLETTER_ACTION to post somewhere else instead - a hosted
 * provider like Buttondown, ConvertKit or Beehiiv - and the forms will use
 * that without any code change. PUBLIC_ because the value is baked into the
 * form's action attribute and is visible to everyone: it is an endpoint, not
 * a secret, and Astro only exposes PUBLIC_-prefixed variables to output.
 *
 * The trailing slash is required, not cosmetic. This site sets
 * `trailingSlash: 'always'`, which applies to API routes as well as pages:
 * /api/subscribe is a 404 and only /api/subscribe/ resolves.
 */
export const NEWSLETTER_ACTION: string =
  import.meta.env.PUBLIC_NEWSLETTER_ACTION || '/api/subscribe/';

/** True when sign-ups go to our own D1 rather than a third-party provider. */
export const NEWSLETTER_IS_LOCAL: boolean = NEWSLETTER_ACTION === '/api/subscribe/';

/**
 * Google Tag Manager container ID.
 *
 * Owned by the Cloudflare Pages dashboard, deliberately not by this repo. It
 * is read from the build environment, so changing it is an edit in
 * "Variables and secrets" and a redeploy - no code change, no commit.
 *
 * Read through `process.env` rather than `import.meta.env` because it carries
 * no PUBLIC_ prefix, and Vite only exposes prefixed variables to
 * `import.meta.env`. Every page that renders this layout is prerendered, so
 * this runs in Node at build time where `process` exists; the guard covers the
 * Workers runtime, which has no `process`.
 *
 * Empty means no tag manager and no third-party request at all - the right
 * default for local development, and a safe failure mode rather than a broken
 * page if the variable is ever missing.
 *
 * Note this hides the ID from the *repository*, not from visitors: it is
 * injected into the HTML, so anyone viewing source can read it. It is a
 * container ID, not a credential.
 */
export const GTM_ID: string =
  (typeof process !== 'undefined' ? process.env?.GTM_ID : '') ?? '';
