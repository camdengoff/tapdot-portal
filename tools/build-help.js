// Builds the DoorStep help center (served at /help/) from the article files in help/articles/.
// Each article is an HTML fragment that starts with a comment holding its details:
//
//   <!--
//   title: Publish your changes
//   summary: One line shown under the title, in lists and in search.
//   section: publishing        (an id from help/sections.json)
//   order: 2                   (position inside its section)
//   -->
//   <h2>First heading</h2> …
//
// The file name (without .html) is the article's address: help/articles/publish.html → /help/publish.
// Every page gets the same top bar, the article list down the side and an "On this page" list built
// from its <h2> headings. Links to /help/<name> are checked, so a renamed article can't leave a broken link.
//
// Run by tools/build.js (output in dist/help/). On its own: node tools/build-help.js [output folder]
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'help');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slugify = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

function load() {
  const sections = JSON.parse(fs.readFileSync(path.join(src, 'sections.json'), 'utf8'));
  const articles = fs.readdirSync(path.join(src, 'articles')).filter((f) => f.endsWith('.html')).map((f) => {
    const raw = fs.readFileSync(path.join(src, 'articles', f), 'utf8');
    const m = /^\s*<!--([\s\S]*?)-->/.exec(raw);
    if (!m) throw new Error('help/articles/' + f + ' needs a details comment at the top');
    const meta = {};
    m[1].split('\n').forEach((line) => { const kv = /^\s*(\w+)\s*:\s*(.*?)\s*$/.exec(line); if (kv) meta[kv[1]] = kv[2]; });
    ['title', 'summary', 'section'].forEach((k) => { if (!meta[k]) throw new Error('help/articles/' + f + ' is missing "' + k + '"'); });
    if (!sections.some((s) => s.id === meta.section)) throw new Error('help/articles/' + f + ': no section "' + meta.section + '" in sections.json');
    return { slug: f.replace(/\.html$/, ''), title: meta.title, summary: meta.summary, section: meta.section, order: +meta.order || 99, body: raw.slice(m[0].length).trim() };
  });
  // Articles in reading order: by section, then by order.
  const rank = (a) => sections.findIndex((s) => s.id === a.section) * 1000 + a.order;
  articles.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  return { sections, articles };
}

