/* TapDot portal: churches, their pages, and the people who can edit them. */
(function () {
  // ── Helpers ──────────────────────────────────────────────────────────
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    kids.flat(Infinity).forEach((c) => { if (c != null && c !== false) el.append(c.nodeType ? c : String(c)); });
    return el;
  }
  const $ = (s) => document.querySelector(s);
  const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  const enc = encodeURIComponent;
  let toastT;
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  const when = (iso) => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  // ── Tap stats helpers ────────────────────────────────────────────────
  // Days are the visitor's local dates (YYYY-MM-DD), newest last.
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function lastDays(n) {
    const out = [];
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1));
    for (let i = 0; i < n; i++) { out.push(ymd(d)); d.setDate(d.getDate() + 1); }
    return out;
  }
  // Totals for one page over the given days: visits per day, taps per day, and taps per button.
  function sumStats(s, days) {
    const views = days.map((day) => (s && s.views[day]) || 0);
    const taps = days.map((day) => Object.values((s && s.taps[day]) || {}).reduce((a, b) => a + b, 0));
    const buttons = {};
    days.forEach((day) => Object.entries((s && s.taps[day]) || {}).forEach(([k, n]) => { buttons[k] = (buttons[k] || 0) + n; }));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    return { views, taps, buttons: Object.entries(buttons).sort((a, b) => b[1] - a[1]), totalViews: sum(views), totalTaps: sum(taps) };
  }
  const plural = (n, one, many) => n.toLocaleString() + ' ' + (n === 1 ? one : many);
  const shortDay = (day) => new Date(day + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
  // A small bar chart of visits per day; each bar's tooltip gives the date and count.
  function bars(days, values, tall) {
    const NS = 'http://www.w3.org/2000/svg';
    const w = 100 / days.length;
    const max = Math.max(1, ...values);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 40');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'bars' + (tall ? ' tall' : ''));
    days.forEach((day, i) => {
      const r = document.createElementNS(NS, 'rect');
      const bh = values[i] ? Math.max(2, (values[i] / max) * 38) : 1;
      r.setAttribute('x', i * w + w * 0.15); r.setAttribute('width', w * 0.7);
      r.setAttribute('y', 40 - bh); r.setAttribute('height', bh);
      if (!values[i]) r.setAttribute('class', 'zero');
      const t = document.createElementNS(NS, 'title');
      t.textContent = shortDay(day) + ': ' + plural(values[i], 'visit', 'visits');
      r.append(t); svg.append(r);
    });
    return svg;
  }

  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = await fetch('/api' + path, init);
    if (r.status === 401) { location.replace('/app/login.html'); throw new Error('Please sign in.'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); }
    catch (e) { prompt('Copy this:', text); }
  }
  const act = (fn) => async (ev) => {
    const b = ev && ev.currentTarget;
    if (b) b.disabled = true;
    try { await fn(ev); } catch (e) { toast(e.message); }
    if (b && b.isConnected) b.disabled = false;
  };

  // A small form in the dialog. Resolves with the field values, or null if cancelled.
  function ask(title, fields, okLabel, note) {
    return new Promise((resolve) => {
      const dlg = $('#dlg');
      const inputs = fields.map((f) => f.options
        ? h('select', { name: f.k }, f.options.map((o) => h('option', { value: o[0], selected: o[0] === f.value }, o[1])))
        : h('input', { name: f.k, type: f.type || 'text', value: f.value || '', placeholder: f.placeholder || '', required: f.required !== false, maxlength: f.max || 200, autocomplete: f.auto || 'off' }));
      const form = h('form', { method: 'dialog', class: 'dlgform' },
        h('h2', null, title),
        note ? h('p', { class: 'muted' }, note) : null,
        fields.map((f, i) => h('label', null, f.l, inputs[i], f.hint ? h('span', { class: 'muted small' }, f.hint) : null)),
        h('div', { class: 'row end' },
          h('button', { type: 'button', class: 'ghost', onclick: () => { dlg.close(); resolve(null); } }, 'Cancel'),
          h('button', { class: 'primary' }, okLabel || 'OK')));
      form.onsubmit = (e) => {
        e.preventDefault();
        const out = {};
        fields.forEach((f, i) => { out[f.k] = inputs[i].value.trim ? inputs[i].value.trim() : inputs[i].value; });
        dlg.close(); resolve(out);
      };
      dlg.onclose = () => resolve(null);
      fill($('#dlgBody'), form);
      dlg.showModal();
      if (inputs[0]) inputs[0].focus();
    });
  }
  function showLink(email, link) {
    const dlg = $('#dlg');
    fill($('#dlgBody'), h('div', { class: 'dlgform' },
      h('h2', null, 'Send ' + email + ' this link'),
      h('p', { class: 'muted' }, 'It lets them set a password and sign in. It works once, for 7 days. They can also use Sign in with Google with this email, with no link needed.'),
      h('input', { type: 'text', value: link, readOnly: true, onfocus: (e) => e.target.select(), class: 'mono' }),
      h('div', { class: 'row end' },
        h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Done'),
        h('button', { class: 'primary', onclick: () => copy(link, 'Link copied') }, 'Copy link'))));
    dlg.onclose = null;
    dlg.showModal();
  }

  // ── State and routing ────────────────────────────────────────────────
  let me = null;
  const route = () => decodeURIComponent(location.hash.slice(1));
  window.addEventListener('hashchange', () => { if (me) draw(); });

  async function start() {
    try { me = await api('/me'); } catch (e) { return; }
    const acct = $('#acctBtn');
    acct.hidden = false;
    acct.textContent = me.name || me.email;
    acct.onclick = account;
    draw();
  }
  function churchPicker(current) {
    const sel = $('#churchSel');
    sel.hidden = me.churches.length < 2 && !me.admin;
    fill(sel,
      me.admin ? h('option', { value: '' }, 'All churches') : null,
      me.churches.map((c) => h('option', { value: c.id, selected: c.id === current }, c.name)));
    sel.value = current || '';
    sel.onchange = () => { location.hash = sel.value; };
  }

  async function draw() {
    const id = route();
    if (!id) {
      if (!me.admin && me.churches.length) { location.replace('#' + me.churches[0].id); return; }
      churchPicker('');
      return drawHome();
    }
    churchPicker(id);
    return drawChurch(id);
  }

  // ── Home: every church (admins), or a note for people with none ──────
  async function drawHome() {
    const main = $('#main');
    if (!me.admin) {
      fill(main, h('div', { class: 'card center' }, h('h1', null, 'No churches yet'), h('p', { class: 'muted' }, 'You haven’t been added to a church. Ask whoever manages your church’s pages to add ' + me.email + '.')));
      return;
    }
    me = await api('/me');
    fill(main,
      h('div', { class: 'head' }, h('h1', null, 'Churches'),
        h('button', { class: 'primary', onclick: act(async () => {
          const v = await ask('Add a church', [{ k: 'name', l: 'Church name', placeholder: 'Bethany First Church', max: 80 }], 'Add church');
          if (!v) return;
          const c = await api('/churches', { method: 'POST', body: { name: v.name } });
          me = await api('/me');
          location.hash = c.id;
        }) }, '+ Add church')),
      me.churches.length
        ? h('div', { class: 'grid' }, me.churches.map((c) => h('a', { class: 'card tile', href: '#' + c.id }, h('b', null, c.name), h('span', { class: 'muted small' }, c.id))))
        : h('div', { class: 'card center muted' }, 'No churches yet. Add the first one, then add its pages and people.'));
  }

  // ── One church: its pages and people ────────────────────────────────
  async function drawChurch(id) {
    const main = $('#main');
    let data;
    let allStats = null;
    try {
      [data, allStats] = await Promise.all([api('/churches/' + enc(id)), api('/churches/' + enc(id) + '/stats?days=14').catch(() => null)]);
    }
    catch (e) { fill(main, h('div', { class: 'card center' }, h('p', null, e.message), h('a', { href: '#' }, 'Back'))); return; }
    if (route() !== id) return; // moved on while loading
    const { church, role, pages, members } = data;
    const responses = data.responses || {};
    const manage = role === 'owner' || role === 'admin';
    document.title = church.name + ' · TapDot';
    const reload = () => drawChurch(id);

    const pageCard = (p) => {
      const live = location.origin + '/view/' + church.id + '/' + p.id;
      const code = '<div class="tapdot-page" data-page="' + church.id + '/' + p.id + '"></div>\n<script src="' + location.origin + '/embed.js"></' + 'script>';
      const pending = p.draftAt && (!p.publishedAt || p.draftAt > p.publishedAt);
      return h('div', { class: 'card page' },
        h('div', { class: 'pagehead' },
          h('b', null, p.name),
          p.publishedAt ? h('span', { class: 'pill ' + (pending ? 'warn' : 'ok') }, pending ? 'Unpublished edits' : 'Live') : h('span', { class: 'pill' }, 'Not published')),
        h('div', { class: 'muted small' },
          p.draftAt ? 'Edited ' + when(p.draftAt) + (p.draftBy ? ' by ' + p.draftBy : '') : 'Not edited yet',
          p.publishedAt ? h('br') : null,
          p.publishedAt ? 'Published ' + when(p.publishedAt) + (p.publishedBy ? ' by ' + p.publishedBy : '') : null),
        statStrip(p),
        responses[p.id] ? h('button', { class: 'answers' + (responses[p.id].unseen ? ' new' : ''), onclick: () => showResponses(church, p, reload) },
          '📥 ', plural(responses[p.id].total, 'connect card answer', 'connect card answers'),
          responses[p.id].unseen ? h('span', { class: 'pill ok' }, responses[p.id].unseen + ' new') : null) : null,
        h('div', { class: 'row wrap' },
          h('a', { class: 'primary btn', href: 'editor.html?church=' + enc(church.id) + '&page=' + enc(p.id) }, '✎ Edit'),
          p.publishedAt ? h('a', { class: 'ghost btn', href: live, target: '_blank', rel: 'noopener' }, '↗ Live page') : null,
          h('button', { class: 'ghost', onclick: () => copy(code, 'Code block copied. Paste it into a Squarespace code block once.') }, '📋 Code block'),
          h('details', { class: 'more' }, h('summary', { class: 'ghost' }, '•••'),
            h('div', { class: 'menu' },
              h('button', { onclick: () => copy(live, 'Link copied. Use it for QR codes and tap tags.') }, 'Copy live link'),
              h('button', { onclick: act(async () => {
                const v = await ask('Rename page', [{ k: 'name', l: 'Page name', value: p.name, max: 80 }], 'Rename', 'The page’s link stays the same.');
                if (!v) return;
                await api('/churches/' + enc(church.id) + '/pages/' + enc(p.id), { method: 'PATCH', body: { name: v.name } }); reload();
              }) }, 'Rename'),
              h('button', { onclick: act(async () => {
                const v = await ask('Duplicate page', [{ k: 'name', l: 'Name for the copy', value: p.name + ' copy', max: 80 }], 'Duplicate');
                if (!v) return;
                await api('/churches/' + enc(church.id) + '/pages', { method: 'POST', body: { name: v.name, copyFrom: p.id } }); reload();
              }) }, 'Duplicate'),
              p.publishedAt ? h('button', { onclick: act(async () => {
                if (!confirm('Take “' + p.name + '” off the site? Visitors will see “could not load” until you publish again.')) return;
                await api('/churches/' + enc(church.id) + '/pages/' + enc(p.id) + '/unpublish', { method: 'POST' }); reload();
              }) }, 'Unpublish') : null,
              h('button', { class: 'danger', onclick: act(async () => {
                if (!confirm('Delete “' + p.name + '” for good? This also takes it off the site.')) return;
                await api('/churches/' + enc(church.id) + '/pages/' + enc(p.id), { method: 'DELETE' }); reload();
              }) }, 'Delete')))));
    };

    // Last 7 days at a glance, with a 14-day chart. Clicking it opens the full stats.
    function statStrip(p) {
      const s = allStats && allStats.pages[p.id];
      if (!p.publishedAt && !s) return null;
      const days = lastDays(14);
      const week = sumStats(s, days.slice(7));
      const two = sumStats(s, days);
      const top = week.buttons[0];
      return h('button', { class: 'stats', title: 'See tap stats', onclick: () => showStats(church, p) },
        h('div', { class: 'statnums' },
          h('span', null, h('b', null, week.totalViews.toLocaleString()), ' ', week.totalViews === 1 ? 'visit' : 'visits', h('span', { class: 'muted' }, ' this week')),
          h('span', { class: 'muted small' }, week.totalTaps ? plural(week.totalTaps, 'tap', 'taps') + (top ? ' · top: ' + top[0] + ' (' + top[1] + ')' : '') : 'No taps yet')),
        bars(days, two.views));
    }

    const roleName = { owner: 'Owner', editor: 'Editor' };
    const personRow = (m) => h('div', { class: 'person' },
      h('div', { class: 'who' },
        h('b', null, m.name || m.email),
        h('span', { class: 'muted small' }, (m.name ? m.email + ' · ' : '') +
          ([m.hasPassword ? 'password' : null, m.hasGoogle ? 'Google' : null].filter(Boolean).join(' + ') || 'hasn’t signed in yet'))),
      manage ? h('select', { class: 'sm', onchange: act(async (e) => {
        await api('/churches/' + enc(church.id) + '/members/' + enc(m.email), { method: 'PATCH', body: { role: e.target.value } }); toast('Updated');
      }) }, Object.keys(roleName).map((r) => h('option', { value: r, selected: r === m.role }, roleName[r]))) : h('span', { class: 'muted small' }, roleName[m.role] || m.role),
      manage ? h('button', { class: 'ghost sm', title: 'A link to set or reset their password', onclick: act(async () => {
        const r = await api('/churches/' + enc(church.id) + '/members/' + enc(m.email) + '/link', { method: 'POST' });
        showLink(m.email, r.link);
      }) }, 'Password link') : null,
      manage && m.email !== me.email ? h('button', { class: 'ghost sm danger', onclick: act(async () => {
        if (!confirm('Remove ' + m.email + ' from ' + church.name + '?')) return;
        await api('/churches/' + enc(church.id) + '/members/' + enc(m.email), { method: 'DELETE' }); reload();
      }) }, 'Remove') : null);

    fill(main,
      h('div', { class: 'head' },
        h('h1', null, church.name),
        manage ? h('button', { class: 'ghost sm', onclick: act(async () => {
          const v = await ask('Rename church', [{ k: 'name', l: 'Church name', value: church.name, max: 80 }], 'Rename');
          if (!v) return;
          await api('/churches/' + enc(church.id), { method: 'PATCH', body: { name: v.name } }); me = await api('/me'); draw();
        }) }, 'Rename') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'primary', onclick: () => newPage(church) }, '+ New page')),
      pages.length ? h('div', { class: 'grid' }, pages.map(pageCard))
        : h('div', { class: 'card center muted' }, 'No pages yet. Create one to start editing.'),
      h('div', { class: 'head' }, h('h2', null, 'People'),
        h('div', { class: 'grow' }),
        manage ? h('button', { class: 'ghost', onclick: act(async () => {
          const v = await ask('Add a person', [
            { k: 'email', l: 'Email', type: 'email', placeholder: 'name@church.org' },
            { k: 'role', l: 'Role', value: 'editor', options: [['editor', 'Editor: edits and publishes pages'], ['owner', 'Owner: also adds and removes people']] },
          ], 'Add');
          if (!v) return;
          const r = await api('/churches/' + enc(church.id) + '/members', { method: 'POST', body: v });
          await reload();
          if (r.link) showLink(r.email, r.link); else toast(r.email + ' already has an account and can sign in now.');
        }) }, '+ Add person') : null),
      h('div', { class: 'card list' }, members.length ? members.map(personRow) : h('p', { class: 'muted' }, 'Nobody yet.')),
      me.admin ? h('div', { class: 'dangerzone' }, h('button', { class: 'ghost sm danger', onclick: act(async () => {
        const v = await ask('Delete ' + church.name + '?', [{ k: 'confirm', l: 'Type the church’s id (' + church.id + ') to confirm' }], 'Delete church',
          'This deletes every page (taking them off the site) and removes everyone’s access. It can’t be undone.');
        if (!v || v.confirm !== church.id) return;
        await api('/churches/' + enc(church.id), { method: 'DELETE' });
        me = await api('/me'); location.hash = '';
      }) }, 'Delete church')) : null);
  }

  // ── New page: pick a template (previews side by side) or start from scratch ──
  function newPage(church) {
    const dlg = $('#dlg');
    const TD = window.TD;
    // Every church gets the general starters; BFC's own page and the feature tour are for admins.
    const keys = TD && TD.TEMPLATES ? Object.keys(TD.TEMPLATES).filter((k) => k !== 'blank' && (me.admin || !['bethany', 'tour'].includes(k))) : [];
    const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Page name, e.g. Sunday tap tag', autocomplete: 'off' });
    const create = async (key, btn) => {
      const t = TD && TD.TEMPLATES[key];
      const pageName = name.value.trim() || (key === 'blank' ? 'New page' : t.name);
      btn.disabled = true;
      try {
        const p = await api('/churches/' + enc(church.id) + '/pages', { method: 'POST', body: { name: pageName } });
        location.href = 'editor.html?church=' + enc(church.id) + '&page=' + enc(p.id) + '&template=' + enc(key);
      } catch (e) { toast(e.message); btn.disabled = false; }
    };
    const card = (key) => {
      const blank = key === 'blank';
      const t = blank ? { name: 'Start from scratch', desc: 'An empty page. Add blocks one at a time.' } : TD.TEMPLATES[key];
      let prev;
      if (blank) prev = h('div', { class: 'tplprev blank' }, h('span', null, '+'));
      else {
        const f = h('iframe', { tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy' });
        f.setAttribute('sandbox', 'allow-scripts');
        try { f.srcdoc = TD.previewDoc(t.build()); } catch (e) { /* preview is a nice-to-have */ }
        prev = h('div', { class: 'tplprev' }, f);
      }
      const b = h('button', { class: 'tplcard', onclick: () => create(key, b) }, prev, h('b', null, t.name), t.desc ? h('small', null, t.desc) : null);
      return b;
    };
    fill($('#dlgBody'), h('div', { class: 'dlgform newpage' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'New page'), h('button', { class: 'ghost sm', onclick: () => dlg.close() }, '✕')),
      h('label', null, 'Name', name),
      h('p', { class: 'muted small' }, 'Start from a template or from scratch. You can change everything after; photos and links in templates are examples to replace.'),
      h('div', { class: 'tplgrid' }, card('blank'), keys.map(card))));
    dlg.onclose = null;
    dlg.showModal();
    name.focus();
  }

  // ── Tap stats for one page ───────────────────────────────────────────
  async function showStats(church, p, n) {
    n = n || 30;
    const dlg = $('#dlg');
    const body = h('div', { class: 'dlgform statsdlg' }, h('p', { class: 'muted' }, 'Loading…'));
    fill($('#dlgBody'), body);
    dlg.onclose = null;
    if (!dlg.open) dlg.showModal();
    let data;
    try { data = await api('/churches/' + enc(church.id) + '/stats?days=' + n); }
    catch (e) { fill(body, h('p', null, e.message)); return; }
    const days = lastDays(n);
    const t = sumStats(data.pages[p.id], days);
    const maxB = t.buttons.length ? t.buttons[0][1] : 1;
    fill(body,
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, p.name),
        h('select', { class: 'sm', onchange: (e) => showStats(church, p, +e.target.value) },
          [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([v, l]) => h('option', { value: v, selected: v === n }, l)))),
      h('div', { class: 'statbig' },
        h('div', null, h('b', null, t.totalViews.toLocaleString()), h('span', { class: 'muted small' }, t.totalViews === 1 ? 'visit' : 'visits')),
        h('div', null, h('b', null, t.totalTaps.toLocaleString()), h('span', { class: 'muted small' }, t.totalTaps === 1 ? 'button tap' : 'button taps')),
        h('div', null, h('b', null, t.totalViews ? Math.round((t.totalTaps / t.totalViews) * 10) / 10 : 0), h('span', { class: 'muted small' }, 'taps per visit'))),
      h('div', { class: 'chart' }, bars(days, t.views, true),
        h('div', { class: 'row muted small' }, h('span', { class: 'grow' }, shortDay(days[0])), h('span', null, 'Today'))),
      h('h3', null, 'Buttons tapped'),
      t.buttons.length
        ? h('div', { class: 'taplist' }, t.buttons.map(([label, c]) => h('div', { class: 'tapRow' },
          h('span', { class: 'tapLabel', title: label }, label),
          h('span', { class: 'tapBar' }, h('i', { style: 'width:' + Math.max(3, (c / maxB) * 100) + '%' })),
          h('b', null, c.toLocaleString()))))
        : h('p', { class: 'muted' }, 'No taps in this time yet.'),
      h('p', { class: 'muted small' }, 'A visit counts once per person every 30 minutes. Visits are counted on the site’s code block and the live link. No cookies are used and nothing about visitors is stored.'),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Close')));
  }

  // ── Connect card answers for one page ────────────────────────────────
  function toCsv(list) {
    const qs = [];
    list.forEach((r) => r.answers.forEach((a) => { if (!qs.includes(a.q)) qs.push(a.q); }));
    const cell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['Sent', 'Form'].concat(qs)].concat(list.map((r) => {
      const by = {};
      r.answers.forEach((a) => { by[a.q] = a.a; });
      return [new Date(r.createdAt).toLocaleString(), r.form].concat(qs.map((q) => by[q] || ''));
    }));
    return '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  }
  async function showResponses(church, p, reload) {
    const dlg = $('#dlg');
    const body = h('div', { class: 'dlgform answersdlg' }, h('p', { class: 'muted' }, 'Loading…'));
    fill($('#dlgBody'), body);
    dlg.onclose = reload;
    dlg.showModal();
    let list;
    try { list = (await api('/churches/' + enc(church.id) + '/responses?page=' + enc(p.id))).responses; }
    catch (e) { fill(body, h('p', null, e.message)); return; }
    api('/churches/' + enc(church.id) + '/responses/seen', { method: 'POST', body: { page: p.id } }).catch(() => { /* stays "new" */ });
    const draw = () => fill(body,
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Connect card answers'),
        list.length ? h('button', { class: 'ghost sm', onclick: () => {
          const a = h('a', { href: URL.createObjectURL(new Blob([toCsv(list)], { type: 'text/csv' })), download: p.id + '-answers.csv' });
          document.body.append(a); a.click(); a.remove();
        } }, '⬇ Download for Excel') : null),
      h('p', { class: 'muted small' }, p.name + ' · ' + plural(list.length, 'answer', 'answers') + ', newest first'),
      list.length ? h('div', { class: 'answerlist' }, list.map((r) => h('div', { class: 'answer' + (r.seen ? '' : ' new') },
        h('div', { class: 'row' },
          h('b', { class: 'grow' }, r.form),
          r.seen ? null : h('span', { class: 'pill ok' }, 'New'),
          h('span', { class: 'muted small' }, when(r.createdAt)),
          h('button', { class: 'ghost sm danger', title: 'Delete this answer', onclick: act(async () => {
            if (!confirm('Delete this answer for good?')) return;
            await api('/churches/' + enc(church.id) + '/responses/' + enc(r.id), { method: 'DELETE' });
            list = list.filter((x) => x !== r); draw();
          }) }, '🗑')),
        h('dl', null, r.answers.filter((a) => a.a).map((a) => [h('dt', null, a.q), h('dd', null, a.a)]))))) : h('p', { class: 'muted' }, 'No answers yet.'),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Close')));
    draw();
  }

  // ── Account: name, password, sign out ────────────────────────────────
  function account() {
    const dlg = $('#dlg');
    fill($('#dlgBody'), h('div', { class: 'dlgform' },
      h('h2', null, me.name || me.email),
      h('p', { class: 'muted' }, me.email + (me.admin ? ' · admin' : '')),
      h('p', { class: 'muted small' }, 'Signs in with ' + ([me.hasPassword ? 'a password' : null, me.hasGoogle ? 'Google' : null].filter(Boolean).join(' or ') || 'a link') + '.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'ghost', onclick: act(async () => {
          const v = await ask('Your name', [{ k: 'name', l: 'Name', value: me.name, max: 80, required: false, auto: 'name' }], 'Save');
          if (!v) return;
          await api('/me', { method: 'PUT', body: { name: v.name } }); me.name = v.name; $('#acctBtn').textContent = me.name || me.email; toast('Saved');
        }) }, 'Change name'),
        h('button', { class: 'ghost', onclick: act(async () => {
          const fields = (me.hasPassword ? [{ k: 'currentPassword', l: 'Current password', type: 'password', auto: 'current-password' }] : [])
            .concat([{ k: 'password', l: 'New password (at least 10 characters)', type: 'password', auto: 'new-password' }, { k: 'again', l: 'Type it again', type: 'password', auto: 'new-password' }]);
          const v = await ask(me.hasPassword ? 'Change password' : 'Set a password', fields, 'Save', me.hasPassword ? 'You’ll stay signed in here and be signed out everywhere else.' : 'So you can also sign in without Google.');
          if (!v) return;
          if (v.password !== v.again) { toast('The two passwords don’t match.'); return; }
          await api('/me', { method: 'PUT', body: { password: v.password, currentPassword: v.currentPassword } }); me.hasPassword = true; toast('Password saved');
        }) }, me.hasPassword ? 'Change password' : 'Set a password'),
        h('button', { class: 'ghost danger', onclick: act(async () => {
          await api('/auth/logout', { method: 'POST' }); location.replace('/app/login.html');
        }) }, 'Sign out')),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Close'))));
    dlg.onclose = null;
    dlg.showModal();
  }

  $('#dlg').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  start();
})();
