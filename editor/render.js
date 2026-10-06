/* TapDot Editor — turns a project (theme + blocks + pop-up menus) into one
   self-contained HTML page that can be pasted into a Squarespace code block. */
(function () {
  const TD = (window.TD = window.TD || {});

  // ── Escaping helpers ─────────────────────────────────────────────────
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Values dropped into CSS (colors etc.) can't break out of the declaration.
  const cssv = (v) => String(v == null ? '' : v).replace(/[;{}<>"\\]/g, '').trim();
  const safeUrl = (u, allowData) => {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:|mailto:|tel:|sms:|#|\/|\.\/)/i.test(u)) return u;
    if (allowData && /^data:image\//i.test(u)) return u;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return 'https://' + u; // bare domain
    return '';
  };
  TD.esc = esc;
  TD.safeUrl = safeUrl;

  // Mini markup: **bold**, *italic*, ==accent==, [text](url), newlines.
  function md(src, paragraphs) {
    const links = [];
    let s = esc(src || '');
    // [[#e33|words]] or [[accent|words]] → colored words
    s = s.replace(/\[\[\s*([#\w(),.%\s]+?)\s*\|(.+?)\]\]/g, (m, c, t) => {
      const col = c === 'accent' ? 'var(--td-accent)' : c === 'muted' ? 'var(--td-muted)' : cssv(c);
      links.push('<span style="color:' + col + '">');
      return '\u0000' + (links.length - 1) + '\u0000' + t + '\u0001';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
      const url = safeUrl(u.replace(/&amp;/g, '&'));
      links.push(url ? '<a href="' + esc(url) + '"' + (/^https?:/i.test(url) ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>' : t);
      return '\u0000' + (links.length - 1) + '\u0000';
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
      .replace(/==(.+?)==/g, '<span class="td-accent">$1</span>');
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => links[+i]).replace(/\u0001/g, '</span>');
    if (paragraphs) {
      return s.split(/\n\s*\n/).map((p) => '<p>' + p.trim().replace(/\n/g, '<br>') + '</p>').join('');
    }
    return s.replace(/\n/g, '<br>');
  }
  TD.md = md;

  // ── Actions → link attributes ────────────────────────────────────────
  function actAttrs(a, ctx) {
    a = a || { type: 'none' };
    const d = (k, v) => ' data-td-' + k + '="' + esc(v) + '"';
    switch (a.type) {
      case 'link': {
        const u = safeUrl(a.url);
        if (!u) return { attrs: ' role="button"', live: false };
        return { attrs: ' href="' + esc(u) + '"' + (a.newTab ? ' target="_blank" rel="noopener"' : ''), live: true };
      }
      case 'popup': {
        const u = safeUrl(a.url);
        if (!u) return { attrs: ' role="button"', live: false };
        // No proxy worker set: many sites refuse to load in a pop-up, so open a new tab instead.
        if (!String(ctx.proxy || '').trim()) return { attrs: ' href="' + esc(u) + '" target="_blank" rel="noopener"', live: true };
        ctx.usesPage = true;
        // Without a title the sheet shows the site's name, so remember the real site, not the proxy's.
        let host = '';
        try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (e) { /* keep blank */ }
        return { attrs: ' href="' + esc(proxied(u, a, ctx)) + '"' + d('act', 'popup') + d('title', a.title || '') + d('host', host) + d('icon', a.icon || '🔗'), live: true };
      }
      case 'sheet':
        if (!a.sheet) return { attrs: ' role="button"', live: false };
        return { attrs: ' href="#"' + d('act', 'sheet') + d('sheet', a.sheet), live: true };
      case 'copy':
        return { attrs: ' href="#"' + d('act', 'copy') + d('text', a.text || '') + d('toast', a.toast || 'Copied!'), live: true };
      case 'phone':
        return { attrs: ' href="tel:' + esc(String(a.phone || '').replace(/[^\d+*#,]/g, '')) + '"', live: true };
      case 'sms':
        return { attrs: ' href="sms:' + esc(String(a.phone || '').replace(/[^\d+]/g, '')) + (a.body ? '?&body=' + encodeURIComponent(a.body) : '') + '"', live: true };
      case 'email': {
        const q = a.subject ? '?subject=' + encodeURIComponent(a.subject) : '';
        return { attrs: ' href="mailto:' + esc(String(a.email || '').trim()) + q + '"', live: true };
      }
      case 'scroll':
        return { attrs: ' href="#' + esc(a.target || '') + '"' + d('act', 'scroll'), live: true };
      case 'share':
        return { attrs: ' href="#"' + d('act', 'share') + d('title', a.title || '') + d('url', a.url || ''), live: true };
      default:
        return { attrs: '', live: false };
    }
  }

  // Send pop-up pages through the pop-up proxy worker, when one is set, so sites that
  // refuse to be framed still load. Links already on the proxy are left alone.
  function proxied(u, a, ctx) {
    const px = String(ctx.proxy || '').trim().replace(/\/+$/, '');
    if (!px || a.direct || !/^https?:/i.test(u)) return u;
    let url;
    try { url = new URL(u); if (url.host === new URL(px).host) return u; } catch (e) { return u; }
    const host = url.hostname.replace(/^www\./, '');
    // The live BFC worker maps <worker>/<path> to bethanynaz.org/<path>, so only those links go
    // through it.
    if (px === TD.BFC_PROXY.replace(/\/+$/, '')) return host === 'bethanynaz.org' ? px + url.pathname + url.search + url.hash : u;
    // Any other worker is the copy-and-paste one from the Export tab (editor/popup-worker.js):
    // links to the sites ticked there go through it as ?url=.
    const list = ctx.proxyHosts || [];
    if (!list.some((h) => host === h || host.endsWith('.' + h))) return u;
    return px + '/?url=' + encodeURIComponent(u);
  }

  // `<a>` when the action does something, `<div>` otherwise.
  // `label` is what the item says (button label, card title…); a pop-up without its own title uses it.
  function tap(cls, action, inner, ctx, extraAttrs, label) {
    if (action && action.type === 'popup' && !action.title && label) action = Object.assign({}, action, { title: plain(label) });
    const r = actAttrs(action, ctx);
    const tag = r.live ? 'a' : 'div';
    return '<' + tag + ' class="' + cls + (r.live ? ' td-tap' : '') + '"' + r.attrs + (extraAttrs || '') + '>' + inner + '</' + tag + '>';
  }

  const img = (src, alt, cls, lazy) => {
    const u = safeUrl(src, true);
    if (!u) return '<div class="' + (cls || '') + ' td-noimg"></div>';
    return '<img class="' + (cls || '') + '" src="' + esc(u) + '" alt="' + esc(alt || '') + '"' + (lazy === false ? '' : ' loading="lazy"') + ' />';
  };
  // Icon: emoji text, or an uploaded/linked image.
  const ico = (v) => {
    const u = /^(https?:|data:image\/)/i.test(v || '') ? safeUrl(v, true) : '';
    return u ? '<img class="td-ico" src="' + esc(u) + '" alt="" />' : esc(v);
  };
  // Markup-free text, e.g. for a pop-up title taken from a rich-text label.
  const plain = (s) => md(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const aspectCss = (a) => (a && a !== 'auto' ? 'aspect-ratio:' + cssv(a) + ';' : '');

  // Convert "2026-12-24T18:00" in a given IANA zone to a UTC timestamp.
  function zonedToUtc(local, tz) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local || '');
    if (!m) return null;
    const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    try {
      const parts = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(guess)).forEach((p) => (parts[p.type] = p.value));
      const asZone = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
      return guess - (asZone - guess);
    } catch (e) {
      return guess;
    }
  }

  function videoEmbed(url) {
    url = String(url || '').trim();
    let m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i.exec(url);
    if (m) return 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0&playsinline=1';
    m = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(url);
    if (m) return 'https://player.vimeo.com/video/' + m[1];
    return '';
  }

  // ── Block renderers (return inner HTML) ──────────────────────────────
  const R = {
    hero(b, ctx) {
      const imgs = b.images.filter(Boolean);
      const multi = imgs.length > 1;
      let pics = imgs.map((u, i) => img(u, ctx.title, 'td-hero-img' + (i === 0 ? ' on' : ''), i > 0)).join('');
      if (!imgs.length) pics = '<div class="td-hero-img on td-noimg"></div>';
      const auto = b.aspect === 'auto';
      const media = '<div class="td-hero-media' + (auto ? ' td-auto' : '') + '" style="' + aspectCss(b.aspect) + 'object-fit:' + cssv(b.fit) + '"' + (multi ? ' data-td-fade="' + (+b.interval || 7) * 1000 + '"' : '') + '>' + pics + '</div>';
      let text = '';
      if (b.textPos !== 'none' && (b.title || b.subtitle)) {
        text = '<div class="td-hero-body" style="text-align:' + cssv(b.align) + '">' +
          (b.title ? '<div class="td-hero-title td-head" style="font-size:' + (+b.titleSize || 23) + 'px">' + md(b.title) + '</div>' : '') +
          (b.subtitle ? '<div class="td-hero-sub">' + md(b.subtitle) + '</div>' : '') + '</div>';
      }
      return tap('td-hero td-card td-hero-' + b.textPos + ' td-fit-' + cssv(b.fit), b.action, media + text, ctx, '', b.title);
    },
    heading(b, ctx) {
      const link = b.linkText ? tap('td-see-all', b.action, esc(b.linkText), ctx, '', b.title || b.linkText) : '';
      return '<div class="td-heading" style="justify-content:' + (b.align === 'center' && !link ? 'center' : 'space-between') + '"><h2 class="td-head" style="font-size:' + (+b.size || 18) + 'px">' + md(b.title) + '</h2>' + link + '</div>';
    },
    text(b) {
      return '<div class="td-text' + (b.card ? ' td-card td-pad' : '') + (b.muted ? ' td-muted' : '') + '" style="font-size:' + (+b.size || 15) + 'px;text-align:' + cssv(b.align) + '">' + md(b.body, true) + '</div>';
    },
    buttons(b, ctx) {
      const shape = +b.shape >= 0 ? 'border-radius:' + +b.shape + 'px;' : '';
      const items = b.items.map((it) => {
        let st = shape;
        if (it.bg) st += 'background:' + cssv(it.bg) + ';border-color:' + cssv(it.bg) + ';';
        if (it.color) st += 'color:' + cssv(it.color) + ';';
        const icon = it.icon ? '<span class="td-btn-icon"' + (it.iconBg ? ' style="background:' + cssv(it.iconBg) + '"' : ' style="width:auto;background:none"') + '>' + ico(it.icon) + '</span>' : '';
        return tap('td-btn', it.action, icon + '<span class="td-btn-label">' + md(it.label) + '</span>', ctx, st ? ' style="' + st + '"' : '', it.label);
      }).join('');
      return '<div class="td-btns td-btns-' + cssv(b.layout) + ' td-btn-' + cssv(b.variant) + ' td-btn-' + cssv(b.size) + '">' + items + '</div>';
    },
    banner(b, ctx) {
      let lead = '';
      if (safeUrl(b.image, true)) lead = img(b.image, b.title, 'td-banner-img');
      else if (b.icon) lead = '<div class="td-banner-icon"' + (b.iconBg ? ' style="background:' + cssv(b.iconBg) + '"' : '') + '>' + ico(b.icon) + '</div>';
      const inner = lead + '<div class="td-banner-text">' +
        (b.eyebrow ? '<div class="td-eyebrow">' + md(b.eyebrow) + '</div>' : '') +
        '<div class="td-banner-title td-head">' + md(b.title) + '</div>' +
        (b.subtitle ? '<div class="td-banner-sub">' + md(b.subtitle) + '</div>' : '') + '</div>' +
        (b.arrow ? '<div class="td-arrow">›</div>' : '');
      return tap('td-banner td-card', b.action, inner, ctx, '', b.title);
    },
    cards(b, ctx) {
      const items = b.items.map((it) => {
        const pic = b.variant === 'tile'
          ? '<div class="td-cardimg" style="' + aspectCss(b.aspect) + '">' + img(it.image, it.name) + '</div>'
          : '<div class="td-cardimg" style="width:' + (+b.imgSize || 64) + 'px;height:' + (+b.imgSize || 64) + 'px">' + img(it.image, it.name) + '</div>';
        const info = '<div class="td-cardinfo">' + (it.tag ? '<div class="td-tag">' + md(it.tag) + '</div>' : '') + '<div class="td-cardname td-head">' + md(it.name) + '</div></div>';
        return tap('td-cardi td-card', it.action, pic + info, ctx, b.layout === 'scroll' ? ' style="width:' + (+b.width || 195) + 'px"' : '', it.name);
      }).join('');
      return '<div class="td-cards td-cards-' + cssv(b.layout) + ' td-cards-' + cssv(b.variant) + '">' + items + '</div>';
    },
    accordion(b, ctx) {
      const items = b.items.map((it) => {
        const btn = it.btnLabel ? tap('td-btn td-inline-btn', it.action, esc(it.btnLabel), ctx, '', it.title) : '';
        return '<details class="td-acc-item"' + (it.open ? ' open' : '') + '><summary>' +
          (it.icon ? '<span class="td-acc-icon">' + ico(it.icon) + '</span>' : '') +
          '<span class="td-acc-title td-head">' + md(it.title) + '</span><span class="td-acc-chev">›</span></summary>' +
          '<div class="td-acc-body">' + (safeUrl(it.image, true) ? img(it.image, it.title, 'td-acc-img') : '') + md(it.body, true) + btn + '</div></details>';
      }).join('');
      return '<div class="td-acc td-card"' + (b.single ? ' data-td-single="1"' : '') + '>' + items + '</div>';
    },
    slides(b, ctx) {
      const slides = b.items.map((it) => {
        const cap = b.captions !== 'none' && (it.title || it.caption)
          ? '<div class="td-slide-cap">' + (it.title ? '<div class="td-slide-title td-head">' + md(it.title) + '</div>' : '') + (it.caption ? '<div class="td-slide-sub">' + md(it.caption) + '</div>' : '') + '</div>'
          : '';
        return tap('td-slide td-card', it.action, '<div class="td-slide-media" style="' + aspectCss(b.aspect) + '">' + img(it.image, it.title) + '</div>' + cap, ctx, '', it.title);
      }).join('');
      const dots = b.dots && b.items.length > 1 ? '<div class="td-dots">' + b.items.map((_, i) => '<button type="button" aria-label="Slide ' + (i + 1) + '"' + (i === 0 ? ' class="on"' : '') + '></button>').join('') + '</div>' : '';
      const arrows = b.arrows && b.items.length > 1 ? '<button type="button" class="td-sl-arrow td-sl-prev" aria-label="Previous">‹</button><button type="button" class="td-sl-arrow td-sl-next" aria-label="Next">›</button>' : '';
      return '<div class="td-slides td-cap-' + cssv(b.captions) + (b.peek ? ' td-peek' : '') + '"' + (b.autoplay && b.items.length > 1 ? ' data-td-auto="' + (+b.interval || 5) * 1000 + '"' : '') + '><div class="td-slides-wrap"><div class="td-slides-track">' + slides + '</div>' + arrows + '</div>' + dots + '</div>';
    },
    image(b, ctx) {
      const media = '<div class="td-image-media" style="' + aspectCss(b.aspect) + '">' + img(b.image, b.alt) + '</div>';
      return tap('td-image td-card' + (b.aspect === 'auto' ? ' td-auto' : ''), b.action, media + (b.caption ? '<div class="td-image-cap">' + md(b.caption) + '</div>' : ''), ctx, '', b.caption);
    },
    gallery(b, ctx) {
      if (b.zoom) ctx.usesZoom = true;
      const items = b.images.filter(Boolean).map((u) => {
        const s = safeUrl(u, true);
        return '<' + (b.zoom ? 'a href="#" data-td-act="zoom" data-td-src="' + esc(s) + '"' : 'div') + ' class="td-gal-item" style="' + aspectCss(b.aspect) + '">' + img(u, '') + '</' + (b.zoom ? 'a' : 'div') + '>';
      }).join('');
      return '<div class="td-gallery" style="grid-template-columns:repeat(' + (+b.cols || 3) + ',1fr);gap:' + (+b.gap || 0) + 'px">' + items + '</div>';
    },
    // Connect card: answers are sent to the portal page the form was published from (ctx.formUrl).
    form(b, ctx) {
      const kinds = { email: 'email', phone: 'tel' };
      const q = b.items.map((it, i) => {
        const id = 'td-f-' + b.id + '-' + i;
        const req = it.required ? ' required' : '';
        const star = it.required ? '<span class="td-req" aria-hidden="true">*</span>' : '';
        const lab = esc(it.label || 'Question');
        const ph = it.ph ? ' placeholder="' + esc(it.ph) + '"' : '';
        const opts = String(it.options || '').split('\n').map((o) => o.trim()).filter(Boolean);
        if (it.kind === 'check') {
          return '<label class="td-f-check"><input type="checkbox" name="q' + i + '" value="Yes"' + req + ' /><span>' + lab + star + '</span></label>';
        }
        if (it.kind === 'choice' || it.kind === 'checks') {
          const type = it.kind === 'choice' ? 'radio' : 'checkbox';
          return '<fieldset class="td-f-q" data-td-label="' + lab + '"' + (it.required ? ' data-td-req' : '') + '><legend>' + lab + star + '</legend>' +
            opts.map((o) => '<label class="td-f-check"><input type="' + type + '" name="q' + i + '" value="' + esc(o) + '"' + (type === 'radio' ? req : '') + ' /><span>' + esc(o) + '</span></label>').join('') + '</fieldset>';
        }
        const input = it.kind === 'long'
          ? '<textarea id="' + id + '" name="q' + i + '" rows="3" maxlength="2000"' + ph + req + '></textarea>'
          : '<input id="' + id + '" name="q' + i + '" type="' + (kinds[it.kind] || 'text') + '" maxlength="200"' + ph + req +
            (it.kind === 'email' ? ' autocomplete="email"' : it.kind === 'phone' ? ' autocomplete="tel"' : /name/i.test(it.label) ? ' autocomplete="name"' : '') + ' />';
        return '<div class="td-f-q"><label for="' + id + '">' + lab + star + '</label>' + input + '</div>';
      }).join('');
      const labels = b.items.map((it) => it.label || 'Question');
      return '<form class="td-form td-card" novalidate data-td-form="' + esc(b.id) + '" data-td-post="' + esc(ctx.formUrl || '') + '" data-td-labels="' + esc(JSON.stringify(labels)) + '">' +
        (b.title ? '<div class="td-form-title td-head">' + md(b.title) + '</div>' : '') +
        (b.intro ? '<div class="td-form-intro">' + md(b.intro, true) + '</div>' : '') +
        q +
        '<input class="td-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />' +
        '<div class="td-form-err" role="alert"></div>' +
        '<button type="submit" class="td-form-btn">' + esc(b.btnLabel || 'Send') + '</button>' +
        '</form><div class="td-form-done td-card" hidden>' + md(b.thanks || 'Thank you!', true) + '</div>';
    },
    copy(b) {
      const rows = b.items.map((it) =>
        '<div class="td-copy-row"><div class="td-copy-text">' + (it.label ? '<div class="td-tag">' + md(it.label) + '</div>' : '') +
        '<div class="td-copy-val">' + esc(it.value).replace(/\n/g, '<br>') + '</div></div>' +
        '<a href="#" class="td-copy-btn td-tap" data-td-act="copy" data-td-text="' + esc(it.value) + '" data-td-toast="' + esc(it.toast || 'Copied!') + '">' + esc(b.btnLabel || 'Copy') + '</a></div>').join('');
      return '<div class="td-copy td-card">' + (b.title ? '<div class="td-copy-title td-head">' + md(b.title) + '</div>' : '') + rows + '</div>';
    },
    events(b, ctx) {
      ctx.usesEvents = true;
      return '<div class="td-events" data-td-events="' + esc(safeUrl(b.url)) + '" data-td-max="' + (+b.max || 3) + '" data-td-tz="' + esc(b.tz) + '" data-td-detail="' + (b.detail ? 1 : 0) + '" data-td-proxies="' + (b.proxies ? 1 : 0) + '" data-td-error="' + esc(b.error) + '">' +
        '<div class="td-events-msg td-card">' + esc(b.loading) + '</div></div>';
    },
    video(b) {
      const src = videoEmbed(b.url);
      if (!src) return '<div class="td-card td-pad td-muted" style="text-align:center">Add a YouTube or Vimeo link</div>';
      return '<div class="td-video td-card" style="' + aspectCss(b.aspect) + '"><iframe src="' + esc(src) + '" title="Video" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
    },
    countdown(b, ctx) {
      const t = zonedToUtc(b.target, b.tz);
      const slot = b.cdStyle === 'slot';
      const unit = (k, l) => '<div class="td-cd-unit"><div class="td-cd-num td-head' + (slot ? ' td-slot' : '') + '" data-td-u="' + k + '">' +
        (slot ? '<span class="td-sd"><span>0</span></span>' : '0') + '</div><div class="td-cd-lbl">' + l + '</div></div>';
      const data = (t ? ' data-td-countdown="' + t + '"' : '') + ' data-td-done="' + esc(b.done) + '"' + (b.hideDone ? ' data-td-hidedone="1"' : '') +
        (slot && !ctx.noAnim ? ' data-td-intro="1"' : '');
      const body = (b.label ? '<div class="td-cd-label' + (b.sub ? ' td-cd-title td-head' : '') + '">' + md(b.label) + '</div>' : '') +
        (b.sub ? '<div class="td-cd-sub">' + md(b.sub) + '</div>' : '') +
        '<div class="td-cd-units' + (slot ? ' td-cd-slot' : '') + '">' + unit('d', 'Days') + unit('h', 'Hours') + unit('m', 'Min') + unit('s', 'Sec') + '</div>' +
        (b.btnLabel && b.action && actAttrs(b.action, {}).live
          ? '<div class="td-cd-btn">' + tap('td-btn td-inline-btn', b.action, esc(b.btnLabel), ctx, '', b.label) + '</div>' : '');
      if (!safeUrl(b.image, true)) return '<div class="td-countdown td-card td-pad"' + data + '>' + body + '</div>';
      if (b.imgLayout === 'bg') {
        const dim = Math.min(90, Math.max(0, b.dim == null ? 50 : +b.dim)) / 100;
        return '<div class="td-countdown td-card td-pad td-cd-bg"' + data + '>' + img(b.image, '', 'td-cd-bgimg') +
          '<div class="td-cd-shade" style="background:rgba(0,0,0,' + dim + ')"></div><div class="td-cd-body">' + body + '</div></div>';
      }
      return '<div class="td-countdown td-card td-cd-hasimg"' + data + '><div class="td-cd-photo" style="' + aspectCss(b.aspect || '16/9') + '">' + img(b.image, '') + '</div>' +
        '<div class="td-pad">' + body + '</div></div>';
    },
    spacer(b) {
      return '<div class="td-spacer" style="height:' + (+b.height || 0) + 'px">' + (b.line ? '<hr>' : '') + '</div>';
    },
    html(b) {
      return b.code || '';
    },
  };

  // ── CSS ──────────────────────────────────────────────────────────────
  function fontStack(f) {
    if (!f || f === 'system') return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const serif = /Merriweather|Playfair|Lora/.test(f);
    return "'" + f + "', " + (serif ? 'Georgia, serif' : "-apple-system, BlinkMacSystemFont, sans-serif");
  }
  function fontLink(t) {
    const fams = [t.font, t.headFont].filter((f) => f && f !== 'system');
    const uniq = fams.filter((f, i) => fams.indexOf(f) === i);
    if (!uniq.length) return '';
    return '<link rel="preconnect" href="https://fonts.googleapis.com" />\n<link href="https://fonts.googleapis.com/css2?' +
      uniq.map((f) => 'family=' + f.replace(/ /g, '+') + ':wght@400;500;600;700;800').join('&') + '&display=swap" rel="stylesheet" />';
  }

  function buildCss(p) {
    const t = p.theme;
    const sqs = p.exp.squarespace;
    const app = p.exp.layout === 'app';
    const imp = sqs ? ' !important' : '';
    let css = '';
    css += ':root{--td-bg:' + cssv(t.bg) + ';--td-card:' + cssv(t.card) + ';--td-card2:' + cssv(t.card2) + ';--td-text:' + cssv(t.text) +
      ';--td-muted:' + cssv(t.muted) + ';--td-accent:' + cssv(t.accent) + ';--td-accent-text:' + cssv(t.accentText) + ';--td-sheet:' + cssv(t.sheetBg) +
      ';--td-radius:' + +t.radius + 'px;--td-btn-radius:' + +t.btnRadius + 'px;--td-img-radius:' + +t.imgRadius + 'px;--td-side:' + +t.side + 'px;--td-gap:' + +t.gap + 'px' +
      ';--td-font:' + fontStack(t.font) + ';--td-head-font:' + fontStack(t.headFont || t.font) + ';}\n';

    if (sqs) {
      css += `/* Squarespace overrides */
body{padding-top:0 !important;margin-top:0 !important}
html,body,#siteWrapper,#site,#page,.content-wrapper,.page-section,section,.Index-page-content,.sqs-block-code,article,main,footer,header{background:var(--td-bg) !important}
.sqs-block-content,.sqs-layout,.sqs-col-wm-12,.sqs-block{padding:0 !important;margin:0 !important}
#sq-search-header-slot,#sq-mobile-search-btn,#sq-search-overlay{display:none !important}
.tdp h1,.tdp h2,.tdp h3,.tdp p,.tdp a,.tdp div,.tdp span,.tdp summary{letter-spacing:normal !important;word-spacing:normal !important;text-transform:none;font-family:inherit}
.tdp .td-head{font-family:var(--td-head-font) !important}
`;
    }
    css += `.tdp *,.tdp *::before,.tdp *::after,.td-overlay *,.td-overlay *::before,.td-overlay *::after{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--td-bg);color:var(--td-text);font-family:var(--td-font);font-size:${+t.fontSize}px;line-height:1.5;-webkit-text-size-adjust:100%}
`;
    if (app) {
      css += `html,body{width:100%;height:100%;overflow:hidden}
#td-root{position:fixed;inset:0;top:0${imp};overflow-y:scroll;-webkit-overflow-scrolling:touch;overscroll-behavior:none;background:var(--td-bg)}
`;
    }
    css += `.tdp{max-width:${t.widthMode === 'full' ? 'none' : +t.maxWidth + 'px'};margin:0 auto;padding:${+t.padTop}px 0 ${+t.padBottom}px;color:var(--td-text);font-family:var(--td-font);font-size:${+t.fontSize}px;line-height:1.5}
.tdp a{color:inherit;text-decoration:none}
.tdp .td-text a,.tdp .td-acc-body a{color:var(--td-accent);text-decoration:underline}
.td-b{margin:var(--td-gap) var(--td-side) 0;color:var(--td-text)}
.td-b.td-edge{margin-left:0;margin-right:0}
.td-accent{color:var(--td-accent)}
.td-muted{color:var(--td-muted)}
.td-head{font-family:var(--td-head-font)}
.td-card{background:var(--td-card);border-radius:var(--td-radius);overflow:hidden${t.shadow ? ';box-shadow:0 6px 20px rgba(0,0,0,.18)' : ''}}
.td-pad{padding:16px}
.td-tap{cursor:pointer;-webkit-tap-highlight-color:transparent;display:block;transition:background .15s,transform .15s}
.td-tap.td-card:active,.td-btn.td-tap:active{background:var(--td-card2)}
${t.pressFx ? '.td-tap:active{transform:scale(.97)}' : ''}
.td-ico{width:1.2em;height:1.2em;object-fit:contain;display:block}
.td-noimg{background:linear-gradient(135deg,var(--td-card2),var(--td-card));width:100%;height:100%;min-height:40px}
.tdp img{display:block;max-width:100%}
/* hero */
.td-hero{position:relative}
.td-hero-media{position:relative;width:100%;overflow:hidden;background:var(--td-card2)}
.td-hero-media.td-auto{aspect-ratio:auto}
.td-hero-media.td-auto .td-hero-img{position:relative}
.td-hero-media.td-auto .td-hero-img:not(.on){position:absolute}
.td-hero-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1s ease}
.td-fit-contain .td-hero-img{object-fit:contain}
.td-hero-img.on{opacity:1}
.td-hero-body{padding:18px 20px 24px}
.td-hero-title{font-weight:800;line-height:1.15;margin-bottom:4px}
.td-hero-sub{font-size:.94em;color:var(--td-muted)}
.td-hero-overlay .td-hero-body{position:absolute;left:0;right:0;bottom:0;padding:48px 20px 20px;background:linear-gradient(to top,rgba(0,0,0,.72),rgba(0,0,0,0));color:#fff}
.td-hero-overlay .td-hero-sub{color:rgba(255,255,255,.85)}
/* heading */
.td-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:4px}
.td-heading h2{font-weight:700;line-height:1.2;margin:0;color:var(--td-text)}
.td-see-all{font-size:13px;color:var(--td-muted);white-space:nowrap}
.td-see-all:active{color:var(--td-text)}
/* text */
.td-text p+p{margin-top:.7em}
/* buttons */
.td-btns{display:flex;gap:10px}
.td-btns-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 calc(var(--td-side) * -1);padding:0 var(--td-side)}
.td-btns-scroll::-webkit-scrollbar{display:none}
.td-btns-wrap{flex-wrap:wrap}
.td-btns-grid2,.td-btns-grid3{display:grid;grid-template-columns:repeat(2,1fr)}
.td-btns-grid3{grid-template-columns:repeat(3,1fr)}
.td-btns-stack{flex-direction:column}
.td-btn{display:flex;align-items:center;gap:8px;background:var(--td-card);color:var(--td-text);border:1.5px solid var(--td-card);border-radius:var(--td-btn-radius);font-weight:600;font-size:13px;padding:9px 16px 9px 10px;white-space:nowrap;flex-shrink:0}
.td-btn:not(:has(.td-btn-icon)){padding-left:16px}
.td-btn-sm .td-btn{font-size:12px;padding-top:6px;padding-bottom:6px}
.td-btn-lg .td-btn{font-size:15px;padding-top:13px;padding-bottom:13px}
.td-btns-grid2 .td-btn,.td-btns-grid3 .td-btn,.td-btns-stack .td-btn{justify-content:center;white-space:normal;text-align:center}
.td-btns-grid3 .td-btn{flex-direction:column;gap:6px;padding:14px 8px}
.td-btns-stack .td-btn{padding-top:14px;padding-bottom:14px;font-size:14px}
.td-btn-accent .td-btn{background:var(--td-accent);border-color:var(--td-accent);color:var(--td-accent-text)}
.td-btn-accent .td-btn.td-tap:active{filter:brightness(.9);background:var(--td-accent)}
.td-btn-outline .td-btn{background:transparent;border-color:var(--td-card2)}
.td-btn-icon{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
.td-btn-sm .td-btn-icon{width:22px;height:22px;font-size:12px}
.td-btn-lg .td-btn-icon{width:34px;height:34px;font-size:17px}
.td-inline-btn{display:inline-flex;margin-top:12px;background:var(--td-accent);border-color:var(--td-accent);color:var(--td-accent-text);padding:10px 18px}
/* banner */
.td-banner{display:flex;align-items:center;gap:14px;padding:16px;color:var(--td-text)}
.td-banner-icon{width:44px;height:44px;border-radius:var(--td-img-radius);background:rgba(128,128,128,.18);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
.td-banner-img{width:52px;height:52px;border-radius:var(--td-img-radius);object-fit:cover;flex-shrink:0}
.td-banner-text{flex:1;min-width:0}
.td-eyebrow{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--td-accent);margin-bottom:3px}
.td-banner-title{font-size:15px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.td-banner-sub{font-size:12px;color:var(--td-muted);margin-top:2px;line-height:1.4}
.td-arrow{color:var(--td-muted);font-size:22px;flex-shrink:0}
/* cards */
.td-cards{display:flex;gap:10px}
.td-cards-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 calc(var(--td-side) * -1);padding:0 var(--td-side);scroll-padding:0 var(--td-side);scroll-snap-type:x proximity}
.td-cards-scroll::-webkit-scrollbar{display:none}
.td-cards-scroll .td-cardi{flex-shrink:0;scroll-snap-align:start}
.td-cards-grid{display:grid;grid-template-columns:repeat(2,1fr)}
.td-cards-list{flex-direction:column}
.td-cardi{display:flex;color:var(--td-text)}
.td-cards-pill .td-cardi{align-items:center}
.td-cards-tile .td-cardi{flex-direction:column}
.td-cardimg{flex-shrink:0;overflow:hidden;background:var(--td-card2)}
.td-cardimg img{width:100%;height:100%;object-fit:cover}
.td-cardinfo{padding:0 12px;min-width:0}
.td-cards-tile .td-cardinfo{padding:10px 12px 12px}
.td-tag{font-size:10px;font-weight:600;color:var(--td-muted);text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px}
.td-cardname{font-size:14px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* accordion */
.td-acc-item+.td-acc-item{border-top:1px solid rgba(128,128,128,.18)}
.td-acc-item summary{list-style:none;display:flex;align-items:center;gap:12px;padding:15px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.td-acc-item summary::-webkit-details-marker{display:none}
.td-acc-item summary:active{background:var(--td-card2)}
.td-acc-icon{font-size:18px}
.td-acc-title{flex:1;font-weight:600;font-size:15px}
.td-acc-chev{color:var(--td-muted);font-size:20px;transition:transform .2s;line-height:1}
.td-acc-item[open] .td-acc-chev{transform:rotate(90deg)}
.td-acc-body{padding:0 16px 16px;color:var(--td-muted);font-size:14px;line-height:1.55}
.td-acc-body p+p{margin-top:.6em}
.td-acc-body strong{color:var(--td-text)}
.td-acc-img{width:100%;border-radius:calc(var(--td-radius) * .7);margin-bottom:12px}
/* slides */
.td-slides-wrap{position:relative}
.td-slides-track{display:flex;gap:10px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.td-slides-track::-webkit-scrollbar{display:none}
.td-slide{flex:0 0 100%;scroll-snap-align:center;position:relative;color:var(--td-text)}
.td-peek .td-slide{flex-basis:86%;scroll-snap-align:start}
.td-slide-media{position:relative;overflow:hidden;background:var(--td-card2)}
.td-slide-media img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.td-slide-cap{padding:12px 14px 14px}
.td-cap-overlay .td-slide-cap{position:absolute;left:0;right:0;bottom:0;padding:40px 14px 14px;background:linear-gradient(to top,rgba(0,0,0,.7),rgba(0,0,0,0));color:#fff}
.td-slide-title{font-weight:700;font-size:16px;line-height:1.25}
.td-slide-sub{font-size:13px;opacity:.8}
.td-dots{display:flex;justify-content:center;gap:6px;padding-top:10px}
.td-dots button{width:7px;height:7px;border-radius:99px;border:0;background:var(--td-muted);opacity:.4;padding:0;cursor:pointer;transition:all .25s}
.td-dots button.on{width:20px;opacity:1;background:var(--td-accent)}
.td-sl-arrow{position:absolute;top:50%;transform:translateY(-50%);width:34px;height:34px;border-radius:50%;border:0;background:rgba(0,0,0,.45);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}
.td-cap-below .td-sl-arrow{top:40%}
.td-sl-prev{left:8px}.td-sl-next{right:8px}
/* image & gallery */
.td-image-media{position:relative;overflow:hidden}
.td-image-media img{width:100%;height:100%;object-fit:cover}
.td-auto .td-image-media img{height:auto}
.td-image:not(.td-auto) .td-image-media img{position:absolute;inset:0}
.td-image-cap{padding:10px 14px;font-size:13px;color:var(--td-muted)}
.td-gallery{display:grid;border-radius:var(--td-radius);overflow:hidden}
.td-gal-item{position:relative;overflow:hidden;background:var(--td-card2);display:block}
.td-gal-item img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
/* copy */
.td-copy-title{font-weight:700;font-size:15px;padding:14px 16px 0}
.td-copy-row{display:flex;align-items:center;gap:12px;padding:12px 16px}
.td-copy-row+.td-copy-row{border-top:1px solid rgba(128,128,128,.18)}
.td-copy-text{flex:1;min-width:0}
.td-copy-val{font-size:15px;font-weight:600;word-break:break-word}
.td-copy-btn{flex-shrink:0;background:var(--td-accent);color:var(--td-accent-text) !important;border-radius:var(--td-btn-radius);padding:8px 14px;font-size:13px;font-weight:700}
.td-copy-btn.td-tap:active{filter:brightness(.9)}
/* connect card form */
.td-form{padding:16px;display:flex;flex-direction:column;gap:14px}
.td-form-title{font-weight:700;font-size:17px}
.td-form-intro{color:var(--td-muted);font-size:14px;margin-top:-6px}
.td-form-intro p{margin:0 0 6px}
.td-f-q{display:flex;flex-direction:column;gap:6px;border:0;margin:0;padding:0;min-width:0}
.td-f-q>label,.td-f-q legend{font-size:13px;font-weight:600;padding:0}
.td-req{color:var(--td-accent);margin-left:3px}
.td-form input[type=text],.td-form input[type=email],.td-form input[type=tel],.td-form textarea{font:inherit;font-size:16px;color:var(--td-text);background:rgba(128,128,128,.12);border:1.5px solid rgba(128,128,128,.25);border-radius:calc(var(--td-radius)*.6);padding:10px 12px;width:100%;box-sizing:border-box;outline:none;-webkit-appearance:none;appearance:none}
.td-form input:focus,.td-form textarea:focus{border-color:var(--td-accent)}
.td-form textarea{resize:vertical;min-height:72px}
.td-f-check{display:flex;align-items:flex-start;gap:10px;font-size:15px;cursor:pointer;padding:3px 0}
.td-f-check input{width:20px;height:20px;margin:1px 0 0;flex-shrink:0;accent-color:var(--td-accent)}
.td-f-q .td-bad,.td-form .td-bad{border-color:#ef4444 !important}
fieldset.td-bad legend,.td-f-check.td-bad span{color:#ef4444}
.td-hp{position:absolute !important;left:-9999px !important;width:1px;height:1px;opacity:0}
.td-form-err{color:#ef4444;font-size:13px;display:none}
.td-form-err.show{display:block}
.td-form-btn{font:inherit;font-weight:700;font-size:16px;background:var(--td-accent);color:var(--td-accent-text);border:0;border-radius:var(--td-btn-radius);padding:13px;cursor:pointer;-webkit-appearance:none}
.td-form-btn:active{filter:brightness(.9)}
.td-form-btn:disabled{opacity:.6}
.td-form[hidden],.td-form-done[hidden]{display:none !important}
.td-form-done{padding:22px 18px;text-align:center;font-size:16px;font-weight:600}
.td-form-done p{margin:0}
/* events */
.td-events-msg{padding:20px;text-align:center;color:var(--td-muted);font-size:13px}
.td-events-list{display:flex;flex-direction:column;gap:1px;background:rgba(0,0,0,.4);border-radius:var(--td-radius);overflow:hidden}
.td-ev{display:flex;align-items:center;gap:14px;background:var(--td-card);padding:14px 16px;color:var(--td-text)}
.td-ev:active{background:var(--td-card2)}
.td-ev-date{display:flex;flex-direction:column;align-items:center;min-width:36px}
.td-ev-mo{font-size:10px;font-weight:700;text-transform:uppercase;color:var(--td-accent);letter-spacing:.05em}
.td-ev-dy{font-size:24px;font-weight:800;line-height:1}
.td-ev-detail{flex:1;min-width:0}
.td-ev-name{font-size:14px;font-weight:600;line-height:1.3;margin-bottom:2px}
.td-ev-meta{font-size:12px;color:var(--td-muted)}
/* video, countdown, spacer */
.td-video{position:relative}
.td-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.td-cd-label{text-align:center;color:var(--td-muted);font-size:13px;margin-bottom:10px}
.td-cd-title{font-size:18px;font-weight:700;color:var(--td-text);margin-bottom:4px}
.td-cd-btn{text-align:center;margin-top:4px}
.td-cd-sub{text-align:center;color:var(--td-muted);font-size:13px;margin-bottom:12px}
.td-cd-units{display:flex;justify-content:center;gap:10px}
.td-cd-unit{flex:1;max-width:76px;text-align:center;background:var(--td-card2);border-radius:calc(var(--td-radius) * .7);padding:10px 4px}
.td-cd-num{font-size:26px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums}
.td-cd-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--td-muted);margin-top:4px}
.td-cd-done{text-align:center;font-weight:700;font-size:18px}
.td-cd-slot{gap:14px}
.td-cd-slot .td-cd-unit{background:none;padding:0;max-width:none;flex:0 1 auto;min-width:56px}
.td-cd-slot .td-cd-num{font-size:44px;display:flex;justify-content:center;line-height:1.15}
.td-sd{position:relative;display:inline-block;overflow:hidden;width:.64em;height:1.15em;-webkit-mask-image:linear-gradient(transparent,#000 22%,#000 78%,transparent);mask-image:linear-gradient(transparent,#000 22%,#000 78%,transparent)}
.td-sd span{position:absolute;inset:0;text-align:center;will-change:transform,filter}
.td-cd-hasimg,.td-cd-bg{overflow:hidden;position:relative}
.td-cd-photo{position:relative;overflow:hidden}
.td-cd-photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.td-cd-bgimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.td-cd-shade{position:absolute;inset:0}
.td-cd-body{position:relative;padding:18px 0}
.td-cd-bg .td-cd-label,.td-cd-bg .td-cd-sub,.td-cd-bg .td-cd-lbl,.td-cd-bg .td-cd-num,.td-cd-bg .td-cd-done{color:#fff}
.td-cd-bg .td-cd-unit{background:rgba(255,255,255,.16);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.td-cd-bg .td-cd-slot .td-cd-unit{background:none;-webkit-backdrop-filter:none;backdrop-filter:none}
.td-cd-bg .td-cd-slot .td-cd-num,.td-cd-bg .td-cd-slot .td-cd-lbl{text-shadow:0 2px 12px rgba(0,0,0,.45)}
.td-spacer{display:flex;align-items:center}
.td-spacer hr{width:100%;border:0;border-top:1px solid rgba(128,128,128,.25)}
/* overlays: pop-up page, menus, event details, zoom, toast */
.td-overlay{font-family:var(--td-font);color:var(--td-text)}
.td-bd{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
.td-bd.open{display:block}
.td-sheet{position:fixed;left:0;right:0;bottom:0;z-index:201;background:var(--td-sheet);border-radius:20px 20px 0 0;max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch;transform:translateY(100%);transition:transform .35s cubic-bezier(.32,.72,0,1);max-width:${t.widthMode === 'full' ? 720 : Math.max(480, +t.maxWidth)}px;margin:0 auto;visibility:hidden}
.td-sheet.open{transform:translateY(0);visibility:visible}
.td-sheet.td-page{height:85vh;overflow:hidden;display:flex;flex-direction:column}
.td-handle{display:flex;justify-content:center;padding:10px 0 4px;flex-shrink:0}
.td-handle span{width:36px;height:4px;background:rgba(128,128,128,.4);border-radius:99px}
.td-sheet-head{display:flex;align-items:center;justify-content:space-between;padding:4px 20px 14px;border-bottom:1px solid rgba(128,128,128,.15);flex-shrink:0}
.td-sheet-head-l{display:flex;align-items:center;gap:10px;min-width:0}
.td-sheet-icon{font-size:22px;line-height:1}
.td-sheet-title{font-size:17px;font-weight:700;line-height:1.25}
.td-sheet-sub{font-size:12px;color:var(--td-muted);margin-top:1px}
.td-close{width:30px;height:30px;background:rgba(128,128,128,.2);border-radius:50%;border:0;color:var(--td-text);font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0}
.td-sheet-body{padding:20px 20px 40px}
.td-page-body{flex:1;position:relative;overflow:hidden}
.td-page-body iframe{width:100%;height:100%;border:0;background:#fff}
.td-loader{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--td-accent),#fff);transform-origin:left;animation:tdLoad 1.6s ease-in-out infinite;z-index:3}
@keyframes tdLoad{0%{transform:scaleX(0);opacity:1}70%{transform:scaleX(.85);opacity:1}100%{transform:scaleX(1);opacity:0}}
.td-mi{display:flex;align-items:center;gap:16px;background:var(--td-card);border-radius:var(--td-radius);padding:18px 16px;margin-bottom:10px;color:var(--td-text);text-decoration:none}
.td-mi:active{background:var(--td-card2)}
.td-mi-icon{width:48px;height:48px;border-radius:var(--td-img-radius);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;background:rgba(128,128,128,.18)}
.td-mi-text{flex:1;min-width:0}
.td-mi-title{font-size:16px;font-weight:700;line-height:1.2;margin-bottom:3px}
.td-mi-desc{font-size:13px;color:var(--td-muted);line-height:1.4}
.td-ev-body{font-size:14px;line-height:1.6}
.td-ev-body p{margin-bottom:10px;color:var(--td-muted)}
.td-ev-body img{width:100%;border-radius:12px;margin-bottom:16px;display:block}
.td-ev-btn{display:block;background:var(--td-accent);color:var(--td-accent-text);text-align:center;padding:14px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-top:10px}
.td-zoom{display:none;position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.92);align-items:center;justify-content:center;padding:16px}
.td-zoom.open{display:flex}
.td-zoom img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px}
.td-zoom .td-close{position:absolute;top:14px;right:14px;color:#fff;background:rgba(255,255,255,.18)}
.td-toast{position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);background:rgba(20,20,20,.92);color:#fff;padding:10px 18px;border-radius:99px;font-size:14px;font-weight:600;opacity:0;pointer-events:none;transition:all .25s;z-index:400;font-family:var(--td-font);white-space:nowrap}
.td-toast.show{opacity:1;transform:translate(-50%,0)}
.td-sched-off{display:none !important}
`;
    if (t.widthMode === 'full') {
      // Wide screens: roomier margins, more columns, and heroes that don't fill the whole screen.
      css += '@media (min-width:700px){.tdp{--td-side:' + Math.max(+t.side, 24) + 'px}.td-cards-grid{grid-template-columns:repeat(3,1fr)}.td-btns-stack{display:grid;grid-template-columns:repeat(2,1fr)}.td-hero-media{max-height:60vh}.td-peek .td-slide{flex-basis:48%}}\n' +
        '@media (min-width:1100px){.tdp{--td-side:' + Math.max(+t.side, 40) + 'px}.td-cards-grid{grid-template-columns:repeat(4,1fr)}.td-peek .td-slide{flex-basis:32%}}\n';
    }
    if (t.anim !== 'none') {
      css += '@keyframes tdIn{from{opacity:0;transform:translateY(' + (t.anim === 'slide' ? 28 : 0) + 'px)}to{opacity:1;transform:none}}\n' +
        '.td-anim{opacity:0;animation:tdIn .5s cubic-bezier(.22,1,.36,1) forwards}\n' +
        '@media (prefers-reduced-motion:reduce){.td-anim{animation:none;opacity:1}}\n';
    }
    return css;
  }

  // ── Runtime script (serialized into the page) ────────────────────────
  /* eslint-disable */
  function tdRuntime(TIMES) {
    var D = document, W = window, PREVIEW = !!W.TD_PREVIEW;
    var root = D.getElementById('td-root');
    function lock(on) { var el = root || D.body; el.style.overflow = on ? 'hidden' : ''; }
    function $(s, c) { return (c || D).querySelector(s); }
    function $$(s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); }

    // toast + copy
    var tt;
    function toast(m) { var t = $('#td-toast'); if (!t) return; t.textContent = m; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(function () { t.classList.remove('show'); }, 1800); }
    function fallbackCopy(text) {
      var ta = D.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; D.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, 999999); var ok = false;
      try { ok = D.execCommand('copy'); } catch (e) {}
      D.body.removeChild(ta); return ok;
    }
    function copy(text, msg) {
      var done = function () { toast(msg || 'Copied!'); };
      if (navigator.clipboard && W.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    }

    // sheets
    function closeAll() {
      $$('.td-sheet.open,.td-bd.open,.td-zoom.open').forEach(function (e) { e.classList.remove('open'); });
      lock(false);
      var f = $('#td-page-frame'); if (f) setTimeout(function () { if (!$('#td-page.open')) f.src = 'about:blank'; }, 400);
    }
    function openSheet(id) {
      var s = D.getElementById(id); if (!s) return;
      closeAll(); s.classList.add('open'); $('#td-bd').classList.add('open'); lock(true);
    }
    function openPage(url, title, icon, site) {
      var f = $('#td-page-frame'), l = $('#td-page-loader');
      var host = site || url; if (!site) try { host = new URL(url, location.href).hostname.replace('www.', ''); } catch (e) {}
      $('#td-page-title').textContent = title || host;
      var ic = $('#td-page-icon'); ic.textContent = '';
      if (/^(https?:|data:image\/)/i.test(icon || '')) { var im = D.createElement('img'); im.className = 'td-ico'; im.src = icon; ic.appendChild(im); }
      else ic.textContent = icon || '🔗';
      l.style.display = 'block'; f.onload = function () { l.style.display = 'none'; };
      openSheet('td-page'); f.src = url;
    }
    function scrollToId(id) {
      var el = D.getElementById(id); if (!el) return;
      var sc = root || D.scrollingElement;
      var top = el.getBoundingClientRect().top - (root ? root.getBoundingClientRect().top : 0) + sc.scrollTop - 12;
      sc.scrollTo({ top: top, behavior: 'smooth' });
    }

    D.addEventListener('click', function (e) {
      if (e.target.closest('[data-td-close]')) { e.preventDefault(); closeAll(); return; }
      var a = e.target.closest('[data-td-act]');
      if (!a) {
        if (PREVIEW) {
          var l = e.target.closest('a[href]');
          if (l && /^https?:/i.test(l.getAttribute('href'))) { e.preventDefault(); W.open(l.href, '_blank'); }
        }
        return;
      }
      var g = function (k) { return a.getAttribute('data-td-' + k) || ''; };
      e.preventDefault();
      switch (g('act')) {
        case 'popup': openPage(a.getAttribute('href'), g('title'), g('icon'), g('host')); break;
        case 'sheet': openSheet('td-sheet-' + g('sheet')); break;
        case 'copy': copy(g('text'), g('toast')); break;
        case 'scroll': closeAll(); scrollToId(a.getAttribute('href').slice(1)); break;
        case 'zoom': $('#td-zoom-img').src = g('src'); $('#td-zoom').classList.add('open'); lock(true); break;
        case 'share':
          var u = g('url') || location.href, t = g('title') || D.title;
          if (navigator.share) navigator.share({ title: t, url: u }).catch(function () {});
          else copy(u, 'Link copied');
          break;
      }
    });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

    // connect card forms: check the answers, then send them to the portal
    $$('[data-td-form]').forEach(function (f) {
      var started = Date.now();
      var err = $('.td-form-err', f), btn = $('.td-form-btn', f), done = f.nextElementSibling;
      function fail(m) { err.textContent = m; err.classList.add('show'); }
      f.addEventListener('input', function (e) { var x = e.target.closest('.td-bad'); if (x) x.classList.remove('td-bad'); });
      f.addEventListener('change', function (e) { var x = e.target.closest('.td-bad'); if (x) x.classList.remove('td-bad'); });
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        err.classList.remove('show');
        $$('.td-bad', f).forEach(function (el) { el.classList.remove('td-bad'); });
        var labels = []; try { labels = JSON.parse(f.getAttribute('data-td-labels')) || []; } catch (x) {}
        var missing = [], badEmail = null, first = null;
        var answers = labels.map(function (label, i) {
          var els = $$('[name="q' + i + '"]', f);
          if (!els.length) return { q: label, a: '' };
          var pick = els[0].type === 'checkbox' || els[0].type === 'radio';
          var vals = els.filter(function (el) { return !pick || el.checked; }).map(function (el) { return el.value.trim(); }).filter(Boolean);
          var box = els[0].closest('fieldset') || (pick ? els[0].closest('label') : els[0]);
          var req = els[0].required || !!els[0].closest('[data-td-req]');
          var bad = false;
          if (req && !vals.length) { missing.push(label); bad = true; }
          else if (els[0].type === 'email' && vals[0] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals[0])) { badEmail = label; bad = true; }
          if (bad) { box.classList.add('td-bad'); first = first || els[0]; }
          return { q: label, a: vals.join(', ') };
        });
        if (missing.length) { fail('Please fill in: ' + missing.join(', ')); first.focus(); return; }
        if (badEmail) { fail('Please check the ' + badEmail.toLowerCase() + ' address.'); first.focus(); return; }
        if (!answers.some(function (a) { return a.a; })) { fail('Please fill in the form first.'); return; }
        function finish() {
          f.hidden = true; done.hidden = false;
          try { done.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) {}
        }
        if (PREVIEW) { toast('Preview: answers are not sent'); finish(); return; }
        var post = f.getAttribute('data-td-post');
        if (!post) { fail('This form isn’t connected yet. Publish the page from the TapDot portal to collect answers.'); return; }
        var label = btn.textContent;
        btn.disabled = true; btn.textContent = 'Sending…';
        var hp = $('.td-hp', f);
        fetch(post, { method: 'POST', body: JSON.stringify({ block: f.getAttribute('data-td-form'), answers: answers, website: hp ? hp.value : '', ms: Date.now() - started }) })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw { msg: j.error }; }); })
          .then(finish, function (x) { fail((x && x.msg) || 'Your answers could not be sent. Check your connection and try again.'); })
          .then(function () { btn.disabled = false; btn.textContent = label; });
      });
    });

    // accordion: one open at a time
    $$('[data-td-single] details').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!d.open) return;
        $$('details', d.parentNode).forEach(function (o) { if (o !== d) o.open = false; });
      });
    });

    // hero fade slideshows
    $$('[data-td-fade]').forEach(function (w) {
      var imgs = $$('.td-hero-img', w), i = 0;
      setInterval(function () { imgs[i].classList.remove('on'); i = (i + 1) % imgs.length; imgs[i].classList.add('on'); }, +w.getAttribute('data-td-fade'));
    });

    // slides
    $$('.td-slides').forEach(function (s) {
      var tr = $('.td-slides-track', s), sl = $$('.td-slide', s), dots = $$('.td-dots button', s), cur = 0, hold = 0;
      if (!sl.length) return;
      function go(i) { cur = (i + sl.length) % sl.length; tr.scrollTo({ left: sl[cur].offsetLeft - sl[0].offsetLeft, behavior: 'smooth' }); }
      tr.addEventListener('scroll', function () {
        var best = 0, bd = 1e9;
        sl.forEach(function (x, i) { var d = Math.abs(x.offsetLeft - sl[0].offsetLeft - tr.scrollLeft); if (d < bd) { bd = d; best = i; } });
        cur = best; dots.forEach(function (d, i) { d.classList.toggle('on', i === best); });
      }, { passive: true });
      dots.forEach(function (d, i) { d.addEventListener('click', function () { hold = Date.now(); go(i); }); });
      var p = $('.td-sl-prev', s), n = $('.td-sl-next', s);
      if (p) p.addEventListener('click', function () { hold = Date.now(); go(cur - 1); });
      if (n) n.addEventListener('click', function () { hold = Date.now(); go(cur + 1); });
      tr.addEventListener('touchstart', function () { hold = Date.now(); }, { passive: true });
      var ms = +s.getAttribute('data-td-auto');
      if (ms) setInterval(function () { if (Date.now() - hold > ms * 1.5) go(cur + 1); }, ms);
    });

    // countdowns
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    // Slot-machine digits: each digit rolls up, blurred while moving and sharp when it lands.
    var REDUCE = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function roll(cell, ch, dur) {
      var old = cell.lastChild, nu = D.createElement('span'); nu.textContent = ch; cell.appendChild(nu);
      if (REDUCE || !nu.animate) { while (cell.firstChild !== nu) cell.removeChild(cell.firstChild); return; }
      var blur = dur < 160 ? 7 : 4, ease = dur < 160 ? 'linear' : 'cubic-bezier(.2,.8,.25,1)';
      if (old) old.animate([{ transform: 'translateY(0)', filter: 'blur(0)', opacity: 1 }, { transform: 'translateY(-100%)', filter: 'blur(' + blur + 'px)', opacity: 0 }],
        { duration: dur, easing: ease, fill: 'forwards' }).onfinish = function () { if (old.parentNode) old.parentNode.removeChild(old); };
      nu.animate([{ transform: 'translateY(100%)', filter: 'blur(' + (blur + 2) + 'px)', opacity: 0 }, { transform: 'translateY(0)', filter: 'blur(0)', opacity: 1 }],
        { duration: dur, easing: ease });
    }
    function spin(cell, col) {
      // A quick spin through random digits that slows down and settles on the real value.
      cell._spin = 1;
      var steps = 6 + col * 2, t = 0;
      for (var i = 0; i < steps; i++) (function (i) {
        var last = i === steps - 1, p = i / (steps - 1), dur = Math.round(45 + 330 * p * p * p);
        setTimeout(function () {
          roll(cell, last ? cell._want : String(Math.floor(Math.random() * 10)), dur);
          if (last) cell._spin = 0;
        }, t);
        t += dur * (last ? 1 : 0.9);
      })(i);
    }
    function slotSet(el, str, intro) {
      var cells = el.children;
      while (cells.length < str.length) { var n = D.createElement('span'); n.className = 'td-sd'; n.innerHTML = '<span>0</span>'; el.insertBefore(n, el.firstChild); }
      while (cells.length > str.length) el.removeChild(el.firstChild);
      for (var i = 0; i < str.length; i++) {
        var cell = cells[i], ch = str.charAt(i);
        cell._want = ch;
        if (intro && !REDUCE) { spin(cell, i + (+el.getAttribute('data-td-col') || 0)); continue; }
        if (cell._spin || (cell.lastChild && cell.lastChild.textContent === ch)) continue;
        roll(cell, ch, 420);
      }
    }
    $$('.td-cd-slot').forEach(function (u) { $$('.td-slot', u).forEach(function (e, i) { e.setAttribute('data-td-col', i * 2); }); });
    function tick() {
      $$('[data-td-countdown]').forEach(function (c) {
        var ms = +c.getAttribute('data-td-countdown') - Date.now();
        if (ms <= 0) {
          if (c.getAttribute('data-td-hidedone')) { c.closest('.td-b').style.display = 'none'; return; }
          var u = $('.td-cd-units', c); if (u) u.outerHTML = '<div class="td-cd-done">' + c.getAttribute('data-td-done').replace(/</g, '&lt;') + '</div>';
          return;
        }
        var intro = !c._tdInit && c.getAttribute('data-td-intro'); c._tdInit = 1;
        var s = Math.floor(ms / 1000), set = function (k, v) {
          var e = $('[data-td-u="' + k + '"]', c); if (!e) return;
          if (e.classList.contains('td-slot')) slotSet(e, String(v), intro); else e.textContent = v;
        };
        var dd = Math.floor(s / 86400), hh = Math.floor(s / 3600) % 24, mm = Math.floor(s / 60) % 60;
        // Days, hours and minutes that are zero are hidden with their labels.
        [['d', dd], ['h', hh], ['m', mm]].forEach(function (x) {
          var e = $('[data-td-u="' + x[0] + '"]', c), u = e && e.closest('.td-cd-unit');
          if (u) u.style.display = x[1] ? '' : 'none';
        });
        set('d', dd); set('h', pad(hh)); set('m', pad(mm)); set('s', pad(s % 60));
      });
    }
    if ($('[data-td-countdown]')) { tick(); setInterval(tick, 1000); }

    // schedules (show/hide blocks by day + time window)
    function zNow(tz) { try { return new Date(new Date().toLocaleString('en-US', { timeZone: tz })); } catch (e) { return new Date(); } }
    function hm(s) { var p = String(s).split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
    function inWindow(s) {
      var n = zNow(s.tz || 'America/Chicago');
      var ymd = n.getFullYear() * 10000 + (n.getMonth() + 1) * 100 + n.getDate();
      if (s.from && ymd < +s.from.replace(/-/g, '')) return false;
      if (s.to && ymd > +s.to.replace(/-/g, '')) return false;
      if (s.days && s.days.length && s.days.indexOf(n.getDay()) < 0) return false;
      if (s.start || s.end) {
        var t = n.getHours() * 60 + n.getMinutes(), a = hm(s.start || '0:00'), b = s.end ? hm(s.end) : 1440;
        if (a <= b ? (t < a || t >= b) : (t < a && t >= b)) return false;
      }
      return true;
    }
    // The first time tab whose window is open wins; otherwise the normal page shows.
    function activeTab() {
      if (W.TD_FORCE_TIME) return W.TD_FORCE_TIME;
      for (var i = 0; i < TIMES.length; i++) if (inWindow(TIMES[i])) return TIMES[i].id;
      return 'normal';
    }
    function sched() {
      var tab = activeTab();
      D.documentElement.setAttribute('data-td-time', tab);
      $$('[data-td-show]').forEach(function (el) {
        el.classList.toggle('td-sched-off', (' ' + el.getAttribute('data-td-show') + ' ').indexOf(' ' + tab + ' ') < 0);
      });
    }
    sched(); setInterval(sched, 30000);

    // events (Squarespace JSON feed)
    function escH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fetchT(url) {
      var c = W.AbortController ? new AbortController() : null, t = setTimeout(function () { if (c) c.abort(); }, 7000);
      return fetch(url, c ? { signal: c.signal } : {}).then(function (r) { clearTimeout(t); if (!r.ok) throw 0; return r.json(); });
    }
    function getFeed(url, proxies) {
      var list = [function () { return fetchT(url); }];
      if (proxies) [
        'https://api.allorigins.win/get?url=' + encodeURIComponent(url),
        'https://corsproxy.io/?' + encodeURIComponent(url),
        'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url),
      ].forEach(function (p) { list.push(function () { return fetchT(p).then(function (j) { return j && j.contents ? JSON.parse(j.contents) : j; }); }); });
      var i = 0;
      function next() {
        if (i >= list.length) return Promise.reject(new Error('feed failed'));
        return list[i++]().then(function (d) { if (d && (d.upcoming || d.items)) return d; throw 0; }).catch(next);
      }
      return next();
    }
    function interval(body) {
      var t = String(body || '').replace(/<[^>]+>/g, ' ').toLowerCase();
      if (/every other week|bi-?weekly/.test(t)) return 14;
      if (/every week|weekly|each week|every (sun|mon|tues|wednes|thurs|fri|satur)day/.test(t)) return 7;
      return null;
    }
    function nextOcc(start, end, days, tz) {
      var today = new Date(new Date().toLocaleDateString('en-US', { timeZone: tz }) + ' 00:00:00');
      var sct = new Date(start.toLocaleString('en-US', { timeZone: tz })), h = sct.getHours(), m = sct.getMinutes();
      for (var c = new Date(start); c <= end; c = new Date(c.getTime() + days * 864e5)) {
        var ct = new Date(c.toLocaleString('en-US', { timeZone: tz })); ct.setHours(h, m, 0, 0);
        if (ct >= today) return new Date(c.getTime());
      }
      return null;
    }
    function openEvent(ev, tz) {
      $('#td-ev-title').textContent = ev.title;
      $('#td-ev-date').textContent = ev.date.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }) + ' · ' +
        ev.date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
      var b = $('#td-ev-body'); b.innerHTML = '';
      if (ev.assetUrl) { var im = D.createElement('img'); im.src = ev.assetUrl + '?format=1000w'; b.appendChild(im); }
      if (ev.body) {
        var doc = new DOMParser().parseFromString(ev.body, 'text/html');
        doc.querySelectorAll('p, li, h1, h2, h3').forEach(function (n) { var p = D.createElement('p'); p.textContent = n.textContent; if (p.textContent.trim()) b.appendChild(p); });
        doc.querySelectorAll('a.sqs-block-button-element').forEach(function (x) {
          var a = D.createElement('a'); a.className = 'td-ev-btn'; a.href = x.href; a.target = '_blank'; a.rel = 'noopener'; a.textContent = x.textContent.trim(); b.appendChild(a);
        });
      }
      openSheet('td-evsheet');
    }
    $$('[data-td-events]').forEach(function (box) {
      var g = function (k) { return box.getAttribute('data-td-' + k); };
      var url = g('events'), max = +g('max') || 3, tz = g('tz') || 'America/Chicago';
      var fail = function () { box.innerHTML = '<div class="td-events-msg td-card">' + escH(g('error')) + '</div>'; };
      if (!url) return fail();
      getFeed(url, g('proxies') === '1').then(function (data) {
        var items = data.upcoming || data.items || [], evs = [], now = new Date();
        for (var k = 0; k < items.length; k++) {
          var it = items[k], st = new Date(it.startDate), en = it.endDate ? new Date(it.endDate) : null, d = st;
          if (en && en - st > 7 * 864e5) { d = nextOcc(st, en, interval(it.body) || 7, tz); if (!d) continue; }
          else if ((en || st) < now) continue;
          evs.push({ title: it.title || 'Event', date: d, assetUrl: it.assetUrl, body: it.body });
        }
        if (!evs.length) throw 0;
        evs = evs.sort(function (a, b) { return a.date - b.date; }).slice(0, max);
        var list = D.createElement('div'); list.className = 'td-events-list';
        evs.forEach(function (ev) {
          var r = D.createElement('a'); r.className = 'td-ev td-tap'; r.href = '#';
          r.innerHTML = '<div class="td-ev-date"><span class="td-ev-mo">' + ev.date.toLocaleString('en-US', { month: 'short', timeZone: tz }) + '</span><span class="td-ev-dy">' +
            ev.date.toLocaleString('en-US', { day: 'numeric', timeZone: tz }) + '</span></div><div class="td-ev-detail"><div class="td-ev-name">' + escH(ev.title) +
            '</div><div class="td-ev-meta">' + ev.date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) + '</div></div><div class="td-arrow">›</div>';
          r.addEventListener('click', function (e) { e.preventDefault(); if (g('detail') === '1') openEvent(ev, tz); });
          list.appendChild(r);
        });
        box.innerHTML = ''; box.appendChild(list);
      }).catch(fail);
    });
  }
  /* eslint-enable */

  // ── Overlays (pop-up page, menus, event detail, zoom, toast) ─────────
  function overlays(p, ctx) {
    let h = '<div class="td-overlay">\n<div class="td-bd" id="td-bd" data-td-close></div>\n';
    h += '<div class="td-sheet td-page" id="td-page"><div class="td-loader" id="td-page-loader"></div><div class="td-handle"><span></span></div>' +
      '<div class="td-sheet-head"><div class="td-sheet-head-l"><div class="td-sheet-icon" id="td-page-icon">🔗</div><div class="td-sheet-title" id="td-page-title">Loading…</div></div>' +
      '<button class="td-close" data-td-close aria-label="Close">✕</button></div><div class="td-page-body"><iframe id="td-page-frame" src="about:blank" title="Page"></iframe></div></div>\n';
    p.sheets.forEach((s) => {
      const items = s.items.map((it) => tap('td-mi', it.action,
        '<div class="td-mi-icon"' + (it.iconBg ? ' style="background:' + cssv(it.iconBg) + '"' : '') + '>' + ico(it.icon) + '</div>' +
        '<div class="td-mi-text"><div class="td-mi-title td-head">' + md(it.title) + '</div>' + (it.desc ? '<div class="td-mi-desc">' + md(it.desc) + '</div>' : '') + '</div><div class="td-arrow">›</div>', ctx, '', it.title)).join('');
      h += '<div class="td-sheet" id="td-sheet-' + esc(s.id) + '"><div class="td-handle"><span></span></div><div class="td-sheet-head"><div class="td-sheet-head-l">' +
        (s.icon ? '<div class="td-sheet-icon">' + ico(s.icon) + '</div>' : '') + '<div><div class="td-sheet-title td-head">' + md(s.title) + '</div>' +
        (s.subtitle ? '<div class="td-sheet-sub">' + md(s.subtitle) + '</div>' : '') + '</div></div><button class="td-close" data-td-close aria-label="Close">✕</button></div>' +
        '<div class="td-sheet-body">' + items + '</div></div>\n';
    });
    if (ctx.usesEvents) {
      h += '<div class="td-sheet" id="td-evsheet"><div class="td-handle"><span></span></div><div class="td-sheet-head"><div class="td-sheet-head-l"><div class="td-sheet-icon">📅</div><div>' +
        '<div class="td-sheet-title" id="td-ev-title">Event</div><div class="td-sheet-sub" id="td-ev-date" style="color:var(--td-accent)"></div></div></div>' +
        '<button class="td-close" data-td-close aria-label="Close">✕</button></div><div class="td-sheet-body td-ev-body" id="td-ev-body"></div></div>\n';
    }
    if (ctx.usesZoom) h += '<div class="td-zoom" id="td-zoom" data-td-close><img id="td-zoom-img" alt="" /><button class="td-close" data-td-close aria-label="Close">✕</button></div>\n';
    h += '<div class="td-toast" id="td-toast" role="status"></div>\n</div>';
    return h;
  }

  function blockStyle(b) {
    const s = b.style || {};
    const v = [];
    ['card', 'card2', 'text', 'muted', 'accent'].forEach((k) => { if (s[k]) v.push('--td-' + k + ':' + cssv(s[k])); });
    if (s.radius >= 0) v.push('--td-radius:' + +s.radius + 'px');
    if (s.side >= 0) v.push('--td-side:' + +s.side + 'px');
    if (s.mt >= 0) v.push('margin-top:' + +s.mt + 'px');
    return v.join(';');
  }

  /**
   * render(project, opts) → HTML string.
   * opts.preview: adds editor hooks (click-to-select, link interception).
   * opts.noAnim: skips entrance animation (used for live re-renders).
   * opts.forceTime: a time tab id ('normal' or a time id) to preview; '' follows the clock.
   * opts.formUrl: where Connect card answers are sent (only pages published from the portal).
   */
  TD.render = function (p, opts) {
    opts = opts || {};
    const ctx = { title: p.title, proxy: p.exp.proxy, proxyHosts: p.exp.proxyHosts, noAnim: !!opts.noAnim, formUrl: opts.formUrl || '' };
    const t = p.theme;
    const anim = t.anim !== 'none' && !opts.noAnim;
    let n = 0;
    const times = p.times || [];
    const tabIds = ['normal'].concat(times.map((x) => x.id));
    const body = p.blocks.filter((b) => !b.hidden).map((b) => {
      const inner = R[b.type](b, ctx);
      const st = blockStyle(b);
      const hide = (b.hideIn || []).filter((id) => tabIds.includes(id));
      if (hide.length >= tabIds.length) return '';
      const sched = hide.length ? ' data-td-show="' + esc(tabIds.filter((id) => !hide.includes(id)).join(' ')) + '"' : '';
      const cls = 'td-b td-t-' + b.type + (anim ? ' td-anim' : '') + (b.style && +b.style.side === 0 ? ' td-edge' : '') + (b.cssClass ? ' ' + esc(b.cssClass) : '');
      const delay = anim ? 'animation-delay:' + Math.min(0.05 + n++ * 0.06, 0.6).toFixed(2) + 's;' : '';
      return '<div class="' + cls + '"' + (b.anchor ? ' id="' + esc(b.anchor) + '"' : '') + (opts.preview ? ' data-td-id="' + b.id + '"' : '') + sched +
        ((st || delay) ? ' style="' + delay + st + '"' : '') + '>' + inner + '</div>';
    }).filter(Boolean).join('\n');

    const css = buildCss(p);
    const app = p.exp.layout === 'app';
    const page = (app ? '<div id="td-root">' : '') + '<div class="tdp">\n' + body + '\n</div>' + (app ? '</div>' : '');
    const ov = overlays(p, ctx);
    let pre = '';
    if (opts.preview) {
      pre = '<script>window.TD_PREVIEW=1;window.TD_FORCE_TIME=' + JSON.stringify(opts.forceTime || '') + ';</' + 'script>\n';
    }
    let script = '<script>\n(' + tdRuntime.toString() + ')(' + JSON.stringify(times.map((x) => ({ id: x.id, days: x.days, start: x.start, end: x.end, from: x.from, to: x.to, tz: x.tz }))).replace(/</g, '\\u003c') + ');\n</' + 'script>';
    if (opts.preview) {
      script += '\n<script>document.addEventListener("click",function(e){if(!e.altKey&&!window.TD_PICK)return;var b=e.target.closest("[data-td-id]");if(!b)return;e.preventDefault();e.stopPropagation();parent.postMessage({tdSelect:b.getAttribute("data-td-id")},"*")},true);' +
        '(function(){var t;function sc(){return document.getElementById("td-root")||document.scrollingElement}addEventListener("scroll",function(){clearTimeout(t);t=setTimeout(function(){var r=sc();if(r)parent.postMessage({tdScrollY:r.scrollTop},"*")},80)},true);addEventListener("message",function(e){if(e.data&&typeof e.data.tdScrollTo==="number"){var r=sc();if(r)r.scrollTop=e.data.tdScrollTo}})})();' +
        'window.addEventListener("message",function(e){if(e.data&&"tdPick" in e.data){window.TD_PICK=e.data.tdPick;document.documentElement.classList.toggle("td-picking",!!e.data.tdPick)}if(e.data&&e.data.tdFlash){var el=document.querySelector("[data-td-id=\\""+e.data.tdFlash+"\\"]");if(el){el.scrollIntoView({block:"center",behavior:"smooth"});el.animate([{outline:"3px solid #7c9cff",outlineOffset:"3px"},{outline:"3px solid transparent",outlineOffset:"3px"}],{duration:1200})}}});</' + 'script>' +
        '<style>.td-picking [data-td-id]{cursor:crosshair}.td-picking [data-td-id]:hover{outline:2px dashed #7c9cff;outline-offset:2px}</style>';
    }
    let embed = '';
    if (opts.embed) {
      embed = '\n<script type="application/json" id="tapdot-project">' + JSON.stringify(opts.embed).replace(/</g, '\\u003c') + '</' + 'script>';
    }
    const head = '<meta charset="UTF-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />\n' +
      '<title>' + esc(p.title) + '</title>\n' + fontLink(t) + '\n<style>\n' + css + '</style>';
    const bodyAll = page + '\n' + ov + '\n' + pre + script + embed;

    if (p.exp.fullDoc || opts.preview) {
      return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' + head + '\n</head>\n<body>\n<!-- Built with TapDot Editor -->\n' + bodyAll + '\n</body>\n</html>\n';
    }
    return '<!-- Built with TapDot Editor -->\n' + fontLink(t) + '\n<style>\n' + css + '</style>\n' + bodyAll + '\n';
  };
})();
