/* DoorStep portal: churches, their pages, and the people who can edit them. */
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
  // Dates leave out the year when it's this year ("Nov 12, 1:20 PM").
  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString([], Object.assign({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }, d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }));
  };

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
  function bars(days, values, tall, tip) {
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
      t.textContent = tip ? tip(day, values[i]) : shortDay(day) + ': ' + plural(values[i], 'visit', 'visits');
      r.append(t); svg.append(r);
    });
    return svg;
  }

  // On the stats link page (stats.html), everything is read-only and comes from /api/shared/<token>.
  const SHARE = document.body.dataset.mode === 'shared' ? location.hash.slice(1) : null;
  const cbase = (church) => SHARE ? '/shared/' + enc(SHARE) : '/churches/' + enc(church.id);

  async function api(path, opts) {
    opts = opts || {};
    const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    const r = await fetch('/api' + path, init);
    if (r.status === 401 && !SHARE) { location.replace('/app/login.html'); throw new Error('Please sign in.'); }
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
  window.addEventListener('hashchange', () => { if (SHARE) location.reload(); else if (me) draw(); });

  async function start() {
    if (SHARE !== null) return drawShared('30');
    try { me = await api('/me'); } catch (e) { return; }
    const acct = $('#acctBtn');
    acct.hidden = false;
    acct.textContent = me.name || me.email;
    acct.onclick = account;
    $('#tplBtn').hidden = !me.admin;
    $('#adminBtn').hidden = !me.admin;
    topMenu();
    draw();
  }

  // Phones: the top bar keeps the logo, the church picker and one ☰ menu with everything else
  // (Admin, Templates, Help, theme, account). Each entry clicks the real button, which wider screens show.
  function topMenu() {
    const det = $('#topMenu'), list = $('#topMenuList');
    if (!det) return;
    det.hidden = false;
    const item = (icon, label, sub, run) => h('button', { type: 'button', onclick: () => { det.open = false; run(); } },
      h('span', { class: 'mi' }, icon), h('span', { class: 'ml' }, label, sub ? h('small', null, sub) : null));
    const draw = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      fill(list,
        item('👤', me.name || 'Account', me.email, account),
        me.admin ? item('🛡', 'Admin', 'Every account, church and change', () => { location.hash = 'admin'; }) : null,
        me.admin ? item('🧩', 'Templates', 'Starting points for new pages', () => { location.hash = 'templates'; }) : null,
        item('?', 'Help center', 'Step-by-step guides', () => window.open('/help/', '_blank', 'noopener')),
        item(theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐', 'Theme: ' + (theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'), 'Tap to switch', () => { $('#themeBtn').click(); }));
    };
    det.addEventListener('toggle', () => { if (det.open) draw(); });
    draw();
  }
  // Pop-up menus (•••, ☰) close after picking an item, or when tapping anywhere else.
  document.addEventListener('click', (e) => {
    const inMenu = e.target.closest && e.target.closest('details.more');
    document.querySelectorAll('details.more[open]').forEach((d) => {
      if (d !== inMenu || (e.target.closest('.menu button, .menu a'))) d.open = false;
    });
  });
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
    const gp = $('#glassPanel'); if (gp) gp.remove();
    // The glass look (soft brand-colored backdrop, see-through panels) is for the church screens.
    document.body.classList.toggle('glassy', !!id && id !== 'templates' && !/^admin(\/|$)/.test(id) && !id.includes('/'));
    $('#tplBtn').classList.toggle('on', id === 'templates');
    $('#adminBtn').classList.toggle('on', /^admin(\/|$)/.test(id));
    if (id === 'templates' && me.admin) { churchPicker(''); return drawTemplates(); }
    if (/^admin(\/|$)/.test(id) && me.admin) { churchPicker(''); return drawAdmin(id.slice(6)); }
    if (!id) {
      if (!me.admin && me.churches.length) { location.replace('#' + me.churches[0].id); return; }
      churchPicker('');
      return drawHome();
    }
    // #<church>/<page> is that page's Settings screen.
    const [cid, pid] = id.split('/');
    churchPicker(cid);
    if (pid) return drawPageSettings(cid, pid);
    return drawChurch(id);
  }

  // ── One page's Settings screen (#<church>/<page>) ───────────────────
  async function drawPageSettings(cid, pid) {
    const main = $('#main');
    let data;
    try { data = await api('/churches/' + enc(cid)); }
    catch (e) { fill(main, h('div', { class: 'card center' }, h('p', null, e.message), h('a', { href: '#' }, 'Back'))); return; }
    if (route() !== cid + '/' + pid) return;
    const { church, role } = data;
    const p = data.pages.find((x) => x.id === pid);
    if (!p || role === 'viewer') { location.replace('#' + cid); return; }
    document.title = p.name + ' settings · DoorStep';
    const url = '/churches/' + enc(church.id) + '/pages/' + enc(p.id);
    const save = (body) => api(url, { method: 'PATCH', body });
    const code = '<div class="tapdot-page" data-page="' + church.id + '/' + p.id + '"></div>\n<script src="' + location.origin + '/embed.js"></' + 'script>';
    const live = location.origin + '/view/' + church.id + '/' + p.id;

    const nameIn = h('input', { type: 'text', value: p.name, maxlength: 80 });
    const adv = h('input', { type: 'checkbox', checked: !!(p.settings && p.settings.advanced), onchange: act(async () => {
      const r = await save({ settings: { advanced: adv.checked } });
      adv.checked = !!r.settings.advanced;
      toast(adv.checked ? 'Advanced editing is on for this page.' : 'Advanced editing is off for this page.');
    }) });

    fill(main,
      h('a', { class: 'crumb', href: '#' + church.id }, '← ' + church.name),
      h('div', { class: 'head' }, h('div', null, h('h1', null, 'Settings'), h('p', { class: 'muted sub' }, p.name))),
      h('div', { class: 'settings' },
        h('section', { class: 'card' },
          h('h3', null, 'Page name'),
          h('form', { class: 'row', onsubmit: act(async (ev) => {
            ev.preventDefault();
            const name = nameIn.value.trim();
            if (!name) { toast('Give the page a name.'); return; }
            await save({ name }); p.name = name;
            $('.head .sub').textContent = name;
            toast('Renamed. The page’s link stays the same.');
          }) }, nameIn, h('button', { class: 'ghost', type: 'submit' }, 'Save'))),
        h('section', { class: 'card' },
          h('h3', null, 'Editing'),
          h('label', { class: 'check' }, adv, h('span', null, 'Advanced editing',
            h('span', { class: 'muted small' }, 'Shows Style overrides on every block in the editor: its own colors, corner radius, spacing, anchor name and CSS class. Leave it off to keep the editor simple and let the theme set the look. Overrides already on the page keep working either way.')))),
        h('section', { class: 'card' },
          h('h3', null, 'Install code'),
          h('p', { class: 'muted small' }, 'Paste this into a code block on your website once. After that, Publish in the editor updates the page there.'),
          h('textarea', { class: 'mono', readOnly: true, rows: 2, onfocus: (e) => e.target.select() }, code),
          h('div', { class: 'row wrap' },
            h('button', { class: 'primary', onclick: () => copy(code, 'Install code copied. Paste it into your site once.') }, '📋 Copy install code'),
            p.publishedAt ? h('a', { class: 'ghost btn', href: live, target: '_blank', rel: 'noopener' }, '↗ Live page') : h('span', { class: 'muted small' }, 'Not published yet.')))));
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
      [data, allStats] = await Promise.all([api('/churches/' + enc(id)), api('/churches/' + enc(id) + '/stats?days=180').catch(() => null)]);
    }
    catch (e) { fill(main, h('div', { class: 'card center' }, h('p', null, e.message), h('a', { href: '#' }, 'Back'))); return; }
    if (route() !== id) return; // moved on while loading
    const { church, role, pages, members } = data;
    const responses = data.responses || {};
    const manage = role === 'owner' || role === 'admin';
    const viewer = role === 'viewer'; // "Stats only": sees the page list and tap stats, nothing else
    document.title = church.name + ' · DoorStep';
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
        viewer ? (p.publishedAt ? h('div', { class: 'row wrap' }, h('a', { class: 'ghost btn', href: live, target: '_blank', rel: 'noopener' }, '↗ Live page'),
          h('button', { class: 'ghost', onclick: () => openQr(p) }, '▦ QR code')) : null) : h('div', { class: 'row wrap' },
          h('a', { class: 'primary btn', href: 'editor.html?church=' + enc(church.id) + '&page=' + enc(p.id) }, '✎ Edit'),
          p.publishedAt ? h('a', { class: 'ghost btn', href: live, target: '_blank', rel: 'noopener' }, '↗ Live page') : null,
          h('button', { class: 'ghost wideonly', title: 'Paste this into your website once. After that, Publish updates it.', onclick: () => copy(code, 'Install code copied. Paste it into your site once.') }, '📋 Install code'),
          h('a', { class: 'ghost btn icon wideonly', href: '#' + church.id + '/' + p.id, title: 'Settings', 'aria-label': 'Settings' }, '⚙'),
          h('details', { class: 'more' }, h('summary', { class: 'ghost', 'aria-label': 'More for ' + p.name }, '•••'),
            h('div', { class: 'menu' },
              h('div', { class: 'menuhead' }, p.name),
              h('button', { class: 'phoneonly', onclick: () => copy(code, 'Install code copied. Paste it into your site once.') }, '📋 Copy install code'),
              h('button', { class: 'phoneonly', onclick: () => { location.hash = church.id + '/' + p.id; } }, '⚙ Settings'),
              h('button', { onclick: () => copy(live, 'Link copied. Use it for QR codes and tap tags.') }, 'Copy live link'),
              h('button', { onclick: () => openQr(p) }, '▦ QR code'),
              h('button', { onclick: act(async () => {
                const v = await ask('Rename page', [{ k: 'name', l: 'Page name', value: p.name, max: 80 }], 'Rename', 'The page’s link stays the same.');
                if (!v) return;
                await api('/churches/' + enc(church.id) + '/pages/' + enc(p.id), { method: 'PATCH', body: { name: v.name } }); reload();
              }) }, 'Rename'),
              me.admin ? h('button', { onclick: act(async () => {
                const v = await ask('Save as a template', [{ k: 'name', l: 'Template name', value: p.name, max: 80 }, { k: 'desc', l: 'Description', max: 200, required: false }], 'Save',
                  'Makes a copy of this page’s latest saved version for the Templates list. It starts hidden from churches.');
                if (!v) return;
                await api('/templates', { method: 'POST', body: { name: v.name, desc: v.desc, fromPage: church.id + '/' + p.id, hidden: true } });
                toast('Saved. Find it under 🧩 Templates.');
              }) }, 'Save as template') : null,
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

    const renameChurch = act(async () => {
      const v = await ask('Rename church', [{ k: 'name', l: 'Church name', value: church.name, max: 80 }], 'Rename');
      if (!v) return;
      await api('/churches/' + enc(church.id), { method: 'PATCH', body: { name: v.name } }); me = await api('/me'); draw();
    });
    const roleName = { owner: 'Owner', editor: 'Editor', viewer: 'Stats only' };
    const personRow = (m) => h('div', { class: 'person' },
      h('div', { class: 'who' },
        me.admin ? h('a', { href: '#admin/person/' + enc(m.email), title: 'Open in Admin' }, h('b', null, m.name || m.email)) : h('b', null, m.name || m.email),
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

    const headBar = h('div', { class: 'head' },
        h('h1', null, church.name),
        manage ? h('button', { class: 'ghost sm wideonly', onclick: renameChurch }, 'Rename') : null,
        h('div', { class: 'grow' }),
        h('button', { class: 'ghost', title: 'Download a PDF of visits and taps for a week, month, year or any dates', onclick: () => reportDialog(church, pages, { answers: !viewer && Object.keys(responses).length > 0, responses }) }, '⤓ ', h('span', { class: 'wideonly' }, 'PDF report'), h('span', { class: 'phoneonly' }, 'Report')),
        manage ? h('button', { class: 'ghost wideonly', title: 'A read-only page of this church’s tap stats, for people who don’t edit', onclick: () => shareDialog(church) }, '📊 Share stats') : null,
        viewer ? h('span', { class: 'pill' }, 'Stats only') : h('button', { class: 'primary newpage', onclick: () => newPage(church) }, '+ New page'),
        manage ? h('details', { class: 'more phoneonly' }, h('summary', { class: 'ghost', 'aria-label': 'More for ' + church.name }, '•••'),
          h('div', { class: 'menu' },
            h('div', { class: 'menuhead' }, church.name),
            h('button', { onclick: () => shareDialog(church) }, '📊 Share stats'),
            h('button', { onclick: renameChurch }, 'Rename church'))) : null);
    const pagesView = () => [
      pages.length ? h('div', { class: 'grid' }, pages.map(pageCard))
        : h('div', { class: 'card center muted' }, viewer ? 'No pages yet.' : 'No pages yet. Create one to start editing.')];
    const peopleView = () => [
      h('div', { class: 'head flat' }, h('h2', null, 'People'),
        h('div', { class: 'grow' }),
        manage ? h('button', { class: 'ghost', onclick: act(async () => {
          const v = await ask('Add a person', [
            { k: 'email', l: 'Email', type: 'email', placeholder: 'name@church.org' },
            { k: 'role', l: 'Role', value: 'editor', options: [['editor', 'Editor: edits and publishes pages'], ['owner', 'Owner: also adds and removes people'], ['viewer', 'Stats only: sees visits and taps, can’t edit']] },
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
      }) }, 'Delete church')) : null];

    // Overview / Pages / People, switched by the glass dock at the bottom. The last one picked is remembered.
    const tabs = [['overview', 'Overview', '◎'], ['pages', 'Pages', '▤'], ['qr', 'QR codes', '⊞'], viewer ? null : ['people', 'People', '☺']].filter(Boolean);
    // A page's ••• → QR code opens the QR codes view set to that page.
    const openQr = (p) => { qrWhat[church.id] = Object.assign(qrWhat[church.id] || { url: '', email: '', subject: '', phone: '', text: '' }, { kind: 'page', page: p.id }); showTab('qr'); window.scrollTo(0, 0); };
    let tab = store.get('doorstep-church-tab');
    if (!tabs.some((t) => t[0] === tab)) tab = 'overview';
    const view = h('div', { class: 'gview' });
    const dock = h('nav', { class: 'dock glass', 'aria-label': 'Church views' });
    const showTab = (t) => {
      tab = t; store.set('doorstep-church-tab', t);
      fill(view, t === 'pages' ? pagesView() : t === 'people' ? peopleView() : t === 'qr' ? qrMaker(church, pages) : overview(church, pages, allStats, { viewer, responses, reload, go: showTab }));
      view.querySelectorAll(':scope > *, .ovgrid > *').forEach((el, i) => { el.classList.add('reveal'); el.style.setProperty('--i', i); });
      dock.querySelectorAll('button[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'));
    };
    fill(dock,
      tabs.map(([k, label, icon], i) => h('button', { type: 'button', 'data-tab': k, onclick: () => showTab(k), onkeydown: (e) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        showTab(tabs[next][0]); dock.children[next].focus();
      } }, h('span', { class: 'di', 'aria-hidden': 'true' }, icon), h('span', null, label))),
      h('span', { class: 'dsep' }),
      h('button', { type: 'button', class: 'dglass', title: 'Adjust glass', 'aria-label': 'Adjust glass', onclick: glassPanel }, h('span', { class: 'di', 'aria-hidden': 'true' }, '◧')));
    fill(main, headBar, view, dock);
    showTab(tab);
  }

  // ── Glass dashboard: church Overview, line chart, and the Adjust glass panel ──
  // Remembered in this browser only; private windows and blocked storage just use the defaults.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* not remembered */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nothing to forget */ } },
  };
  const GLASS0 = { blur: 22, opacity: 55, edge: 60 };
  const GLASS_PRESETS = [['Clear', { blur: 10, opacity: 25, edge: 80 }], ['Frosted', GLASS0], ['Solid', { blur: 32, opacity: 88, edge: 35 }]];
  const clampN = (v, lo, hi, d) => (v !== '' && v != null && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, Math.round(+v))) : d);
  function glassGet() {
    let g = {};
    try { g = JSON.parse(store.get('doorstep-glass') || '{}') || {}; } catch (e) { g = {}; }
    return { blur: clampN(g.blur, 0, 40, GLASS0.blur), opacity: clampN(g.opacity, 10, 95, GLASS0.opacity), edge: clampN(g.edge, 0, 100, GLASS0.edge) };
  }
  function glassApply(g) {
    const r = document.documentElement.style;
    r.setProperty('--gl-blur', g.blur + 'px');
    r.setProperty('--gl-op', g.opacity + '%');
    r.setProperty('--gl-edge', g.edge + '%');
  }
  glassApply(glassGet());
  document.addEventListener('animationend', (e) => { if (e.animationName === 'gIn' && e.target.classList.contains('reveal')) e.target.classList.remove('reveal'); });

  function glassPanel() {
    const old = $('#glassPanel');
    if (old) { old.remove(); return; }
    let g = glassGet();
    const save = (patch) => { g = Object.assign({}, g, patch); store.set('doorstep-glass', JSON.stringify(g)); glassApply(g); sync(); };
    const rows = [['blur', 'Blur', 0, 40, 'px'], ['opacity', 'Opacity', 10, 95, '%'], ['edge', 'Edge light', 0, 100, '%']].map(([k, label, lo, hi, unit]) => {
      const range = h('input', { type: 'range', min: lo, max: hi, step: 1, 'aria-label': label, oninput: () => save({ [k]: +range.value }) });
      const num = h('input', { type: 'number', min: lo, max: hi, step: 1, class: 'num', 'aria-label': label + ' (' + unit + ')', onchange: () => save({ [k]: clampN(num.value, lo, hi, g[k]) }) });
      return { k, range, num, el: h('label', { class: 'grange' }, h('span', { class: 'row' }, h('span', { class: 'grow' }, label), num, h('span', { class: 'muted small unit' }, unit)), range) };
    });
    const sync = () => rows.forEach((r) => { r.range.value = g[r.k]; if (document.activeElement !== r.num) r.num.value = g[r.k]; });
    const close = () => { panel.remove(); document.removeEventListener('keydown', esc); const b = $('.dglass'); if (b) b.focus(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const panel = h('aside', { id: 'glassPanel', class: 'glasspanel glass', 'aria-label': 'Glass appearance' },
      h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Glass appearance'), h('button', { class: 'ghost sm icon', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
      h('p', { class: 'muted small' }, 'How see-through the panels are. Only changes how the portal looks in this browser.'),
      h('div', { class: 'gsample', 'aria-hidden': 'true' }, h('span', { class: 'dot' }), 'Live preview'),
      h('div', { class: 'gpresets' }, GLASS_PRESETS.map(([name, v]) => h('button', { type: 'button', class: 'ghost sm', onclick: () => save(v) }, name))),
      rows.map((r) => r.el),
      h('button', { type: 'button', class: 'ghost sm wide', onclick: () => { store.del('doorstep-glass'); g = Object.assign({}, GLASS0); glassApply(g); sync(); } }, 'Reset'));
    document.body.append(panel);
    document.addEventListener('keydown', esc);
    sync();
    panel.querySelector('.gpresets button').focus();
  }

  // Visits (orange, with a soft fill) and taps (grey) per day as two lines; hover a day for its numbers.
  function lineChart(days, visits, taps) {
    const NS = 'http://www.w3.org/2000/svg';
    const max = Math.max(1, ...visits, ...taps);
    const n = days.length;
    const X = (i) => (n === 1 ? 300 : (i * 600) / (n - 1));
    const Y = (v) => 180 - (v / max) * 160;
    const el = (tag, at) => { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; };
    const svg = el('svg', { viewBox: '0 0 600 185', preserveAspectRatio: 'none', class: 'lchart', role: 'img',
      'aria-label': 'Visits and taps per day: ' + visits.reduce((a, b) => a + b, 0) + ' visits, ' + taps.reduce((a, b) => a + b, 0) + ' taps.' });
    const gid = 'lg' + Math.random().toString(36).slice(2, 8);
    const defs = el('defs', {});
    const grad = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
    grad.append(el('stop', { offset: 0, 'stop-color': 'var(--accent)', 'stop-opacity': '.28' }), el('stop', { offset: 1, 'stop-color': 'var(--accent)', 'stop-opacity': 0 }));
    defs.append(grad); svg.append(defs);
    [20, 100, 180].forEach((y) => svg.append(el('path', { d: 'M0 ' + y + ' H600', class: 'lgrid' })));
    const pts = (a) => a.map((v, i) => X(i) + ',' + Y(v)).join(' ');
    svg.append(el('path', { d: 'M' + X(0) + ' 185 ' + visits.map((v, i) => 'L' + X(i) + ' ' + Y(v)).join(' ') + ' L' + X(n - 1) + ' 185 Z', fill: 'url(#' + gid + ')' }));
    svg.append(el('polyline', { points: pts(taps), class: 'ltaps' }));
    svg.append(el('polyline', { points: pts(visits), class: 'lvisits' }));
    // One invisible column per day carries the tooltip.
    days.forEach((day, i) => {
      const w = 600 / n;
      const r = el('rect', { x: Math.max(0, X(i) - w / 2), y: 0, width: w, height: 185, class: 'lhit' });
      const t = el('title', {}); t.textContent = shortDay(day) + ': ' + plural(visits[i], 'visit', 'visits') + ', ' + plural(taps[i], 'tap', 'taps');
      r.append(t); svg.append(r);
    });
    const marks = Array.from(new Set(Array.from({ length: Math.min(n, 6) }, (_, i) => (n <= 6 ? i : Math.round((i * (n - 1)) / 5)))));
    return h('div', { class: 'lwrap' },
      h('div', { class: 'lyax' }, h('span', null, max.toLocaleString()), h('span', null, Math.round(max / 2).toLocaleString()), h('span', null, '0')),
      svg,
      h('div', { class: 'lxax' }, marks.map((i) => h('span', { style: 'left:' + (X(i) / 6) + '%;transform:' + (i === 0 && n > 1 ? 'none' : i === n - 1 && n > 1 ? 'translateX(-100%)' : 'translateX(-50%)') }, i === n - 1 ? 'Today' : shortDay(days[i])))));
  }

  let ovDays = +store.get('doorstep-ov-days') || 30;
  // The church at a glance: visits with the change from the period before, a visits-and-taps chart,
  // the pages ranked by visits, and the most-tapped buttons across all pages.
  function overview(church, pages, allStats, o) {
    if (![7, 30, 90].includes(ovDays)) ovDays = 30;
    const wrap = h('div', { class: 'overview' });
    const draw = () => {
      const all = lastDays(ovDays * 2);
      const days = all.slice(ovDays), before = all.slice(0, ovDays);
      const per = pages.map((p) => ({ p, now: sumStats(allStats && allStats.pages[p.id], days), was: sumStats(allStats && allStats.pages[p.id], before) }));
      const visits = days.map((_, i) => per.reduce((a, x) => a + x.now.views[i], 0));
      const taps = days.map((_, i) => per.reduce((a, x) => a + x.now.taps[i], 0));
      const tv = visits.reduce((a, b) => a + b, 0), tt = taps.reduce((a, b) => a + b, 0);
      const was = per.reduce((a, x) => a + x.was.totalViews, 0);
      const change = was ? Math.round(((tv - was) / was) * 100) : null;
      const span = { 7: 'last 7 days', 30: 'last 30 days', 90: 'last 3 months' }[ovDays];
      const ranked = per.slice().sort((a, b) => b.now.totalViews - a.now.totalViews || (b.p.publishedAt ? 1 : 0) - (a.p.publishedAt ? 1 : 0));
      const best = ranked[0] && ranked[0].now.totalViews ? ranked[0] : null;
      const btns = [];
      per.forEach((x) => x.now.buttons.forEach(([label, c]) => btns.push({ label, c, p: x.p })));
      btns.sort((a, b) => b.c - a.c);
      const topB = btns.slice(0, 5);
      const unseen = pages.filter((p) => o.responses[p.id] && o.responses[p.id].unseen);
      const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Time span' },
        [[7, 'Week'], [30, 'Month'], [90, '3 months']].map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(v === ovDays), onclick: () => { ovDays = v; store.set('doorstep-ov-days', v); draw(); } }, l)));
      const statusPill = (p) => {
        const pending = p.draftAt && (!p.publishedAt || p.draftAt > p.publishedAt);
        return p.publishedAt ? h('span', { class: 'pill ' + (pending ? 'warn' : 'ok') }, pending ? 'Unpublished edits' : 'Live') : h('span', { class: 'pill' }, 'Not published');
      };
      fill(wrap,
        unseen.length ? h('div', { class: 'ovnote glass' }, h('span', { 'aria-hidden': 'true' }, '📥'),
          h('span', { class: 'grow' }, h('b', null, plural(unseen.reduce((a, p) => a + o.responses[p.id].unseen, 0), 'new connect card answer', 'new connect card answers')), ' on ', unseen.map((p) => p.name).join(', ')),
          unseen.length === 1 ? h('button', { class: 'ghost sm', onclick: () => showResponses(church, unseen[0], o.reload) }, 'Read') : h('button', { class: 'ghost sm', onclick: () => o.go('pages') }, 'See pages')) : null,
        h('div', { class: 'ovgrid ovtop' },
          h('section', { class: 'card ovcard ovbig' },
            h('div', { class: 'ovtitle' }, h('span', null, 'Visits · ' + span), h('span', { class: 'ovicon', 'aria-hidden': 'true' }, '◎')),
            h('b', { class: 'bignum' }, tv.toLocaleString()),
            h('p', { class: 'muted small' }, change == null ? (tv ? 'No visits in the ' + ovDays + ' days before to compare.' : 'No visits yet in this time.')
              : [h('span', { class: change >= 0 ? 'up' : 'down' }, (change > 0 ? '+' : '') + change + '%'), ' compared with the ' + ovDays + ' days before']),
            h('div', { class: 'ovmini' },
              h('div', null, h('b', null, tt.toLocaleString()), h('span', { class: 'muted small' }, tt === 1 ? 'button tap' : 'button taps')),
              h('div', null, h('b', null, tv ? (Math.round((tt / tv) * 10) / 10).toLocaleString() : '0'), h('span', { class: 'muted small' }, 'taps per visit')),
              h('div', null, h('b', null, pages.filter((p) => p.publishedAt).length + ' of ' + pages.length), h('span', { class: 'muted small' }, 'pages live'))),
            best ? h('button', { class: 'ovbest', type: 'button', title: 'See tap stats', onclick: () => showStats(church, best.p) },
              h('span', { class: 'ovicon', 'aria-hidden': 'true' }, '★'),
              h('span', { class: 'grow ovname' }, h('b', null, best.p.name), h('span', { class: 'muted small' }, 'Most visited · ' + plural(best.now.totalViews, 'visit', 'visits'))),
              h('span', { class: 'arrow', 'aria-hidden': 'true' }, '↗')) : null),
          h('section', { class: 'card ovcard ovchart' },
            h('div', { class: 'ovtitle' }, h('h2', null, 'Visits and taps'), seg),
            h('div', { class: 'ovlegend' },
              h('div', null, h('span', null, h('i', { class: 'kv' }), 'Visits'), h('b', null, tv.toLocaleString())),
              h('div', null, h('span', null, h('i', { class: 'kt' }), 'Taps'), h('b', null, tt.toLocaleString()))),
            tv || tt ? lineChart(days, visits, taps) : h('div', { class: 'ovempty' }, h('b', null, 'No visits yet'), h('span', { class: 'muted small' }, 'Once a page is published and people open it, visits and taps show up here.')))),
        h('div', { class: 'ovgrid ovlow' },
          h('section', { class: 'card ovcard' },
            h('div', { class: 'ovtitle' }, h('h2', null, 'Pages'), h('button', { class: 'textbtn', type: 'button', onclick: () => o.go('pages') }, 'View all →')),
            ranked.length ? h('div', { class: 'ovrows' }, ranked.slice(0, 5).map((x) => h('div', { class: 'ovrow' },
              h('span', { class: 'ovicon' + (x.p.publishedAt ? ' live' : ''), 'aria-hidden': 'true' }, x.p.publishedAt ? '●' : '○'),
              h('span', { class: 'grow ovname' }, h('b', null, x.p.name), h('span', { class: 'muted small' }, x.p.draftAt ? 'Edited ' + when(x.p.draftAt) : 'Not edited yet')),
              statusPill(x.p),
              h('button', { class: 'ovcount', type: 'button', title: 'See tap stats', onclick: () => showStats(church, x.p) }, h('b', null, x.now.totalViews.toLocaleString()), h('span', { class: 'muted small' }, x.now.totalViews === 1 ? 'visit' : 'visits')),
              o.viewer ? null : h('a', { class: 'ghost sm btn', href: 'editor.html?church=' + enc(church.id) + '&page=' + enc(x.p.id) }, '✎ Edit'))))
              : h('div', { class: 'ovempty' }, h('b', null, 'No pages yet'), o.viewer ? null : h('button', { class: 'primary sm', onclick: () => newPage(church) }, '+ New page'))),
          h('section', { class: 'card ovcard' },
            h('div', { class: 'ovtitle' }, h('h2', null, 'Most-tapped buttons'), h('span', { class: 'muted small' }, plural(tt, 'tap', 'taps') + ' · ' + span)),
            topB.length ? h('div', { class: 'ovbtns' }, topB.map((b) => h('button', { type: 'button', class: 'ovbtn', title: 'See tap stats for ' + b.p.name, onclick: () => showStats(church, b.p) },
              h('span', { class: 'row' }, h('b', { class: 'grow ovlabel' }, b.label), h('span', null, Math.round((b.c / Math.max(1, tt)) * 100) + '%')),
              h('span', { class: 'ovtrack' }, h('i', { style: 'width:' + Math.max(3, (b.c / topB[0].c) * 100) + '%' })),
              h('span', { class: 'muted small' }, plural(b.c, 'tap', 'taps') + ' · ' + b.p.name))))
              : h('div', { class: 'ovempty' }, h('b', null, 'No taps yet'), h('span', { class: 'muted small' }, 'Buttons people tap on your pages are ranked here.')))),
        h('p', { class: 'ovfoot' }, h('span', null, h('i'), 'A visit counts once per person every 30 minutes. No cookies, and nothing about visitors is stored.')));
      wrap.querySelectorAll('.ovgrid > *').forEach((el, i) => { el.classList.add('reveal'); el.style.setProperty('--i', i); });
    };
    draw();
    return wrap;
  }

  // ── QR codes: static codes for a page or any link, made in this browser ──
  // The link itself goes in the code (nothing in between), so a printed code keeps working whatever happens
  // to DoorStep. The look is remembered per church in this browser; what it opens is kept while the portal is open.
  const QR0 = { fg: '#111111', bg: '#ffffff', eye: '#111111', eyeSame: true, clear: false, dots: 'square', corners: 'square', margin: 4, logo: null, logoSize: 22, logoBack: true, px: 1200 };
  const QR_THEMES = [['Classic', '#111111'], ['Orange', '#cc4410'], ['Green', '#15784f'], ['Navy', '#1e2a4a'], ['Plum', '#5b2a6e']];
  const qrWhat = {}; // per church: { kind, page, url, email, subject, phone, text }
  const slug = (s) => String(s || 'qr-code').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'qr-code';
  function download(blob, name) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // A logo picked from the computer, shrunk to at most 600px (SVG logos stay as they are if small).
  function readLogo(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Pick a picture file (PNG, JPG or SVG).'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read that file.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not open that picture.'));
        img.onload = () => {
          const w = img.naturalWidth || 300, hh = img.naturalHeight || 300;
          if (file.type === 'image/svg+xml' && fr.result.length < 150000) return resolve({ src: fr.result, w, h: hh });
          const k = Math.min(1, 600 / Math.max(w, hh));
          const cv = h('canvas', { width: Math.round(w * k), height: Math.round(hh * k) });
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve({ src: cv.toDataURL('image/png'), w: cv.width, h: cv.height });
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function qrMaker(church, pages) {
    const KEY = 'doorstep-qr-' + church.id;
    let st;
    try { st = Object.assign({}, QR0, JSON.parse(store.get(KEY) || '{}')); } catch (e) { st = Object.assign({}, QR0); }
    const live = pages.filter((p) => p.publishedAt);
    const w = qrWhat[church.id] || (qrWhat[church.id] = { kind: 'page', page: (live[0] || pages[0] || {}).id || '', url: '', email: '', subject: '', phone: '', text: '' });
    if (w.kind === 'page' && !pages.length) w.kind = 'url';
    const pageUrl = (id) => location.origin + '/view/' + church.id + '/' + id;
    const save = () => { const keep = Object.assign({}, st); try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch (e) { delete keep.logo; store.set(KEY, JSON.stringify(keep)); } };

    // What the code opens, as the text that goes in it.
    function content() {
      if (w.kind === 'page') return w.page ? pageUrl(w.page) : '';
      if (w.kind === 'url') { const u = w.url.trim(); return !u ? '' : /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u; }
      if (w.kind === 'email') return w.email.trim() ? 'mailto:' + w.email.trim() + (w.subject.trim() ? '?subject=' + enc(w.subject.trim()) : '') : '';
      if (w.kind === 'phone') { const p = w.phone.replace(/[^\d+]/g, ''); return p ? 'tel:' + p : ''; }
      return w.text;
    }
    function fileName() {
      const p = pages.find((x) => x.id === w.page);
      if (w.kind === 'page' && p) return 'qr-' + slug(p.name);
      if (w.kind === 'url') return 'qr-' + slug(w.url.replace(/^https?:\/\/(www\.)?/i, ''));
      return 'qr-' + slug(church.name + ' ' + w.kind);
    }
    const opts = () => ({ text: content(), fg: st.fg, bg: st.clear ? null : st.bg, eye: st.eyeSame ? st.fg : st.eye, dots: st.dots, corners: st.corners, margin: st.margin,
      logo: st.logo, logoSize: st.logoSize / 100, logoBack: st.logoBack });

    // ── Inputs ──
    const seg = (choices, cur, pick, label) => {
      const g = h('div', { class: 'seg', role: 'group', 'aria-label': label });
      const sync = (v) => g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      choices.forEach(([v, l]) => g.append(h('button', { type: 'button', 'data-v': v, onclick: () => { sync(v); pick(v); } }, l)));
      sync(cur);
      return g;
    };
    const colorField = (label, key, after) => {
      const pick = h('input', { type: 'color', value: st[key], 'aria-label': label + ' (picker)' });
      const txt = h('input', { type: 'text', class: 'mono hexbox', value: st[key].toUpperCase(), maxlength: 7, spellcheck: false, 'aria-label': label + ' (hex)' });
      const set = (v) => { st[key] = v; pick.value = v; if (document.activeElement !== txt) txt.value = v.toUpperCase(); if (after) after(); changed(); };
      pick.oninput = () => set(pick.value);
      txt.oninput = () => { const v = DSQR.hex(txt.value); txt.classList.toggle('bad', !v); if (v) set(v); };
      txt.onblur = () => { txt.value = st[key].toUpperCase(); txt.classList.remove('bad'); };
      const el = h('div', { class: 'qrcolor' }, h('span', { class: 'qrlabel' }, label), h('span', { class: 'row' }, pick, txt));
      el.setValue = (v) => { st[key] = v; pick.value = v; txt.value = v.toUpperCase(); };
      return el;
    };
    const numRange = (label, key, lo, hi, unit) => {
      const range = h('input', { type: 'range', min: lo, max: hi, step: 1, value: st[key], 'aria-label': label });
      const num = h('input', { type: 'number', min: lo, max: hi, step: 1, class: 'num', value: st[key], 'aria-label': label + ' (' + unit + ')' });
      range.oninput = () => { st[key] = +range.value; num.value = range.value; changed(); };
      num.onchange = () => { st[key] = clampN(num.value, lo, hi, st[key]); num.value = range.value = st[key]; changed(); };
      return h('label', { class: 'grange' }, h('span', { class: 'row' }, h('span', { class: 'grow' }, label), num, h('span', { class: 'muted small unit' }, unit)), range);
    };
    const field = (label, key, attrs) => h('label', null, label, h('input', Object.assign({ value: w[key], oninput: (e) => { w[key] = e.target.value; changed(); } }, attrs)));

    const whatBox = h('div', { class: 'qrwhat' });
    const kinds = [pages.length ? ['page', 'Your page'] : null, ['url', 'Web address'], ['email', 'Email'], ['phone', 'Phone'], ['text', 'Text']].filter(Boolean);
    function drawWhat() {
      const p = pages.find((x) => x.id === w.page);
      fill(whatBox,
        w.kind === 'page' ? [
          h('label', null, 'Page', h('select', { onchange: (e) => { w.page = e.target.value; drawWhat(); changed(); } },
            pages.map((x) => h('option', { value: x.id, selected: x.id === w.page }, x.name + (x.publishedAt ? '' : ' (not published yet)'))))),
          p && !p.publishedAt ? h('p', { class: 'qrnote warn' }, 'This page isn’t published yet. The code will open it once you publish.') : null,
          h('p', { class: 'muted small' }, 'Opens the page’s live link. If the page is on your website, you can use that address instead under ', h('button', { type: 'button', class: 'textbtn', onclick: () => { w.kind = 'url'; drawAll(); } }, 'Web address'), '.')]
        : w.kind === 'url' ? field('Web address', 'url', { type: 'url', placeholder: 'yourchurch.org/welcome', autocomplete: 'off', spellcheck: false })
        : w.kind === 'email' ? [field('Email address', 'email', { type: 'email', placeholder: 'office@yourchurch.org' }), field('Subject (optional)', 'subject', { placeholder: 'Prayer request' })]
        : w.kind === 'phone' ? field('Phone number', 'phone', { type: 'tel', placeholder: '+1 555 123 4567' })
        : h('label', null, 'Text', h('textarea', { rows: 3, maxlength: 1000, oninput: (e) => { w.text = e.target.value; changed(); } }, w.text)));
    }

    const eyeField = colorField('Corner squares', 'eye');
    const fgField = colorField('Dots', 'fg', () => { if (st.eyeSame) eyeField.setValue(st.fg); });
    const bgField = colorField('Background', 'bg');
    const eyeRow = h('div', { class: 'qreye' }, eyeField);
    const syncEye = () => { eyeRow.hidden = st.eyeSame; bgField.classList.toggle('off', st.clear); };
    const themes = h('div', { class: 'qrthemes' }, QR_THEMES.map(([name, c]) => h('button', { type: 'button', class: 'qrsw', title: name, 'aria-label': name + ' (' + c + ')', style: '--c:' + c,
      onclick: () => { st.fg = c; fgField.setValue(c); if (st.eyeSame) eyeField.setValue(c); changed(); } }, h('i'), name)));

    const logoIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif', hidden: true, onchange: act(async () => {
      const f = logoIn.files[0]; logoIn.value = '';
      if (!f) return;
      st.logo = await readLogo(f); drawLogo(); changed();
    }) });
    const logoBox = h('div', { class: 'qrlogo' });
    function drawLogo() {
      fill(logoBox,
        h('div', { class: 'row wrap' },
          st.logo ? h('img', { class: 'qrlogothumb', src: st.logo.src, alt: 'Logo' }) : null,
          h('button', { type: 'button', class: 'ghost sm', onclick: () => logoIn.click() }, st.logo ? 'Change logo' : '+ Add a logo'),
          st.logo ? h('button', { type: 'button', class: 'ghost sm danger', onclick: () => { st.logo = null; drawLogo(); changed(); } }, 'Remove') : null),
        st.logo ? [numRange('Logo size', 'logoSize', 10, 30, '%'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.logoBack, onchange: (e) => { st.logoBack = e.target.checked; changed(); } }), 'Clear the dots behind the logo')]
          : h('p', { class: 'muted small' }, 'Goes in the middle. Codes with a logo use extra error correction so they still scan.'),
        logoIn);
    }

    const settings = h('div', { class: 'qrside' },
      h('section', { class: 'card qrsec' },
        h('h2', null, 'What it opens'),
        seg(kinds, w.kind, (v) => { w.kind = v; drawWhat(); changed(); }, 'What the code opens'),
        whatBox),
      h('section', { class: 'card qrsec' },
        h('h2', null, 'Colors'),
        themes,
        h('div', { class: 'qrcolors' }, fgField, bgField),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.clear, onchange: (e) => { st.clear = e.target.checked; syncEye(); changed(); } }), 'See-through background'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !st.eyeSame, onchange: (e) => { st.eyeSame = !e.target.checked; if (st.eyeSame) eyeField.setValue(st.fg); syncEye(); changed(); } }), 'Different color for the corner squares'),
        eyeRow),
      h('section', { class: 'card qrsec' },
        h('h2', null, 'Shape'),
        h('div', { class: 'qrshape' }, h('span', { class: 'qrlabel' }, 'Dots'), seg([['square', 'Squares'], ['rounded', 'Rounded'], ['dots', 'Dots']], st.dots, (v) => { st.dots = v; changed(); }, 'Dot shape')),
        h('div', { class: 'qrshape' }, h('span', { class: 'qrlabel' }, 'Corners'), seg([['square', 'Square'], ['rounded', 'Rounded'], ['round', 'Round']], st.corners, (v) => { st.corners = v; changed(); }, 'Corner shape')),
        numRange('Border', 'margin', 0, 8, 'dots')),
      h('section', { class: 'card qrsec' }, h('h2', null, 'Logo'), logoBox),
      h('button', { type: 'button', class: 'textbtn qrreset', onclick: () => { const lg = st.logo; st = Object.assign({}, QR0, { logo: lg }); save(); drawAll(); } }, 'Reset colors and shape'));

    // ── Preview and downloads ──
    const art = h('div', { class: 'qrart' });
    const meta = h('div', { class: 'qrmeta' });
    const status = h('div', { class: 'qrstatus', role: 'status' });
    const pxNum = h('input', { type: 'number', min: 200, max: 4000, step: 100, class: 'num', value: st.px, 'aria-label': 'PNG size in pixels',
      onchange: () => { st.px = clampN(pxNum.value, 200, 4000, st.px); pxNum.value = st.px; save(); } });
    let ok = false;
    const need = () => { if (!ok) { toast('Fill in what the code opens first.'); return false; } return true; };
    const dlPng = h('button', { type: 'button', class: 'primary', onclick: act(async () => { if (need()) download(await DSQR.png(opts(), st.px), fileName() + '.png'); }) }, '⬇ PNG');
    const dlSvg = h('button', { type: 'button', class: 'ghost', title: 'Sharp at any size: best for printing', onclick: () => { if (need()) download(new Blob([DSQR.svg(opts(), st.px).svg], { type: 'image/svg+xml' }), fileName() + '.svg'); } }, '⬇ SVG');
    const cpImg = window.ClipboardItem && navigator.clipboard && navigator.clipboard.write ? h('button', { type: 'button', class: 'ghost', title: 'Copy the picture to paste into a bulletin or slide', onclick: act(async () => {
      if (!need()) return;
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': DSQR.png(opts(), st.px) })]); toast('QR code copied. Paste it into your bulletin or slides.'); }
      catch (e) { toast('Your browser wouldn’t copy the picture. Download it instead.'); }
    }) }, 'Copy') : null;
    const preview = h('aside', { class: 'card qrprev' },
      art, status, meta,
      h('div', { class: 'qrdl' }, dlPng, dlSvg, cpImg),
      h('label', { class: 'qrpx' }, h('span', { class: 'grow' }, 'PNG size'), pxNum, h('span', { class: 'muted small' }, 'px')),
      h('p', { class: 'muted small qrfoot' }, 'Static code: the address is in the code itself, so it keeps working forever, with no account or subscription.'));

    let t1, t2, gen = 0;
    function changed() { save(); clearTimeout(t1); t1 = setTimeout(redraw, 60); }
    function redraw() {
      const o = opts();
      const my = ++gen;
      clearTimeout(t2);
      art.classList.toggle('clear', st.clear);
      if (!o.text) {
        ok = false;
        fill(art, h('div', { class: 'qrempty' }, h('b', { 'aria-hidden': 'true' }, '▦'), h('span', null, 'Fill in what the code opens to see it here.')));
        fill(status); fill(meta);
        return;
      }
      let r;
      try { r = DSQR.svg(o); }
      catch (e) {
        ok = false;
        fill(art, h('div', { class: 'qrempty' }, h('b', { 'aria-hidden': 'true' }, '!'), h('span', null, 'That’s too much to fit in a QR code. Try a shorter link or less text.')));
        fill(status); fill(meta);
        return;
      }
      ok = true;
      art.innerHTML = r.svg;
      // Things that make codes hard to scan, worst first.
      const warn = [];
      const bgc = st.clear ? '#ffffff' : st.bg;
      const c1 = DSQR.contrast(st.fg, bgc), c2 = DSQR.contrast(o.eye, bgc);
      if (DSQR.lum(st.fg) > DSQR.lum(bgc)) warn.push('The dots are lighter than the background. Many phones can’t read codes like that.');
      else if (Math.min(c1, c2) < 3) warn.push('The colors are close together. Use darker dots or a lighter background.');
      if (st.clear && DSQR.lum(st.fg) > 0.4) warn.push('See-through codes need dark dots and a light place to sit.');
      if (st.margin < 2) warn.push('A border of at least 2 dots helps phones find the code.');
      if (r.version > 10) warn.push('Lots of tiny dots. A shorter link makes a code that scans more easily from afar.');
      fill(meta,
        h('div', { class: 'mono qrtext', title: o.text }, o.text),
        warn.map((x) => h('p', { class: 'qrnote warn' }, x)));
      fill(status, h('span', { class: 'muted small' }, 'Checking it scans…'));
      t2 = setTimeout(async () => {
        const res = await DSQR.check(o).catch(() => null);
        if (my !== gen) return;
        fill(status, res === true ? h('span', { class: 'pill ok' }, '✓ Scans') : res === false ? h('span', { class: 'pill bad' }, '⚠ Didn’t scan in our check. Try a smaller logo or stronger colors.') : null);
      }, 350);
    }
    function drawAll() {
      const fresh = qrMaker(church, pages);
      root.replaceWith(fresh);
    }
    const root = h('div', { class: 'qrmaker' }, h('div', { class: 'head flat qrhead' }, h('h2', null, 'QR codes'), h('span', { class: 'muted small' }, 'Make a code for a page or any link, then download it for print.')), h('div', { class: 'qrgrid' }, settings, preview));
    drawWhat(); drawLogo(); syncEye(); redraw();
    return root;
  }

  // ── New page: pick a template (previews side by side) or start from scratch ──
  // Templates offered for new pages: the admin-edited ones (Templates panel) once there are any,
  // otherwise the editor's built-in starters. Each is { key, name, desc, project(), server }.
  async function templateChoices() {
    try {
      const r = await api('/templates?full=1');
      const mine = r.templates.filter((t) => !t.hidden && t.project);
      if (mine.length) return mine.map((t) => ({ key: t.id, name: t.name, desc: t.desc, project: () => t.project, server: true }));
    } catch (e) { /* fall back to the built-in starters */ }
    const TD = window.TD;
    if (!TD || !TD.TEMPLATES) return [];
    return Object.keys(TD.TEMPLATES).filter((k) => k !== 'blank' && (me.admin || !['bethany', 'tour'].includes(k)))
      .map((k) => ({ key: k, name: TD.TEMPLATES[k].name, desc: TD.TEMPLATES[k].desc, project: () => TD.TEMPLATES[k].build(), server: false }));
  }
  // A small picture of a page (the editor's own renderer in a sandboxed frame).
  function preview(project) {
    const f = h('iframe', { tabindex: '-1', 'aria-hidden': 'true', loading: 'lazy' });
    f.setAttribute('sandbox', 'allow-scripts');
    try { f.srcdoc = window.TD.previewDoc(window.TD.normalize(JSON.parse(JSON.stringify(project)))); } catch (e) { /* preview is a nice-to-have */ }
    return h('div', { class: 'tplprev' }, f);
  }

  // ── New page: pick a template (previews side by side) or start from scratch ──
  async function newPage(church) {
    const dlg = $('#dlg');
    const name = h('input', { type: 'text', maxlength: 80, placeholder: 'Page name, e.g. Sunday tap tag', autocomplete: 'off' });
    const grid = h('div', { class: 'tplgrid' }, h('p', { class: 'muted' }, 'Loading templates…'));
    fill($('#dlgBody'), h('div', { class: 'dlgform newpage' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'New page'), h('button', { class: 'ghost sm', onclick: () => dlg.close() }, '✕')),
      h('label', null, 'Name', name),
      h('p', { class: 'muted small' }, 'Start from a template or from scratch. You can change everything after; photos and links in templates are examples to replace.'),
      grid));
    dlg.onclose = null;
    dlg.showModal();
    name.focus();
    const create = async (t, btn) => {
      btn.disabled = true;
      try {
        const body = { name: name.value.trim() || (t ? t.name : 'New page') };
        if (t && t.server) body.template = t.key;
        const p = await api('/churches/' + enc(church.id) + '/pages', { method: 'POST', body });
        location.href = 'editor.html?church=' + enc(church.id) + '&page=' + enc(p.id) + (t && !t.server ? '&template=' + enc(t.key) : '');
      } catch (e) { toast(e.message); btn.disabled = false; }
    };
    const blank = h('button', { class: 'tplcard', onclick: () => create(null, blank) }, h('div', { class: 'tplprev blank' }, h('span', null, '+')), h('b', null, 'Start from scratch'), h('small', null, 'An empty page. Add blocks one at a time.'));
    const list = await templateChoices();
    fill(grid, blank, list.map((t) => {
      const b = h('button', { class: 'tplcard', onclick: () => create(t, b) }, preview(t.project()), h('b', null, t.name), t.desc ? h('small', null, t.desc) : null);
      return b;
    }));
  }

  // ── Admin: the starter templates churches pick from ────────────────────
  async function drawTemplates() {
    const main = $('#main');
    document.title = 'Templates · DoorStep';
    let list;
    try {
      list = (await api('/templates?full=1')).templates;
      if (!list.length && window.TD && window.TD.TEMPLATES) {
        // First visit: save the built-in starters so they can be edited here.
        const TD = window.TD;
        const items = Object.keys(TD.TEMPLATES).filter((k) => k !== 'blank')
          .map((k) => ({ name: TD.TEMPLATES[k].name, desc: TD.TEMPLATES[k].desc || '', project: TD.TEMPLATES[k].build(), hidden: k === 'bethany' || k === 'tour' }));
        await api('/templates/seed', { method: 'POST', body: { items } });
        list = (await api('/templates?full=1')).templates;
      }
    } catch (e) { fill(main, h('div', { class: 'card center' }, h('p', null, e.message))); return; }
    if (route() !== 'templates') return;
    const reload = () => drawTemplates();
    const T = (id) => '/templates/' + enc(id);
    const move = async (i, d) => {
      const ids = list.map((t) => t.id);
      const j = i + d;
      if (j < 0 || j >= ids.length) return;
      ids.splice(j, 0, ids.splice(i, 1)[0]);
      await api('/templates/order', { method: 'POST', body: { ids } }); reload();
    };
    const card = (t, i) => h('div', { class: 'card tplitem' + (t.hidden ? ' off' : '') },
      t.project ? preview(t.project) : h('div', { class: 'tplprev blank' }, h('span', null, '?')),
      h('div', { class: 'pagehead' }, h('b', null, t.name), t.hidden ? h('span', { class: 'pill' }, 'Hidden') : h('span', { class: 'pill ok' }, 'Shown')),
      h('div', { class: 'muted small' }, t.desc || 'No description'),
      h('div', { class: 'muted small' }, t.draftAt ? 'Edited ' + when(t.draftAt) + (t.draftBy ? ' by ' + t.draftBy : '') : ''),
      h('div', { class: 'row wrap' },
        h('a', { class: 'primary btn', href: 'editor.html?tpl=' + enc(t.id) }, '✎ Edit'),
        h('button', { class: 'ghost', title: 'Move earlier', disabled: i === 0, onclick: act(() => move(i, -1)) }, '←'),
        h('button', { class: 'ghost', title: 'Move later', disabled: i === list.length - 1, onclick: act(() => move(i, 1)) }, '→'),
        h('details', { class: 'more' }, h('summary', { class: 'ghost' }, '•••'),
          h('div', { class: 'menu' },
            h('button', { onclick: act(async () => {
              const v = await ask('Template details', [
                { k: 'name', l: 'Name', value: t.name, max: 80 },
                { k: 'desc', l: 'Description', value: t.desc, max: 200, required: false, hint: 'Shown under the preview when someone makes a new page.' },
              ], 'Save');
              if (!v) return;
              await api(T(t.id), { method: 'PATCH', body: v }); reload();
            }) }, 'Name and description'),
            h('button', { onclick: act(async () => { await api(T(t.id), { method: 'PATCH', body: { hidden: !t.hidden } }); reload(); }) }, t.hidden ? 'Show to churches' : 'Hide from churches'),
            h('button', { onclick: act(async () => {
              const r = await api('/templates', { method: 'POST', body: { name: t.name + ' copy', desc: t.desc, copyFrom: t.id, hidden: true } }); reload();
              toast('Copied as a hidden template');
              return r;
            }) }, 'Duplicate'),
            h('button', { class: 'danger', onclick: act(async () => {
              if (!confirm('Delete the “' + t.name + '” template? Pages already made from it stay as they are.')) return;
              await api(T(t.id), { method: 'DELETE' }); reload();
            }) }, 'Delete')))));
    fill(main,
      h('div', { class: 'head' }, h('h1', null, 'Templates'), h('div', { class: 'grow' }),
        h('button', { class: 'primary', onclick: act(async () => {
          const v = await ask('New template', [
            { k: 'name', l: 'Name', placeholder: 'Christmas Eve', max: 80 },
            { k: 'desc', l: 'Description', max: 200, required: false },
            { k: 'from', l: 'Start from', value: '', options: [['', 'A blank page']].concat(list.map((t) => [t.id, 'A copy of “' + t.name + '”'])) },
          ], 'Create', 'New templates start hidden, so churches don’t see them until you choose Show.');
          if (!v) return;
          const r = await api('/templates', { method: 'POST', body: { name: v.name, desc: v.desc, copyFrom: v.from || undefined, hidden: true } });
          location.href = 'editor.html?tpl=' + enc(r.id);
        }) }, '+ New template')),
      h('p', { class: 'muted' }, 'These are the starting points every church sees when they click + New page, in this order. Editing a template only changes new pages; pages made earlier stay as they are. You can also turn any church page into a template from its ••• menu.'),
      list.length ? h('div', { class: 'grid tplpanel' }, list.map(card)) : h('div', { class: 'card center muted' }, 'No templates yet.'));
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
    try { data = await api(cbase(church) + '/stats?days=' + n); }
    catch (e) { fill(body, h('p', null, e.message)); return; }
    const days = lastDays(n);
    const t = sumStats(data.pages[p.id], days);
    const maxB = t.buttons.length ? t.buttons[0][1] : 1;
    fill(body,
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, p.name),
        h('select', { class: 'sm', onchange: (e) => showStats(church, p, +e.target.value) },
          [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([v, l]) => h('option', { value: v, selected: v === n }, l))),
        h('button', { type: 'button', class: 'ghost sm', title: 'Download a PDF report for this page', onclick: () => reportDialog(church, [p], {}) }, '⤓ PDF')),
      // Wide screens: totals, chart and buttons on the left, the activity log on the right.
      h('div', { class: 'statcols' },
        h('div', { class: 'statcol' },
          h('div', { class: 'statbig' },
            h('div', null, h('b', null, t.totalViews.toLocaleString()), h('span', { class: 'muted small' }, t.totalViews === 1 ? 'visit' : 'visits')),
            h('div', null, h('b', null, t.totalTaps.toLocaleString()), h('span', { class: 'muted small' }, t.totalTaps === 1 ? 'button tap' : 'button taps')),
            h('div', null, h('b', null, t.totalViews ? Math.round((t.totalTaps / t.totalViews) * 10) / 10 : 0), h('span', { class: 'muted small' }, 'taps per visit'))),
          h('div', { class: 'chart' }, bars(days, t.views, true),
            h('div', { class: 'row muted small' }, h('span', { class: 'grow' }, shortDay(days[0])), h('span', null, 'Today'))),
          h('h3', null, 'Buttons tapped'),
          t.buttons.length
            ? h('div', { class: 'taplist' }, t.buttons.map(([label, c]) => tapRow(church, p, label, c, maxB)))
            : h('p', { class: 'muted' }, 'No taps in this time yet.')),
        h('div', { class: 'statcol' }, activityLog(church, p))),
      h('p', { class: 'muted small' }, 'A visit counts once per person every 30 minutes. Visits are counted on the site’s code block and the live link. No cookies are used and nothing about visitors is stored.'),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Close')));
  }

  // ── PDF report: a church's (or one page's) tap stats for a chosen period ──
  // The PDF is drawn in this browser by report.js (loaded the first time). Connect card answers are
  // only counted when this person may read them: not for "Stats only" people, and on a stats link
  // only when the link includes answers. Only counts go in the PDF, never what people wrote.
  let reportJs = null;
  const loadReport = () => reportJs || (reportJs = new Promise((res, rej) => {
    if (window.DoorStepReport) return res(window.DoorStepReport);
    const s = h('script', { src: 'report.js' });
    s.onload = () => res(window.DoorStepReport);
    s.onerror = () => { reportJs = null; rej(new Error('Could not load the report maker. Check your connection and try again.')); };
    document.head.append(s);
  }));
  const REPORT_SPANS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last 12 months'],
    ['tm', 'This month so far'], ['lm', 'Last month'], ['ty', 'This year so far'], ['c', 'Pick dates…']];
  // From and to dates (both included) for a span; stats go back 365 days, today included.
  function reportRange(k, cFrom, cTo) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const first = new Date(today); first.setDate(first.getDate() - 364);
    const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    let a, b = new Date(today);
    if (/^\d+$/.test(k)) a = back(+k - 1);
    else if (k === 'tm') a = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    else if (k === 'lm') { a = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12); b = new Date(today.getFullYear(), today.getMonth(), 0, 12); }
    else if (k === 'ty') a = new Date(today.getFullYear(), 0, 1, 12);
    else { a = cFrom ? new Date(cFrom + 'T12:00:00') : back(29); b = cTo ? new Date(cTo + 'T12:00:00') : new Date(today); }
    if (b > today) b = new Date(today);
    if (a > b) a = new Date(b);
    const cut = a < first; // older than DoorStep keeps
    if (cut) a = new Date(first);
    const n = Math.round((b - a) / 864e5) + 1;
    // Compare with the same number of days just before, if DoorStep still has them.
    const ce = new Date(a); ce.setDate(ce.getDate() - 1);
    const cs = new Date(a); cs.setDate(cs.getDate() - n);
    return { from: ymd(a), to: ymd(b), n, cut, first: ymd(first), today: ymd(today), cmp: cs >= first ? { from: ymd(cs), to: ymd(ce) } : null };
  }

  function reportDialog(church, pages, o) {
    o = o || {};
    loadReport().catch(() => { /* tried again on Download */ });
    const dlg = $('#dlg');
    const saved = store.get('doorstep-report-span') || '30';
    const spanSel = h('select', { name: 'span' }, REPORT_SPANS.map(([v, l]) => h('option', { value: v, selected: v === saved }, l)));
    const r0 = reportRange('30');
    const fromIn = h('input', { type: 'date', name: 'from', value: r0.from, min: r0.first, max: r0.today });
    const toIn = h('input', { type: 'date', name: 'to', value: r0.today, min: r0.first, max: r0.today });
    const custom = h('div', { class: 'row wrap reportdates' }, h('label', null, 'From', fromIn), h('label', null, 'To', toIn));
    const pageSel = h('select', { name: 'page' }, h('option', { value: '' }, 'All pages'), pages.map((p) => h('option', { value: p.id, selected: p.id === o.page }, p.name)));
    const detailsBox = h('input', { type: 'checkbox', checked: store.get('doorstep-report-details') === '1' });
    const answersBox = o.answers ? h('input', { type: 'checkbox', checked: store.get('doorstep-report-answers') !== '0' }) : null;
    const summary = h('p', { class: 'muted small' });
    const detailsRow = h('label', { class: 'check' }, detailsBox, h('span', null, 'A page for each page', h('span', { class: 'muted small' }, 'Adds each page’s own chart and every button tapped.')));
    const sync = () => {
      custom.hidden = spanSel.value !== 'c';
      detailsRow.hidden = !!pageSel.value || pages.length < 2;
      const r = reportRange(spanSel.value, fromIn.value, toIn.value);
      summary.textContent = shortDay(r.from) + (r.from === r.to ? '' : ' – ' + new Date(r.to + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }))
        + ' · ' + plural(r.n, 'day', 'days') + (r.cmp ? ', compared with the ' + r.n + ' days before.' : '.')
        + (r.cut ? ' DoorStep keeps one year of stats, so it starts on ' + shortDay(r.first) + '.' : '');
    };
    [spanSel, fromIn, toIn, pageSel].forEach((el) => el.addEventListener('change', sync));
    const go = h('button', { type: 'button', class: 'primary', onclick: act(async () => {
      const r = reportRange(spanSel.value, fromIn.value, toIn.value);
      const label = (REPORT_SPANS.find((x) => x[0] === spanSel.value) || [])[1];
      store.set('doorstep-report-span', spanSel.value);
      store.set('doorstep-report-details', detailsBox.checked ? '1' : '0');
      if (answersBox) store.set('doorstep-report-answers', answersBox.checked ? '1' : '0');
      const chosen = pageSel.value ? pages.filter((p) => p.id === pageSel.value) : pages;
      go.textContent = 'Making the PDF…';
      try {
        const [R, stats] = await Promise.all([loadReport(), api(cbase(church) + '/stats?days=365')]);
        let answers = null;
        if (answersBox && answersBox.checked) {
          answers = {};
          const lo = new Date(r.from + 'T00:00:00'), hi = new Date(r.to + 'T00:00:00'); hi.setDate(hi.getDate() + 1);
          await Promise.all(chosen.filter((p) => o.responses && o.responses[p.id] && o.responses[p.id].total).map(async (p) => {
            const list = (await api(cbase(church) + '/responses?page=' + enc(p.id))).responses || [];
            answers[p.id] = list.filter((x) => { const t = new Date(x.createdAt); return t >= lo && t < hi; }).length;
          }));
        }
        const blob = await R.make({ church, pages: chosen, stats, from: r.from, to: r.to, cmp: r.cmp, answers, details: detailsBox.checked && !pageSel.value,
          span: spanSel.value === 'c' ? plural(r.n, 'day', 'days') : label + (r.cut ? ' (from ' + shortDay(r.first) + ')' : '') });
        download(blob, slug(church.name) + (pageSel.value ? '-' + slug(chosen[0].name) : '') + '-stats-' + r.from + (r.from === r.to ? '' : '-to-' + r.to) + '.pdf');
        toast('PDF report downloaded');
        dlg.close();
      } finally { go.textContent = '⤓ Download PDF'; }
    }) }, '⤓ Download PDF');
    fill($('#dlgBody'), h('form', { class: 'dlgform reportdlg', onsubmit: (e) => e.preventDefault() },
      h('h2', null, 'PDF report'),
      h('p', { class: 'muted' }, 'A printable summary of visits and button taps, ready to send to your team or share at a meeting.'),
      h('label', null, 'Time period', spanSel),
      custom,
      pages.length > 1 ? h('label', null, 'Pages', pageSel) : null,
      summary,
      detailsRow,
      answersBox ? h('label', { class: 'check' }, answersBox, h('span', null, 'Count connect card answers', h('span', { class: 'muted small' }, 'Only how many came in. What people wrote stays out of the PDF.'))) : null,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancel'), go)));
    sync();
    dlg.onclose = null;
    if (!dlg.open) dlg.showModal();
  }

  // One "Buttons tapped" row: name, bar, count, and a button that shows that button on the page.
  function tapRow(church, p, label, c, maxB) {
    return h('div', { class: 'tapRow' },
      h('span', { class: 'tapLabel', title: label }, label),
      h('span', { class: 'tapBar' }, h('i', { style: 'width:' + Math.max(3, (c / maxB) * 100) + '%' })),
      h('b', null, c.toLocaleString()),
      h('button', { type: 'button', class: 'ghost sm tapShow', title: 'Show “' + label + '” on the page', 'aria-label': 'Show “' + label + '” on the page', onclick: () => showButton(church, p, label, c) }, h('span', { 'aria-hidden': 'true' }, '◎'), h('span', { class: 'lbl' }, 'Show')));
  }

  // ── Show a tapped button on its page ────────────────────────────────
  // Taps are counted by the button's text (public/embed.js tapLabel), so this loads the live page in
  // a locked-down frame (scripts only, no access to the portal, no stats counted, taps do nothing)
  // and circles every button with that name, opening its pop-up first if it lives in one.
  let btnMsg = null;
  async function showButton(church, p, label, count) {
    let dlg = $('#btnDlg');
    if (!dlg) { dlg = h('dialog', { id: 'btnDlg', class: 'btndlg' }); document.body.append(dlg); }
    if (btnMsg) window.removeEventListener('message', btnMsg);
    const status = h('p', { class: 'muted small btnStatus' }, 'Finding the button…');
    const nav = h('div', { class: 'row btnNav', hidden: true });
    const stage = h('div', { class: 'btnStage' });
    fill(dlg, h('div', { class: 'dlgform' },
      h('div', { class: 'row' },
        h('div', { class: 'grow', style: 'min-width:0' },
          h('h2', { class: 'btnTitle', title: label }, label),
          h('p', { class: 'muted small' }, p.name + (count ? ' · ' + plural(count, 'tap', 'taps') + ' in this time' : ''))),
        h('button', { type: 'button', class: 'ghost icon', 'aria-label': 'Close', onclick: () => dlg.close() }, '✕')),
      h('div', { class: 'row' }, h('div', { class: 'grow' }, status), nav),
      stage));
    dlg.onclose = () => { if (btnMsg) window.removeEventListener('message', btnMsg); btnMsg = null; stage.replaceChildren(); };
    if (!dlg.open) dlg.showModal();
    if (!p.publishedAt) { status.textContent = 'This page isn’t live right now, so there’s no page to show the button on.'; return; }
    let html;
    try {
      const r = await fetch('/p/' + enc(church.id) + '/' + enc(p.id), { cache: 'no-cache' });
      if (!r.ok) throw new Error();
      html = await r.text();
    } catch (e) { status.textContent = 'The page couldn’t be loaded. Please try again.'; return; }
    if (!dlg.open) return;
    const frame = h('iframe', { class: 'btnFrame', title: 'Page preview', sandbox: 'allow-scripts', srcdoc: btnDoc(html, label) });
    let found = 0, at = 0;
    const go = (i) => { at = (i + found) % found; frame.contentWindow.postMessage({ dsShow: at }, '*'); drawNav(); };
    function drawNav() {
      nav.hidden = found < 2;
      fill(nav, h('button', { type: 'button', class: 'ghost sm', 'aria-label': 'Previous one', onclick: () => go(at - 1) }, '‹'),
        h('span', { class: 'muted small' }, (at + 1) + ' of ' + found),
        h('button', { type: 'button', class: 'ghost sm', 'aria-label': 'Next one', onclick: () => go(at + 1) }, '›'));
    }
    btnMsg = (e) => {
      if (e.source !== frame.contentWindow || !e.data || e.data.dsFound == null) return;
      found = e.data.dsFound;
      if (!found) status.textContent = 'This button isn’t on the page anymore. It may have been renamed or removed since these taps.';
      else if (e.data.dsHidden) status.textContent = 'This button is on the page but hidden right now (for example in a closed section or another tab). Its spot is outlined.';
      else if (found > 1) status.textContent = found + ' buttons on the page have this name, and their taps are counted together. Use the arrows to see each one.';
      else status.textContent = e.data.dsSheet ? 'This button is inside a pop-up, so the pop-up is opened for you.' : 'Here it is, circled on the page.';
      drawNav();
    };
    window.addEventListener('message', btnMsg);
    stage.replaceChildren(frame);
  }
  // The live page as a standalone document, plus a script that finds and circles the button.
  function btnDoc(html, label) {
    const js = String.raw`(function(){
var LABEL=` + JSON.stringify(label).replace(/</g, '\\u003c') + String.raw`,D=document,W=window,list=[],cur=-1,ring,allow=false;
function firstLine(el){var t=(el.innerText||el.textContent||'').split('\n'),any='';for(var i=0;i<t.length;i++){var s=t[i].trim();if(s&&/[0-9A-Za-zÀ-￿]/.test(s.replace(/[ -⯿\uD800-\uDFFF️]/g,'')))return s;any=any||s;}return any;}
function tapLabel(t){var l=firstLine(t)||t.getAttribute('aria-label')||t.getAttribute('title')||'';var row=t.classList.contains('td-copy-btn')&&t.closest('.td-copy-row');if(row){var w=row.querySelector('.td-tag')||row.querySelector('.td-copy-val');if(w)l+=': '+firstLine(w);}return l.replace(/\s+/g,' ').trim().slice(0,60)||'Button';}
function counted(t){return t.classList.contains('td-tap')||!/^#/.test(t.getAttribute('href')||'#');}
function shown(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
function find(){var out=[],h=D.documentElement;h.classList.add('ds-measure');D.querySelectorAll('.td-tap,a[href]').forEach(function(t){if(counted(t)&&tapLabel(t)===LABEL)out.push(t);});h.classList.remove('ds-measure');
out.sort(function(a,b){return (shown(b)?1:0)-(shown(a)?1:0);});return out;}
D.addEventListener('click',function(e){if(allow)return;if(e.target.closest('[data-td-close]'))return;e.preventDefault();e.stopPropagation();},true);
D.addEventListener('submit',function(e){e.preventDefault();e.stopPropagation();},true);
W.open=function(){return null;};
function track(){if(!ring)return;var t=list[cur];if(t){var r=t.getBoundingClientRect();if(r.width||r.height){ring.style.display='block';ring.style.left=(r.left-6)+'px';ring.style.top=(r.top-6)+'px';ring.style.width=(r.width+12)+'px';ring.style.height=(r.height+12)+'px';}else ring.style.display='none';}requestAnimationFrame(track);}
function show(i){cur=i;var t=list[i],sheet=false;if(!t)return;
var d=t.parentElement;while(d){if(d.tagName==='DETAILS')d.open=true;d=d.parentElement;}
var s=t.closest('.td-sheet');if(s&&!s.classList.contains('open')&&/^td-sheet-/.test(s.id)){var k=s.id.slice(9),o=D.querySelector('[data-td-act="sheet"][data-td-sheet="'+k.replace(/"/g,'')+'"]');allow=true;try{if(o)o.click();}finally{allow=false;}if(!s.classList.contains('open')){s.classList.add('open');var bd=D.getElementById('td-bd');if(bd)bd.classList.add('open');}sheet=true;}
else if(!s){D.querySelectorAll('.td-sheet.open,.td-bd.open').forEach(function(e){e.classList.remove('open');});}
if(!ring){ring=D.createElement('div');ring.id='ds-ring';D.body.appendChild(ring);requestAnimationFrame(track);}
ring.classList.remove('ds-pulse');void ring.offsetWidth;ring.classList.add('ds-pulse');
setTimeout(function(){t.scrollIntoView({block:'center',behavior:'smooth'});},sheet?380:30);
return sheet;}
function report(sheet){parent.postMessage({dsFound:list.length,dsHidden:list.length&&!shown(list[0])&&!sheet,dsSheet:!!sheet},'*');}
function start(){var tries=0;(function look(){list=find();if(list.length||tries++>25){report(list.length?show(0):false);if(list.length&&!shown(list[0]))setTimeout(function(){report(false);},450);return;}setTimeout(look,200);})();}
W.addEventListener('message',function(e){if(e.source===parent&&e.data&&typeof e.data.dsShow==='number'&&list[e.data.dsShow])report(show(e.data.dsShow));});
if(D.readyState==='complete')setTimeout(start,150);else W.addEventListener('load',function(){setTimeout(start,150);});
})();`;
    const css = '#ds-ring{position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ff5e1f;border-radius:10px;box-shadow:0 0 0 4px rgba(255,94,31,.3),0 0 0 9999px rgba(20,20,20,.42);display:none;transition:left .25s,top .25s,width .25s,height .25s}' +
      '#ds-ring.ds-pulse{animation:ds-pulse 1s ease-out 3}@keyframes ds-pulse{0%{box-shadow:0 0 0 0 rgba(255,94,31,.6),0 0 0 9999px rgba(20,20,20,.42)}100%{box-shadow:0 0 0 14px rgba(255,94,31,0),0 0 0 9999px rgba(20,20,20,.42)}}' +
      '.ds-measure .td-sheet,.ds-measure .td-sheet *{visibility:visible!important}' + // closed pop-ups have no text to read otherwise
      '@media (prefers-reduced-motion:reduce){#ds-ring{transition:none}#ds-ring.ds-pulse{animation:none}}';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<base href="' + location.origin + '/"><style>' + css + '</style></head><body style="margin:0"><div class="tapdot-page" data-loaded="1">' + html +
      '</div><script>' + js.replace(/<\/script/gi, '<\\/script') + '</' + 'script></body></html>';
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
    try { list = (await api(cbase(church) + '/responses?page=' + enc(p.id))).responses; }
    catch (e) { fill(body, h('p', null, e.message)); return; }
    if (!SHARE) api('/churches/' + enc(church.id) + '/responses/seen', { method: 'POST', body: { page: p.id } }).catch(() => { /* stays "new" */ });
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
          SHARE ? null : h('button', { class: 'ghost sm danger', title: 'Delete this answer', onclick: act(async () => {
            if (!confirm('Delete this answer for good?')) return;
            await api('/churches/' + enc(church.id) + '/responses/' + enc(r.id), { method: 'DELETE' });
            list = list.filter((x) => x !== r); draw();
          }) }, '🗑')),
        h('dl', null, r.answers.filter((a) => a.a).map((a) => [h('dt', null, a.q), h('dd', null, a.a)]))))) : h('p', { class: 'muted' }, 'No answers yet.'),
      h('div', { class: 'row end' }, h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Close')));
    draw();
  }

  // ── Activity log: every visit and tap on one day, with times ────────
  // Taps from the same browser tab are shown under the visit they belong to.
  function activityLog(church, p) {
    const wrap = h('div', { class: 'activity' });
    let day = new Date(); day.setHours(0, 0, 0, 0);
    const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const hourName = (hr) => new Date(2000, 0, 1, hr).toLocaleTimeString([], { hour: 'numeric' });
    async function load() {
      const from = day.getTime();
      const next = new Date(day); next.setDate(next.getDate() + 1);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const isToday = from === today.getTime();
      const head = h('div', { class: 'row' },
        h('h3', { class: 'grow' }, 'Activity'),
        h('button', { class: 'ghost sm', title: 'Day before', onclick: () => { day.setDate(day.getDate() - 1); load(); } }, '‹'),
        h('input', { type: 'date', class: 'sm', value: ymd(day), max: ymd(today), onchange: (e) => { if (e.target.value) { day = new Date(e.target.value + 'T00:00:00'); load(); } } }),
        h('button', { class: 'ghost sm', title: 'Day after', disabled: isToday, onclick: () => { day.setDate(day.getDate() + 1); load(); } }, '›'));
      fill(wrap, head, h('p', { class: 'muted small' }, 'Loading…'));
      let r;
      try { r = await api(cbase(church) + '/activity?page=' + enc(p.id) + '&from=' + from + '&to=' + next.getTime()); }
      catch (e) { fill(wrap, head, h('p', { class: 'muted' }, e.message)); return; }
      const ev = r.events;
      if (!ev.length) {
        fill(wrap, head, h('p', { class: 'muted' }, (isToday ? 'Nothing yet today.' : 'Nothing on this day.') + ' The log keeps the last ' + r.keepDays + ' days.'));
        return;
      }
      // Busiest hours of the day.
      const hours = Array.from({ length: 24 }, (_, i) => i);
      const perHour = hours.map((hr) => ev.filter((e) => e.kind === 'view' && new Date(e.at).getHours() === hr).length);
      // One entry per visit (browser tab), newest first, with its taps in order.
      const groups = [];
      const byVisit = {};
      ev.forEach((e) => {
        let g = e.visit && byVisit[e.visit];
        if (!g || (e.kind === 'view' && g.view)) {
          g = { at: e.at, view: null, taps: [] };
          groups.push(g);
          if (e.visit) byVisit[e.visit] = g;
        }
        if (e.kind === 'view') { g.view = e; g.at = Math.min(g.at, e.at); } else g.taps.push(e);
      });
      groups.sort((a, b) => b.at - a.at);
      const views = ev.filter((e) => e.kind === 'view').length;
      fill(wrap, head,
        h('p', { class: 'muted small' }, plural(views, 'visit', 'visits') + ' and ' + plural(ev.length - views, 'tap', 'taps') + ' on ' +
          day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + '. Times are in your time zone.'),
        h('div', { class: 'chart' }, bars(hours, perHour, true, (hr, n) => hourName(hr) + ': ' + plural(n, 'visit', 'visits')),
          h('div', { class: 'row muted small' }, h('span', { class: 'grow' }, hourName(0)), h('span', { class: 'grow center' }, hourName(12)), h('span', null, hourName(23)))),
        h('div', { class: 'log' }, groups.map((g) => h('div', { class: 'logrow' },
          h('span', { class: 'logtime' }, time(g.at)),
          h('div', { class: 'logwhat' },
            h('span', null, g.view ? 'Opened the page' : 'Came back'),
            g.taps.length ? h('div', { class: 'logtaps' }, g.taps.map((t) => h('button', { type: 'button', class: 'logtap', title: 'Tapped at ' + time(t.at) + '. Click to see this button on the page.', onclick: () => showButton(church, p, t.label) }, t.label, h('small', null, time(t.at))))) : h('span', { class: 'muted small' }, 'No taps'))))));
    }
    load();
    return wrap;
  }

  // ── Stats link: owners make a read-only stats page to send a church ──
  async function shareDialog(church) {
    const dlg = $('#dlg');
    const body = h('div', { class: 'dlgform' }, h('p', { class: 'muted' }, 'Loading…'));
    fill($('#dlgBody'), body);
    dlg.onclose = null;
    if (!dlg.open) dlg.showModal();
    const url = '/churches/' + enc(church.id) + '/share';
    let share;
    try { share = (await api(url)).share; } catch (e) { fill(body, h('p', null, e.message)); return; }
    const answersBox = h('input', { type: 'checkbox', checked: share ? share.answers : false, onchange: act(async (e) => {
      if (!share) return;
      share = (await api(url, { method: 'PATCH', body: { answers: e.target.checked } })).share;
      toast(share.answers ? 'The link now shows connect card answers' : 'The link no longer shows connect card answers');
    }) });
    const intro = h('p', { class: 'muted' }, 'A link to a page with only ' + church.name + '’s tap stats: visits, button taps and the activity log for each page. Nobody needs to sign in, and nothing on it can be changed. Anyone with the link can see it.');
    const check = h('label', { class: 'check' }, answersBox,
      h('span', null, 'Also show connect card answers', h('span', { class: 'muted small' }, 'Names, emails and anything else people sent through forms on the pages.')));
    const close = h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Close');
    if (!share) {
      fill(body, h('h2', null, 'Share stats'), intro, check,
        h('div', { class: 'row end' }, close, h('button', { class: 'primary', onclick: act(async () => {
          await api(url, { method: 'POST', body: { answers: answersBox.checked } });
          shareDialog(church);
        }) }, 'Make link')));
      return;
    }
    fill(body, h('h2', null, 'Share stats'), intro,
      h('input', { type: 'text', value: share.link, readOnly: true, onfocus: (e) => e.target.select(), class: 'mono' }),
      h('div', { class: 'row wrap' },
        h('button', { class: 'primary', onclick: () => copy(share.link, 'Stats link copied') }, 'Copy link'),
        h('a', { class: 'ghost btn', href: share.link, target: '_blank', rel: 'noopener' }, '↗ Open')),
      check,
      h('p', { class: 'muted small' }, 'Made ' + when(share.createdAt) + (share.createdBy ? ' by ' + share.createdBy : '') + '.'),
      h('div', { class: 'row end wrap' },
        h('button', { class: 'ghost danger', onclick: act(async () => {
          if (!confirm('Turn off this stats link? Anyone who has it will see “turned off”.')) return;
          await api(url, { method: 'DELETE' }); toast('Stats link turned off'); shareDialog(church);
        }) }, 'Turn off'),
        h('button', { class: 'ghost', onclick: act(async () => {
          if (!confirm('Make a new link? The old one stops working.')) return;
          await api(url, { method: 'POST', body: {} }); toast('New link made'); shareDialog(church);
        }) }, 'New link'),
        close));
  }

  // ── The stats link page: one church's numbers, read-only ─────────────
  async function drawShared(n) {
    n = +n || 30;
    const main = $('#main');
    if (!SHARE) { fill(main, h('div', { class: 'card center' }, h('h1', null, 'Link not complete'), h('p', { class: 'muted' }, 'This stats link is missing its code. Copy the whole link and try again.'))); return; }
    let info, data;
    try { [info, data] = await Promise.all([api(cbase()), api(cbase() + '/stats?days=' + n)]); }
    catch (e) { fill(main, h('div', { class: 'card center' }, h('h1', null, 'Stats not available'), h('p', { class: 'muted' }, e.message))); return; }
    const church = info.church;
    document.title = church.name + ' · Tap stats';
    $('#topName').textContent = church.name;
    const days = lastDays(n);
    const pages = info.pages.filter((p) => p.publishedAt || data.pages[p.id]);
    const per = pages.map((p) => ({ p, t: sumStats(data.pages[p.id], days) }));
    const sum = (k) => per.reduce((a, x) => a + x.t[k], 0);
    const views = days.map((_, i) => per.reduce((a, x) => a + x.t.views[i], 0));
    const totalViews = sum('totalViews');
    const totalTaps = sum('totalTaps');
    const rangeSel = h('select', { class: 'sm', 'aria-label': 'Time range', onchange: (e) => drawShared(e.target.value) },
      [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([v, l]) => h('option', { value: v, selected: v === n }, l)));
    const answers = info.responses || {};

    const card = ({ p, t }) => {
      const top = t.buttons.slice(0, 5);
      const maxB = top.length ? top[0][1] : 1;
      return h('div', { class: 'card page' },
        h('div', { class: 'pagehead' }, h('b', null, p.name),
          p.publishedAt ? h('span', { class: 'pill ok' }, 'Live') : h('span', { class: 'pill' }, 'Not live')),
        h('button', { class: 'stats', title: 'See details and the activity log', onclick: () => showStats(church, p, n) },
          h('div', { class: 'statnums' },
            h('span', null, h('b', null, t.totalViews.toLocaleString()), ' ', t.totalViews === 1 ? 'visit' : 'visits'),
            h('span', { class: 'muted small' }, t.totalTaps ? plural(t.totalTaps, 'button tap', 'button taps') : 'No taps yet')),
          bars(days, t.views)),
        top.length ? h('div', { class: 'taplist' }, top.map(([label, c]) => tapRow(church, p, label, c, maxB))) : null,
        info.answers && answers[p.id] ? h('button', { class: 'answers', onclick: () => showResponses(church, p, () => {}) },
          '📥 ', plural(answers[p.id].total, 'connect card answer', 'connect card answers')) : null,
        h('div', { class: 'row wrap' },
          h('button', { class: 'ghost', onclick: () => showStats(church, p, n) }, '📊 Details'),
          p.publishedAt ? h('a', { class: 'ghost btn', href: location.origin + '/view/' + church.id + '/' + p.id, target: '_blank', rel: 'noopener' }, '↗ See the page') : null));
    };

    fill(main,
      h('div', { class: 'head' },
        h('div', { class: 'grow' }, h('h1', null, church.name), h('p', { class: 'muted sub' }, 'How people are using your tap pages')),
        h('button', { class: 'ghost', title: 'Download a PDF of visits and taps for a week, month, year or any dates', onclick: () => reportDialog(church, pages, { answers: !!info.answers && Object.keys(answers).length > 0, responses: answers }) }, '⤓ PDF report'),
        rangeSel),
      h('div', { class: 'card overview wideov' },
        h('div', { class: 'statbig' },
          h('div', null, h('b', null, totalViews.toLocaleString()), h('span', { class: 'muted small' }, totalViews === 1 ? 'visit' : 'visits')),
          h('div', null, h('b', null, totalTaps.toLocaleString()), h('span', { class: 'muted small' }, totalTaps === 1 ? 'button tap' : 'button taps')),
          h('div', null, h('b', null, totalViews ? Math.round((totalTaps / totalViews) * 10) / 10 : 0), h('span', { class: 'muted small' }, 'taps per visit'))),
        h('div', { class: 'chart' }, bars(days, views, true),
          h('div', { class: 'row muted small' }, h('span', { class: 'grow' }, shortDay(days[0])), h('span', null, 'Today')))),
      h('div', { class: 'head' }, h('h2', null, pages.length === 1 ? 'Your page' : 'Your pages')),
      per.length ? h('div', { class: 'grid' }, per.map(card)) : h('div', { class: 'card center muted' }, 'No pages are live yet.'),
      h('p', { class: 'muted small foot' }, 'A visit counts once per person every 30 minutes. No cookies are used and nothing about visitors is stored. Bookmark this page to come back to it.'));
  }

  // ── Admin screen (#admin…): every account, church and change across DoorStep ──
  // #admin = people, #admin/person/<email>, #admin/churches, #admin/activity. See server/admin.js.
  const ROLE_NAME = { owner: 'Owner', editor: 'Editor', viewer: 'Stats only' };
  const ROLE_OPTS = [['editor', 'Editor: edits and publishes pages'], ['owner', 'Owner: also adds and removes people'], ['viewer', 'Stats only: sees visits and taps, can’t edit']];
  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso)) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 86400 * 30) return Math.round(s / 86400) + ' d ago';
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const howName = { password: 'password', google: 'Google', link: 'a password link', setup: 'the setup key', admin: 'the admin sign-in' };
  const methods = (p) => [p.hasPassword ? 'Password' : null, p.hasGoogle ? 'Google' : null].filter(Boolean).join(' + ');
  const personPills = (p) => [
    p.admin === 'main' ? h('span', { class: 'pill ok', title: 'Set in ADMIN_EMAILS' }, 'Main admin') : p.admin ? h('span', { class: 'pill ok' }, 'Admin') : null,
    p.disabled ? h('span', { class: 'pill bad' }, 'Turned off') : null,
    !p.lastLoginAt && !p.hasPassword && !p.hasGoogle && !p.disabled ? h('span', { class: 'pill' }, 'Invited') : null];
  let adminCache = null; // { overview, churches } for church names and the tiles
  // The riskiest admin changes also ask for a fresh code from your own authenticator app.
  async function askCode(why) {
    const v = await ask('Confirm with your authenticator app', [{ k: 'code', l: '6-digit code', placeholder: '123456', max: 11, auto: 'one-time-code' }], 'Confirm', why);
    return v && v.code ? v.code.replace(/\s+/g, '') : null;
  }
  function showSecret(title, value, note) {
    const dlg = $('#dlg');
    fill($('#dlgBody'), h('div', { class: 'dlgform' },
      h('h2', null, title),
      h('p', { class: 'muted' }, note),
      h('input', { type: 'text', value, readOnly: true, onfocus: (e) => e.target.select(), class: 'mono' }),
      h('div', { class: 'row end' },
        h('button', { class: 'ghost', onclick: () => dlg.close() }, 'Done'),
        h('button', { class: 'primary', onclick: () => copy(value, 'Copied') }, 'Copy'))));
    dlg.onclose = null;
    if (!dlg.open) dlg.showModal();
  }
  const SETUP_NOTE = 'They need this once, with their password or Google, to add DoorStep to an authenticator app on the admin sign-in page. It works for 24 hours. Send it separately from any password link, and send them the admin sign-in address yourself (it isn’t linked anywhere).';

  async function drawAdmin(rest) {
    const main = $('#main');
    document.title = 'Admin · DoorStep';
    const [tab, arg] = [rest.split('/')[0] || 'people', rest.split('/').slice(1).join('/')];
    try {
      const [overview, ch] = await Promise.all([api('/admin/overview'), api('/admin/churches')]);
      adminCache = { overview, churches: ch.churches };
    } catch (e) { fill(main, h('div', { class: 'card center' }, h('p', null, e.message), h('a', { href: '#' }, 'Back'))); return; }
    const o = adminCache.overview;
    const tabs = [['people', 'People'], ['churches', 'Churches'], ['activity', 'Activity']];
    const body = h('div', { class: 'adminbody' }, h('p', { class: 'muted' }, 'Loading…'));
    fill(main,
      h('div', { class: 'head' }, h('div', null, h('h1', null, 'Admin'),
        h('p', { class: 'muted sub' }, 'Every account, church and change across DoorStep.' + (o.you.main ? '' : ' You’re an admin; only a main admin can make or remove admins.')))),
      o.failedAdminSignins24h ? h('a', { class: 'note bad block', href: '#admin/activity' }, '⚠ ' + plural(o.failedAdminSignins24h, 'failed admin sign-in', 'failed admin sign-ins') + ' in the last 24 hours. Tap to see them in Activity.') : null,
      h('div', { class: 'statbig admintiles' },
        h('div', null, h('b', null, o.people.toLocaleString()), h('span', { class: 'muted small' }, 'people')),
        h('div', null, h('b', null, o.active30.toLocaleString()), h('span', { class: 'muted small' }, 'signed in, last 30 days')),
        h('div', null, h('b', null, o.churches.toLocaleString()), h('span', { class: 'muted small' }, o.churches === 1 ? 'church' : 'churches')),
        h('div', null, h('b', null, o.livePages + ' / ' + o.pages), h('span', { class: 'muted small' }, 'pages live')),
        h('div', null, h('b', null, o.admins.toLocaleString()), h('span', { class: 'muted small' }, o.admins === 1 ? 'admin' : 'admins'))),
      h('nav', { class: 'tabs' }, tabs.map(([k, l]) => h('a', { href: '#admin' + (k === 'people' ? '' : '/' + k), class: (tab === k || (tab === 'person' && k === 'people')) ? 'on' : '' }, l))),
      body);
    if (tab === 'person') return adminPerson(body, arg);
    if (tab === 'churches') return adminChurches(body);
    if (tab === 'activity') return adminActivity(body);
    return adminPeople(body);
  }
  const stillOn = (r) => route() === r;

  async function addPersonDialog(church) {
    const cs = adminCache.churches;
    const fields = [
      { k: 'email', l: 'Email', type: 'email', placeholder: 'name@church.org' },
      { k: 'name', l: 'Name', required: false, max: 80, placeholder: 'Optional' },
      { k: 'church', l: 'Church', value: church || (cs[0] && cs[0].id) || '', options: [['', 'No church (admins only)']].concat(cs.map((c) => [c.id, c.name])) },
      { k: 'role', l: 'Role in that church', value: 'editor', options: ROLE_OPTS },
    ];
    if (adminCache.overview.you.main) fields.push({ k: 'admin', l: 'DoorStep admin', value: '', options: [['', 'No'], ['1', 'Yes: can manage every church and account']] });
    const v = await ask('Add a person', fields, 'Add');
    if (!v) return;
    const code = v.admin ? await askCode('Making someone an admin needs a code from your own authenticator app.') : null;
    if (v.admin && !code) return;
    const r = await api('/admin/people', { method: 'POST', body: { email: v.email, name: v.name, church: v.church, role: v.role, admin: !!v.admin, code } });
    if (r.setupCode) {
      showSecret('Admin setup code for ' + r.email, r.setupCode, SETUP_NOTE + (r.link ? ' Their password link: ' + r.link : ''));
    } else if (r.link) showLink(r.email, r.link); else toast(r.email + ' already has an account and can sign in now.');
    return r.email;
  }

  async function adminPeople(body) {
    const r0 = route();
    let list;
    try { list = (await api('/admin/people')).people; } catch (e) { fill(body, h('p', null, e.message)); return; }
    if (!stillOn(r0)) return;
    const q = h('input', { type: 'search', placeholder: 'Search name, email or church', 'aria-label': 'Search people', class: 'grow' });
    const filt = h('select', { class: 'auto', 'aria-label': 'Show' },
      [['', 'Everyone'], ['admin', 'Admins'], ['owner', 'Church owners'], ['none', 'In no church'], ['never', 'Never signed in'], ['off', 'Turned off']].map(([v, l]) => h('option', { value: v }, l)));
    const table = h('div', { class: 'atable' });
    const draw = () => {
      const s = q.value.trim().toLowerCase();
      const f = filt.value;
      const rows = list.filter((p) => (!s || (p.email + ' ' + p.name + ' ' + p.churches.map((c) => c.name).join(' ')).toLowerCase().includes(s)) &&
        (!f || (f === 'admin' && p.admin) || (f === 'owner' && p.churches.some((c) => c.role === 'owner')) || (f === 'none' && !p.churches.length) ||
          (f === 'never' && !p.lastLoginAt) || (f === 'off' && p.disabled)));
      fill(table,
        h('div', { class: 'arow ahead' }, h('span', null, 'Person'), h('span', null, 'Churches'), h('span', null, 'Signs in with'), h('span', null, 'Last sign-in')),
        rows.length ? rows.map((p) => h('a', { class: 'arow' + (p.disabled ? ' off' : ''), href: '#admin/person/' + enc(p.email) },
          h('span', { class: 'who' }, h('b', null, p.name || p.email, ' ', personPills(p)), p.name ? h('span', { class: 'muted small' }, p.email) : null),
          h('span', { class: 'chips' }, p.churches.length ? p.churches.map((c) => h('span', { class: 'chip' }, c.name, h('small', null, ROLE_NAME[c.role] || c.role))) : h('span', { class: 'muted small' }, p.admin ? 'All (admin)' : 'None')),
          h('span', { class: 'small' }, methods(p) || h('span', { class: 'muted' }, 'Not set up')),
          h('span', { class: 'small muted', title: p.lastLoginAt ? when(p.lastLoginAt) : '' }, p.lastLoginAt ? ago(p.lastLoginAt) : 'Never')))
          : h('p', { class: 'muted pad' }, 'Nobody matches.'));
    };
    q.oninput = draw; filt.onchange = draw;
    fill(body,
      h('div', { class: 'row wrap toolbar' }, q, filt,
        h('button', { class: 'primary', onclick: act(async () => { const e = await addPersonDialog(); if (e) location.hash = 'admin/person/' + enc(e); }) }, '+ Add person')),
      h('div', { class: 'card flush' }, table));
    draw();
    q.focus();
  }

  async function adminPerson(body, emailIn) {
    const r0 = route();
    let data;
    try { data = await api('/admin/people/' + enc(emailIn)); } catch (e) { fill(body, h('div', { class: 'card center' }, h('p', null, e.message), h('a', { href: '#admin' }, '← People'))); return; }
    if (!stillOn(r0)) return;
    const p = data.person;
    const you = data.you;
    const self = p.email === you.email;
    // What the server will allow (it checks again): nobody changes a main admin here, only a main admin changes another admin.
    const locked = p.admin === 'main' || (p.admin === 'admin' && !you.main);
    const lockNote = p.admin === 'main' ? 'Main admins (ADMIN_EMAILS) manage their own account from the Account menu.' : 'Only a main admin can change another admin’s account.';
    const U = '/admin/people/' + enc(p.email);
    const reload = () => adminPerson(body, p.email);
    const done = (msg) => { toast(msg); reload(); };
    document.title = (p.name || p.email) + ' · Admin · DoorStep';

    const nameIn = h('input', { type: 'text', value: p.name, maxlength: 80, placeholder: 'Name' });
    const emailNew = h('input', { type: 'email', value: p.email, maxlength: 200 });
    const lastLine = p.lastLoginAt ? 'Last signed in ' + when(p.lastLoginAt) + (howName[p.lastLoginHow] ? ' with ' + howName[p.lastLoginHow] : '') + '.' : 'Hasn’t signed in yet.';

    const inChurches = new Set(p.churches.map((c) => c.id));
    const addSel = h('select', { class: 'auto', 'aria-label': 'Church' }, adminCache.churches.filter((c) => !inChurches.has(c.id)).map((c) => h('option', { value: c.id }, c.name)));
    const addRole = h('select', { class: 'auto', 'aria-label': 'Role' }, Object.keys(ROLE_NAME).map((r) => h('option', { value: r, selected: r === 'editor' }, ROLE_NAME[r])));
    const churchRow = (c) => h('div', { class: 'person' },
      h('div', { class: 'who' }, h('a', { href: '#' + c.id }, h('b', null, c.name)), h('span', { class: 'muted small' }, 'Added ' + when(c.addedAt))),
      h('select', { class: 'sm', 'aria-label': 'Role in ' + c.name, onchange: act(async (e) => { await api(U + '/churches/' + enc(c.id), { method: 'PUT', body: { role: e.target.value } }); toast('Role changed'); }) },
        Object.keys(ROLE_NAME).map((r) => h('option', { value: r, selected: r === c.role }, ROLE_NAME[r]))),
      h('button', { class: 'ghost sm danger', onclick: act(async () => {
        if (!confirm('Remove ' + p.email + ' from ' + c.name + '?')) return;
        await api(U + '/churches/' + enc(c.id), { method: 'DELETE' }); done('Removed from ' + c.name);
      }) }, 'Remove'));

    const adminBox = h('input', { type: 'checkbox', checked: !!p.admin, disabled: !you.main || p.admin === 'main' || self, onchange: act(async () => {
      const on = adminBox.checked;
      const code = await askCode(on ? 'Make ' + p.email + ' a DoorStep admin? They’ll see and manage every church, page and account (except other admins).' : 'Remove admin from ' + p.email + '? Their authenticator app is forgotten too.');
      if (!code) { adminBox.checked = !on; return; }
      try {
        const r = await api(U + '/admin', { method: 'PUT', body: { admin: on, code } });
        reload();
        if (r.setupCode) showSecret('Admin setup code for ' + p.email, r.setupCode, SETUP_NOTE); else toast(on ? 'Now an admin' : 'No longer an admin');
      } catch (e) { adminBox.checked = !on; throw e; }
    }) });

    const actBtn = (label, title, fn, cls) => h('button', { class: 'ghost' + (cls ? ' ' + cls : ''), title, disabled: locked && !(self && label === 'Sign out everywhere'), onclick: act(fn) }, label);

    fill(body,
      h('a', { class: 'crumb', href: '#admin' }, '← People'),
      h('div', { class: 'head personhead' },
        h('div', null, h('h2', null, p.name || p.email, ' ', personPills(p)), h('p', { class: 'muted sub' }, p.name ? p.email : '', p.createdAt ? (p.name ? ' · ' : '') + 'Account since ' + new Date(p.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''))),
      locked ? h('p', { class: 'note' }, '🔒 ' + lockNote) : null,
      p.disabled ? h('p', { class: 'note bad' }, 'This account is turned off' + (p.disabledBy ? ' (by ' + p.disabledBy + ', ' + when(p.disabledAt) + ')' : '') + '. They can’t sign in until you turn it back on. Their churches and roles are kept.') : null,
      h('div', { class: 'admingrid' },
        h('section', { class: 'card' },
          h('h3', null, 'Sign-in'),
          h('p', { class: 'small' }, methods(p) ? 'Signs in with ' + methods(p).replace(' + ', ' or ') + '.' : 'No password or Google yet.', ' ', lastLine, ' ',
            p.sessions ? plural(p.sessions, 'device', 'devices') + ' signed in now.' : 'Not signed in anywhere.'),
          h('div', { class: 'row wrap' },
            actBtn('Password link', 'A one-time link (7 days) to set a new password. Their old password keeps working until they use it.', async () => { const r = await api(U + '/link', { method: 'POST' }); showLink(p.email, r.link); }),
            actBtn('Sign out everywhere', 'Ends every session on every device. They can sign in again.', async () => { if (!confirm('Sign ' + (self ? 'yourself' : p.email) + ' out on every device?')) return; await api(U + '/signout', { method: 'POST' }); if (self) location.replace('/app/login.html'); else done('Signed out everywhere'); }),
            p.hasPassword ? actBtn('Remove password', 'Their password stops working and they’re signed out. Google sign-in or a new password link still work.', async () => { if (!confirm('Remove ' + p.email + '’s password and sign them out?')) return; await api(U + '/remove-password', { method: 'POST' }); done('Password removed'); }, 'danger') : null,
            p.hasGoogle ? actBtn('Unlink Google', 'Forget which Google account they used, so a different Google account with this email can sign in next time.', async () => { if (!confirm('Unlink ' + p.email + '’s Google account?')) return; await api(U + '/unlink-google', { method: 'POST' }); done('Google unlinked'); }) : null)),
        h('section', { class: 'card' },
          h('h3', null, 'Name and email'),
          h('form', { class: 'row', onsubmit: act(async (ev) => { ev.preventDefault(); await api(U, { method: 'PATCH', body: { name: nameIn.value } }); done('Name saved'); }) },
            nameIn, h('button', { class: 'ghost', type: 'submit', disabled: locked && !self }, 'Save')),
          h('form', { class: 'row', onsubmit: act(async (ev) => {
            ev.preventDefault();
            const to = emailNew.value.trim().toLowerCase();
            if (to === p.email) return;
            if (!confirm('Change ' + p.email + ' to ' + to + '? Their churches and roles move over. They’ll be signed out, and need Google with the new address or a new password link if they had no password.')) return;
            const r = await api(U, { method: 'PATCH', body: { email: to } });
            toast('Email changed'); location.hash = 'admin/person/' + enc(r.email);
          }) }, emailNew, h('button', { class: 'ghost', type: 'submit', disabled: locked || self }, 'Change'))),
        h('section', { class: 'card wide2' },
          h('h3', null, 'Churches'),
          p.admin ? h('p', { class: 'muted small' }, 'As an admin they can already open every church. Roles below matter only if they stop being an admin.') : null,
          h('div', { class: 'list flushlist' }, p.churches.length ? p.churches.map(churchRow) : h('p', { class: 'muted small' }, 'Not in any church' + (p.admin ? '.' : ', so they can’t sign in.'))),
          addSel.options.length ? h('div', { class: 'row wrap addrow' }, addSel, addRole, h('button', { class: 'ghost', onclick: act(async () => {
            await api(U + '/churches/' + enc(addSel.value), { method: 'PUT', body: { role: addRole.value } }); done('Added to ' + addSel.selectedOptions[0].textContent);
          }) }, '+ Add to church')) : null),
        h('section', { class: 'card' },
          h('h3', null, 'Admin'),
          h('label', { class: 'check' }, adminBox, h('span', null, 'DoorStep admin',
            h('span', { class: 'muted small' }, p.admin === 'main' ? 'Main admin: set in ADMIN_EMAILS in Cloudflare, so it can’t be changed here.'
              : self ? 'You can’t change your own admin access.'
              : !you.main ? 'Only a main admin can make or remove admins.'
              : 'Sees and manages every church, page, template and account, except other admins.'))),
          p.adminSince ? h('p', { class: 'muted small' }, 'Admin since ' + when(p.adminSince) + '.') : null,
          p.twoStep ? h('div', { class: 'twostep' },
            h('p', { class: 'small' }, p.twoStep.on
              ? h('span', null, h('span', { class: 'pill ok' }, 'Two-step on'), ' Authenticator app added ' + when(p.twoStep.since) + '. ' + plural(p.twoStep.recoveryLeft, 'recovery code', 'recovery codes') + ' left.')
              : h('span', null, h('span', { class: 'pill warn' }, 'Two-step not set up'), ' They can’t use admin powers until they add an authenticator app' + (p.twoStep.setupCodeUntil ? ' (setup code valid until ' + when(p.twoStep.setupCodeUntil) + ').' : '.'))),
            h('div', { class: 'row wrap' },
              self && p.twoStep.on ? h('button', { class: 'ghost', onclick: act(async () => {
                const code = await askCode('Your old recovery codes stop working and you get 10 new ones.');
                if (!code) return;
                const r = await api(U + '/recovery', { method: 'POST', body: { code } });
                showSecret('Your new recovery codes', r.recovery.join('  '), 'Each signs you in once if you lose your phone. They won’t be shown again; save them in a password manager.');
              }) }, 'New recovery codes') : null,
              you.main && !self && p.admin === 'admin' ? h('button', { class: 'ghost', onclick: act(async () => {
                const code = await askCode('Make a one-time setup code so ' + p.email + ' can add an authenticator app.');
                if (!code) return;
                const r = await api(U + '/setup-code', { method: 'POST', body: { code } });
                reload(); showSecret('Admin setup code for ' + p.email, r.setupCode, SETUP_NOTE);
              }) }, p.twoStep.on ? 'New setup code' : 'Make setup code') : null,
              you.main && !self && p.admin === 'admin' && p.twoStep.on ? h('button', { class: 'ghost danger', onclick: act(async () => {
                const code = await askCode('Reset ' + p.email + '’s two-step sign-in? Their authenticator app and recovery codes stop working and they’re signed out of admin. Use this if they lost their phone.');
                if (!code) return;
                const r = await api(U + '/reset-2fa', { method: 'POST', body: { code } });
                reload(); showSecret('Admin setup code for ' + p.email, r.setupCode, SETUP_NOTE);
              }) }, 'Reset two-step') : null)) : null),
        h('section', { class: 'card' },
          h('h3', null, 'Account'),
          h('div', { class: 'row wrap' },
            p.disabled
              ? actBtn('Turn account back on', 'They can sign in again with the same churches and roles.', async () => { await api(U, { method: 'PATCH', body: { disabled: false } }); done('Account turned back on'); })
              : actBtn('Turn account off', 'Signs them out and stops them signing in, without losing their churches and roles.', async () => {
                if (!confirm('Turn off ' + p.email + '? They’re signed out now and can’t sign in until you turn it back on.')) return;
                await api(U, { method: 'PATCH', body: { disabled: true } }); done('Account turned off');
              }, 'danger'),
            actBtn('Delete account', 'Removes the account, its password and Google link, and all church access. Pages they edited stay.', async () => {
              const v = await ask('Delete ' + p.email + '?', [{ k: 'confirm', l: 'Type their email to confirm' }], 'Delete account', 'This removes the account and every church it belongs to. Pages they made stay. It can’t be undone; you can add them again later as a new person.');
              if (!v || v.confirm.toLowerCase() !== p.email) return;
              await api(U, { method: 'DELETE' }); toast('Account deleted'); location.hash = 'admin';
            }, 'danger')),
          self ? h('p', { class: 'muted small' }, 'This is you. You can’t turn off or delete your own account.') : null),
        h('section', { class: 'card wide2' },
          h('h3', null, 'Recent activity'),
          data.activity.length ? h('div', { class: 'log' }, data.activity.map(logRow)) : h('p', { class: 'muted small' }, 'Nothing yet.'))));
  }

  // One line of the change log, in words.
  function logRow(r) {
    const cname = (id) => { const c = adminCache && adminCache.churches.find((x) => x.id === id); return c ? c.name : id; };
    const C = r.church_id ? h('a', { href: '#' + r.church_id }, cname(r.church_id)) : null;
    const P = (e) => h('a', { href: '#admin/person/' + enc(e) }, e);
    const role = ROLE_NAME[r.detail] || r.detail;
    const map = {
      signin: () => ['signed in with ', howName[r.detail] || r.detail],
      'admin.signin': () => ['signed in to admin mode with ', howName[r.detail] || r.detail, ' + authenticator code'],
      'admin.signin.fail': () => [h('b', { class: 'danger' }, 'Failed admin sign-in'), ' for ', r.target || '(no email)', ' at the ', r.detail.split(' · ')[0], ' step', r.detail.includes('IP') ? ' (' + r.detail.split(' · ')[1] + ')' : ''],
      'admin.2fa.on': () => ['added an authenticator app for admin sign-in'],
      'admin.2fa.reset': () => ['reset ', P(r.target), '’s two-step sign-in'],
      'admin.setupcode': () => ['made an admin setup code for ', P(r.target)],
      'admin.recovery': () => ['used a recovery code (', r.detail, ')'],
      'admin.recovery.new': () => ['made new recovery codes'],
      'admin.password': () => ['set their admin password with the setup key'],
      'person.add': () => ['added ', P(r.target)],
      'person.rename': () => ['renamed ', P(r.target), ' to “', r.detail, '”'],
      'person.email': () => ['changed the email ', r.detail.replace(/^was /, ''), ' to ', P(r.target)],
      'person.disable': () => ['turned off ', P(r.target)],
      'person.enable': () => ['turned ', P(r.target), ' back on'],
      'person.delete': () => ['deleted the account ', r.target],
      'person.link': () => ['made a password link for ', P(r.target)],
      'person.signout': () => ['signed ', P(r.target), ' out everywhere'],
      'person.nopassword': () => ['removed ', P(r.target), '’s password'],
      'person.nogoogle': () => ['unlinked ', P(r.target), '’s Google account'],
      'admin.add': () => ['made ', P(r.target), ' an admin'],
      'admin.remove': () => ['removed admin from ', P(r.target)],
      'member.add': () => ['added ', P(r.target), ' to ', C, ' as ', role],
      'member.role': () => ['set ', P(r.target), ' to ', role, ' in ', C],
      'member.remove': () => ['removed ', P(r.target), ' from ', C],
      'church.add': () => ['added the church ', C || r.detail],
      'church.rename': () => ['renamed ', C, ' to “', r.detail, '”'],
      'church.delete': () => ['deleted the church ', r.detail],
      'page.add': () => ['made the page “', r.detail, '” in ', C],
      'page.delete': () => ['deleted the page “', r.detail, '” in ', C],
      'page.publish': () => ['published “', r.detail, '” in ', C],
      'page.unpublish': () => ['unpublished “', r.detail, '” in ', C],
    };
    const words = map[r.action] ? map[r.action]() : [r.action, ' ', r.target, ' ', r.detail];
    return h('div', { class: 'logrow' },
      h('span', { class: 'logtime', title: when(r.at) }, ago(r.at)),
      h('span', { class: 'logwhat' }, h('span', null, r.actor ? (r.action === 'signin' ? P(r.actor) : h('b', null, r.actor)) : (r.action === 'admin.signin.fail' ? '' : 'Someone'), r.actor ? ' ' : '', words)));
  }

  async function adminChurches(body) {
    const cs = adminCache.churches;
    const date = (iso) => iso ? h('span', { title: when(iso) }, ago(iso)) : h('span', { class: 'muted' }, '—');
    fill(body,
      h('div', { class: 'row wrap toolbar' }, h('div', { class: 'grow' }),
        h('button', { class: 'primary', onclick: act(async () => {
          const v = await ask('Add a church', [{ k: 'name', l: 'Church name', placeholder: 'Bethany First Church', max: 80 }], 'Add church');
          if (!v) return;
          const c = await api('/churches', { method: 'POST', body: { name: v.name } });
          me = await api('/me'); location.hash = c.id;
        }) }, '+ Add church')),
      h('div', { class: 'card flush' }, h('div', { class: 'atable churches' },
        h('div', { class: 'arow ahead' }, h('span', null, 'Church'), h('span', null, 'Pages live'), h('span', null, 'People'), h('span', null, 'Last edit'), h('span', null, 'Last publish')),
        cs.length ? cs.map((c) => h('a', { class: 'arow', href: '#' + c.id },
          h('span', { class: 'who' }, h('b', null, c.name), h('span', { class: 'muted small' }, c.id + ' · since ' + new Date(c.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' }))),
          h('span', { class: 'small', 'data-l': 'Pages live' }, c.livePages + ' of ' + c.pages),
          h('span', { class: 'small', 'data-l': 'People' }, plural(c.people, 'person', 'people'), c.people && !c.owners ? h('span', { class: 'pill warn', title: 'Nobody here can add or remove people except admins' }, 'No owner') : null),
          h('span', { class: 'small', 'data-l': 'Last edit' }, date(c.lastEdit)),
          h('span', { class: 'small', 'data-l': 'Last publish' }, date(c.lastPublish))))
          : h('p', { class: 'muted pad' }, 'No churches yet.'))));
  }

  async function adminActivity(body) {
    const r0 = route();
    const q = h('input', { type: 'search', placeholder: 'Filter by email, church id or action', 'aria-label': 'Filter activity', class: 'grow' });
    const box = h('div', { class: 'log biglog' });
    const more = h('button', { class: 'ghost', hidden: true }, 'Load more');
    let last = 0, t;
    const load = async (reset) => {
      if (reset) { last = 0; fill(box); }
      const r = await api('/admin/activity?before=' + last + '&q=' + enc(q.value.trim()));
      if (!stillOn(r0)) return;
      if (!r.items.length && !last) box.append(h('p', { class: 'muted pad' }, 'Nothing yet. Sign-ins and changes to people, churches and pages show up here.'));
      r.items.forEach((x) => box.append(logRow(x)));
      if (r.items.length) last = r.items[r.items.length - 1].id;
      more.hidden = !r.more;
    };
    q.oninput = () => { clearTimeout(t); t = setTimeout(() => load(true).catch((e) => toast(e.message)), 300); };
    more.onclick = act(() => load(false));
    fill(body,
      h('div', { class: 'row wrap toolbar' }, q),
      h('p', { class: 'muted small' }, 'Sign-ins and every change to people, roles, churches and pages, newest first. Kept for a year. (Page edits aren’t listed; each page card shows who edited last.)'),
      box, h('div', { class: 'foot' }, more));
    try { await load(true); } catch (e) { fill(box, h('p', { class: 'pad' }, e.message)); }
  }

  // ── Account: name, password, sign out ────────────────────────────────
  function account() {
    const dlg = $('#dlg');
    fill($('#dlgBody'), h('div', { class: 'dlgform' },
      h('h2', null, me.name || me.email),
      h('p', { class: 'muted' }, me.email + (me.admin ? ' · admin mode' : '')),
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
        me.admin ? h('button', { class: 'ghost', title: 'End admin mode on this device. Admin mode also ends after 30 minutes without activity.', onclick: act(async () => {
          await fetch('/api/admin-auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
          location.replace('/app/');
        }) }, 'Leave admin mode') : null,
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
