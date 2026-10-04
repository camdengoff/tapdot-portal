// The TapDot portal API, served by Cloudflare Pages Functions under /api/.
//
// Roles: admins (ADMIN_EMAILS) see and manage every church. In a church, an "owner" can add
// and remove people, and an "editor" can create, edit and publish pages.
//
// Page storage (KV, bound as PAGES):
//   draft:<church>/<page>  the editor project (JSON), saved as people edit
//   live:<church>/<page>   the published HTML that the site's code block shows
import { db, HttpError, now, all, one, run, slugify, isSlug, normEmail, isEmail } from './db.js';
import * as auth from './auth.js';

const MAX_BODY = 20 * 1024 * 1024;

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers),
});

async function body(request, kind) {
  const len = +(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'That is too big to save (over 20 MB). Try smaller photos.');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'That is too big to save (over 20 MB). Try smaller photos.');
  if (kind === 'text') return text;
  try { return JSON.parse(text || '{}'); } catch (e) { throw new HttpError(400, 'The request was not valid JSON.'); }
}

// Changes must come from the portal itself, not another site (on top of SameSite cookies).
function checkOrigin(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Requests from other sites are not allowed.');
}

async function churchRole(d, user, churchId) {
  if (!isSlug(churchId)) throw new HttpError(404, 'No such church.');
  const church = await one(d, 'SELECT id, name, created_at FROM churches WHERE id = ?', churchId);
  if (!church) throw new HttpError(404, 'No such church.');
  if (user.admin) return { church, role: 'admin' };
  const m = await one(d, 'SELECT role FROM members WHERE church_id = ? AND email = ?', churchId, user.email);
  if (!m) throw new HttpError(404, 'No such church.');
  return { church, role: m.role };
}
const canManage = (role) => role === 'admin' || role === 'owner';

// A password link signs in as that person, so a church owner may only make one for someone who
// is brand new (no password, no Google, in no other church). Resets for anyone else go to an admin.
async function mayMakeLink(d, env, role, churchId, email) {
  if (role === 'admin') return true;
  if (auth.isAdmin(env, email)) return false;
  const u = await one(d, 'SELECT pw_hash, google_sub FROM users WHERE email = ?', email);
  if (u && (u.pw_hash || u.google_sub)) return false;
  return !(await one(d, 'SELECT 1 FROM members WHERE email = ? AND church_id != ? LIMIT 1', email, churchId));
}

async function pageRow(d, churchId, pageId) {
  if (!isSlug(pageId)) throw new HttpError(404, 'No such page.');
  const p = await one(d, 'SELECT * FROM pages WHERE church_id = ? AND id = ?', churchId, pageId);
  if (!p) throw new HttpError(404, 'No such page.');
  return p;
}
const pageOut = (p) => ({ id: p.id, name: p.name, createdAt: p.created_at, draftAt: p.draft_at, draftBy: p.draft_by, publishedAt: p.published_at, publishedBy: p.published_by });

async function uniqueSlug(d, table, base, churchId) {
  const root = slugify(base) || (table === 'churches' ? 'church' : 'page');
  for (let i = 1; i < 200; i++) {
    const id = i === 1 ? root : root.slice(0, 46) + '-' + i;
    const taken = table === 'churches'
      ? await one(d, 'SELECT 1 FROM churches WHERE id = ?', id)
      : await one(d, 'SELECT 1 FROM pages WHERE church_id = ? AND id = ?', churchId, id);
    if (!taken) return id;
  }
  throw new HttpError(409, 'Pick a different name.');
}

