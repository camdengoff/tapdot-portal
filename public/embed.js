/* TapDot live page loader. Paste once into a Squarespace code block:
     <div class="tapdot-page" data-page="church/page"></div>
     <script src="https://<portal address>/embed.js"></script>
   It always shows the latest version published from the TapDot portal, and counts visits and
   button taps for the portal's stats (no cookies, nothing about the visitor is kept). */
(function () {
  var me = document.currentScript;
  var base = me && me.src ? me.src.replace(/\/embed\.js(?:[?#].*)?$/, '') : '';

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  // A random id for this browser tab, so the activity log can show a visit and its taps together.
  // It isn't stored anywhere else and says nothing about who the visitor is.
  var visit = '';
  try { visit = sessionStorage.getItem('tapdot-visit') || ''; } catch (e) { /* storage blocked */ }
  if (!visit) {
    visit = Math.random().toString(36).slice(2, 12);
    try { sessionStorage.setItem('tapdot-visit', visit); } catch (e) { /* one id for this page load */ }
  }
  function send(page, ev, label) {
    var data = JSON.stringify({ page: page, ev: ev, label: label, day: today(), visit: visit });
    try { if (navigator.sendBeacon && navigator.sendBeacon(base + '/api/track', data)) return; } catch (e) { /* fall back to fetch */ }
    try { fetch(base + '/api/track', { method: 'POST', body: data, keepalive: true, mode: 'no-cors' }); } catch (e) { /* stats are best effort */ }
  }
  // A visit counts once per browser tab every 30 minutes, so refreshing doesn't inflate it.
  function countView(page) {
    var key = 'tapdot-seen:' + page;
    try {
      var last = +sessionStorage.getItem(key) || 0;
      if (Date.now() - last < 30 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch (e) { /* storage blocked: count it anyway */ }
    send(page, 'view');
  }
  // The first line with a letter or number in it (skips icon-only lines like an emoji).
  function firstLine(el) {
    var t = (el.innerText || el.textContent || '').split('\n'), any = '';
    for (var i = 0; i < t.length; i++) {
      var s = t[i].trim();
      if (s && /[0-9A-Za-z\u00C0-\uFFFF]/.test(s.replace(/[\u2000-\u2BFF\uD800-\uDFFF\uFE0F]/g, ''))) return s;
      any = any || s;
    }
    return any;
  }
  // The name a tap is counted under: the button's own text (a copy button also names what it copies).
  function tapLabel(t) {
    var label = firstLine(t) || t.getAttribute('aria-label') || t.getAttribute('title') || '';
    var row = t.classList.contains('td-copy-btn') && t.closest('.td-copy-row');
    if (row) { var what = row.querySelector('.td-tag') || row.querySelector('.td-copy-val'); if (what) label += ': ' + firstLine(what); }
    return label;
  }
  function watchTaps(el, page) {
    el.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.td-tap, a[href]');
      if (!t || !el.contains(t)) return;
      if (!t.classList.contains('td-tap') && /^#/.test(t.getAttribute('href') || '#')) return;
      send(page, 'tap', tapLabel(t));
    }, true);
  }

  function run(el) {
    if (el.getAttribute('data-loaded')) return;
    el.setAttribute('data-loaded', '1');
    var page = (el.getAttribute('data-page') || '').replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(page)) { el.textContent = 'TapDot: set data-page to "church/page".'; return; }
    if (el.hasAttribute('data-live')) { countView(page); watchTaps(el, page); return; } // already on the page (/view links)
    fetch(base + '/p/' + page, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        el.innerHTML = html;
        // Scripts added with innerHTML don't run, so swap each one for a fresh copy.
        el.querySelectorAll('script').forEach(function (old) {
          var s = document.createElement('script');
          for (var i = 0; i < old.attributes.length; i++) s.setAttribute(old.attributes[i].name, old.attributes[i].value);
          s.textContent = old.textContent;
          old.replaceWith(s);
        });
        countView(page);
        watchTaps(el, page);
      })
      .catch(function () { el.textContent = 'This page could not load. Please refresh.'; });
  }
  function all() { document.querySelectorAll('.tapdot-page[data-page]').forEach(run); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
})();
