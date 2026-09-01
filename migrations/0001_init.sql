-- CritVolt D1 schema
--
-- Two kinds of table live here, and the difference matters:
--
--   MIRROR tables (authors, categories, games, articles, article_tags) are a
--   projection of the Markdown in src/content. Git stays the source of truth
--   for editorial content: it is reviewable, diffable and it is what builds
--   the static HTML. The build re-seeds these, so any direct write to them is
--   overwritten on the next deploy. They exist to make the catalogue
--   queryable - related articles, an admin view, reporting.
--
--   RUNTIME tables (subscribers, page_views) hold data that has no home in
--   Git because it is created by visitors, not by editors. These are the only
--   tables the site ever writes to at request time, and they are never
--   truncated by a deploy.

-- ---------------------------------------------------------------- mirror ---

CREATE TABLE IF NOT EXISTS authors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT,
  bio        TEXT,
  avatar     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  blurb TEXT,
  color TEXT,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS games (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  slug   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  poster TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL,
  url             TEXT NOT NULL UNIQUE,
  category_id     INTEGER NOT NULL REFERENCES categories(id),
  author_id       INTEGER REFERENCES authors(id),
  game_id         INTEGER REFERENCES games(id),
  title           TEXT NOT NULL,
  description     TEXT,
  pub_date        TEXT NOT NULL,
  cover           TEXT,
  cover_alt       TEXT,
  -- Reviews only. NULL everywhere else, which is why there is no CHECK here.
  score           REAL,
  verdict         TEXT,
  featured        INTEGER NOT NULL DEFAULT 0,
  draft           INTEGER NOT NULL DEFAULT 0,
  reading_minutes INTEGER,
  synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  PRIMARY KEY (article_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_author   ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_articles_game     ON articles(game_id);
CREATE INDEX IF NOT EXISTS idx_articles_pubdate  ON articles(pub_date DESC);
CREATE INDEX IF NOT EXISTS idx_tags_tag          ON article_tags(tag);

-- --------------------------------------------------------------- runtime ---

CREATE TABLE IF NOT EXISTS subscribers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE,
  -- pending until a confirmation link is clicked; unsubscribed is kept rather
  -- than deleted so a re-subscribe cannot silently resurrect a opt-out.
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'active', 'unsubscribed')),
  source       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);

-- One row per path per day. Rolling up by day keeps this small enough to
-- aggregate cheaply and means no per-visitor row is ever stored.
CREATE TABLE IF NOT EXISTS page_views (
  path  TEXT NOT NULL,
  day   TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (path, day)
);

CREATE INDEX IF NOT EXISTS idx_views_day ON page_views(day DESC);
