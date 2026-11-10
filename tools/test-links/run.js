// Runs every fixture through the editor's link finder and compares with expected.json.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const L = __dirname, NM = L + '/node_modules';
const map = [
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/', NM + '/pdfjs-dist/build/'],
  ['https://cdn.jsdelivr.net/npm/jsqr@1.4.0/', NM + '/jsqr/'],
  ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/', NM + '/tesseract.js/'],
  ['https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/', NM + '/tesseract.js-core/'],
  ['https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/', NM + '/@tesseract.js-data/eng/'],
];
const norm = (t) => String(t).replace(/\/$/, '').toLowerCase();
(async () => {
  const exp = JSON.parse(fs.readFileSync(path.resolve(L, process.argv[3] || 'expected.json')));
  const dir = path.resolve(L, process.argv[2] || 'fx');
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.route(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/, (r) => {
    const u = r.request().url(); const m = map.find(([p]) => u.startsWith(p));
    if (!m) return r.abort();
    const f = m[1] + u.slice(m[0].length).split('?')[0];
    if (!fs.existsSync(f)) { console.log('MISSING', u); return r.abort(); }
    r.fulfill({ path: f, contentType: f.endsWith('.js') ? 'application/javascript' : f.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' });
  });
  await ctx.route('http://fx.local/**', (r) => r.fulfill({ path: dir + '/' + decodeURIComponent(r.request().url().split('/').pop()) }));
  const pg = await ctx.newPage(); pg.on('pageerror', (e) => console.log('pageerror', e.message));
  await pg.goto('http://localhost:8765/index.html'); await pg.waitForTimeout(800);
  let pass = 0, total = 0, extra = 0;
  for (const [file, want] of Object.entries(exp)) {
    const kind = /\.pdf$/.test(file) ? 'pdf' : 'image';
    const t0 = Date.now();
    const got = await pg.evaluate(async ([file, kind]) => {
      const blob = await (await fetch('http://fx.local/' + encodeURIComponent(file))).blob();
      const o = { links: [] };
      try { await TD.linkFinder.addFoundLinks(o, blob, kind); } catch (e) { return { error: String(e) }; }
      return o.links.map((l) => ({ label: l.label, page: l.page, target: l.action.type === 'email' ? 'mailto:' + l.action.email : l.action.type === 'phone' ? 'tel:' + l.action.phone : l.action.type === 'sms' ? 'sms:' + l.action.phone : l.action.url }));
    }, [file, kind]);
    console.log('\n## ' + file + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
    if (got.error) { console.log('  ERROR', got.error); total += want.length; continue; }
    const seen = new Set();
    for (const [target, label] of want) {
      total++;
      const g = got.find((x) => norm(x.target) === norm(target));
      if (g) seen.add(g);
      const ok = g && [].concat(label).includes(g.label);
      if (ok) pass++;
      console.log((ok ? '  ok   ' : g ? '  NAME ' : '  MISS ') + target + '  want "' + label + '"' + (g && !ok ? '  got "' + g.label + '"' : ''));
    }
    got.filter((x) => !seen.has(x)).forEach((x) => { extra++; console.log('  EXTRA ' + x.target + '  "' + x.label + '"'); });
  }
  console.log('\nRESULT ' + pass + '/' + total + ' right, ' + extra + ' extra');
  await b.close();
})();