const HEAD = (title, desc) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='40' fill='%23ff5e1f'/><circle cx='50' cy='50' r='14' fill='%2315784f'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script>try { var t = localStorage.getItem('tapdot-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}</script>
<link rel="stylesheet" href="/help/help.css">
</head>`;

const TOP = (searchBox) => `<a class="skip" href="#content">Skip to the article</a>
<header class="top">
  <div class="top-in">
    <a class="logo" href="/"><i aria-hidden="true"></i>DoorStep</a>
    <a class="logo-sub" href="/help/">Help</a>
    ${searchBox ? '<div class="search top-search"><input type="search" placeholder="Search help" aria-label="Search help" autocomplete="off"><kbd>/</kbd><div class="results" role="listbox" hidden></div></div>' : '<div class="grow"></div>'}
    <div class="top-r">
      <button class="theme" type="button" id="theme" title="Theme: follows your device" aria-label="Switch light or dark">◐</button>
      <a class="btn primary" href="/app/">Sign in</a>
    </div>
  </div>
</header>`;

const FOOT = `<footer class="foot">
  <div class="foot-in">
    <span>© ${new Date().getFullYear()} DoorStep</span>
    <span><a href="/">Home</a> · <a href="/help/">Help center</a> · <a href="/app/">Sign in</a></span>
  </div>
</footer>
<script src="/help/help.js" defer></script>
</body>
</html>
`;

function sidebar(sections, articles, current) {
  return `<nav class="side" aria-label="Help articles">
  <details class="side-menu" open>
    <summary>All help articles</summary>
    <div class="side-list">
${sections.map((s) => `      <div class="side-sec">
        <b>${esc(s.name)}</b>
${articles.filter((a) => a.section === s.id).map((a) => `        <a href="/help/${a.slug}"${a.slug === current ? ' aria-current="page"' : ''}>${esc(a.title)}</a>`).join('\n')}
      </div>`).join('\n')}
    </div>
  </details>
</nav>`;
}

// Gives every h2/h3 an id (for the "On this page" list and for links to one part of an article).
function withIds(src) {
  const toc = [];
  const used = new Set();
  const html = src.replace(/<(h[23])(\s[^>]*)?>([\s\S]*?)<\/\1>/g, (m, tag, attrs, inner) => {
    attrs = attrs || '';
    let id = (/\sid="([^"]+)"/.exec(attrs) || [])[1];
    if (!id) { const base = slugify(inner) || 'part'; id = base; let n = 2; while (used.has(id)) id = base + '-' + n++; attrs += ' id="' + id + '"'; }
    used.add(id);
    if (tag === 'h2') toc.push({ id, text: plain(inner) });
    return '<' + tag + attrs + '>' + inner + ' <a class="hash" href="#' + id + '" aria-label="Link to this part">#</a></' + tag + '>';
  });
  return { html, toc };
}

function articlePage(a, all, sections) {
  const sec = sections.find((s) => s.id === a.section);
  const i = all.indexOf(a);
  const prev = all[i - 1], next = all[i + 1];
  const { html: body, toc } = withIds(a.body);
  return `${HEAD(a.title + ' · DoorStep Help', a.summary)}
<body class="article-page">
${TOP(true)}
<div class="layout">
${sidebar(sections, all, a.slug)}
<main id="content" class="article">
  <div class="crumbs"><a href="/help/">Help</a><span>›</span><a href="/help/#${sec.id}">${esc(sec.name)}</a></div>
  <h1>${esc(a.title)}</h1>
  <p class="lead">${esc(a.summary)}</p>
  <div class="prose">
${body}
  </div>
  <nav class="pager" aria-label="More articles">
    ${prev ? `<a class="prev" href="/help/${prev.slug}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
    ${next ? `<a class="next" href="/help/${next.slug}"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}
  </nav>
  <p class="still">Still stuck? Ask whoever set up DoorStep for your church, and mention this article: <b>${esc(a.title)}</b>.</p>
</main>
${toc.length > 1 ? `<aside class="toc" aria-label="On this page"><b>On this page</b>${toc.map((t) => `<a href="#${t.id}">${esc(t.text)}</a>`).join('')}</aside>` : '<aside class="toc"></aside>'}
</div>
${FOOT}`;
}

function indexPage(sections, all) {
  const pick = (slugs) => slugs.map((s) => all.find((a) => a.slug === s)).filter(Boolean);
  const popular = pick(['install-code', 'publish', 'tags-and-qr-codes', 'connect-card', 'rss-feed', 'tap-stats']);
  return `${HEAD('DoorStep Help Center', 'Step-by-step guides for building, publishing and measuring your church’s DoorStep pages.')}
<body class="index-page">
${TOP(false)}
<main id="content">
  <section class="hub-hero">
    <div class="hub-in">
      <span class="mono">Help center</span>
      <h1>How can we help?</h1>
      <p class="lead">Step-by-step guides for building your church’s tap page, putting it on your website and seeing how people use it.</p>
      <div class="search big"><input type="search" placeholder="Search, e.g. “install code” or “QR code”" aria-label="Search help" autocomplete="off"><kbd>/</kbd><div class="results" role="listbox" hidden></div></div>
      <div class="popular"><span>Popular:</span>${popular.map((a) => `<a href="/help/${a.slug}">${esc(a.title)}</a>`).join('')}</div>
    </div>
  </section>
  <section class="hub-start">
    <div class="hub-in">
      <h2>New to DoorStep? Start here.</h2>
      <ol class="path">
        <li><a href="/help/new-page"><span class="n">01</span><b>Make a page</b><small>Pick a template and give it a name.</small></a></li>
        <li><a href="/help/editor-tour"><span class="n">02</span><b>Make it yours</b><small>Swap in your photos, times and links.</small></a></li>
        <li><a href="/help/install-code"><span class="n">03</span><b>Paste the install code</b><small>Once, on a page of your website.</small></a></li>
        <li><a href="/help/publish"><span class="n">04</span><b>Publish</b><small>Your page goes live in about a minute.</small></a></li>
        <li><a href="/help/tags-and-qr-codes"><span class="n">05</span><b>Point your tags at it</b><small>NFC tags, QR codes and links.</small></a></li>
      </ol>
    </div>
  </section>
  <section class="hub-secs">
    <div class="hub-in">
${sections.map((s) => `      <div class="sec" id="${s.id}">
        <div class="sec-h"><span class="ic" aria-hidden="true">${s.icon}</span><div><h2>${esc(s.name)}</h2><p>${esc(s.blurb)}</p></div></div>
        <ul>
${all.filter((a) => a.section === s.id).map((a) => `          <li><a href="/help/${a.slug}"><b>${esc(a.title)}</b><span>${esc(a.summary)}</span></a></li>`).join('\n')}
        </ul>
      </div>`).join('\n')}
    </div>
  </section>
</main>
${FOOT}`;
}

function build(out) {
  const { sections, articles } = load();
  // Check links between articles, including links to one part (/help/name#part, or #part on the same page).
  const ids = {};
  articles.forEach((a) => { ids[a.slug] = new Set((withIds(a.body).html.match(/\sid="[^"]+"/g) || []).map((x) => x.slice(5, -1))); });
  articles.forEach((a) => {
    (a.body.match(/href="(\/help\/[^"]*|#[^"]+)"/g) || []).forEach((h) => {
      const [s, part] = h.slice(6, -1).replace(/^\/help\//, '').split('#');
      const slug = h.startsWith('href="#') ? a.slug : s.replace(/\/$/, '');
      if (slug && !ids[slug]) throw new Error('help/articles/' + a.slug + '.html links to /help/' + slug + ', which doesn’t exist');
      if (slug && part && !ids[slug].has(part)) throw new Error('help/articles/' + a.slug + '.html links to ' + slug + '#' + part + ', but that article has no part with that id');
    });
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), indexPage(sections, articles));
  articles.forEach((a) => fs.writeFileSync(path.join(out, a.slug + '.html'), articlePage(a, articles, sections)));
  // What the search box reads: each article's words, split by heading so results can jump to the right part.
  const index = articles.map((a) => {
    const parts = [];
    withIds(a.body).html.replace(/<a class="hash"[^>]*>#<\/a>/g, '').split(/(?=<h2[\s>])/).forEach((chunk) => {
      const hm = /^<h2\s[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/.exec(chunk);
      if (hm && /^related guides$/i.test(plain(hm[2]))) return; // just links to other articles
      parts.push({ h: hm ? plain(hm[2]) : '', id: hm ? hm[1] : '', t: plain(hm ? chunk.slice(hm[0].length) : chunk) });
    });
    const sec = sections.find((s) => s.id === a.section);
    return { slug: a.slug, title: a.title, summary: a.summary, section: sec.name, parts };
  });
  fs.writeFileSync(path.join(out, 'search.json'), JSON.stringify(index));
  for (const f of ['help.css', 'help.js']) fs.copyFileSync(path.join(src, f), path.join(out, f));
  return articles.length;
}

module.exports = build;
if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(root, 'dist/help'));
  console.log(out + ': ' + build(out) + ' help articles');
}
