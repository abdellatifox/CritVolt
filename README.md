# CritVolt

A gaming content site built on Astro. Four sections — **Guides, News, Reviews, Setup** — with
advertising slots and an affiliate layer wired in from the start.

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

---

## The idea

Everything that repeats is a component, and everything that varies is data. That means:

- Adding an article = adding one Markdown file.
- Adding a whole new section = one entry in `src/consts.ts` + one block in `src/content.config.ts`.
- Changing where ads appear = editing `AdSlot` placements, not every page.
- Changing affiliate programme = editing **one** file, not every article.

---

## Project map

```
src/
  consts.ts              Site identity + the section list. Start here.
  content.config.ts      Frontmatter schema for each section.
  lib/
    affiliate.ts         Every money link is built here.
    posts.ts             Querying, sorting, related posts, dates.
  styles/global.css      Design tokens + shared components.
  components/
    Header / Footer      Nav reads the section list from consts.ts.
    ArticleCard          The one card used in every grid on the site.
    ProductCard          The money component: specs, price, tracked buy button.
    AdSlot               Reserved ad space (no layout shift).
    AffiliateDisclosure  Auto-inserted on any page with affiliate links.
    ScoreBadge / Thumb   Review score, and cover art with a generated fallback.
  layouts/BaseLayout     Owns <head>: canonical, OG, JSON-LD, fonts.
  pages/
    index.astro                    Homepage
    [category]/index.astro         Section archive (page 1)
    [category]/page/[page].astro   Archive pages 2+ (noindexed)
    [category]/[slug].astro        Article page for all four sections
    about / affiliate-disclosure / 404 / rss.xml.ts
content/
  guides/ news/ reviews/ setup/    One Markdown file per article.
```

---

## Adding an article

Drop a `.md` file into the right folder. The filename becomes the URL slug.

```md
---
title: "Ashfall Requiem: All 42 Ember Shard Locations"
description: "Meta description and card excerpt. 120-160 characters."
pubDate: 2026-08-22
updatedDate: 2026-08-27   # optional — stamp this whenever you refresh the post
author: "Nadia Roux"
cover: "/img/covers/ashfall.jpg"   # optional — a gradient is generated if absent
game: "Ashfall Requiem"
tags: ["Ashfall Requiem", "Collectibles"]
featured: false           # true = eligible for the homepage hero
draft: false              # true = visible in dev, excluded from the build
---

Body in Markdown. `##` headings become the sidebar table of contents.
```

**Reviews** additionally require `score` (0-10), `verdict` and `game`, and accept
`pros`, `cons`, `platforms`, `developer`, `publisher`, `releaseDate`.
The score drives both the badge colour and the `Review` structured data that produces
star ratings in Google results.

**Setup** articles accept a `products` array (see below).

---

## Affiliate links

Never write a raw retailer link into an article. Add products in frontmatter:

```yaml
products:
  - name: "Nexis RTX 5070 Ti 16GB"
    award: "Best overall"
    price: "$749"
    retailer: "Amazon"
    network: "amazon"          # amazon | awin | impact | direct
    url: "https://www.amazon.com/dp/XXXXXXX"   # raw URL, no tag
    specs:
      - { label: "Memory", value: "16GB GDDR7" }
    pros: ["..."]
    cons: ["..."]