export async function handle({ request, env }) {
  try {
    checkOrigin(request);
    const d = await db(env);
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const M = request.method;
    const route = (method, n, first) => M === method && parts.length === n && (!first || parts[0] === first);

    // ── Signed-out routes ────────────────────────────────────────────
    if (route('GET', 1, 'config')) return json({ google: auth.googleEnabled(env), setup: !!env.SETUP_KEY });
    if (parts[0] === 'auth') {
      if (route('POST', 2) && parts[1] === 'login') {
        const b = await body(request);
        return json({ ok: true }, 200, { 'Set-Cookie': await auth.passwordLogin(d, env, b.email, b.password) });
      }
      if (route('POST', 2) && parts[1] === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': await auth.endSession(d, request) });
      // First-time setup: lets an admin set a password using the SETUP_KEY secret, for when
      // Google sign-in isn't set up yet. Remove the secret afterwards to turn this off.
      if (route('POST', 2) && parts[1] === 'setup') {
        const b = await body(request);
        const email = normEmail(b.email);
        if (!env.SETUP_KEY) throw new HttpError(404, 'Setup is turned off.');
        if (!auth.sameString(String(b.key || ''), env.SETUP_KEY) || !auth.isAdmin(env, email)) throw new HttpError(403, 'That setup key or admin email is not right.');
        await auth.setPassword(d, email, b.password);
        return json({ ok: true }, 200, { 'Set-Cookie': await auth.startSession(d, email) });
      }
      if (route('GET', 2) && parts[1] === 'google') return auth.googleStart(env, request);
      if (route('GET', 3) && parts[1] === 'google' && parts[2] === 'callback') return auth.googleCallback(d, env, request);
      if (route('GET', 2) && parts[1] === 'link') {
        const email = await auth.readLink(d, url.searchParams.get('token'));
        if (!email) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.');
        const u = await one(d, 'SELECT name FROM users WHERE email = ?', email);
        return json({ email, name: (u && u.name) || '' });
      }
      if (route('POST', 2) && parts[1] === 'link') {
        const b = await body(request);
        return json({ ok: true }, 200, { 'Set-Cookie': await auth.useLink(d, env, b.token, b.password, b.name) });
      }
      throw new HttpError(404, 'Not found.');
    }

    // ── Everything else needs a signed-in person ─────────────────────
    const user = await auth.currentUser(d, env, request);
    if (!user) throw new HttpError(401, 'Please sign in.');

    if (route('GET', 1, 'me')) {
      const churches = user.admin
        ? (await all(d, 'SELECT id, name FROM churches ORDER BY name')).map((c) => Object.assign(c, { role: 'admin' }))
        : await all(d, 'SELECT c.id, c.name, m.role FROM members m JOIN churches c ON c.id = m.church_id WHERE m.email = ? ORDER BY c.name', user.email);
      return json(Object.assign({}, user, { churches, google: auth.googleEnabled(env) }));
    }
    if (route('PUT', 1, 'me')) {
      const b = await body(request);
      if (typeof b.name === 'string') await run(d, 'UPDATE users SET name = ? WHERE email = ?', b.name.trim().slice(0, 80), user.email);
      if (b.password != null) {
        if (user.hasPassword && !(await auth.verifyPassword(d, user.email, b.currentPassword))) throw new HttpError(400, 'Your current password is not right.');
        await auth.setPassword(d, user.email, b.password);
        return json({ ok: true }, 200, { 'Set-Cookie': await auth.startSession(d, user.email) });
      }
      return json({ ok: true });
    }

    if (parts[0] !== 'churches') throw new HttpError(404, 'Not found.');

    if (route('POST', 1)) {
      if (!user.admin) throw new HttpError(403, 'Only an admin can add churches.');
      const b = await body(request);
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) throw new HttpError(400, 'Give the church a name.');
      const id = await uniqueSlug(d, 'churches', b.id || name);
      await run(d, 'INSERT INTO churches (id, name, created_at) VALUES (?, ?, ?)', id, name, now());
      return json({ id, name }, 201);
    }

    const churchId = parts[1];
    const { church, role } = await churchRole(d, user, churchId);

    if (parts.length === 2) {
      if (M === 'GET') {
        const pages = (await all(d, 'SELECT * FROM pages WHERE church_id = ? ORDER BY name', churchId)).map(pageOut);
        const members = await all(d, 'SELECT m.email, m.role, m.added_at AS addedAt, u.name, (u.pw_hash IS NOT NULL) AS hasPassword, (u.google_sub IS NOT NULL) AS hasGoogle FROM members m LEFT JOIN users u ON u.email = m.email WHERE m.church_id = ? ORDER BY m.email', churchId);
        members.forEach((m) => { m.hasPassword = !!m.hasPassword; m.hasGoogle = !!m.hasGoogle; });
        return json({ church, role, pages, members });
      }
      if (M === 'PATCH') {
        if (!canManage(role)) throw new HttpError(403, 'Only an owner can rename the church.');
        const b = await body(request);
        const name = String(b.name || '').trim().slice(0, 80);
        if (!name) throw new HttpError(400, 'Give the church a name.');
        await run(d, 'UPDATE churches SET name = ? WHERE id = ?', name, churchId);
        return json({ ok: true });
      }
      if (M === 'DELETE') {
        if (!user.admin) throw new HttpError(403, 'Only an admin can delete a church.');
        const pages = await all(d, 'SELECT id FROM pages WHERE church_id = ?', churchId);
        for (const p of pages) await Promise.all([env.PAGES.delete('draft:' + churchId + '/' + p.id), env.PAGES.delete('live:' + churchId + '/' + p.id)]);
        await d.batch([
          d.prepare('DELETE FROM pages WHERE church_id = ?').bind(churchId),
          d.prepare('DELETE FROM members WHERE church_id = ?').bind(churchId),
          d.prepare('DELETE FROM churches WHERE id = ?').bind(churchId),
        ]);
        return json({ ok: true });
      }
    }

    // ── People ───────────────────────────────────────────────────────
    if (parts[2] === 'members') {
      if (!canManage(role)) throw new HttpError(403, 'Only a church owner can change who has access.');
      if (route('POST', 3)) {
        const b = await body(request);
        const email = normEmail(b.email);
        if (!isEmail(email)) throw new HttpError(400, 'That doesn’t look like an email address.');
        const newRole = b.role === 'owner' ? 'owner' : 'editor';
        await run(d, 'INSERT INTO members (church_id, email, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (church_id, email) DO UPDATE SET role = excluded.role', churchId, email, newRole, now());
        const u = await one(d, 'SELECT pw_hash, google_sub FROM users WHERE email = ?', email);
        const fresh = !u || (!u.pw_hash && !u.google_sub);
        const link = fresh && (await mayMakeLink(d, env, role, churchId, email)) ? await auth.makeLink(d, request, email) : null;
        return json({ email, role: newRole, link }, 201);
      }
      const email = normEmail(parts[3]);
      const m = await one(d, 'SELECT role FROM members WHERE church_id = ? AND email = ?', churchId, email);
      if (!m) throw new HttpError(404, 'That person is not in this church.');
      if (route('POST', 5) && parts[4] === 'link') {
        if (!(await mayMakeLink(d, env, role, churchId, email))) throw new HttpError(403, email + ' already has an account. Ask your TapDot admin to reset their password.');
        return json({ link: await auth.makeLink(d, request, email) });
      }
      if (route('PATCH', 4)) {
        const b = await body(request);
        await run(d, 'UPDATE members SET role = ? WHERE church_id = ? AND email = ?', b.role === 'owner' ? 'owner' : 'editor', churchId, email);
        return json({ ok: true });
      }
      if (route('DELETE', 4)) {
        if (email === user.email && !user.admin) throw new HttpError(400, 'You can’t remove yourself. Ask another owner.');
        await run(d, 'DELETE FROM members WHERE church_id = ? AND email = ?', churchId, email);
        // Sign them out if this was the last church they belonged to.
        if (!(await auth.mayUsePortal(d, env, email))) await run(d, 'DELETE FROM sessions WHERE email = ?', email);
        return json({ ok: true });
      }
      throw new HttpError(404, 'Not found.');
    }

    // ── Pages ────────────────────────────────────────────────────────
    if (parts[2] === 'pages') {
      if (route('POST', 3)) {
        const b = await body(request);
        const name = String(b.name || '').trim().slice(0, 80);
        if (!name) throw new HttpError(400, 'Give the page a name.');
        const id = await uniqueSlug(d, 'pages', name, churchId);
        await run(d, 'INSERT INTO pages (church_id, id, name, created_at) VALUES (?, ?, ?, ?)', churchId, id, name, now());
        if (b.copyFrom && isSlug(b.copyFrom)) {
          const src = await env.PAGES.get('draft:' + churchId + '/' + b.copyFrom);
          if (src) {
            await env.PAGES.put('draft:' + churchId + '/' + id, src);
            await run(d, 'UPDATE pages SET draft_at = ?, draft_by = ? WHERE church_id = ? AND id = ?', now(), user.email, churchId, id);
          }
        }
        return json({ id, name }, 201);
      }
      const p = await pageRow(d, churchId, parts[3]);
      const key = churchId + '/' + p.id;
      if (route('GET', 4)) {
        const draft = await env.PAGES.get('draft:' + key);
        return json(Object.assign(pageOut(p), { church: church.name, role, draft: draft ? JSON.parse(draft) : null }));
      }
      if (route('PATCH', 4)) {
        const b = await body(request);
        const name = String(b.name || '').trim().slice(0, 80);
        if (!name) throw new HttpError(400, 'Give the page a name.');
        await run(d, 'UPDATE pages SET name = ? WHERE church_id = ? AND id = ?', name, churchId, p.id);
        return json({ ok: true });
      }
      if (route('DELETE', 4)) {
        await Promise.all([env.PAGES.delete('draft:' + key), env.PAGES.delete('live:' + key)]);
        await run(d, 'DELETE FROM pages WHERE church_id = ? AND id = ?', churchId, p.id);
        return json({ ok: true });
      }
      if (route('PUT', 5) && parts[4] === 'draft') {
        const text = await body(request, 'text');
        let proj;
        try { proj = JSON.parse(text); } catch (e) { throw new HttpError(400, 'The page could not be read.'); }
        if (!proj || !Array.isArray(proj.blocks)) throw new HttpError(400, 'The page could not be read.');
        // Refuse to overwrite someone else's newer save (the editor sends the time it loaded).
        const base = request.headers.get('X-TapDot-Base') || '';
        if (p.draft_at && base && base !== p.draft_at && request.headers.get('X-TapDot-Force') !== '1') {
          return json({ error: (p.draft_by || 'Someone') + ' saved this page since you opened it.', draftAt: p.draft_at, draftBy: p.draft_by }, 409);
        }
        const at = now();
        await env.PAGES.put('draft:' + key, text);
        await run(d, 'UPDATE pages SET draft_at = ?, draft_by = ? WHERE church_id = ? AND id = ?', at, user.email, churchId, p.id);
        return json({ ok: true, draftAt: at });
      }
      if (route('POST', 5) && parts[4] === 'publish') {
        const html = await body(request, 'text');
        if (!html.trim()) throw new HttpError(400, 'Nothing to publish.');
        const at = now();
        let title = p.name;
        try { title = decodeURIComponent(request.headers.get('X-TapDot-Title') || '') || p.name; } catch (e) { /* keep the page name */ }
        title = title.slice(0, 120);
        await env.PAGES.put('live:' + key, html, { metadata: { at, title: encodeURIComponent(title) } }); // metadata must stay ASCII
        await run(d, 'UPDATE pages SET published_at = ?, published_by = ? WHERE church_id = ? AND id = ?', at, user.email, churchId, p.id);
        return json({ ok: true, publishedAt: at });
      }
      if (route('POST', 5) && parts[4] === 'unpublish') {
        await env.PAGES.delete('live:' + key);
        await run(d, 'UPDATE pages SET published_at = NULL, published_by = NULL WHERE church_id = ? AND id = ?', churchId, p.id);
        return json({ ok: true });
      }
    }
    throw new HttpError(404, 'Not found.');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on the server. Please try again.' }, 500);
  }
}

// ── Public live pages ─────────────────────────────────────────────────
// GET /p/<church>/<page>     the published HTML fragment, for the site's code block
// GET /view/<church>/<page>  the same page as a standalone web page (handy for QR codes)
function metaTitle(m) {
  try { return decodeURIComponent((m && m.title) || '') || 'Page'; } catch (e) { return 'Page'; }
}
export async function live({ request, env, params }, standalone) {
  const c = String(params.church || '');
  const p = String(params.page || '');
  const headers = {
    'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=30', 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    // Pages can hold custom HTML, so when opened here they run in a sandbox with no access to
    // this site (the portal's sign-in). Sites that load them through the code block are unaffected.
    'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-top-navigation-by-user-activation',
  };
  if (!env.PAGES || !isSlug(c) || !isSlug(p)) return new Response('Page not found.', { status: 404, headers });
  const { value: html, metadata } = await env.PAGES.getWithMetadata('live:' + c + '/' + p);
  if (html == null) return new Response('Page not found.', { status: 404, headers });
  if (!standalone) return new Response(html, { headers });
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  return new Response('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />\n<title>' + esc(metaTitle(metadata)) + '</title>\n</head>\n<body style="margin:0">\n' + html + '\n</body>\n</html>\n', { headers });
}
