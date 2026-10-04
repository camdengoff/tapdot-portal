/* TapDot portal sign-in: email + password, Google, and one-time "set your password" links. */
(function () {
  const $ = (s) => document.querySelector(s);
  const hash = new URLSearchParams(location.hash.slice(1));
  const msg = (text, good) => { const m = $('#msg'); m.textContent = text || ''; m.hidden = !text; m.classList.toggle('good', !!good); };

  async function post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
    return out;
  }
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });

  async function showSignIn() {
    $('#signin').hidden = false;
    if (hash.get('error')) msg(hash.get('error'));
    try {
      const cfg = await (await fetch('/api/config')).json();
      $('#googleBtn').hidden = !cfg.google;
      $('#orLine').hidden = !cfg.google;
      $('#setupLink').hidden = !cfg.setup;
    } catch (e) { /* Google stays hidden */ }
    $('#email').focus();
    $('#signin').onsubmit = async (e) => {
      e.preventDefault();
      busy(e.target, true); msg('');
      try { await post('/api/auth/login', { email: $('#email').value, password: $('#password').value }); location.replace('/app/'); }
      catch (x) { msg(x.message); busy(e.target, false); }
    };
  }

  async function showSetPassword(token) {
    history.replaceState(null, '', location.pathname); // keep the link out of browser history
    let info;
    try {
      const r = await fetch('/api/auth/link?token=' + encodeURIComponent(token));
      info = await r.json();
      if (!r.ok) throw new Error(info.error);
    } catch (e) { msg(e.message || 'This link has expired. Ask for a new one.'); showSignIn(); return; }
    $('#setpw').hidden = false;
    $('#setFor').textContent = 'For ' + info.email;
    $('#setName').value = info.name || '';
    $('#setPw').focus();
    $('#setpw').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#setPw').value !== $('#setPw2').value) { msg('The two passwords don’t match.'); return; }
      busy(e.target, true); msg('');
      try { await post('/api/auth/link', { token, password: $('#setPw').value, name: $('#setName').value.trim() }); location.replace('/app/'); }
      catch (x) { msg(x.message); busy(e.target, false); }
    };
  }

  function showSetup() {
    $('#signin').hidden = true;
    $('#setup').hidden = false;
    $('#suEmail').focus();
    $('#setup').onsubmit = async (e) => {
      e.preventDefault();
      busy(e.target, true); msg('');
      try { await post('/api/auth/setup', { email: $('#suEmail').value, key: $('#suKey').value, password: $('#suPw').value }); location.replace('/app/'); }
      catch (x) { msg(x.message); busy(e.target, false); }
    };
  }

  window.addEventListener('hashchange', () => { if (location.hash === '#setup') showSetup(); });
  if (hash.get('set')) showSetPassword(hash.get('set'));
  else if (location.hash === '#setup') { showSignIn(); showSetup(); }
  else showSignIn();
})();
