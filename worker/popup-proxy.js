// TapDot pop-up proxy (Cloudflare Worker)
//
// Lets pages that normally refuse to be framed open inside the tap page's pop-up sheet.
// Two ways to call it:
//   1. https://<worker>/?url=https://site.com/page   → any page on an ALLOWED_HOSTS site
//   2. https://<worker>/some/path                     → https://bethanynaz.org/some/path
//      (the original behaviour, so existing links keep working)
//
// Only sites listed in ALLOWED_HOSTS are proxied, so the worker can't be used as an open proxy.
//
// It also hosts published pages from the editor's "Publish to your site" button:
//   POST /_tapdot/page/<name>  (Authorization: Bearer <PUBLISH_KEY>) saves the page HTML
//   GET  /_tapdot/page/<name>  returns the latest saved HTML, which the Squarespace code block loads
// This needs a KV namespace bound as PAGES and a secret named PUBLISH_KEY (see the README).

const DEFAULT_ORIGIN = 'https://bethanynaz.org';

// A host matches itself and its subdomains (e.g. 'bethanynaz.org' also allows 'www.bethanynaz.org').
const ALLOWED_HOSTS = [
  'bethanynaz.org',
  'bethanynaz.info',
  'tithely.com',
  'tithelymedia.blob.core.windows.net',
  'wufoo.com',
  'churchcenter.com',
  'docs.google.com',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Clean, browser-like headers so sites like Squarespace don't answer with 403s.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const isAllowed = (host) => ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));

const text = (body, status) => new Response(body, { status, headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
const MAX_PAGE = 20 * 1024 * 1024;

// Published pages, stored in KV under "page:<name>".
async function pages(request, env, name) {
  if (!/^[a-z0-9-]{1,60}$/.test(name)) return text('Page names use lowercase letters, numbers and dashes.', 400);
  if (!env.PAGES) return text('Publishing is not set up on this worker yet: bind a KV namespace named PAGES.', 500);
  if (request.method === 'POST') {
    if (!env.PUBLISH_KEY) return text('Publishing is not set up on this worker yet: add a secret named PUBLISH_KEY.', 500);
    if ((request.headers.get('Authorization') || '') !== 'Bearer ' + env.PUBLISH_KEY) return text('Wrong publish key.', 401);
    const html = await request.text();
    if (!html.trim()) return text('Nothing to publish.', 400);
    if (html.length > MAX_PAGE) return text('This page is too large to publish (20 MB max).', 413);
    await env.PAGES.put('page:' + name, html, { metadata: { at: new Date().toISOString() } });
    return text('Published', 200);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);
  const html = await env.PAGES.get('page:' + name);
  if (html == null) return text('No page has been published with this name yet.', 404);
  return new Response(request.method === 'HEAD' ? null : html, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

export default {
  async fetch(request, env = {}) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
    const self = new URL(request.url);
    const pub = /^\/_tapdot\/page\/([^/]+)\/?$/.exec(self.pathname);
    if (pub) return pages(request, env, decodeURIComponent(pub[1]));
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });

    let target;
    const asked = self.searchParams.get('url');
    if (asked) {
      try { target = new URL(asked); } catch { return new Response('Bad url', { status: 400, headers: CORS_HEADERS }); }
      if (!/^https?:$/.test(target.protocol)) return new Response('Bad url', { status: 400, headers: CORS_HEADERS });
      if (!isAllowed(target.hostname)) return new Response('This site is not on the proxy allow list.', { status: 403, headers: CORS_HEADERS });
    } else {
      target = new URL(DEFAULT_ORIGIN + self.pathname + self.search);
    }

    const res = await fetch(target.toString(), { method: request.method, headers: FETCH_HEADERS, redirect: 'follow' });

    const headers = new Headers(res.headers);
    // Remove iframe-blocking headers.
    headers.delete('X-Frame-Options');
    headers.delete('Content-Security-Policy');
    headers.delete('Content-Security-Policy-Report-Only');
    headers.set('Content-Security-Policy', 'frame-ancestors *');
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);

    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html')) {
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }

    // HTML: make relative images/styles load from the real site, keep in-page link taps
    // inside the proxy (so the next page can also show in the pop-up), and hide Squarespace search.
    const finalUrl = res.url || target.toString();
    const proxyBase = self.origin + '/?url=';
    const inject = `
<base href="${finalUrl.replace(/"/g, '&quot;')}">
<style>
  #sq-search-header-slot, #sq-search-trigger, #sq-mobile-search-btn, #sq-search-overlay, #sq-search-modal { display: none !important; }
</style>
<script>
(function () {
  var PROXY = ${JSON.stringify(proxyBase)}, ALLOWED = ${JSON.stringify(ALLOWED_HOSTS)};
  function ok(h) { return ALLOWED.some(function (a) { return h === a || h.slice(-a.length - 1) === '.' + a; }); }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.target === '_blank') return;
    var u; try { u = new URL(a.href, document.baseURI); } catch (x) { return; }
    if (!/^https?:$/.test(u.protocol) || (u.hash && u.href.split('#')[0] === location.href.split('#')[0])) return;
    e.preventDefault();
    if (ok(u.hostname)) location.href = PROXY + encodeURIComponent(u.href);
    else window.open(u.href, '_blank', 'noopener');
  }, true);
})();
</script>`;

    let html = await res.text();
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
    headers.delete('Content-Length');
    return new Response(html, { status: res.status, statusText: res.statusText, headers });
  },
};
