/* DoorStep admin sign-in: password or Google, then a code from an authenticator app. See server/adminauth.js. */
(function () {
  try { const t = localStorage.getItem('tapdot-theme'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) { /* device theme */ }
  const $ = (s) => document.querySelector(s);
  const hash = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname); // keep sign-in tokens out of history
  const msg = (text) => { const m = $('#msg'); m.textContent = text || ''; m.hidden = !text; };
  const show = (id) => { ['#step1', '#step2', '#needSetup', '#enroll', '#recovery', '#pwForm'].forEach((s) => { $(s).hidden = s !== id; }); const f = $(id).querySelector('input'); if (f) f.focus(); };
  const busy = (form, on) => form.querySelectorAll('button, input').forEach((el) => { el.disabled = on; });
  async function post(what, data) {
    const r = await fetch('/api/admin-auth/' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}), credentials: 'same-origin' });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(out.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
    return out;
  }
  const submit = (form, fn) => { form.onsubmit = async (e) => { e.preventDefault(); busy(form, true); msg(''); try { await fn(); } catch (x) { msg(x.message); if (/timed out/.test(x.message)) setTimeout(() => location.reload(), 2500); } busy(form, false); }; };
  const digits = (el) => el.addEventListener('input', () => { if (/^\d[\d\s]*$/.test(el.value)) el.value = el.value.replace(/\D/g, '').slice(0, 6); });

  let challenge = null, via = 'password';
  const atAdmin = () => location.replace('/app/#admin');

  function afterStep1(r, who) {
    challenge = r.challenge;
    if (r.enrolled) { $('#s2for').textContent = who; show('#step2'); return; }
    if (via === 'google') startEnroll('').catch(() => show('#needSetup')); else show('#needSetup');
  }
  async function startEnroll(setupCode) {
    const r = await post('enroll', { challenge, setupCode });
    const qr = qrcode(0, 'M'); qr.addData(r.uri); qr.make();
    const img = new Image(); img.src = qr.createDataURL(6, 0); img.alt = '';
    $('#qr').replaceChildren(img);
    $('#secret').textContent = r.secret.replace(/(.{4})/g, '$1 ').trim();
    $('#otpLink').href = r.uri;
    show('#enroll');
  }

  submit($('#step1'), async () => {
    via = 'password';
    const r = await post('start', { email: $('#email').value, password: $('#password').value });
    $('#password').value = '';
    afterStep1(r, $('#email').value.trim());
  });
  digits($('#code'));
  submit($('#step2'), async () => { await post('verify', { challenge, code: $('#code').value }); atAdmin(); });
  submit($('#needSetup'), async () => { await startEnroll($('#setupCode').value); $('#setupCode').value = ''; });
  digits($('#code2'));
  submit($('#enroll'), async () => {
    const r = await post('confirm', { challenge, code: $('#code2').value });
    const list = r.recovery || [];
    $('#codes').replaceChildren(...list.map((c) => Object.assign(document.createElement('li'), { textContent: c })));
    const text = 'DoorStep admin recovery codes (each works once)\n\n' + list.join('\n') + '\n';
    $('#copyCodes').onclick = async () => { try { await navigator.clipboard.writeText(text); $('#copyCodes').textContent = 'Copied'; } catch (e) { prompt('Copy these:', list.join(' ')); } };
    $('#dlCodes').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'doorstep-recovery-codes.txt'; a.click(); };
    $('#saved').onchange = () => { $('#toAdmin').disabled = !$('#saved').checked; };
    $('#toAdmin').onclick = atAdmin;
    show('#recovery');
  });
  submit($('#pwForm'), async () => {
    await post('password', { email: $('#pwEmail').value, key: $('#pwKey').value, password: $('#pwNew').value });
    $('#pwKey').value = $('#pwNew').value = '';
    show('#step1'); $('#email').value = $('#pwEmail').value; msg(''); $('#password').focus();
  });
  $('#pwLink').onclick = (e) => { e.preventDefault(); msg(''); show('#pwForm'); };

  fetch('/api/admin-auth/config').then((r) => r.json()).then((cfg) => {
    $('#googleBtn').hidden = !cfg.google; $('#orLine').hidden = !cfg.google; $('#pwLink').hidden = !cfg.setupKey;
  }).catch(() => {});

  if (hash.get('c')) { via = 'google'; afterStep1({ challenge: hash.get('c'), enrolled: hash.get('enrolled') === '1' }, hash.get('email') || ''); }
  else { show('#step1'); if (hash.get('error')) msg(hash.get('error')); }
})();
