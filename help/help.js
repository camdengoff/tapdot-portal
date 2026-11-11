/* DoorStep Help Center: theme switch, search and the "On this page" highlight. */
(function () {
  // ◐ cycles Auto → Light → Dark, the same switch (and saved choice) as the homepage and portal.
  var root = document.documentElement, themeBtn = document.getElementById('theme');
  if (themeBtn) {
    var label = function () { var t = root.getAttribute('data-theme'); themeBtn.textContent = t === 'light' ? '☀' : t === 'dark' ? '☾' : '◐'; themeBtn.title = 'Theme: ' + (t === 'light' ? 'light' : t === 'dark' ? 'dark' : 'follows your device'); };
    label();
    themeBtn.addEventListener('click', function () {
      var t = root.getAttribute('data-theme'), next = !t ? 'light' : t === 'light' ? 'dark' : '';
      if (next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
      try { if (next) localStorage.setItem('tapdot-theme', next); else localStorage.removeItem('tapdot-theme'); } catch (e) { /* not remembered */ }
      label();
    });
  }

  // On a phone the article list folds away above the article (it starts open for browsers without scripts).
  var menu = document.querySelector('.article-page .side-menu');
  if (menu && window.matchMedia && matchMedia('(max-width: 860px)').matches) menu.open = false;

  // ── Search ──────────────────────────────────────────────────────────
  // search.json holds every article's words, split by heading, so a result can open the right part.
  var index = null, loading = null;
  function load() {
    if (index) return Promise.resolve(index);
    if (!loading) loading = fetch('/help/search.json').then(function (r) { return r.json(); }).then(function (d) { index = d; return d; });
    return loading;
  }
  var escHtml = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var norm = function (s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'"); };
  var words = function (q) { return norm(q).split(/[^a-z0-9']+/).filter(function (w) { return w.length > 1 || /\d/.test(w); }); };
  // Light stemming so "publishing" finds "publish" and "tags" finds "tag".
  var stem = function (w) { return w.replace(/(ing|ed|es|s)$/, '').replace(/'s$/, '') || w; };
  function has(text, w) { return text.indexOf(w) !== -1 || (stem(w).length > 2 && text.indexOf(stem(w)) !== -1); }

  function search(q) {
    var ws = words(q);
    if (!ws.length) return [];
    var out = [];
    index.forEach(function (a) {
      var title = norm(a.title), summary = norm(a.summary);
      var best = null;
      a.parts.forEach(function (p) {
        var h = norm(p.h), t = norm(p.t), score = 0, all = true;
        ws.forEach(function (w) {
          var s = 0;
          if (has(title, w)) s += 12;
          if (has(summary, w)) s += 5;
          if (has(h, w)) s += 7;
          if (has(t, w)) s += 2 + Math.min(3, t.split(stem(w)).length - 1) * 0.5;
          if (!s) all = false;
          score += s;
        });
        if (!all || !score) return;
        if (norm(a.title + ' ' + p.h + ' ' + p.t).indexOf(norm(q).trim()) !== -1) score += 8; // the exact phrase
        if (!best || score > best.score) best = { score: score, part: p };
      });
      if (best) out.push({ a: a, part: best.part, score: best.score });
    });
    out.sort(function (x, y) { return y.score - x.score; });
    return out.slice(0, 8);
  }
  function mark(text, ws) {
    var html = escHtml(text);
    ws.forEach(function (w) {
      var s = stem(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (s.length < 2) return;
      html = html.replace(new RegExp('\\b(' + s + '[a-z]*)', 'gi'), '<mark>$1</mark>');
    });
    return html;
  }
  // A short piece of the matching part, around the first word that matches.
  function snippet(r, ws) {
    var t = r.part.t, lt = norm(t), at = -1;
    for (var i = 0; i < ws.length && at < 0; i++) at = lt.indexOf(stem(ws[i]));
    if (at < 0) return r.a.summary;
    var start = Math.max(0, at - 50), s = t.slice(start, start + 150);
    if (start > 0) s = '…' + s.replace(/^\S*\s/, '');
    if (start + 150 < t.length) s = s.replace(/\s\S*$/, '') + '…';
    return s;
  }

  document.querySelectorAll('.search').forEach(function (box) {
    var input = box.querySelector('input'), list = box.querySelector('.results'), sel = -1, items = [];
    function draw() {
      var q = input.value.trim();
      if (!q) { list.hidden = true; return; }
      load().then(function () {
        if (input.value.trim() !== q) return;
        var ws = words(q), res = search(q);
        sel = -1;
        if (!res.length) { list.innerHTML = '<div class="none">Nothing found for “' + escHtml(q) + '”. Try another word, like “publish”, “tag” or “photo”.</div>'; list.hidden = false; items = []; return; }
        list.innerHTML = res.map(function (r) {
          var href = '/help/' + r.a.slug + (r.part.id && words(r.a.title).join(' ') !== ws.join(' ') ? '#' + r.part.id : '');
          return '<a role="option" href="' + href + '"><small>' + escHtml(r.a.section) + (r.part.h ? ' · ' + escHtml(r.part.h) : '') + '</small><b>' + mark(r.a.title, ws) + '</b><span>' + mark(snippet(r, ws), ws) + '</span></a>';
        }).join('');
        items = list.querySelectorAll('a');
        list.hidden = false;
      }).catch(function () { list.innerHTML = '<div class="none">Search couldn’t load. Check your connection and try again.</div>'; list.hidden = false; });
    }
    function pick(i) {
      if (!items.length) return;
      sel = (i + items.length) % items.length;
      items.forEach(function (a, j) { a.classList.toggle('on', j === sel); });
      items[sel].scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('focus', function () { load().catch(function () {}); if (input.value.trim()) draw(); });
    input.addEventListener('input', draw);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); pick(sel + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); pick(sel - 1); }
      else if (e.key === 'Enter') { var a = items[sel >= 0 ? sel : 0]; if (a) { e.preventDefault(); location.href = a.href; } }
      else if (e.key === 'Escape') { list.hidden = true; input.blur(); }
    });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) list.hidden = true; });
  });
  // "/" jumps to the search box.
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var input = document.querySelector('.search input');
    if (input) { e.preventDefault(); input.focus(); }
  });

  // ── "On this page": highlight the part being read ───────────────────
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (links.length && 'IntersectionObserver' in window) {
    var heads = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); }).filter(Boolean);
    var current = function () {
      var top = 100, on = heads[0];
      heads.forEach(function (h) { if (h.getBoundingClientRect().top < top) on = h; });
      links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + on.id); });
    };
    var io = new IntersectionObserver(current, { rootMargin: '-80px 0px -60% 0px' });
    heads.forEach(function (h) { io.observe(h); });
    current();
  }
})();
