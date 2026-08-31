/**
 * Single source of truth for site identity + navigation.
 * Adding a 5th section later = add one entry here. Nothing else needs to change:
 * nav, category pages, colours, badges and the sitemap all read from this file.
 */

export const CDN = 'https://pub-29b2020ad2a44fcfb6073ca4a9925842.r2.dev';

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
 * Where the sign-up form POSTs. Paste the form endpoint from your email
 * provider (Buttondown, ConvertKit, Mailchimp, Beehiiv — they all give you one).
 * Left empty the form is inert, which is why the page says so in dev.
 *
 * Set PUBLIC_NEWSLETTER_ACTION in the environment to override it without
 * editing code. PUBLIC_ because the value is baked into the form's action
 * attribute and is therefore visible to everyone - it is an endpoint, not a
 * secret, and Astro only exposes PUBLIC_-prefixed variables to output.
 */
export const NEWSLETTER_ACTION: string = import.meta.env.PUBLIC_NEWSLETTER_ACTION ?? '';
