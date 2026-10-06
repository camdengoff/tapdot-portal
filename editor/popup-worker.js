/* TapDot Editor — the copy-and-paste Cloudflare Worker that lets a church's pop-up sheets show
   sites that refuse to be framed. TD.popupWorkerCode(hosts) returns the whole worker, with the
   church's chosen sites filled in. The editor sends links to those sites as <worker>/?url=… */
(function () {
  const TD = window.TD;

  // The worker itself. Written as a real function so it stays readable; its source is pasted
  // into Cloudflare with ALLOWED_HOSTS filled in.
  function worker() {
    const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
    const isAllowed = (host) => ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
    const page = (title, body, status) => new Response(
      '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + title + '</title>' +
      '<body style="font:16px/1.5 system-ui,sans-serif;padding:32px 20px;text-align:center;color:#333">' + body + '</body>',
      { status, headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS) });
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    return {
      async fetch(request) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: CORS });
        const self = new URL(request.url);
        // The editor checks which sites this worker allows.
        if (self.pathname === '/_tapdot/hosts') return new Response(JSON.stringify({ hosts: ALLOWED_HOSTS }), { headers: Object.assign({ 'Content-Type': 'application/json' }, CORS) });

        let target;
        try { target = new URL(self.searchParams.get('url') || ''); } catch (e) { return page('TapDot pop-up worker', 'This worker is running. Pop-up links reach it as <code>?url=</code>.', 200); }
        if (!/^https?:$/.test(target.protocol)) return page('Bad link', 'That link is not a web page.', 400);
        if (!isAllowed(target.hostname)) {
          return page('Open page', '<p>This site isn’t on this pop-up worker’s list.</p><p><a href="' + esc(target.href) + '" target="_blank" rel="noopener">Open ' + esc(target.hostname) + '</a></p>', 403);
        }

        const res = await fetch(target.href, {
          method: request.method,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        const headers = new Headers(res.headers);
        // Drop the headers that stop a page from showing inside a pop-up.
        headers.delete('X-Frame-Options');
        headers.delete('Content-Security-Policy');
        headers.delete('Content-Security-Policy-Report-Only');
        headers.set('Content-Security-Policy', 'frame-ancestors *');
        for (const k in CORS) headers.set(k, CORS[k]);
        if (!(res.headers.get('content-type') || '').includes('text/html')) {
          return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
        }

        // Load the site's images and styles from the real site, keep taps on links to listed
        // sites inside the pop-up, and open everything else in a new tab.
        const inject = '<base href="' + esc(res.url || target.href) + '">' +
          '<style>#sq-search-header-slot,#sq-search-trigger,#sq-mobile-search-btn,#sq-search-overlay,#sq-search-modal{display:none!important}</style>' +
          '<script>(function(){var P=' + JSON.stringify(self.origin + '/?url=') + ',A=' + JSON.stringify(ALLOWED_HOSTS) + ';' +
          'function ok(h){return A.some(function(a){return h===a||h.slice(-a.length-1)==="."+a})}' +
          'document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a[href]");if(!a||e.defaultPrevented||a.target==="_blank")return;' +
          'var u;try{u=new URL(a.href,document.baseURI)}catch(x){return}if(!/^https?:$/.test(u.protocol)||(u.hash&&u.href.split("#")[0]===location.href.split("#")[0]))return;' +
          'e.preventDefault();if(ok(u.hostname))location.href=P+encodeURIComponent(u.href);else window.open(u.href,"_blank","noopener")},true)})();</' + 'script>';
        let html = await res.text();
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
        headers.delete('Content-Length');
        return new Response(html, { status: res.status, statusText: res.statusText, headers });
      },
    };
  }

  TD.popupWorkerCode = function (hosts) {
    const list = (hosts || []).filter(Boolean);
    return '// TapDot pop-up worker: lets these sites show inside your tap page’s pop-up sheets.\n' +
      '// Made by the TapDot editor. To change the list, copy the code again from the Export tab.\n' +
      'const ALLOWED_HOSTS = ' + JSON.stringify(list, null, 2) + ';\n\n' +
      'export default (' + worker.toString() + ')();\n';
  };
})();
