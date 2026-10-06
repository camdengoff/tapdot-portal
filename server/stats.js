// Tap stats: how many people opened each live page, and which buttons they tapped.
//
// Live pages send a small beacon to POST /api/track (see public/embed.js). Counts are kept per
// page, per day and per button label, so nothing about the visitor is stored.
import { HttpError, all, one, run, isSlug } from './db.js';

const MAX_LABELS_PER_DAY = 200; // keeps junk beacons from filling the table
const KEEP_DAYS = 400;

const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// The visitor's own date, so a Sunday evening visit counts on Sunday wherever the church is.
// Anything more than a day off the server's clock falls back to the server's date.
function pickDay(d) {
  const t = Date.now();
  const near = [dayOf(t - 864e5), dayOf(t), dayOf(t + 864e5)];
  return near.includes(d) ? d : near[1];
}

export async function track(d, request) {
  const text = (await request.text()).slice(0, 2000);
  let b;
  try { b = JSON.parse(text); } catch (e) { throw new HttpError(400, 'Bad beacon.'); }
  const [c, p] = String(b.page || '').split('/');
  const kind = b.ev === 'tap' ? 'tap' : b.ev === 'view' ? 'view' : '';
  if (!kind || !isSlug(c) || !isSlug(p)) throw new HttpError(400, 'Bad beacon.');
  const label = kind === 'tap' ? String(b.label || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Button' : '';
  if (!(await one(d, 'SELECT 1 FROM pages WHERE church_id = ? AND id = ? AND published_at IS NOT NULL', c, p))) return;
  const day = pickDay(String(b.day || ''));
  const bumped = await run(d, 'UPDATE stats SET n = n + 1 WHERE church_id = ? AND page_id = ? AND day = ? AND kind = ? AND label = ?', c, p, day, kind, label);
  if (!bumped.meta.changes) {
    await run(d, `INSERT OR IGNORE INTO stats (church_id, page_id, day, kind, label, n)
      SELECT ?, ?, ?, ?, ?, 1 WHERE (SELECT COUNT(*) FROM stats WHERE church_id = ? AND page_id = ? AND day = ?) < ?`,
    c, p, day, kind, label, c, p, day, MAX_LABELS_PER_DAY);
  }
  if (Math.random() < 0.01) await run(d, 'DELETE FROM stats WHERE day < ?', dayOf(Date.now() - KEEP_DAYS * 864e5));
}

// Every page's counts in a church over the last `days` days (today included).
export async function churchStats(d, churchId, days) {
  days = Math.min(Math.max(parseInt(days, 10) || 30, 1), 365);
  const from = dayOf(Date.now() - (days - 1) * 864e5 - 864e5); // one extra day for visitors ahead of UTC
  const rows = await all(d, 'SELECT page_id, day, kind, label, n FROM stats WHERE church_id = ? AND day >= ? ORDER BY day', churchId, from);
  const pages = {};
  for (const r of rows) {
    const s = pages[r.page_id] || (pages[r.page_id] = { views: {}, taps: {} });
    if (r.kind === 'view') s.views[r.day] = (s.views[r.day] || 0) + r.n;
    else (s.taps[r.day] || (s.taps[r.day] = {}))[r.label] = r.n;
  }
  return { from, pages };
}