```

At render time `src/lib/affiliate.ts` injects your tracking tag, adds
`rel="sponsored nofollow noopener"`, and appends the article slug as a sub-id so you can
see which post earns. The page also renders an "at a glance" jump list and the
affiliate disclosure automatically.

**Before going live:** replace the placeholder IDs in `src/lib/affiliate.ts`
(`AFFILIATE_IDS`). Changing programme later is a one-file edit.

---

## Ad slots

```astro
<AdSlot id="setup-article-top" format="inarticle" />
```

Formats: `leaderboard` (90px), `billboard` (250px), `rect` (300x250),
`halfpage` (300x600), `inarticle` (280px).

Each slot reserves its height in CSS **before** any ad script runs, so injecting AdSense
cannot push content down and wreck Cumulative Layout Shift. To go live, paste your
AdSense `<ins>` block inside `src/components/AdSlot.astro` — one edit covers every
placement on the site.

Current placements: homepage top + in-feed + rail; archive top + rail;
article top + bottom + rail.

---

## Search

The header search button opens an overlay that filters a static JSON index
(`/search-index.json`, generated at build time from every published article).

- The index is fetched **only** on first open, so search adds nothing to page load.
- Shortcuts: `/` or `Ctrl`/`Cmd`+`K` to open, arrow keys to move, `Enter` to go, `Esc` to close.
- Ranking: title match beats game/tag match beats description match.

No server and no third party. If the site ever passes a few thousand articles,
swap the index for [Pagefind](https://pagefind.app/) — the overlay stays the same.

## Sign-up

`/signup/` and the home-page band both POST to `/api/subscribe/`, which writes to
the D1 `subscribers` table. They are ordinary HTML forms and work with JavaScript
off; `NewsletterEnhance.astro` upgrades them to a fetch so the reader stays put
and sees the result inline.

To use a hosted provider instead (Buttondown, ConvertKit, Beehiiv), set
`PUBLIC_NEWSLETTER_ACTION` to its form endpoint — no code change.

Note the trailing slash: this site sets `trailingSlash: 'always'`, which applies
to API routes too. `/api/subscribe` is a 404; only `/api/subscribe/` resolves.

The header CTA is the only filled accent button in the layout, which is deliberate:
one red button per screen keeps it reading as *the* action.

## The article page

Everything below is a component, so a new article gets all of it for free.

| Piece | What it does |
|---|---|
| `ReadingProgress` | The line under the header that fills as you scroll. Uses CSS scroll-driven animation where supported (zero JS, off the main thread) and falls back to a throttled scroll listener. |
| `ArticleToc` | Collapsible contents box built on `<details>` — works with JS disabled. Folds itself on phones, nests H3s under their H2, and highlights the section you are reading in both itself and the sidebar copy. |
| `ShareRow` | Reddit, X, Facebook and copy-link. Plain anchors to each network's share URL — no third-party widgets, no tracking scripts. |
| `PrevNext` | Older / newer article in the same section. Retention, plus two more internal links per page. |
| `BackToTop` | Appears past 800px of scroll. |
| Heading anchors | A quiet `#` on hover beside every H2/H3, injected by the contents script so the Markdown stays clean. |

Jumping from the contents list briefly flashes the target heading, so the reader can
see where the jump landed.

## Cover art

You do not have to find images by hand. Put the real game name in `game:` and run,
from this folder:

```bash
npm run covers:dry     # show what it would fetch
npm run covers         # fetch and write
```

It pulls official store/press artwork from RAWG (or Steam if you have no RAWG
key), saves it to `public/img/covers/<slug>.jpg`, and fills in `cover:`,
`coverAlt:` and `coverCredit:` for you. The credit line prints under the image.

Only articles with a `game:` field are looked up. Hardware guides get their images
from the manufacturer or from the Amazon product feed instead.

Everything it downloads is resized to 1600px and stored as WebP, so a fetch never
regresses page weight.

### Editorial rule

`scripts/fetch-covers.mjs` carries a `BANNED_SHOTS` / `BANNED_GAMES` list: store
gallery positions that were reviewed and rejected, plus games whose art is
unusable for this site. Rejected positions keep their slot number so
`<game>-3.webp` always means gallery position 3 — without that, later
screenshots would shift down a number and overwrite an image an article already
points at.

## Images

```bash
npm run images:dry     # report what would convert
npm run images         # convert to WebP and rewrite every reference
```

Converts anything under `public/img` to WebP at 1600px, deletes the original, and
rewrites the `cover:` fields and `<figure>` blocks that point at it. Run it after
adding images by hand; the cover fetcher already does this for what it downloads.

The last full pass took the image set from **20MB to 5.2MB (74% smaller)** with no
visible quality loss at the sizes this layout actually displays.

**Never** use YouTube thumbnails, fan art, or images lifted from Google Images.
They belong to whoever made them, and an infringement complaint costs you AdSense
and your affiliate account — the two things this site earns from.

## Cloudflare: R2, D1 and KV

The site is **static with a thin dynamic edge**. All 38 pages are prerendered to
HTML and served from the CDN; only the three routes under `src/pages/api/` run on
a Worker. That split is the whole design — rendering articles per request from a
database cannot beat a file already sitting at the edge, and it is where the 99
mobile score comes from.

| Store | Binding | Holds |
| --- | --- | --- |
| **R2** `critvolt-assets` | `MEDIA` | 265 image files. Reads go over the public CDN URL, not the binding — a bound read would put a Worker in front of every image. |
| **D1** `critvolt-db` | `DB` | The editorial mirror (articles, authors, categories, games, tags) plus the runtime tables (subscribers, page_views). |
| **KV** `CACHE` | `CACHE` | The trending list and per-IP rate-limit counters — small, hot, expiring values. |

### Markdown is still the source of truth

D1 does **not** own the content. `src/content/**/*.md` does. The build projects
that catalogue into the mirror tables so it can be queried — "every article by
this author", "most covered games", joins for a future admin view — but a deploy
rebuilds those tables from scratch, so a direct write to them is overwritten.

