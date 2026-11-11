// Feed reader for the RSS feed block: GET /api/feed?url=<feed address>.
//
// A church page can't read another site's RSS feed from the browser (the site has to allow it,
// and Squarespace doesn't), so live pages ask us for it instead. Only real RSS/Atom feeds are
// passed on, so this can't be used as a general proxy. Answers are cached for 5 minutes.
const MAX_BYTES = 3 * 1024 * 1024;
const TTL = 300;

const fail = (status, error) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
});

export async function feedProxy(request, waitUntil) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' } });
  if (request.method !== 'GET') return fail(405, 'Use GET.');
  const self = new URL(request.url);
  let target;
  try { target = new URL(self.searchParams.get('url') || ''); } catch (e) { return fail(400, 'Add ?url= with the feed address.'); }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password || target.hostname === self.hostname) return fail(400, 'That feed address is not allowed.');

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(self.origin + '/api/feed?url=' + encodeURIComponent(target.href));
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }

  let r;
  try {
    r = await fetch(target.href, {
      redirect: 'follow',
      headers: { 'User-Agent': 'DoorStep feed reader', Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5' },
    });
  } catch (e) { return fail(502, 'Could not reach that feed.'); }
  if (!r.ok) return fail(502, 'The feed answered with an error (' + r.status + ').');
  if (+r.headers.get('Content-Length') > MAX_BYTES) return fail(413, 'That feed is too big.');
  let text = await r.text();
  if (text.length > MAX_BYTES) return fail(413, 'That feed is too big.');
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 5000))) return fail(415, 'That address is not an RSS or Atom feed.');
  if (/squarespace\.com/i.test(text.slice(0, 1500))) text = await squarespaceExtras(target, text);

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
    const extra = items.filter((it) => !seen.has(pathOf(it.fullUrl))).slice(0, 200).map((it) => {
      const img = it.assetUrl && /^https?:/i.test(it.assetUrl) ? it.assetUrl + (/\?/.test(it.assetUrl) ? '' : '?format=1500w') : '';
      const when = it.publishOn || it.addedOn;
      return '<item><title>' + xml(it.title) + '</title>' +
        (when ? '<pubDate>' + new Date(when).toUTCString() + '</pubDate>' : '') +
        '<link>' + xml(origin + it.fullUrl) + '</link>' +
        '<description>' + xml(it.excerpt || it.body || '') + '</description>' +
        (img ? '<media:content url="' + xml(img) + '" medium="image"/>' : '') +
        tagsOf(it).map((t) => '<category>' + xml(t) + '</category>').join('') + '</item>';
    }).join('');
    if (extra && /<\/channel>/.test(text)) text = text.replace(/<\/channel>(?![\s\S]*<\/channel>)/, extra + '</channel>');
    return text;
  } catch (e) { return text; }
}
