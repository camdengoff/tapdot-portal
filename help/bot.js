/* DoorStep help bot: a chat button that answers "how do I…" questions from the help center.
   Free and in the browser: it reads /help/bot.json (built from help/articles/ by tools/build-help.js)
   and matches the question to the closest part of an article.

   It only talks about DoorStep. People who are signed in get the article's step-by-step walkthrough
   right in the chat; people who aren't get a short answer and a Sign in button.

   Add it to a page with <script src="/help/bot.js" defer></script>. Used on the homepage, the help
   center and the portal. */
(function () {
  if (window.DS_HELP_BOT) return;
  window.DS_HELP_BOT = true;
  var D = document;

  var CSS = '' +
    '.dsb{--b-panel:#fff;--b-panel2:#f5f5f4;--b-line:#e4e4e2;--b-text:#262626;--b-muted:#6b6b6b;--b-accent:#ff5e1f;--b-btn:#cc4410;--b-tint:#fff7f3;--b-tint-line:#ffd2bf;--b-ink:#c2410c;--b-green:#15784f;--b-green-bg:#e8f5ee;--b-green-line:#b5dfc8;' +
    'font-family:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:-.01em;color:var(--b-text);position:fixed;right:20px;bottom:20px;z-index:60}' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .dsb{--b-panel:#1a1a1a;--b-panel2:#242424;--b-line:#2f2f2f;--b-text:#f2f2f0;--b-muted:#a3a3a0;--b-accent:#ff6a2e;--b-tint:#26170f;--b-tint-line:#5c2c14;--b-ink:#ff8a5c;--b-green:#4fd197;--b-green-bg:#10291d;--b-green-line:#24573b}}' +
    ':root[data-theme="dark"] .dsb{--b-panel:#1a1a1a;--b-panel2:#242424;--b-line:#2f2f2f;--b-text:#f2f2f0;--b-muted:#a3a3a0;--b-accent:#ff6a2e;--b-tint:#26170f;--b-tint-line:#5c2c14;--b-ink:#ff8a5c;--b-green:#4fd197;--b-green-bg:#10291d;--b-green-line:#24573b}' +
    'body.glassy .dsb{bottom:84px}' +
    '.dsb *{box-sizing:border-box}' +
    '.dsb-open{display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px 0 14px;border:0;border-radius:999px;background:var(--b-btn);color:#fff;font:inherit;font-weight:600;font-size:15px;cursor:pointer;box-shadow:0 6px 24px rgba(255,80,10,.28),0 2px 6px rgba(0,0,0,.12)}' +
    '.dsb-open:hover{filter:brightness(1.07)}' +
    '.dsb-open .q{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.22);font-size:13px;font-weight:700}' +
    '.dsb.on .dsb-open{display:none}' +
    '.dsb-panel{display:none;flex-direction:column;width:380px;max-width:calc(100vw - 24px);height:560px;max-height:calc(100vh - 110px);background:var(--b-panel);border:1px solid var(--b-line);border-radius:6px;box-shadow:0 12px 60px rgba(255,80,10,.12),0 4px 18px rgba(0,0,0,.12);overflow:hidden}' +
    '.dsb.on .dsb-panel{display:flex}' +
    '.dsb-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--b-line)}' +
    '.dsb-logo{width:22px;height:22px;border-radius:50%;background:var(--b-accent);position:relative;flex:none}' +
    '.dsb-logo:after{content:"";position:absolute;inset:7px;border-radius:50%;background:var(--b-green)}' +
    '.dsb-head b{flex:1;font-size:15px;font-weight:700;letter-spacing:-.02em}' +
    '.dsb-head small{display:block;font-weight:500;font-size:12px;color:var(--b-muted);letter-spacing:0}' +
    '.dsb-x{width:32px;height:32px;border:0;border-radius:4px;background:none;color:var(--b-muted);font-size:17px;cursor:pointer}' +
    '.dsb-x:hover{background:var(--b-panel2);color:var(--b-text)}' +
    '.dsb-log{position:relative;flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}' +
    '.dsb-m{max-width:92%;padding:10px 13px;border-radius:6px;font-size:14.5px;line-height:1.5;overflow-wrap:anywhere}' +
    '.dsb-bot{align-self:flex-start;background:var(--b-panel2);border-bottom-left-radius:2px}' +
    '.dsb-me{align-self:flex-end;background:var(--b-btn);color:#fff;border-bottom-right-radius:2px}' +
    '.dsb-m p,.dsb-m ul,.dsb-m ol,.dsb-m table,.dsb-m .callout{margin:0 0 8px}' +
    '.dsb-m > :last-child,.dsb-m .callout > :last-child{margin-bottom:0}' +
    '.dsb-m ul,.dsb-m ol{padding-left:20px}' +
    '.dsb-m a{color:var(--b-ink)}' +
    '.dsb-m h3{font-size:14.5px;margin:10px 0 4px}' +
    '.dsb-src{display:block;font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--b-green);margin-bottom:4px}' +
    '.dsb-m .steps{list-style:none;padding:0;counter-reset:s}' +
    '.dsb-m .steps>li{counter-increment:s;position:relative;padding:0 0 10px 32px}' +
    '.dsb-m .steps>li:before{content:counter(s);position:absolute;left:0;top:0;width:22px;height:22px;border-radius:50%;background:var(--b-tint);border:1px solid var(--b-tint-line);color:var(--b-ink);font-size:12px;font-weight:700;line-height:20px;text-align:center}' +
    '.dsb-m .steps>li>b:first-child{display:block}' +
    '.dsb-m .callout{border:1px solid var(--b-line);border-left:3px solid var(--b-green);background:var(--b-panel);border-radius:4px;padding:8px 10px;font-size:13.5px}' +
    '.dsb-m .callout>b:first-child{display:block;font-size:11px;text-transform:uppercase;color:var(--b-green)}' +
    '.dsb-m .callout.key{border-left-color:var(--b-accent);background:var(--b-tint)}' +
    '.dsb-m .ui{display:inline-block;font-weight:500;font-size:.92em;padding:0 6px;border:1px solid var(--b-line);border-radius:3px;background:var(--b-panel);white-space:nowrap}' +
    '.dsb-m .tw{overflow-x:auto}.dsb-m table{border-collapse:collapse;font-size:13px}.dsb-m td,.dsb-m th{border:1px solid var(--b-line);padding:4px 6px;text-align:left;vertical-align:top}' +
    '.dsb-m img{max-width:100%}' +
    '.dsb-go{display:inline-flex;align-items:center;margin-top:10px;padding:7px 12px;border-radius:4px;background:var(--b-btn);color:#fff !important;text-decoration:none;font-weight:600;font-size:13.5px}' +
    '.dsb-more{display:inline-block;margin-top:8px;font-weight:600;font-size:13.5px}' +
    '.dsb-hint{font-size:12px;color:var(--b-muted);margin-bottom:-4px}' +
    '.dsb-chips{display:flex;flex-wrap:wrap;gap:6px}' +
    '.dsb-chip{font:inherit;font-size:13px;font-weight:600;padding:6px 11px;border-radius:999px;border:1px solid var(--b-line);background:var(--b-panel);color:var(--b-text);cursor:pointer;text-align:left}' +
    '.dsb-chip:hover{border-color:var(--b-accent)}' +
    '.dsb-form{display:flex;gap:8px;padding:12px;border-top:1px solid var(--b-line)}' +
    '.dsb-form input{flex:1;min-width:0;font:inherit;font-size:15px;color:var(--b-text);background:var(--b-panel2);border:1px solid var(--b-line);border-radius:4px;padding:9px 12px;outline:none}' +
    '.dsb-form input:focus{border-color:var(--b-accent)}' +
    '.dsb-form button{flex:none;border:0;border-radius:4px;background:var(--b-btn);color:#fff;font:inherit;font-weight:600;padding:0 14px;cursor:pointer}' +
    '.dsb-dots{display:inline-flex;gap:4px;padding:4px 0}.dsb-dots i{width:6px;height:6px;border-radius:50%;background:var(--b-muted);animation:dsbDot 1s infinite}' +
    '.dsb-dots i:nth-child(2){animation-delay:.15s}.dsb-dots i:nth-child(3){animation-delay:.3s}' +
    '@keyframes dsbDot{0%,60%,100%{opacity:.25}30%{opacity:.9}}' +
    '@media (max-width:520px){.dsb{right:12px;bottom:12px}body.glassy .dsb{bottom:80px}.dsb.on{left:0;right:0;bottom:0}.dsb-panel{width:100%;max-width:none;height:85vh;max-height:none;border-radius:10px 10px 0 0}.dsb.on .dsb-open{display:none}}';

  var SUGGEST = ['How do I publish my page?', 'How do I put my page on my website?', 'How do I make a QR code?', 'How do I see my tap stats?'];

  // ── Matching ─────────────────────────────────────────────────────────
  var STOP = ' a an the is are am was were be been do does did i im id my me we our you your us to of in on at for and or it its this that there here can could would should will how what whats which who why any some get got have has had with about from please just tell know want like need so if then as by up out also really one thing things way doorstep make makes making use using set where when mean means meaning life today day good best ';
  var SYN = {};
  [['publish', 'publish publishing published golive'],
   ['install', 'install embed squarespace wix wordpress website site paste code codeblock snippet'],
   ['tag', 'tag tags nfc qr qrcode sticker stickers'],
   ['stat', 'stat stats statistics analytics visits visitors views tapped clicks clicked numbers report'],
   ['button', 'button buttons link links'],
   ['photo', 'photo photos picture pictures image images video videos'],
   ['color', 'color colors colour colours theme font fonts style'],
   ['delete', 'delete remove erase trash'],
   ['person', 'person people staff team member members user users invite role roles access'],
   ['password', 'password signin sign login log google account'],
   ['form', 'form forms connect card answers responses'],
   ['feed', 'feed rss groups list blog sermons'],
   ['popup', 'popup pop sheet menu menus'],
   ['pdf', 'pdf flyer bulletin viewer'],
   ['history', 'history undo version versions restore'],
   ['schedule', 'schedule special times timed weekly'],
   ['give', 'give giving donate donation tithe offering'],
   ['page', 'page pages']
  ].forEach(function (g) { g[1].split(' ').forEach(function (w) { SYN[w] = g[0]; }); });
  function root(w) {
    if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    if (w.length > 3 && /e$/.test(w)) w = w.slice(0, -1);
    if (w.length > 3 && /([bdgmnpt])\1$/.test(w)) w = w.slice(0, -1); // tapped → tap
    return w;
  }
  // The question's words as [own word, synonym group]; documents keep both forms.
  function qwords(s) {
    var out = [];
    String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(function (w) {
      if (!w || STOP.indexOf(' ' + w + ' ') !== -1) return;
      var r = root(w);
      if (!out.some(function (x) { return x[0] === r; })) out.push([r, SYN[w] || r]);
    });
    return out;
  }
  function words(s) {
    var out = [];
    String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').forEach(function (w) {
      if (!w || STOP.indexOf(' ' + w + ' ') !== -1) return;
      [SYN[w] || root(w), root(w)].forEach(function (x) { if (x && out.indexOf(x) === -1) out.push(x); });
    });
    return out;
  }
  function near(a, b) {
    if (a === b) return true;
    if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, miss = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++miss > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return miss + (a.length - i) + (b.length - j) <= 1;
  }

  // Common questions whose words alone point the wrong way: sent straight to the right part.
  var INTENTS = [
    [/\b(delete|remove|get rid of)\b.*\bpages?\b|\bpages?\b.*\b(delete|remove)\b/, 'dashboard#buttons-on-a-card'],
    [/\b(remove|delete|take off)\b.*\b(person|people|someone|staff|member|user|editor)s?\b/, 'people-and-roles#remove-a-person'],
    [/\b(add|invite|give access)\b.*\b(person|people|someone|staff|team|member|user|volunteer|editor|pastor|admin)s?\b/, 'people-and-roles#add-a-person'],
    [/\b(who|how many|which|what)\b.*\b(tap|tapped|taps|visit|visits|visited|click|clicked|clicks)\b|\b(stats|statistics|analytics)\b/, 'tap-stats#at-a-glance'],
    [/\b(new|make|create|start)\b.*\bpage\b/, 'new-page#make-the-page'],
    [/\badd\b.*\b(button|block|section|photo|image|video|countdown|form|list)s?\b/, 'blocks#add-a-block'],
    [/\bundo\b/, 'version-history#undo-and-redo'],
    [/\b(unpublish|offline|take (it |the page )?down)\b/, 'publish#take-a-page-offline'],
    [/\b(forgot|reset|lost)\b.*\bpassword\b|\bpassword\b.*\b(forgot|reset|change)\b|\bcant (sign|log) ?in\b/, 'sign-in#if-you-cant-get-in'],
    [/\b(donat\w*|giving|tithe|tithing|offering)\b/, 'giving#add-a-give-button'],
  ];
  function intent(q) {
    var t = q.toLowerCase().replace(/[’']/g, '');
    for (var i = 0; i < INTENTS.length; i++) {
      if (!INTENTS[i][0].test(t)) continue;
      var key = INTENTS[i][1].split('#');
      for (var j = 0; j < docs.length; j++) if (docs[j].a.slug === key[0] && docs[j].p.id === key[1]) return docs[j];
    }
    return null;
  }

  var docs = null, loading = null;
  function load() {
    if (docs) return Promise.resolve(docs);
    if (!loading) loading = fetch('/help/bot.json').then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (arts) {
      docs = [];
      arts.forEach(function (a) {
        var tw = words(a.title), sw = words(a.summary);
        a.parts.forEach(function (p, i) {
          docs.push({ a: a, p: p, first: i === 0, title: tw, sum: sw, head: words(p.h), text: words(p.t) });
        });
      });
      var df = {};
      docs.forEach(function (d) {
        var seen = {};
        d.title.concat(d.sum, d.head, d.text).forEach(function (w) { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } });
      });
      docs.df = df;
      return docs;
    });
    return loading;
  }
  function has(list, w) { for (var i = 0; i < list.length; i++) if (near(list[i], w)) return true; return false; }
  function search(q) {
    var qw = qwords(q), N = docs.length;
    var scored = docs.map(function (d) {
      var s = 0, hits = 0, strong = false;
      qw.forEach(function (pair) {
        var best = 0, isStrong = false;
        pair.forEach(function (w, k) {
          if (k && w === pair[0]) return;
          var f = Math.log(1 + N / ((docs.df[w] || 0) + 1)) * (k ? 0.55 : 1), x = 0; // a synonym counts for a bit over half
          if (has(d.head, w)) x = Math.max(x, 2.2);
          if (has(d.title, w)) x = Math.max(x, 1.8);
          if (has(d.sum, w)) x = Math.max(x, 1.3);
          if (has(d.text, w)) x = Math.max(x, 1);
          if (f * x > best) { best = f * x; isStrong = x > 1; }
        });
        if (best) { s += best; hits++; if (isStrong) strong = true; }
      });
      if (qw.length) s *= 0.35 + 0.65 * hits / qw.length; // reward covering more of the question
      if (d.first && d.p.h === '') s *= 0.9;
      return { d: d, s: s, strong: strong };
    }).sort(function (a, b) { return b.s - a.s; });
    return { qw: qw, list: scored };
  }

  // ── Signed in? (has an account) ──────────────────────────────────────
  var signedIn = null;
  function checkSignIn() {
    if (signedIn !== null) return Promise.resolve(signedIn);
    return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { signedIn = r.ok; return signedIn; }, function () { signedIn = false; return false; });
  }

  // ── UI ───────────────────────────────────────────────────────────────
  function el(tag, cls, text) { var e = D.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function mount() {
    var st = el('style'); st.textContent = CSS; D.head.appendChild(st);
    var box = el('div', 'dsb');
    var open = el('button', 'dsb-open'); open.type = 'button'; open.setAttribute('aria-label', 'Ask a question about DoorStep');
    open.innerHTML = '<span class="q" aria-hidden="true">?</span>Ask';
    var panel = el('div', 'dsb-panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'DoorStep help');
    panel.innerHTML = '<div class="dsb-head"><span class="dsb-logo" aria-hidden="true"></span><b>DoorStep help<small>Answers from the help center</small></b><button type="button" class="dsb-x" aria-label="Close">✕</button></div>' +
      '<div class="dsb-log" aria-live="polite"></div>' +
      '<form class="dsb-form" autocomplete="off"><input type="text" maxlength="200" placeholder="Ask how to do something…" aria-label="Your question"><button type="submit">Ask</button></form>';
    box.appendChild(open); box.appendChild(panel); D.body.appendChild(box);
    var log = panel.querySelector('.dsb-log'), form = panel.querySelector('form'), input = form.querySelector('input');
    var started = false;

    function bubble(cls, html) { var m = el('div', 'dsb-m ' + cls); if (html != null) m.innerHTML = html; log.appendChild(m); return m; }
    function chips(label, qs) {
      if (!qs.length) return;
      if (label) log.appendChild(el('div', 'dsb-hint', label));
      var w = el('div', 'dsb-chips');
      qs.forEach(function (q) { var c = el('button', 'dsb-chip', q); c.type = 'button'; c.setAttribute('data-q', q); w.appendChild(c); });
      log.appendChild(w);
    }
    // Scroll to the end, or to the top of a long answer so it reads from the start.
    function end(m) { log.scrollTop = m && m.offsetHeight > log.clientHeight * 0.6 ? m.offsetTop - 12 : log.scrollHeight; }

    function greet() {
      started = true;
      checkSignIn().then(function (yes) {
        bubble('dsb-bot', yes
          ? 'Hi! I can walk you through anything in DoorStep, like publishing a page, adding buttons or reading your stats. What do you want to do?'
          : 'Hi! I can answer questions about DoorStep. <b>Sign in</b> and I can walk you through each step too.');
        chips('', SUGGEST);
        end();
      });
      load().catch(function () {});
    }

    function answer(q) {
      q = String(q || '').trim().slice(0, 200);
      if (!q) return;
      bubble('dsb-me').textContent = q;
      var wait = bubble('dsb-bot', '<span class="dsb-dots" aria-label="Typing"><i></i><i></i><i></i></span>');
      end();
      var t0 = Date.now();
      Promise.all([load(), checkSignIn()]).then(function (r) {
        var yes = r[1], res = search(q), best = res.list[0], lower = q.toLowerCase(), hit = intent(q);
        if (hit) best = { d: hit, s: 99, strong: true };
        setTimeout(function () {
          wait.parentNode.removeChild(wait);
          if (/^\W*(thanks|thank you|thank u|thx|ty|ok|okay|got it|cool|great|perfect|awesome)\W*$/.test(lower)) { bubble('dsb-bot').textContent = 'You’re welcome! Anything else?'; end(); return; }
          if (/^\W*(hi|hello|hey|howdy|yo)( there)?\W*$/.test(lower)) { bubble('dsb-bot').textContent = 'Hi! What do you want to do in DoorStep?'; end(); return; }
          if (!best || !best.strong || best.s < 1.5) {
            bubble('dsb-bot', 'I can only help with using DoorStep, like building, publishing and sharing your church’s pages. Try asking it another way, or pick one of these:');
            chips('', SUGGEST);
            end();
            return;
          }
          var d = best.d, a = d.a, href = '/help/' + a.slug + (d.p.id ? '#' + d.p.id : '');
          var src = '<span class="dsb-src">' + esc(a.title) + (d.p.h ? ' › ' + esc(d.p.h) : '') + '</span>';
          var m;
          if (yes) {
            m = bubble('dsb-bot', src + d.p.html + '<a class="dsb-more" href="' + esc(href) + '" target="_blank" rel="noopener">Open the full guide ↗</a>');
          } else {
            src = '<span class="dsb-src">' + esc(a.title) + '</span>';
            m = bubble('dsb-bot', src + '<p>' + esc(a.summary) + '</p><p>Sign in with your DoorStep account and I’ll walk you through the steps.</p><a class="dsb-go" href="/app/">Sign in</a>');
          }
          var seen = {}; seen[a.slug] = 1;
          var more = res.list.slice(1).filter(function (x) { if (seen[x.d.a.slug] || x.s < best.s * 0.55 || !x.strong) return false; seen[x.d.a.slug] = 1; return true; }).slice(0, 2);
          chips('Related', more.map(function (x) { return x.d.a.title; }));
          end(m);
        }, Math.max(0, 450 - (Date.now() - t0)));
      }, function () {
        wait.parentNode.removeChild(wait);
        bubble('dsb-bot', 'I couldn’t load the help articles. Check your connection, or browse the <a href="/help/">help center</a>.');
        end();
      });
    }

    open.addEventListener('click', function () { box.classList.add('on'); if (!started) greet(); setTimeout(function () { input.focus(); }, 30); });
    panel.querySelector('.dsb-x').addEventListener('click', function () { box.classList.remove('on'); open.focus(); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && box.classList.contains('on')) { box.classList.remove('on'); open.focus(); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); var v = input.value; input.value = ''; answer(v); });
    log.addEventListener('click', function (e) { var c = e.target.closest('[data-q]'); if (c) answer(c.getAttribute('data-q')); });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', mount); else mount();
})();
