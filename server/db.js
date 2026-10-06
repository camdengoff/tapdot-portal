// Database for the TapDot portal (Cloudflare D1, bound as DB).
// Tables are created on first use, so a new D1 database needs no manual setup.
// Page contents live in KV (bound as PAGES), because D1 rows are capped at about 2 MB and
// pages with uploaded photos can be bigger than that.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    pw_hash TEXT,
    pw_salt TEXT,
    google_sub TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  // One-time links that let someone set (or reset) their password.
  `CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS login_fails (
    email TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS churches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    church_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    added_at TEXT NOT NULL,
    PRIMARY KEY (church_id, email)
  )`,
  `CREATE TABLE IF NOT EXISTS pages (
    church_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    draft_at TEXT,
    draft_by TEXT,
    published_at TEXT,
    published_by TEXT,
    PRIMARY KEY (church_id, id)
  )`,
  // Tap stats: one row per page, day, kind ('view' or 'tap') and button label. See stats.js.
  `CREATE TABLE IF NOT EXISTS stats (
    church_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    n INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (church_id, page_id, day, kind, label)
  )`,
  // Connect card answers sent from live pages. See forms.js.
  `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    church_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    block_id TEXT NOT NULL DEFAULT '',
    form TEXT NOT NULL DEFAULT '',
    answers TEXT NOT NULL,
    created_at TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE INDEX IF NOT EXISTS responses_page ON responses (church_id, page_id, created_at)',
  // Recent form sends per visitor (a hash of their IP address and the page), to slow down spam.
  `CREATE TABLE IF NOT EXISTS form_hits (
    id TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS form_hits_id ON form_hits (id)',
  'CREATE INDEX IF NOT EXISTS members_email ON members (email)',
  'CREATE INDEX IF NOT EXISTS sessions_email ON sessions (email)',
  'CREATE INDEX IF NOT EXISTS login_fails_email ON login_fails (email)',
];

let ready = null;
export function db(env) {
  if (!env.DB) throw new HttpError(500, 'The portal database is not set up yet: bind a D1 database named DB.');
  if (!env.PAGES) throw new HttpError(500, 'Page storage is not set up yet: bind a KV namespace named PAGES.');
  if (!ready) {
    ready = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { ready = null; throw e; });
  }
  return ready.then(() => env.DB);
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const now = () => new Date().toISOString();
export const all = async (d, sql, ...args) => (await d.prepare(sql).bind(...args).all()).results || [];
export const one = (d, sql, ...args) => d.prepare(sql).bind(...args).first();
export const run = (d, sql, ...args) => d.prepare(sql).bind(...args).run();

// Lowercase letters, digits and dashes, used for church and page ids in links.
export function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
}
export const isSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(s || '');
export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e) && e.length <= 200;
