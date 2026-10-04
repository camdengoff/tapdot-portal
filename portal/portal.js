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
  window.addEventListener('hashchange', draw);

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
    try { data = await api('/churches/' + enc(id)); }
    catch (e) { fill(main, h('div', { class: 'card center' }, h('p', null, e.message), h('a', { href: '#' }, 'Back'))); return; }
    if (route() !== id) return; // moved on while loading
    const { church, role, pages, members } = data;
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
        h('button', { class: 'primary', onclick: act(async () => {
          const v = await ask('New page', [{ k: 'name', l: 'Page name', placeholder: 'Sunday tap tag', max: 80 }], 'Create',
            'You’ll start from a blank page. Use New in the editor to pick a template.');
          if (!v) return;
          const p = await api('/churches/' + enc(church.id) + '/pages', { method: 'POST', body: { name: v.name } });
          location.href = 'editor.html?church=' + enc(church.id) + '&page=' + enc(p.id);
        }) }, '+ New page')),
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