`subscribers` and `page_views` are the opposite: they hold data created by
visitors that exists nowhere else, and nothing ever truncates them.

### Where images live

Images are authored as `/img/...` everywhere — in frontmatter, in markdown, in
the manifests. `src/lib/cdn.ts` is the only place that decides which host serves
them, driven by `PUBLIC_CDN_URL`.

This indirection is not decoration. An earlier migration wrote the R2 hostname
directly into 19 articles and ~30 `<img>` tags, pointed them at a bucket that had
never been uploaded to, and deleted the local originals. Every image on the site
404'd. Now switching hosts — or falling back to same-origin — is one variable,
and `public/img/` stays in the repo as both the upload source and a working
fallback if `PUBLIC_CDN_URL` is ever unset.

### Environment variables, and Cloudflare's two stores

This bit costs hours if you get it wrong, so it is written down.

Cloudflare Pages keeps **two separate variable stores**, and they are not
interchangeable:

| Store | Available during `npm run build`? | Available to `/api/` at request time? |
| --- | --- | --- |
| **Build** variables | yes | no |
| **Runtime** variables and secrets | **no** | yes |

CritVolt bakes the GTM tag into HTML at build time, so `GTM_ID` has to be a
**build** variable. Set as a runtime variable it produces a completely green
build that ships no tag at all — the page renders perfectly and simply stops
measuring, with nothing anywhere to notice. That exact mistake happened.

Two more traps in the same area:

- A `[vars]` block in `wrangler.toml` **owns the project's whole variable
  list**. Deleting the block does not leave the variables alone; it removes
  them on the next deploy. That is why there is no `[vars]` block here — a
  value someone edits in the dashboard must not be claimed by the repo.
- A **direct upload** (`npm run pages:deploy`) builds on your machine, so it
  uses your local `.env` and ignores the dashboard entirely. Only a Git push
  proves a dashboard variable actually works.

Where each value lives:

| Variable | Owner | Why |
| --- | --- | --- |
| `PUBLIC_CDN_URL` | `.env.production`, committed | Public, and needed for a fresh clone to build correctly. |
| `GTM_ID` | Cloudflare dashboard only | Editable without a commit; deliberately not in the repo. |
| `STEAMGRIDDB_API_KEY` | local `.env`, gitignored | An actual credential. |

`perf-check.mjs` fails the build on a GTM id that is malformed, missing from
the output, or different from the environment, and says so out loud when there
is no `GTM_ID` at all — because that case otherwise looks exactly like success.

### Commands

```bash
npm run deploy          # sync R2 -> build (+ budget) -> seed D1 -> deploy Pages
npm run r2:sync         # upload public/img to R2, then verify over HTTP
npm run r2:verify       # check only: are the objects actually public?
npm run d1:migrate      # apply migrations/0001_init.sql
npm run d1:seed         # rebuild the mirror from src/content
npm run d1:sql          # print the seed SQL without running it
```

Add `:local` to the D1 commands to work against the dev database that
`astro dev` uses through the platform proxy.

## Adding a fifth section

1. Add an entry to `CATEGORIES` in `src/consts.ts` (id, label, href, colour token, blurb, intro).
2. Add a `--cat-<id>` colour in `src/styles/global.css` and a `[data-cat="<id>"]` rule.
3. Add a collection in `src/content.config.ts` and create `src/content/<id>/`.

Nav, footer, archive page, pagination, article routing, RSS and the sitemap all pick it
up automatically.

---

## Design

Dark base (`#08080b`) with a signal-red brand accent (`#ff3b30`), plus one hue per
section — mint for Guides, amber for News, magenta for Reviews, cyan for Setup. Red is
reserved for the brand alone, and the review score ramp is deliberately duller than
both so a gauge never reads as a label. Cards, section headings and nav
underlines carry the section hue. All of it lives in the token block at the top of `global.css`.

---

## Before deploying

- [ ] Set the real domain in `astro.config.mjs` (`site:`) and `src/consts.ts` (`SITE.url`) — canonical URLs, sitemap and RSS all depend on it.
- [ ] Update the sitemap URL in `public/robots.txt`.
- [ ] Replace `AFFILIATE_IDS` in `src/lib/affiliate.ts` with your real tracking IDs.
- [ ] Set `PUBLIC_CDN_URL` in the Pages environment, or images fall back to same-origin.
- [ ] Replace `public/og-default.png` with a proper branded social image (1200x630).
- [ ] Replace all sample content in `src/content/` — the games, products, prices and
      retailer links shipped here are **placeholders for layout only**.
- [ ] Add real cover images to `public/img/covers/` and reference them via `cover:`.
- [ ] Run `npm run images` after adding any image by hand.
