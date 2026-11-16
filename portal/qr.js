/* DoorStep QR codes: static codes made in the browser (the link itself is in the code, nothing in between).
   DSQR.svg(o) draws one as an SVG string; DSQR.png(o, px) turns that into a PNG Blob; DSQR.check(o) reads it
   back with jsQR to be sure it scans. Needs qrcode-lib.js (the global `qrcode`). */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const n2 = (v) => +v.toFixed(3);

  // The module grid. Logos need the strongest error correction (H: up to 30% can be covered), plain codes use M.
  function matrix(text, ecc) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const q = qrcode(0, ecc);
    q.addData(text, 'Byte');
    q.make();
    const n = q.getModuleCount();
    return { n, version: (n - 17) / 4, dark: (r, c) => r >= 0 && c >= 0 && r < n && c < n && q.isDark(r, c) };
  }

  // Hex colors: '#abc' or '#aabbcc' (with or without #). Returns '#rrggbb' or null.
  function hex(v) {
    let s = String(v || '').trim().replace(/^#/, '').toLowerCase();
    if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
    return /^[0-9a-f]{6}$/.test(s) ? '#' + s : null;
  }
  function lum(c) {
    const v = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  // One rounded square module: a corner is rounded only where both neighbours on that corner are empty,
  // so neighbouring modules join into smooth shapes.
  function roundMod(x, y, t, r, b, l) {
    const R = 0.5;
    const tl = !t && !l ? R : 0, tr = !t && !r ? R : 0, br = !b && !r ? R : 0, bl = !b && !l ? R : 0;
    const arc = (rad, ex, ey) => (rad ? 'A' + rad + ' ' + rad + ' 0 0 1 ' + n2(ex) + ' ' + n2(ey) : 'L' + n2(ex) + ' ' + n2(ey));
    return 'M' + n2(x + tl) + ' ' + y + 'H' + n2(x + 1 - tr) + arc(tr, x + 1, y + tr) + 'V' + n2(y + 1 - br) + arc(br, x + 1 - br, y + 1) +
      'H' + n2(x + bl) + arc(bl, x, y + 1 - bl) + 'V' + n2(y + tl) + arc(tl, x + tl, y) + 'Z';
  }
  function rrect(x, y, w, hgt, rad) {
    if (!rad) return 'M' + x + ' ' + y + 'h' + w + 'v' + hgt + 'h' + -w + 'Z';
    return 'M' + n2(x + rad) + ' ' + y + 'H' + n2(x + w - rad) + 'A' + rad + ' ' + rad + ' 0 0 1 ' + n2(x + w) + ' ' + n2(y + rad) +
      'V' + n2(y + hgt - rad) + 'A' + rad + ' ' + rad + ' 0 0 1 ' + n2(x + w - rad) + ' ' + n2(y + hgt) +
      'H' + n2(x + rad) + 'A' + rad + ' ' + rad + ' 0 0 1 ' + x + ' ' + n2(y + hgt - rad) +
      'V' + n2(y + rad) + 'A' + rad + ' ' + rad + ' 0 0 1 ' + n2(x + rad) + ' ' + y + 'Z';
  }
  const circle = (cx, cy, rad) => 'M' + n2(cx - rad) + ' ' + cy + 'a' + rad + ' ' + rad + ' 0 1 0 ' + n2(rad * 2) + ' 0a' + rad + ' ' + rad + ' 0 1 0 ' + n2(-rad * 2) + ' 0Z';

  // o: { text, fg, bg (null = see-through), eye (corner color), dots: square|rounded|dots,
  //      corners: square|rounded|round, margin (modules), logo: { src, w, h }, logoSize (0.1–0.3 of the width), logoBack }
  function svg(o, px) {
    const ecc = o.logo ? 'H' : 'M';
    const m = matrix(o.text, ecc), n = m.n;
    const M = Math.max(0, Math.min(10, o.margin == null ? 4 : o.margin));
    const W = n + M * 2;
    const fg = hex(o.fg) || '#111111', eye = hex(o.eye) || fg, bg = o.bg ? hex(o.bg) || '#ffffff' : null;
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

    // Where the logo goes, and which modules it clears.
    let lb = null;
    if (o.logo && o.logo.src) {
      const s = Math.max(0.1, Math.min(0.3, o.logoSize || 0.22)) * n;
      const ar = o.logo.w && o.logo.h ? o.logo.w / o.logo.h : 1;
      const w = ar >= 1 ? s : s * ar, hh = ar >= 1 ? s / ar : s;
      lb = { x: (n - w) / 2, y: (n - hh) / 2, w, h: hh };
    }
    const pad = o.logoBack ? 0.8 : 0;
    const cleared = (r, c) => lb && o.logoBack && c + 1 > lb.x - pad && c < lb.x + lb.w + pad && r + 1 > lb.y - pad && r < lb.y + lb.h + pad;
    const on = (r, c) => m.dark(r, c) && !finder(r, c) && !cleared(r, c);

    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!on(r, c)) continue;
        const x = c + M, y = r + M;
        if (o.dots === 'dots') d += circle(x + 0.5, y + 0.5, 0.45);
        else if (o.dots === 'rounded') d += roundMod(x, y, on(r - 1, c), on(r, c + 1), on(r + 1, c), on(r, c - 1));
        else d += 'M' + x + ' ' + y + 'h1v1h-1Z';
      }
    }
    // The three corner squares.
    let e = '';
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
      const x = c + M, y = r + M;
      if (o.corners === 'round') e += circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5) + circle(x + 3.5, y + 3.5, 1.5);
      else if (o.corners === 'rounded') e += rrect(x, y, 7, 7, 2.2) + rrect(x + 1, y + 1, 5, 5, 1.4) + rrect(x + 2, y + 2, 3, 3, 0.9);
      else e += rrect(x, y, 7, 7, 0) + rrect(x + 1, y + 1, 5, 5, 0) + rrect(x + 2, y + 2, 3, 3, 0);
    });

    const size = px ? ' width="' + px + '" height="' + px + '"' : '';
    let out = '<svg xmlns="' + NS + '" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + W + ' ' + W + '"' + size + ' shape-rendering="' + (o.dots === 'square' || !o.dots ? 'crispEdges' : 'geometricPrecision') + '">';
    if (bg) out += '<rect width="' + W + '" height="' + W + '" fill="' + bg + '"/>';
    out += '<path fill="' + fg + '" d="' + d + '"/>';
    out += '<path fill="' + eye + '" fill-rule="evenodd" shape-rendering="geometricPrecision" d="' + e + '"/>';
    if (lb) {
      out += '<image x="' + n2(lb.x + M) + '" y="' + n2(lb.y + M) + '" width="' + n2(lb.w) + '" height="' + n2(lb.h) + '" preserveAspectRatio="xMidYMid meet" href="' + esc(o.logo.src) + '" xlink:href="' + esc(o.logo.src) + '"/>';
    }
    out += '</svg>';
    return { svg: out, n, version: m.version, ecc };
  }

  // Draws the SVG onto a canvas at px × px. White behind see-through codes only when asked (for checking).
  function canvas(o, px, white) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = px;
        const ctx = cv.getContext('2d');
        if (white) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, px, px); }
        ctx.drawImage(img, 0, 0, px, px);
        resolve(cv);
      };
      img.onerror = () => reject(new Error('Could not draw the QR code.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(o, px).svg);
    });
  }
  const png = (o, px) => canvas(o, px).then((cv) => new Promise((res) => cv.toBlob(res, 'image/png')));

  // Reads the code back the way a phone would (jsQR, loaded once from jsDelivr like the editor does).
  // Resolves true (reads as the right text), false (doesn't), or null (the checker couldn't load).
  let jsqrP = null;
  function jsqr() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrP) {
      jsqrP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
        s.onload = () => (window.jsQR ? res(window.jsQR) : rej(new Error('no jsQR')));
        s.onerror = () => { jsqrP = null; rej(new Error('no jsQR')); };
        document.head.append(s);
      });
    }
    return jsqrP;
  }
  async function check(o) {
    let read;
    try { read = await jsqr(); } catch (e) { return null; }
    // See-through codes are checked on white, where they're usually printed.
    const cv = await canvas(o, 480, true);
    const id = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    const r = read(id.data, id.width, id.height, { inversionAttempts: 'dontInvert' });
    return !!(r && r.data === o.text);
  }

  window.DSQR = { svg, png, check, hex, contrast, lum };
})();
