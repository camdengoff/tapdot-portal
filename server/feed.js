// Feed reader for the RSS feed block: GET /api/feed?url=<any page or feed address>.
//
// A church page can't read another site's feed from the browser (the site has to allow it, and
// Squarespace doesn't), so live pages ask us for it instead. The address can be the feed itself or
// just the page people visit: we look for the page's feed (its <link rel="alternate">, Squarespace's
// ?format=rss and ?format=json, a JSON Feed, or the usual /feed addresses) and always answer with
// RSS, so this can't be used as a general proxy. Answers are cached for 5 minutes.
const MAX_BYTES = 3 * 1024 * 1024;
const TTL = 300;
const UA = 'DoorStep feed reader';

const fail = (status, error) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
});

export async function feedProxy(request, waitUntil) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  if (request.method !== 'GET') return fail(405, 'Use GET.');
  const self = new URL(request.url);
  let target;
  try { target = new URL(self.searchParams.get('url') || ''); } catch (e) { return fail(400, 'Add ?url= with the page or feed address.'); }
  if (!okUrl(target, self)) return fail(400, 'That address is not allowed.');

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(self.origin + '/api/feed?url=' + encodeURIComponent(target.href));
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let text;
  try { text = await findFeed(target, self); }
  catch (e) { return fail(e.status || 502, e.message || 'Could not reach that page.'); }

  const res = new Response(text, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=' + TTL,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
  if (cache) waitUntil(cache.put(key, res.clone()));
  return res;
}

const okUrl = (u, self) => /^https?:$/.test(u.protocol) && !u.username && !u.password && u.hostname !== self.hostname;
const isFeed = (t) => /<(rss|feed|rdf:RDF)[\s>]/i.test(t.slice(0, 5000));
const oops = (status, message) => Object.assign(new Error(message), { status });

// One GET, size-limited. Resolves { ok, type, text, url } and never throws.
async function get(url, accept) {
  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: accept } });
    if (!r.ok || +r.headers.get('Content-Length') > MAX_BYTES) return { ok: false, status: r.status };
    const text = await r.text();
    if (text.length > MAX_BYTES) return { ok: false, status: 413 };
    return { ok: true, type: (r.headers.get('Content-Type') || '').toLowerCase(), text, url: r.url || url };
  } catch (e) { return { ok: false, status: 0 }; }
}
const ACCEPT_FEED = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5';

