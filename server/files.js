// Photos and PDFs shown in the full-screen viewer (the "Show a photo or PDF" button action).
// They live in KV (bound as PAGES) as file:<church>/<id>, apart from the page itself, so a page
// with a big PDF on it still loads quickly. KV holds up to 25 MB per file; we allow 20 MB.
//
// POST /api/files/<church>   upload (signed in, member of the church; "_templates" is admins only)
// GET  /f/<church>/<id>      the file, for anyone (live pages are public)
import { HttpError, isSlug } from './db.js';

const MAX = 20 * 1024 * 1024;
// No SVG: it can carry scripts, and these are served from the portal's own address.
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const TEMPLATES = '_templates';
const okOwner = (c) => c === TEMPLATES || isSlug(c);

export async function upload(env, request, churchId) {
  if (!okOwner(churchId)) throw new HttpError(404, 'No such church.');
  const type = String(request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[type]) throw new HttpError(415, 'Please upload a photo (JPG, PNG, GIF or WebP) or a PDF.');
  if (+(request.headers.get('Content-Length') || 0) > MAX) throw new HttpError(413, 'That file is too big. Please keep it under 20 MB.');
  const data = await request.arrayBuffer();
  if (data.byteLength > MAX) throw new HttpError(413, 'That file is too big. Please keep it under 20 MB.');
  if (!data.byteLength) throw new HttpError(400, 'That file is empty.');
  let name = '';
  try { name = decodeURIComponent(request.headers.get('X-TapDot-Name') || ''); } catch (e) { /* no name */ }
  name = name.replace(/[^\w .()-]+/g, '').trim().slice(0, 100);
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20) + '.' + TYPES[type];
  await env.PAGES.put('file:' + churchId + '/' + id, data, { metadata: { type, name: encodeURIComponent(name) } });
  return { url: new URL('/f/' + churchId + '/' + id, request.url).href, name, size: data.byteLength };
}

export async function serve(env, params) {
  const c = String(params.church || ''), id = String(params.file || '');
  const headers = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
  if (!env.PAGES || !okOwner(c) || !/^[a-f0-9]{20}\.(jpg|png|gif|webp|pdf)$/.test(id)) return new Response('Not found.', { status: 404, headers });
  const { value, metadata } = await env.PAGES.getWithMetadata('file:' + c + '/' + id, { type: 'arrayBuffer' });
  if (value == null) return new Response('Not found.', { status: 404, headers });
  const type = (metadata && TYPES[metadata.type] && metadata.type) || 'application/octet-stream';
  let name = '';
  try { name = decodeURIComponent((metadata && metadata.name) || ''); } catch (e) { /* no name */ }
  return new Response(value, { headers: Object.assign(headers, {
    'Content-Type': type,
    // Each upload gets a new id, so a file never changes.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Disposition': 'inline' + (name ? '; filename="' + name.replace(/"/g, '') + '"' : ''),
  }) });
}

// When a church is deleted, its files go too.
export async function removeAll(env, churchId) {
  let cursor;
  do {
    const r = await env.PAGES.list({ prefix: 'file:' + churchId + '/', cursor });
    await Promise.all(r.keys.map((k) => env.PAGES.delete(k.name)));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
}
