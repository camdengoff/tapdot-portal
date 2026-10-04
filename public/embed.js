/* TapDot live page loader. Paste once into a Squarespace code block:
     <div class="tapdot-page" data-page="church/page"></div>
     <script src="https://<portal address>/embed.js"></script>
   It always shows the latest version published from the TapDot portal. */
(function () {
  var me = document.currentScript;
  var base = me && me.src ? me.src.replace(/\/embed\.js(?:[?#].*)?$/, '') : '';
  function run(el) {
    if (el.getAttribute('data-loaded')) return;
    el.setAttribute('data-loaded', '1');
    var page = (el.getAttribute('data-page') || '').replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(page)) { el.textContent = 'TapDot: set data-page to "church/page".'; return; }
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
      })
      .catch(function () { el.textContent = 'This page could not load. Please refresh.'; });
  }
  function all() { document.querySelectorAll('.tapdot-page[data-page]').forEach(run); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
})();