async function findFeed(target, self) {
  const first = await get(target.href, ACCEPT_FEED);
  if (!first.ok) throw oops(502, first.status ? 'That page answered with an error (' + first.status + ').' : 'Could not reach that page.');
  const sqsp = (t) => /squarespace/i.test(t.slice(0, 200000));
  // 1. It's already a feed.
  if (isFeed(first.text)) return sqsp(first.text.slice(0, 1500)) ? squarespaceExtras(new URL(first.url), first.text) : first.text;
  // 2. It's a JSON Feed (jsonfeed.org) or Squarespace's ?format=json.
  const asJson = jsonFeed(first.text, new URL(first.url));
  if (asJson) return asJson;

  // 3. It's a web page: try the feeds it points to, then the usual places.
  const tries = [];
  const add = (u) => { try { const x = new URL(u, first.url); if (okUrl(x, self) && tries.indexOf(x.href) < 0) tries.push(x.href); } catch (e) { /* skip */ } };
  const html = first.text;
  (html.match(/<link\b[^>]*>/gi) || []).forEach((tag) => {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss\+xml|atom\+xml|feed\+json|json)/i.test(tag)) return;
    const m = /href=["']([^"']+)["']/i.exec(tag);
    if (m) add(m[1].replace(/&amp;/g, '&'));
  });
  if (sqsp(html)) {
    const u = new URL(first.url); u.searchParams.set('format', 'rss'); add(u.href);
    const j = new URL(first.url); j.searchParams.set('format', 'json'); add(j.href);
  }
  const base = first.url.replace(/[?#].*$/, '').replace(/\/+$/, '');
  [base + '/feed', base + '/rss', base + '/feed.xml', base + '/rss.xml', base + '/atom.xml', base + '/feed.json'].forEach(add);

  for (const u of tries.slice(0, 8)) {
    const r = await get(u, ACCEPT_FEED);
    if (!r.ok) continue;
    if (isFeed(r.text)) return sqsp(r.text.slice(0, 1500)) ? squarespaceExtras(new URL(r.url), r.text) : r.text;
    const j = jsonFeed(r.text, new URL(r.url));
    if (j) return j;
  }
  throw oops(404, 'Couldn’t find a feed for that page. Try its RSS feed address instead.');
}

// A JSON Feed or a Squarespace collection's JSON, as RSS. Anything else: null.
function jsonFeed(text, at) {
  const t = text.trimStart();
  if (t[0] !== '{') return null;
  let o;
  try { o = JSON.parse(t); } catch (e) { return null; }
  if (o && Array.isArray(o.items) && o.collection) return rss(o.collection.title || '', sqItems(o.items, at.origin));
  if (o && Array.isArray(o.items) && /jsonfeed\.org/.test(o.version || '')) {
    return rss(o.title || '', o.items.map((it) => ({
      title: it.title || '', link: it.url || it.external_url || '', date: it.date_published || '',
      html: it.content_html || it.summary || it.content_text || '', img: it.image || it.banner_image || '', tags: it.tags || [],
    })));
  }
  return null;
}
function rss(title, items) {
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>' + xml(title) + '</title>' +
    items.map(item).join('') + '</channel></rss>';
}
function item(it) {
  const d = it.date ? new Date(it.date) : null;
  return '<item><title>' + xml(it.title) + '</title>' +
    (d && !isNaN(d) ? '<pubDate>' + d.toUTCString() + '</pubDate>' : '') +
    '<link>' + xml(it.link) + '</link>' +
    '<description>' + xml(it.html || '') + '</description>' +
    (it.img ? '<media:content url="' + xml(it.img) + '" medium="image"/>' : '') +
    (it.tags || []).map((c) => '<category>' + xml(c) + '</category>').join('') + '</item>';
}
const sqItems = (items, origin) => items.filter((it) => it && it.fullUrl).slice(0, 300).map((it) => ({
  title: it.title || '', link: origin + it.fullUrl, date: it.publishOn || it.addedOn || '',
  html: it.excerpt || it.body || '',
  img: it.assetUrl && /^https?:/i.test(it.assetUrl) ? it.assetUrl + (/\?/.test(it.assetUrl) ? '' : '?format=1500w') : '',
  tags: tagsOf(it),
}));

// ── Squarespace extras ──────────────────────────────────────────────────
// Squarespace RSS stops at 20 items and leaves out what some churches use for filtering: Portfolio
// pages can't have categories, so they write "Tags: Men, Women, Weekday" in each item's SEO
// description instead. The same page's ?format=json has every item and those descriptions, so we
// add the tags as <category> elements and append the items the RSS left out.
const xml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pathOf = (u) => { try { return new URL(u, 'https://x.invalid').pathname.replace(/\/+$/, '').toLowerCase(); } catch (e) { return ''; } };
function tagsOf(it) {
  const out = [];
  const add = (t) => { t = String(t || '').trim(); if (t && out.indexOf(t) < 0) out.push(t); };
  (it.categories || []).forEach(add);
  (it.tags || []).forEach(add);
  const m = /^\s*tags?\s*:\s*([\s\S]*)$/i.exec((it.seoData && it.seoData.seoDescription) || '');
  if (m) m[1].split(/[,;\n]/).forEach(add);
  return out;
}
async function squarespaceExtras(target, text) {
  try {
    const u = new URL(target.href);
    u.searchParams.set('format', 'json');
    const r = await fetch(u.href, { redirect: 'follow', headers: { 'User-Agent': 'DoorStep feed reader', Accept: 'application/json' } });
    if (!r.ok) return text;
    const body = await r.text();
    if (body.length > MAX_BYTES) return text;
    const items = (JSON.parse(body).items || []).filter((it) => it && it.fullUrl);
    if (!items.length) return text;
    const byPath = new Map(items.map((it) => [pathOf(it.fullUrl), it]));
    const seen = new Set();
    // Tags on the items the RSS already has.
    text = text.replace(/<item>([\s\S]*?)<\/item>/g, (all, inner) => {
      const link = /<link>([^<]*)<\/link>/.exec(inner);
      const it = link && byPath.get(pathOf(link[1].trim()));
      if (!it) return all;
      seen.add(pathOf(it.fullUrl));
      const have = (inner.match(/<category[^>]*>[^<]*<\/category>/g) || []).length;
      return have ? all : '<item>' + inner + tagsOf(it).map((t) => '<category>' + xml(t) + '</category>').join('') + '</item>';
    });
    // The items the RSS cut off, in the page's own order.
    const origin = new URL(target.href).origin;
    const extra = sqItems(items.filter((it) => !seen.has(pathOf(it.fullUrl))), origin).map(item).join('');
    if (extra && /<\/channel>/.test(text)) text = text.replace(/<\/channel>(?![\s\S]*<\/channel>)/, extra + '</channel>');
    return text;
  } catch (e) { return text; }
}
