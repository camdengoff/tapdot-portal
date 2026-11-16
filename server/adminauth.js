// Admin sign-in: a separate page (/admin/, linked from nowhere) and a separate, short-lived session.
//
// The regular sign-in never gives admin powers (see auth.js). Signing in as an admin takes two steps:
//   1. password or Google, then
//   2. a 6-digit code from an authenticator app (or a one-time recovery code).
// Codes can't be reused, and failed tries are limited per email and per IP address, so guessing
// passwords or codes gets nowhere. Every failed try shows on the Admin screen's Activity tab.
//
// Turning on the authenticator app the first time needs one of:
//   - a main admin (ADMIN_EMAILS) who signed in with Google in step 1 (Google's own sign-in, which
//     a stolen password alone can't get past), or
//   - the SETUP_KEY secret from Cloudflare (main admins only; also how a main admin who lost their
//     phone and recovery codes gets back in), or
//   - a one-time setup code a main admin made for that admin on the Admin screen (24 hours).
//
// Routes (signed out, under /api/admin-auth/):
//   POST start     {email, password}          → {challenge, enrolled}
//   POST verify    {challenge, code}          → admin session cookie
//   POST enroll    {challenge, setupCode?}    → {secret, uri} (a new authenticator secret)
//   POST confirm   {challenge, code}          → admin session cookie + {recovery: [...]}
//   POST password  {email, key, password}     set a main admin's password with SETUP_KEY
//   POST logout                                end the admin session
//   GET  google                                Google, then back to /admin/#c=<challenge>
import { HttpError, one, run, normEmail } from './db.js';
import * as auth from './auth.js';

const CHALLENGE_MIN = 10;            // minutes to finish step 2
const CHALLENGE_TRIES = 5;           // wrong codes allowed per challenge
const EMAIL_FAILS = 5, EMAIL_WINDOW = 30 * 60 * 1000; // per email: 5 fails per 30 minutes
const IP_FAILS = 10, IP_WINDOW = 60 * 60 * 1000;      // per IP address: 10 fails per hour
const SETUP_CODE_HOURS = 24;
const NOPE = 'That didn’t work. Check your email and password.';
const SLOW = 'Too many tries. Wait a while and try again.';

// ── TOTP (RFC 6238: 30-second steps, 6 digits, SHA-1, as every authenticator app expects) ──
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  const out = [];
  let bits = 0, val = 0;
  for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
