// Stats links: a page that shows a church its tap stats (and, if allowed, its connect card answers)
// with no sign-in and no editing. Made for churches whose pages are edited and published for them.
//
// Each church has at most one link, /app/stats#<token>. The token sits after the # so it never
// reaches server logs or other sites. Owners and admins make, change and turn off the link from the
// church's page in the portal; making a new one stops the old one working.
import { HttpError, one, run, all, now } from './db.js';
import * as stats from './stats.js';
import * as forms from './forms.js';

const newToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
const linkFor = (request, token) => new URL('/app/stats#' + token, request.url).href;
const shareOut = (request, s) => (s ? { link: linkFor(request, s.token), answers: !!s.answers, createdAt: s.created_at, createdBy: s.created_by } : null);

// ── For owners and admins, from the portal ────────────────────────────
// GET    /api/churches/<c>/share   the current link, or null
// POST   /api/churches/<c>/share   make the link (or a new one), { answers }
// PATCH  /api/churches/<c>/share   change what it shows, { answers }
// DELETE /api/churches/<c>/share   turn the link off
export async function manage({ d, request, user, churchId, method, b }) {
  const cur = await one(d, 'SELECT * FROM shares WHERE church_id = ?', churchId);
  if (method === 'GET') return { share: shareOut(request, cur) };
  if (method === 'POST') {
    const answers = b && b.answers != null ? (b.answers ? 1 : 0) : cur ? cur.answers : 0;
    await run(d, 'INSERT INTO shares (church_id, token, answers, created_at, created_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (church_id) DO UPDATE SET token = excluded.token, answers = excluded.answers, created_at = excluded.created_at, created_by = excluded.created_by',
      churchId, newToken(), answers, now(), user.email);
    return { share: shareOut(request, await one(d, 'SELECT * FROM shares WHERE church_id = ?', churchId)) };
  }
  if (method === 'PATCH') {
    if (!cur) throw new HttpError(404, 'This church has no stats link yet.');
    await run(d, 'UPDATE shares SET answers = ? WHERE church_id = ?', b && b.answers ? 1 : 0, churchId);
    return { share: shareOut(request, Object.assign({}, cur, { answers: b && b.answers ? 1 : 0 })) };
  }
  if (method === 'DELETE') {
    await run(d, 'DELETE FROM shares WHERE church_id = ?', churchId);
    return { share: null };
  }
  throw new HttpError(404, 'Not found.');
}

// ── For whoever has the link (no sign-in) ─────────────────────────────
// GET /api/shared/<token>                     church name and its pages
// GET /api/shared/<token>/stats?days=         same as the portal's church stats
// GET /api/shared/<token>/activity?page=&from=&to=
// GET /api/shared/<token>/responses?page=     only if the link includes answers
const GONE = 'This stats link has been turned off or replaced. Ask for a new one.';
export async function route({ d, parts, url, method }) {
  if (method !== 'GET') throw new HttpError(405, 'This link can only be viewed.');
  const token = parts[1] || '';
  if (!/^[0-9a-f]{48}$/.test(token)) throw new HttpError(404, GONE);
  const s = await one(d, 'SELECT s.church_id, s.answers, c.name FROM shares s JOIN churches c ON c.id = s.church_id WHERE s.token = ?', token);
  if (!s) throw new HttpError(404, GONE);
  const churchId = s.church_id;
  const page = async () => {
    const p = await one(d, 'SELECT id FROM pages WHERE church_id = ? AND id = ?', churchId, url.searchParams.get('page') || '');
    if (!p) throw new HttpError(404, 'No such page.');
    return p.id;
  };
  if (parts.length === 2) {
    // Only what the dashboard needs: no draft details and no emails of who edited.
    const pages = await all(d, 'SELECT id, name, published_at AS publishedAt FROM pages WHERE church_id = ? ORDER BY name', churchId);
    return { church: { id: churchId, name: s.name }, pages, answers: !!s.answers, responses: s.answers ? await forms.counts(d, churchId) : {} };
  }
  if (parts.length === 3 && parts[2] === 'stats') return stats.churchStats(d, churchId, url.searchParams.get('days'));
  if (parts.length === 3 && parts[2] === 'activity') return stats.activity(d, churchId, await page(), url.searchParams.get('from'), url.searchParams.get('to'));
  if (parts.length === 3 && parts[2] === 'responses') {
    if (!s.answers) throw new HttpError(403, 'This link doesn’t include connect card answers.');
    const list = await forms.list(d, churchId, await page());
    return { responses: list.map((r) => Object.assign({}, r, { id: undefined, seen: true })) };
  }
  throw new HttpError(404, 'Not found.');
}
