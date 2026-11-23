/* DoorStep PDF report: a church's tap stats for a chosen period, drawn as a real PDF in the browser.
 *
 * Loaded only when someone asks for a report. Uses jsPDF 4.2.1 (MIT, jspdf.umd.min.js) and Hanken
 * Grotesk (OFL, Latin subset, hanken-grotesk-*.ttf) from this folder, so it works with no other site.
 *
 * DoorStepReport.make(r) → Promise<Blob>, where r is:
 *   church   { id, name }
 *   pages    [{ id, name, publishedAt }]   the pages to report on
 *   stats    { pages: { <pageId>: { views: {day: n}, taps: {day: {label: n}} } } }  (from /stats?days=365)
 *   from, to 'YYYY-MM-DD' (the visitor's local dates, both included)
 *   span     words for the period, e.g. 'Last 30 days'
 *   cmp      { from, to } the period to compare with, or null
 *   answers  { <pageId>: n } connect card answers in the period, or null to leave them out
 *   details  true adds a section for each page with visits
 */
(function () {
  const C = {
    text: '#262626', muted: '#6b6b6b', faint: '#9a9a96', line: '#e4e4e2', panel: '#f7f7f5',
    orange: '#ff5e1f', btn: '#cc4410', tint: '#fff4ee', green: '#15784f', greenBg: '#e8f5ee', down: '#b93c0a',
  };
  const W = 612, H = 792, M = 44; // US Letter, in points
  const CW = W - M * 2;

  // ── Loading ──────────────────────────────────────────────────────────
  const BASE = (document.currentScript && document.currentScript.src) || location.href;
  let ready = null;
  function load() {
    if (ready) return ready;
    const here = (f) => new URL(f, BASE).href;
    const script = () => (window.jspdf ? Promise.resolve() : new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = here('jspdf.umd.min.js');
      s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF maker. Check your connection and try again.'));
      document.head.append(s);
    }));
    const font = (f) => fetch(here(f)).then((r) => { if (!r.ok) throw new Error('Could not load the report font.'); return r.arrayBuffer(); })
      .then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); });
    ready = Promise.all([script(), font('hanken-grotesk-regular.ttf'), font('hanken-grotesk-bold.ttf')])
      .then(([, reg, bold]) => ({ reg, bold }))
      .catch((e) => { ready = null; throw e; });
    return ready;
  }

  // ── Dates and numbers ────────────────────────────────────────────────
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dt = (day) => new Date(day + 'T12:00:00');
  function daysBetween(from, to) {
    const out = [];
    const d = dt(from), end = dt(to);
    while (d <= end && out.length < 800) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  const fmtDay = (day, o) => dt(day).toLocaleDateString('en-US', Object.assign({ month: 'short', day: 'numeric' }, o || {}));
  function fmtRange(from, to) {
    const a = dt(from), b = dt(to);
    if (from === to) return fmtDay(from, { weekday: 'short', year: 'numeric' });
    if (a.getFullYear() !== b.getFullYear()) return fmtDay(from, { year: 'numeric' }) + ' – ' + fmtDay(to, { year: 'numeric' });
    return fmtDay(from) + ' – ' + fmtDay(to, { year: 'numeric' });
  }
  const num = (n) => Math.round(n).toLocaleString('en-US');
  const plural = (n, one, many) => num(n) + ' ' + (n === 1 ? one : many);
  const ratio = (t, v) => (v ? (Math.round((t / v) * 10) / 10).toLocaleString('en-US') : '0');
  const pct = (now, was) => (was ? Math.round(((now - was) / was) * 100) : null);

  // Totals for one page over some days.
  function sum(s, days) {
    const views = days.map((d) => (s && s.views[d]) || 0);
    const taps = days.map((d) => Object.values((s && s.taps[d]) || {}).reduce((a, b) => a + b, 0));
    const buttons = {};
    days.forEach((d) => Object.entries((s && s.taps[d]) || {}).forEach(([k, n]) => { buttons[k] = (buttons[k] || 0) + n; }));
    const total = (a) => a.reduce((x, y) => x + y, 0);
    return { views, taps, buttons: Object.entries(buttons).sort((a, b) => b[1] - a[1]), totalViews: total(views), totalTaps: total(taps) };
  }

  // The font has Latin letters and common punctuation only, so leave out emoji and the like.
  const OK = /[ -~ -ſ‘’“”–—•…→€™]/;
  const clean = (s) => Array.from(String(s == null ? '' : s)).map((ch) => (OK.test(ch) ? ch : ch === '\n' ? ' ' : '')).join('').replace(/\s+/g, ' ').trim();

  // ── Drawing ──────────────────────────────────────────────────────────
  async function make(r) {
    const fonts = await load();
    const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter', compress: true });
    doc.addFileToVFS('HG-Regular.ttf', fonts.reg); doc.addFont('HG-Regular.ttf', 'HG', 'normal');
    doc.addFileToVFS('HG-Bold.ttf', fonts.bold); doc.addFont('HG-Bold.ttf', 'HG', 'bold');
    const title = r.church.name + ' · Tap stats · ' + fmtRange(r.from, r.to);
    doc.setProperties({ title: clean(title), subject: 'DoorStep tap stats report', creator: 'DoorStep', author: clean(r.church.name) });

    const font = (size, bold, color, space) => { doc.setFont('HG', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(color || C.text); doc.setCharSpace(space || 0); };
    const text = (s, x, y, o) => doc.text(clean(s), x, y, o || {});
    const fit = (s, w) => { s = clean(s); if (doc.getTextWidth(s) <= w) return s; while (s.length > 1 && doc.getTextWidth(s + '…') > w) s = s.slice(0, -1); return s.trimEnd() + '…'; };
    const fillC = (c) => doc.setFillColor(c);
    const box = (x, y, w, h, c, rad) => { fillC(c); doc.roundedRect(x, y, w, h, rad == null ? 4 : rad, rad == null ? 4 : rad, 'F'); };
    const outline = (x, y, w, h) => { doc.setDrawColor(C.line); doc.setLineWidth(0.75); doc.roundedRect(x, y, w, h, 4, 4, 'S'); };
    const alpha = (a) => doc.setGState(new doc.GState({ opacity: a }));

    const days = daysBetween(r.from, r.to);
    const before = r.cmp ? daysBetween(r.cmp.from, r.cmp.to) : null;
    const per = r.pages.map((p) => ({ p, now: sum(r.stats.pages[p.id], days), was: before ? sum(r.stats.pages[p.id], before) : null }));
    const visits = days.map((_, i) => per.reduce((a, x) => a + x.now.views[i], 0));
    const taps = days.map((_, i) => per.reduce((a, x) => a + x.now.taps[i], 0));
    const tv = visits.reduce((a, b) => a + b, 0), tt = taps.reduce((a, b) => a + b, 0);
    const wasV = per.reduce((a, x) => a + (x.was ? x.was.totalViews : 0), 0);
    const wasT = per.reduce((a, x) => a + (x.was ? x.was.totalTaps : 0), 0);
    const onePage = r.pages.length === 1;

    let y = M;
    let pageNo = 1;
    const newPage = () => { doc.addPage(); pageNo++; y = M + 8; };
    const need = (h) => { if (y + h > H - M - 26) newPage(); };

    // Header: logo, DoorStep, and what this is.
    const logo = (x, cy, rad) => { fillC(C.orange); doc.circle(x + rad, cy, rad, 'F'); fillC(C.green); doc.circle(x + rad, cy, rad * 0.42, 'F'); };
    logo(M, y + 6, 7);
    font(12, true, C.text, -0.2); text('DoorStep', M + 20, y + 10);
    font(9, false, C.muted); text('Tap stats report', W - M, y + 10, { align: 'right' });
    y += 22;
    doc.setDrawColor(C.line); doc.setLineWidth(0.75); doc.line(M, y, W - M, y);
    y += 40;
    font(28, true, C.text, -0.6); text(fit(r.church.name, CW), M, y);
    y += 22;
    font(12, false, C.muted);
    const what = fmtRange(r.from, r.to) + '  ·  ' + r.span + '  ·  ' + (onePage ? r.pages[0].name : plural(r.pages.length, 'page', 'pages'));
    text(fit(what, CW), M, y);
    y += 14;
    font(9, false, C.faint);
    text('Made ' + new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
      + (r.cmp ? '  ·  Changes compare with ' + fmtRange(r.cmp.from, r.cmp.to) : ''), M, y);
    y += 22;

    // The four numbers.
    let busiest = -1;
    visits.forEach((v, i) => { if (v && (busiest < 0 || v > visits[busiest])) busiest = i; });
    const tiles = [
      { label: 'Visits', value: num(tv), change: r.cmp ? pct(tv, wasV) : undefined, was: wasV, hi: true, note: 'Nothing earlier to compare' },
      { label: 'Button taps', value: num(tt), change: r.cmp ? pct(tt, wasT) : undefined, was: wasT, note: 'Nothing earlier to compare' },
      { label: 'Taps per visit', value: ratio(tt, tv), note: tv ? 'Buttons tapped per visit' : 'No visits yet' },
      busiest >= 0 ? { label: 'Busiest day', value: fmtDay(days[busiest], { weekday: 'short' }), note: plural(visits[busiest], 'visit', 'visits'), small: true }
        : { label: 'Busiest day', value: '–', note: 'No visits yet', small: true },
    ];
    const gap = 10, tw = (CW - gap * 3) / 4, th = 74;
    tiles.forEach((t, i) => {
      const x = M + i * (tw + gap);
      if (t.hi) box(x, y, tw, th, C.tint); else box(x, y, tw, th, C.panel);
      font(9, true, t.hi ? C.btn : C.muted, 0.2); text(t.label.toUpperCase(), x + 12, y + 18);
      font(t.small ? 18 : 24, true, C.text, -0.5); text(fit(t.value, tw - 24), x + 12, y + (t.small ? 44 : 46));
      font(9, false, C.muted);
      if (t.change !== undefined) {
        if (t.change == null) text(t.was === 0 && (t.label === 'Visits' ? tv : tt) ? 'None the period before' : 'No change to show', x + 12, y + 62);
        else {
          font(9, true, t.change >= 0 ? C.green : C.down);
          const s = (t.change > 0 ? '+' : '') + t.change + '%';
          text(s, x + 12, y + 62);
          const sw = doc.getTextWidth(s);
          font(9, false, C.muted); text('vs the period before', x + 12 + sw + 3, y + 62);
        }
      } else text(fit(t.note, tw - 24), x + 12, y + 62);
    });
    y += th + 18;

    // Visits and taps chart. Longer periods are added up by week so the lines stay readable.
    const byWeek = days.length > 92;
    const groups = [];
    if (byWeek) groups.push(...weeks(visits, taps));
    else days.forEach((d, i) => groups.push({ day: d, end: d, v: visits[i], t: taps[i] }));
    chart(byWeek ? 'Visits and taps per week' : 'Visits and taps per day', groups, 196, true);

    function chart(heading, gs, ch, legend) {
      need(ch + 10);
      outline(M, y, CW, ch);
      font(12, true, C.text, -0.2); text(heading, M + 14, y + 22);
      if (legend) {
        let lx = W - M - 14;
        const item = (label, color) => {
          font(9, false, C.muted); const w = doc.getTextWidth(label); lx -= w; text(label, lx, y + 21);
          fillC(color); doc.roundedRect(lx - 16, y + 16.5, 10, 4, 2, 2, 'F'); lx -= 30;
        };
        item('Taps', C.green); item('Visits', C.orange);
      }
      const px = M + 40, pw = CW - 40 - 16, py = y + 40, ph = ch - 40 - 30;
      const max = Math.max(1, ...gs.map((g) => Math.max(g.v, legend ? g.t : 0)));
      const top = niceMax(max);
      doc.setLineWidth(0.5);
      [0, 0.5, 1].forEach((f) => {
        const gy = py + ph - f * ph;
        doc.setDrawColor(C.line); doc.line(px, gy, px + pw, gy);
        font(8, false, C.faint); text(num(top * f), px - 8, gy + 3, { align: 'right' });
      });
      const n = gs.length;
      const X = (i) => (n === 1 ? px + pw / 2 : px + (i * pw) / (n - 1));
      const Y = (v) => py + ph - (v / top) * ph;
      if (!gs.some((g) => g.v || g.t)) {
        font(10, false, C.muted); text('No visits in this period yet.', px + pw / 2, py + ph / 2, { align: 'center' });
      } else if (n <= 45 && !legend) {
        // Bars, for one page's short periods.
        const bw = pw / n;
        gs.forEach((g, i) => { const bh = g.v ? Math.max(1.5, (g.v / top) * ph) : 0; if (bh) { fillC(C.orange); doc.rect(px + i * bw + bw * 0.18, py + ph - bh, bw * 0.64, bh, 'F'); } });
      } else {
        const path = (vals) => vals.map((v, i) => [X(i), Y(v)]);
        const draw = (pts, color, width) => {
          doc.setDrawColor(color); doc.setLineWidth(width); doc.setLineJoin('round'); doc.setLineCap('round');
          if (pts.length === 1) { fillC(color); doc.circle(pts[0][0], pts[0][1], 2.5, 'F'); return; }
          doc.lines(pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], 'S');
        };
        const vp = path(gs.map((g) => g.v));
        if (vp.length > 1) {
          // A soft orange fill under the visits line.
          const area = [[vp[0][0], py + ph]].concat(vp, [[vp[vp.length - 1][0], py + ph]]);
          alpha(0.12); fillC(C.orange);
          doc.lines(area.slice(1).map((p, i) => [p[0] - area[i][0], p[1] - area[i][1]]), area[0][0], area[0][1], [1, 1], 'F', true);
          alpha(1);
        }
        if (legend) draw(path(gs.map((g) => g.t)), C.green, 1.4);
        draw(vp, C.orange, 1.8);
      }
      // Dates under the chart: about six, first and last always.
      const marks = Array.from(new Set(Array.from({ length: Math.min(n, 6) }, (_, i) => (n <= 6 ? i : Math.round((i * (n - 1)) / 5)))));
      font(8, false, C.faint);
      const barMode = n <= 45 && !legend;
      marks.forEach((i) => {
        const x = barMode ? px + (i + 0.5) * (pw / n) : X(i);
        const align = n > 1 && i === 0 && !barMode ? 'left' : n > 1 && i === n - 1 && !barMode ? 'right' : 'center';
        text(fmtDay(gs[i].day), x, py + ph + 16, { align });
      });
      y += ch + 14;
    }
    // Whole weeks counted back from the last day, so the newest point isn't a part week; a part week
    // at the start is left out of the chart (the totals above still count it).
    function weeks(vs, ts) {
      const g = [];
      for (let e = days.length; e - 7 >= 0; e -= 7) g.unshift({ day: days[e - 7], v: vs.slice(e - 7, e).reduce((a, b) => a + b, 0), t: ts.slice(e - 7, e).reduce((a, b) => a + b, 0) });
      return g;
    }
    function niceMax(v) {
      if (v <= 4) return 4;
      const p = Math.pow(10, Math.floor(Math.log10(v)));
      for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
      return 10 * p;
    }

    // Two side by side: visits by day of the week, and the most-tapped buttons.
    const half = (CW - 12) / 2, sh = 196;
    need(sh);
    outline(M, y, half, sh);
    font(12, true, C.text, -0.2); text('Busiest days of the week', M + 14, y + 22);
    font(9, false, C.muted); text('Visits on each day, added up', M + 14, y + 36);
    const wk = [0, 0, 0, 0, 0, 0, 0];
    days.forEach((d, i) => { wk[dt(d).getDay()] += visits[i]; });
    const order = [0, 1, 2, 3, 4, 5, 6];
    const wmax = Math.max(1, ...wk), wbest = wk.indexOf(Math.max(...wk));
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bx = M + 14, bwid = half - 28, slot = bwid / 7, by = y + 60, bh = sh - 60 - 36;
    order.forEach((di, i) => {
      const hgt = wk[di] ? Math.max(2, (wk[di] / wmax) * bh) : 1;
      fillC(wk[di] && di === wbest ? C.orange : wk[di] ? '#ffc2a8' : C.line);
      doc.roundedRect(bx + i * slot + slot * 0.18, by + bh - hgt, slot * 0.64, hgt, 2, 2, 'F');
      font(8, di === wbest && wk[di], di === wbest && wk[di] ? C.text : C.muted); text(names[di], bx + i * slot + slot / 2, by + bh + 13, { align: 'center' });
      font(8, false, C.faint); if (wk[di]) text(num(wk[di]), bx + i * slot + slot / 2, by + bh - hgt - 4, { align: 'center' });
    });
    font(9, false, C.muted);
    text(tv ? (names[wbest] === 'Sun' ? 'Sundays' : ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][wbest - 1]) + ' are busiest' : 'No visits yet', bx, y + sh - 10);

    const rx = M + half + 12;
    outline(rx, y, half, sh);
    font(12, true, C.text, -0.2); text('Most-tapped buttons', rx + 14, y + 22);
    font(9, false, C.muted); text(tt ? plural(tt, 'tap', 'taps') + ' in all' : 'Buttons people tap are ranked here', rx + 14, y + 36);
    const btns = [];
    per.forEach((x) => x.now.buttons.forEach(([label, c]) => btns.push({ label, c, p: x.p })));
    btns.sort((a, b) => b.c - a.c);
    const topB = btns.slice(0, 5);
    if (!topB.length) { font(10, false, C.muted); text('No taps in this period yet.', rx + half / 2, y + sh / 2 + 10, { align: 'center' }); }
    topB.forEach((b, i) => {
      const ry = y + 60 + i * 27.5;
      font(9.5, true, C.text); const share = Math.round((b.c / Math.max(1, tt)) * 100) + '%';
      const cw = doc.getTextWidth(share);
      text(fit(b.label, half - 40 - cw), rx + 14, ry);
      text(share, rx + half - 14, ry, { align: 'right' });
      box(rx + 14, ry + 4, half - 28, 3.5, C.panel, 1.75);
      box(rx + 14, ry + 4, Math.max(3, ((half - 28) * b.c) / topB[0].c), 3.5, C.orange, 1.75);
      if (!onePage) { font(7.5, false, C.faint); text(fit(plural(b.c, 'tap', 'taps') + ' · ' + b.p.name, half - 28), rx + 14, ry + 14.5); }
      else { font(7.5, false, C.faint); text(plural(b.c, 'tap', 'taps'), rx + 14, ry + 14.5); }
    });
    y += sh + 22;

    // Every page, busiest first.
    if (!onePage) {
      const cols = [
        { k: 'Page', w: 0, align: 'left' },
        { k: 'Visits', w: 52 },
        r.cmp ? { k: 'Change', w: 52 } : null,
        { k: 'Taps', w: 46 },
        { k: 'Per visit', w: 52 },
        r.answers ? { k: 'Answers', w: 52 } : null,
        { k: 'Most-tapped button', w: 140, align: 'left' },
      ].filter(Boolean);
      cols[0].w = CW - cols.slice(1).reduce((a, c) => a + c.w, 0);
      const rows = per.slice().sort((a, b) => b.now.totalViews - a.now.totalViews || b.now.totalTaps - a.now.totalTaps || a.p.name.localeCompare(b.p.name));
      const head = () => {
        need(60);
        font(15, true, C.text, -0.3); text('Pages', M, y + 4);
        const pw0 = doc.getTextWidth('Pages');
        font(9, false, C.muted); text('Busiest first', M + pw0 + 10, y + 4);
        y += 18;
        box(M, y, CW, 22, C.panel, 3);
        let x = M;
        cols.forEach((c) => { font(8, true, C.muted, 0.2); const label = c.k.toUpperCase(); if (c.align === 'left') text(label, x + 10, y + 14); else text(label, x + c.w - 10, y + 14, { align: 'right' }); x += c.w; });
        y += 22;
      };
      head();
      rows.forEach((row, ri) => {
        if (y + 24 > H - M - 26) { newPage(); head(); }
        let x = M;
        const ch = r.cmp ? pct(row.now.totalViews, row.was.totalViews) : null;
        const vals = {
          Page: row.p.name, Visits: num(row.now.totalViews), Change: ch == null ? '–' : (ch > 0 ? '+' : '') + ch + '%', Taps: num(row.now.totalTaps),
          'Per visit': ratio(row.now.totalTaps, row.now.totalViews), Answers: r.answers ? num(r.answers[row.p.id] || 0) : '',
          'Most-tapped button': row.now.buttons.length ? row.now.buttons[0][0] + ' (' + num(row.now.buttons[0][1]) + ')' : '–',
        };
        cols.forEach((c) => {
          const v = vals[c.k];
          if (c.k === 'Page') {
            fillC(row.p.publishedAt ? C.green : C.line); doc.circle(x + 13, y + 11.5, 2.6, 'F');
            font(10, true, C.text); text(fit(v, c.w - 30), x + 22, y + 15);
          } else if (c.k === 'Change') {
            font(10, true, ch == null ? C.faint : ch >= 0 ? C.green : C.down); text(v, x + c.w - 10, y + 15, { align: 'right' });
          } else if (c.align === 'left') {
            font(9.5, false, v === '–' ? C.faint : C.text); text(fit(v, c.w - 14), x + 10, y + 15);
          } else { font(10, c.k === 'Visits', C.text); text(v, x + c.w - 10, y + 15, { align: 'right' }); }
          x += c.w;
        });
        y += 24;
        if (ri < rows.length - 1) { doc.setDrawColor(C.line); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); }
      });
      font(8, false, C.faint);
      y += 14; text('Green dot: live on the site.' + (r.answers ? ' Answers: connect card answers sent in this period.' : ''), M, y);
      y += 18;
    } else if (r.answers) {
      need(30);
      const lead = 'Connect card answers sent in this period: ';
      font(10, false, C.muted); text(lead, M, y + 10);
      const lw = doc.getTextWidth(lead);
      font(10, true, C.text); text(num(r.answers[r.pages[0].id] || 0), M + lw, y + 10);
      y += 26;
    }

    // One section for each page, if asked for (or the one page's full button list).
    const detail = (x) => {
      const t = x.now;
      need(250);
      font(15, true, C.text, -0.3); text(fit(x.p.name, CW - 160), M, y + 4);
      font(9, false, C.muted);
      text(plural(t.totalViews, 'visit', 'visits') + '  ·  ' + plural(t.totalTaps, 'tap', 'taps') + '  ·  ' + ratio(t.totalTaps, t.totalViews) + ' per visit', W - M, y + 4, { align: 'right' });
      y += 16;
      const gs = days.length > 92
        ? weeks(t.views, t.views.map(() => 0))
        : days.map((d, i) => ({ day: d, v: t.views[i], t: 0 }));
      chart(days.length > 92 ? 'Visits per week' : 'Visits per day', gs, 150, false);
      const list = t.buttons.slice(0, onePage ? 40 : 12);
      if (list.length) {
        need(40);
        font(11, true, C.text, -0.2); text('Buttons tapped', M, y + 4);
        if (t.buttons.length > list.length) { font(9, false, C.muted); text('Top ' + list.length + ' of ' + t.buttons.length, W - M, y + 4, { align: 'right' }); }
        y += 14;
        const maxB = list[0][1];
        list.forEach(([label, c]) => {
          need(20);
          font(9.5, false, C.text); text(fit(label, 190), M, y + 10);
          box(M + 200, y + 5, CW - 260, 5, C.panel, 2.5);
          box(M + 200, y + 5, Math.max(3, ((CW - 260) * c) / maxB), 5, C.orange, 2.5);
          font(9.5, true, C.text); text(num(c), W - M, y + 10, { align: 'right' });
          y += 18;
        });
      } else { font(9.5, false, C.muted); text('No taps in this period.', M, y + 6); y += 16; }
      y += 18;
    };
    if (onePage) detail(per[0]);
    else if (r.details) {
      const busy = per.filter((x) => x.now.totalViews || x.now.totalTaps).sort((a, b) => b.now.totalViews - a.now.totalViews);
      if (busy.length) { newPage(); font(20, true, C.text, -0.5); text('Page by page', M, y + 8); y += 30; busy.forEach(detail); }
    }

    // How visits are counted, then a footer on every page.
    need(40);
    doc.setDrawColor(C.line); doc.setLineWidth(0.5); doc.line(M, y, W - M, y);
    font(8.5, false, C.muted);
    doc.text(doc.splitTextToSize('How this is counted: a visit counts once per person every 30 minutes, on the page’s install code and its live link. Taps count each time someone taps a button. Dates are the visitor’s own. No cookies are used and nothing about visitors is stored.', CW), M, y + 14);
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const fy = H - M + 14;
      logo(M, fy - 3, 3.5);
      font(8, false, C.faint); text(fit('DoorStep  ·  ' + r.church.name + '  ·  ' + fmtRange(r.from, r.to), CW - 80), M + 11, fy);
      text('Page ' + i + ' of ' + total, W - M, fy, { align: 'right' });
    }
    return doc.output('blob');
  }

  window.DoorStepReport = { make, load, daysBetween, ymd };
})();