async function totpAt(secret, step) {
  const key = await crypto.subtle.importKey('raw', b32decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  const v = new DataView(msg);
  v.setUint32(0, Math.floor(step / 2 ** 32)); v.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = mac[19] & 15;
  const n = ((mac[o] & 127) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
// The step the code matches (now, or one step either side for clock drift), or 0.
async function matchStep(secret, code, after) {
  if (!/^\d{6}$/.test(code)) return 0;
  const now = Math.floor(Date.now() / 30000);
  let hit = 0;
  for (const s of [now - 1, now, now + 1]) if (auth.sameString(await totpAt(secret, s), code) && s > after) hit = s; // check all three: same time either way
  return hit;
}
export { totpAt as _totpAt }; // for tests

// ── Failed tries ────────────────────────────────────────────────────────
const ipKey = async (request) => 'i:' + (await auth.sha256('ip:' + (request.headers.get('CF-Connecting-IP') || 'local'))).slice(0, 24);
async function checkLimits(d, request, email) {
  const t = Date.now();
  await run(d, 'DELETE FROM admin_fails WHERE at < ?', t - Math.max(EMAIL_WINDOW, IP_WINDOW));
  const ip = await ipKey(request);
  const a = await one(d, 'SELECT COUNT(*) AS n FROM admin_fails WHERE k = ? AND at > ?', ip, t - IP_WINDOW);
  const b = email ? await one(d, 'SELECT COUNT(*) AS n FROM admin_fails WHERE k = ? AND at > ?', 'e:' + email, t - EMAIL_WINDOW) : { n: 0 };
  if (a.n >= IP_FAILS || b.n >= EMAIL_FAILS) throw new HttpError(429, SLOW);
}
async function fail(d, request, email, stage) {
  const t = Date.now();
  const ip = await ipKey(request);
  await run(d, 'INSERT INTO admin_fails (k, at) VALUES (?, ?)', ip, t);
  if (email) await run(d, 'INSERT INTO admin_fails (k, at) VALUES (?, ?)', 'e:' + email, t);
  await auth.log(d, '', 'admin.signin.fail', email || '', stage + ' · IP ' + ip.slice(2, 10));
}

// ── Challenges: step 1 passed, step 2 pending ──────────────────────────
async function newChallenge(d, email, via) {
  const token = auth.randomHex(32);
  await run(d, 'DELETE FROM admin_challenges WHERE expires_at < ? OR email = ?', Date.now(), email);
  await run(d, 'INSERT INTO admin_challenges (id, email, via, expires_at) VALUES (?, ?, ?, ?)', await auth.sha256(token), email, via, Date.now() + CHALLENGE_MIN * 60000);
  return token;
}
async function readChallenge(d, token) {
  if (!/^[0-9a-f]{64}$/.test(token || '')) throw new HttpError(400, 'This sign-in timed out. Start again.');
  const id = await auth.sha256(token);
  const c = await one(d, 'SELECT * FROM admin_challenges WHERE id = ?', id);
  if (!c || c.expires_at < Date.now() || c.tries >= CHALLENGE_TRIES) throw new HttpError(400, 'This sign-in timed out. Start again.');
  return Object.assign(c, { id });
}
const burn = (d, c) => run(d, 'UPDATE admin_challenges SET tries = tries + 1 WHERE id = ?', c.id);
const done = (d, c) => run(d, 'DELETE FROM admin_challenges WHERE id = ?', c.id);

// Who may be an admin right now (an admin, not turned off).
async function eligible(d, env, email) {
  return (await auth.isAdmin(d, env, email)) && (auth.isMainAdmin(env, email) || !(await auth.isDisabled(d, email)));
}

// A password check that takes the same time whether or not the account exists.
const DUMMY_SALT = '00000000000000000000000000000000';
async function passwordOk(d, email, password) {
  const u = await one(d, 'SELECT pw_hash, pw_salt FROM users WHERE email = ?', email);
  const h = await auth.hashPassword(String(password || ''), u && u.pw_hash ? u.pw_salt : DUMMY_SALT);
  return !!(u && u.pw_hash && auth.sameString(h.hash, u.pw_hash));
}

async function recoveryCodes() {
  const codes = [], hashes = [];
  for (let i = 0; i < 10; i++) {
    const c = b32encode(crypto.getRandomValues(new Uint8Array(6))).toLowerCase().slice(0, 10);
    const code = c.slice(0, 5) + '-' + c.slice(5);
    codes.push(code); hashes.push(await auth.sha256('rc:' + code));
  }
  return { codes, hashes };
}

// Step 2 with an enrolled authenticator: a 6-digit code, or a recovery code (used up).
export async function checkCode(d, email, codeIn) {
  const code = String(codeIn || '').trim().toLowerCase().replace(/\s+/g, '');
  const f = await one(d, 'SELECT * FROM admin_2fa WHERE email = ?', email);
  if (!f) return false;
  if (/^\d{6}$/.test(code)) {
    const step = await matchStep(f.secret, code, f.last_step);
    if (!step) return false;
    // Only one sign-in per code: the step is remembered, so a seen code can't be used again.
    await run(d, 'UPDATE admin_2fa SET last_step = ? WHERE email = ? AND last_step < ?', step, email, step);
    return true;
  }
  if (/^[a-z2-7]{5}-?[a-z2-7]{5}$/.test(code)) {
    const h = await auth.sha256('rc:' + code.slice(0, 5) + '-' + code.slice(-5));
    const list = JSON.parse(f.recovery || '[]');
    const i = list.indexOf(h);
    if (i < 0) return false;
    list.splice(i, 1);
    await run(d, 'UPDATE admin_2fa SET recovery = ? WHERE email = ?', JSON.stringify(list), email);
    await auth.log(d, email, 'admin.recovery', email, list.length + ' left');
    return true;
  }
  return false;
}

// After Google on the admin sign-in page (called from auth.googleCallback).
export function googleDone(d, env) {
  return async (request, email, sameGoogle) => {
    const to = (frag) => new Response(null, { status: 302, headers: { Location: '/admin/#' + frag, 'Cache-Control': 'no-store' } });
    try { await checkLimits(d, request, email); } catch (e) { return to('error=' + encodeURIComponent(SLOW)); }
    if (!sameGoogle || !(await eligible(d, env, email))) {
      await fail(d, request, email, 'google');
      return to('error=' + encodeURIComponent('That Google account can’t sign in here.'));
    }
    const enrolled = !!(await one(d, 'SELECT 1 FROM admin_2fa WHERE email = ?', email));
    return to('c=' + (await newChallenge(d, email, 'google')) + '&enrolled=' + (enrolled ? 1 : 0) + '&email=' + encodeURIComponent(email));
  };
}

export async function route({ d, env, request, parts, json, body }) {
  const M = request.method;
  const what = parts[1];
  if (M === 'GET' && what === 'google' && parts.length === 2) return auth.googleStart(env, request, true);
  if (M === 'GET' && what === 'config' && parts.length === 2) return json({ google: auth.googleEnabled(env), setupKey: !!env.SETUP_KEY });
  if (M !== 'POST' || parts.length !== 2) throw new HttpError(404, 'Not found.');
  // Admin sign-in only from this site itself (a missing Origin isn't enough here).
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, 'Requests from other sites are not allowed.');
  const b = await body(request);

  if (what === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': await auth.endAdminSession(d, request) });

  if (what === 'start') {
    const email = normEmail(b.email);
    await checkLimits(d, request, email);
    const ok = await passwordOk(d, email, b.password); // always runs, so timing doesn't tell admins apart
    if (!email || !ok || !(await eligible(d, env, email))) { await fail(d, request, email, 'password'); throw new HttpError(401, NOPE); }
    const enrolled = !!(await one(d, 'SELECT 1 FROM admin_2fa WHERE email = ?', email));
    return json({ challenge: await newChallenge(d, email, 'password'), enrolled });
  }

  if (what === 'verify') {
    const c = await readChallenge(d, b.challenge);
    await checkLimits(d, request, c.email);
    if (!(await eligible(d, env, c.email)) || !(await checkCode(d, c.email, b.code))) {
      await burn(d, c); await fail(d, request, c.email, 'code');
      throw new HttpError(401, 'That code didn’t work. Use the newest code from your authenticator app.');
    }
    await done(d, c);
    return json({ ok: true }, 200, { 'Set-Cookie': await auth.startAdminSession(d, c.email, c.via) });
  }

  if (what === 'enroll') {
    const c = await readChallenge(d, b.challenge);
    await checkLimits(d, request, c.email);
    const main = auth.isMainAdmin(env, c.email);
    const enrolled = !!(await one(d, 'SELECT 1 FROM admin_2fa WHERE email = ?', c.email));
    const setup = String(b.setupCode || '').trim();
    let allowed = false;
    if (main && env.SETUP_KEY && setup && auth.sameString(setup, env.SETUP_KEY)) allowed = true;           // also replaces a lost phone
    else if (!enrolled && main && c.via === 'google' && !setup) allowed = true;                             // Google proved who they are
    else if (!enrolled && setup) {
      const sc = await one(d, 'SELECT code_hash, expires_at FROM admin_setup_codes WHERE email = ?', c.email);
      allowed = !!(sc && sc.expires_at > Date.now() && auth.sameString(sc.code_hash, await auth.sha256('sc:' + setup.toLowerCase())));
    }
    if (!allowed) {
      await burn(d, c); await fail(d, request, c.email, 'setup');
      throw new HttpError(403, setup ? 'That setup code didn’t work.' : 'Setting up the authenticator app needs a setup code.');
    }
    const secret = b32encode(crypto.getRandomValues(new Uint8Array(20)));
    await run(d, 'UPDATE admin_challenges SET pending_secret = ? WHERE id = ?', secret, c.id);
    const label = encodeURIComponent('DoorStep Admin:' + c.email);
    return json({ secret, uri: 'otpauth://totp/' + label + '?secret=' + secret + '&issuer=' + encodeURIComponent('DoorStep Admin') + '&algorithm=SHA1&digits=6&period=30' });
  }

  if (what === 'confirm') {
    const c = await readChallenge(d, b.challenge);
    await checkLimits(d, request, c.email);
    const step = c.pending_secret ? await matchStep(c.pending_secret, String(b.code || '').trim(), 0) : 0;
    if (!step || !(await eligible(d, env, c.email))) {
      await burn(d, c); await fail(d, request, c.email, 'setup code');
      throw new HttpError(401, 'That code didn’t work. Check the app’s clock and try the newest code.');
    }
    const { codes, hashes } = await recoveryCodes();
    await run(d, 'INSERT INTO admin_2fa (email, secret, last_step, recovery, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET secret = excluded.secret, last_step = excluded.last_step, recovery = excluded.recovery, created_at = excluded.created_at',
      c.email, c.pending_secret, step, JSON.stringify(hashes), new Date().toISOString());
    await run(d, 'DELETE FROM admin_setup_codes WHERE email = ?', c.email);
    // A new authenticator ends every other admin session for this person.
    await run(d, 'DELETE FROM admin_sessions WHERE email = ?', c.email);
    await done(d, c);
    await auth.log(d, c.email, 'admin.2fa.on', c.email);
    return json({ ok: true, recovery: codes }, 200, { 'Set-Cookie': await auth.startAdminSession(d, c.email, c.via) });
  }

  // Moved here from the regular sign-in page: set a main admin's password with SETUP_KEY.
  if (what === 'password') {
    const email = normEmail(b.email);
    await checkLimits(d, request, email);
    if (!env.SETUP_KEY) throw new HttpError(404, 'Setup is turned off.');
    if (!auth.sameString(String(b.key || ''), env.SETUP_KEY) || !auth.isMainAdmin(env, email)) { await fail(d, request, email, 'setup key'); throw new HttpError(403, 'That setup key or admin email is not right.'); }
    await auth.setPassword(d, email, b.password);
    await auth.log(d, email, 'admin.password', email, 'setup key');
    return json({ ok: true });
  }
  throw new HttpError(404, 'Not found.');
}

// ── For the Admin screen (admin.js) ─────────────────────────────────────
export async function makeSetupCode(d, email, by) {
  const c = b32encode(crypto.getRandomValues(new Uint8Array(8))).toLowerCase().slice(0, 12);
  const code = c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8);
  await run(d, 'INSERT INTO admin_setup_codes (email, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_by = excluded.created_by',
    email, await auth.sha256('sc:' + code), Date.now() + SETUP_CODE_HOURS * 3600000, by);
  return code;
}
export async function reset2fa(d, email) {
  await run(d, 'DELETE FROM admin_2fa WHERE email = ?', email);
  await run(d, 'DELETE FROM admin_sessions WHERE email = ?', email);
}
export async function newRecovery(d, email) {
  const { codes, hashes } = await recoveryCodes();
  await run(d, 'UPDATE admin_2fa SET recovery = ? WHERE email = ?', JSON.stringify(hashes), email);
  return codes;
}
export async function status(d, email) {
  const f = await one(d, 'SELECT created_at, recovery FROM admin_2fa WHERE email = ?', email);
  const sc = await one(d, 'SELECT expires_at FROM admin_setup_codes WHERE email = ? AND expires_at > ?', email, Date.now());
  return { on: !!f, since: f ? f.created_at : null, recoveryLeft: f ? JSON.parse(f.recovery || '[]').length : 0, setupCodeUntil: sc ? new Date(sc.expires_at).toISOString() : null };
}
