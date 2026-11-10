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
  const text = await r.text();
  if (text.length > MAX_BYTES) return fail(413, 'That feed is too big.');
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 5000))) return fail(415, 'That address is not an RSS or Atom feed.');

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
