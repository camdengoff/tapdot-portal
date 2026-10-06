// Starter templates that churches pick from when they make a new page. Admins edit them in the
// portal's Templates panel. Info lives in D1 (table `templates`) and each template's editor project
// in KV as template:<id>. Until an admin opens the panel, the editor's built-in starters are used.
import { HttpError, all, one, run, now, slugify, isSlug } from './db.js';

const out = (t) => ({ id: t.id, name: t.name, desc: t.descr, hidden: !!t.hidden, position: t.position, draftAt: t.draft_at, draftBy: t.draft_by });
const key = (id) => 'template:' + id;

function readProject(text) {
  let proj;
  try { proj = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { proj = null; }
  if (!proj || !Array.isArray(proj.blocks)) throw new HttpError(400, 'The template could not be read.');
  return JSON.stringify(proj);
}
async function row(d, id) {
  const t = isSlug(id) && (await one(d, 'SELECT * FROM templates WHERE id = ?', id));
  if (!t) throw new HttpError(404, 'No such template.');
  return t;
}
async function uniqueId(d, base) {
  const root = slugify(base) || 'template';
  for (let i = 1; i < 200; i++) {
    const id = i === 1 ? root : root.slice(0, 46) + '-' + i;
    if (!(await one(d, 'SELECT 1 FROM templates WHERE id = ?', id))) return id;
  }
  throw new HttpError(409, 'Pick a different name.');
}
async function create(d, env, user, name, desc, projectText, hidden) {
  name = String(name || '').trim().slice(0, 80);
  if (!name) throw new HttpError(400, 'Give the template a name.');
  const id = await uniqueId(d, name);
  const pos = ((await one(d, 'SELECT MAX(position) AS m FROM templates')).m || 0) + 1;
  const at = now();
  await env.PAGES.put(key(id), readProject(projectText));
  await run(d, 'INSERT INTO templates (id, name, descr, position, hidden, created_at, draft_at, draft_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, name, String(desc || '').trim().slice(0, 200), pos, hidden ? 1 : 0, at, at, user.email);
  return id;
}

// The project a new page starts from, or null for a template that doesn't exist.
export async function projectFor(d, env, id) {
  if (!isSlug(id) || !(await one(d, 'SELECT 1 FROM templates WHERE id = ?', id))) return null;
  return env.PAGES.get(key(id));
}

// /api/templates… for a signed-in user. `parts` is the path after /api/.
export async function route({ d, env, request, user, parts, url, json, body }) {
  const M = request.method;
  const admin = () => { if (!user.admin) throw new HttpError(403, 'Only an admin can change templates.'); };

  if (parts.length === 1 && M === 'GET') {
    const rows = await all(d, 'SELECT * FROM templates ' + (user.admin ? '' : 'WHERE hidden = 0 ') + 'ORDER BY position, name');
    const list = rows.map(out);
    if (url.searchParams.get('full')) {
      await Promise.all(list.map(async (t) => { try { t.project = JSON.parse(await env.PAGES.get(key(t.id))); } catch (e) { t.project = null; } }));
    }
    return json({ templates: list });
  }
  admin();
  if (parts.length === 1 && M === 'POST') {
    const b = await body(request);
    let project = b.project;
    if (b.fromPage) {
      const [c, p] = String(b.fromPage).split('/');
      project = isSlug(c) && isSlug(p) ? await env.PAGES.get('draft:' + c + '/' + p) : null;
      if (!project) throw new HttpError(404, 'That page has nothing saved yet.');
    } else if (b.copyFrom) {
      project = await projectFor(d, env, b.copyFrom);
      if (!project) throw new HttpError(404, 'No such template.');
    }
    const id = await create(d, env, user, b.name, b.desc, project || { blocks: [] }, !!b.hidden);
    return json({ id }, 201);
  }
  // The editor's built-in starters, saved once so they can be edited. Only when there are none yet.
  if (parts.length === 2 && parts[1] === 'seed' && M === 'POST') {
    const b = await body(request);
    if ((await one(d, 'SELECT COUNT(*) AS n FROM templates')).n) return json({ ok: true, seeded: 0 });
    const items = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
    for (const it of items) await create(d, env, user, it.name, it.desc, it.project, !!it.hidden);
    return json({ ok: true, seeded: items.length });
  }
  if (parts.length === 2 && parts[1] === 'order' && M === 'POST') {
    const b = await body(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isSlug).slice(0, 200);
    await d.batch(ids.map((id, i) => d.prepare('UPDATE templates SET position = ? WHERE id = ?').bind(i + 1, id)));
    return json({ ok: true });
  }
  const t = await row(d, parts[1]);
  if (parts.length === 2 && M === 'GET') {
    const proj = await env.PAGES.get(key(t.id));
    // Same shape as a page, so the editor can open it.
    return json(Object.assign(out(t), { church: 'Templates', role: 'admin', template: true, draft: proj ? JSON.parse(proj) : null }));
  }
  if (parts.length === 2 && M === 'PATCH') {
    const b = await body(request);
    if (b.name != null) {
      const name = String(b.name).trim().slice(0, 80);
      if (!name) throw new HttpError(400, 'Give the template a name.');
      await run(d, 'UPDATE templates SET name = ? WHERE id = ?', name, t.id);
    }
    if (b.desc != null) await run(d, 'UPDATE templates SET descr = ? WHERE id = ?', String(b.desc).trim().slice(0, 200), t.id);
    if (b.hidden != null) await run(d, 'UPDATE templates SET hidden = ? WHERE id = ?', b.hidden ? 1 : 0, t.id);
    return json({ ok: true });
  }
  if (parts.length === 2 && M === 'DELETE') {
    await env.PAGES.delete(key(t.id));
    await run(d, 'DELETE FROM templates WHERE id = ?', t.id);
    return json({ ok: true });
  }
  if (parts.length === 3 && parts[2] === 'draft' && M === 'PUT') {
    const text = readProject(await body(request, 'text'));
    const base = request.headers.get('X-TapDot-Base') || '';
    if (t.draft_at && base && base !== t.draft_at && request.headers.get('X-TapDot-Force') !== '1') {
      return json({ error: (t.draft_by || 'Someone') + ' saved this template since you opened it.', draftAt: t.draft_at, draftBy: t.draft_by }, 409);
    }
    const at = now();
    await env.PAGES.put(key(t.id), text);
    await run(d, 'UPDATE templates SET draft_at = ?, draft_by = ? WHERE id = ?', at, user.email, t.id);
    return json({ ok: true, draftAt: at });
  }
  throw new HttpError(404, 'Not found.');
}
