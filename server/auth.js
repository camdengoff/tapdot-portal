// Sign-in for the TapDot portal: email + password, and Sign in with Google.
//
// Nobody can sign up on their own. A person can sign in once their email is an admin
// (ADMIN_EMAILS) or a member of a church. Passwords are set through one-time links that an
// admin or church owner copies from the portal and sends them, which is also how resets work.
// Google sign-in works for the same people, with no link needed.
import { HttpError, one, run, normEmail } from './db.js';

const SESSION_DAYS = 30;
const LINK_DAYS = 7;
const PBKDF2_ROUNDS = 100000; // the most Cloudflare Workers allow
const COOKIE = 'td_session';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

export async function hashPassword(password, saltHex) {
  const salt = saltHex || randomHex(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ROUNDS }, key, 256);
  return { hash: hex(bits), salt };
}
export function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function checkPasswordRules(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Use a password of at least 10 characters.');
  if (pw.length > 200) throw new HttpError(400, 'That password is too long.');
}

export const adminEmails = (env) => String(env.ADMIN_EMAILS || '').split(',').map(normEmail).filter(Boolean);
export const isAdmin = (env, email) => adminEmails(env).includes(normEmail(email));

// Someone may sign in if they are an admin or belong to at least one church.
export async function mayUsePortal(d, env, email) {
  if (isAdmin(env, email)) return true;
  return !!(await one(d, 'SELECT 1 FROM members WHERE email = ? LIMIT 1', email));
}

// ── Sessions ───────────────────────────────────────────────────────────
// The cookie holds a random token; the database only keeps its hash.
function readCookie(request, name) {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(request.headers.get('Cookie') || '');
  return m ? m[1] : '';
}
export async function currentUser(d, env, request) {
  const token = readCookie(request, COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const s = await one(d, 'SELECT email, expires_at FROM sessions WHERE id = ?', await sha256(token));
  if (!s || s.expires_at < Date.now()) return null;
  if (!(await mayUsePortal(d, env, s.email))) return null;
  const u = await one(d, 'SELECT email, name, pw_hash, google_sub FROM users WHERE email = ?', s.email);
  if (!u) return null;
  return { email: u.email, name: u.name, hasPassword: !!u.pw_hash, hasGoogle: !!u.google_sub, admin: isAdmin(env, u.email) };
}
export async function startSession(d, email) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await run(d, 'DELETE FROM sessions WHERE expires_at < ?', Date.now());
  await run(d, 'INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)', await sha256(token), email, expires);
  return COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_DAYS * 86400;
}
export async function endSession(d, request) {
  const token = readCookie(request, COOKIE);
  if (token) await run(d, 'DELETE FROM sessions WHERE id = ?', await sha256(token));
  return COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}
async function ensureUser(d, email) {
  await run(d, 'INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)', email, new Date().toISOString());
}

// ── Passwords ──────────────────────────────────────────────────────────
const MAX_FAILS = 10;
const FAIL_WINDOW = 15 * 60 * 1000;
export async function passwordLogin(d, env, emailIn, password) {
  const email = normEmail(emailIn);
  const wrong = new HttpError(401, 'That email and password don’t match.');
  if (!email || typeof password !== 'string' || !password) throw wrong;
  await run(d, 'DELETE FROM login_fails WHERE at < ?', Date.now() - FAIL_WINDOW);
  const fails = await one(d, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ?', email);
  if (fails && fails.n >= MAX_FAILS) throw new HttpError(429, 'Too many tries. Wait 15 minutes, or ask for a new password link.');
  const u = await one(d, 'SELECT email, pw_hash, pw_salt FROM users WHERE email = ?', email);
  const ok = u && u.pw_hash && sameString((await hashPassword(password, u.pw_salt)).hash, u.pw_hash);
  if (!ok || !(await mayUsePortal(d, env, email))) {
    await run(d, 'INSERT INTO login_fails (email, at) VALUES (?, ?)', email, Date.now());
    if (u && !u.pw_hash) throw new HttpError(401, 'This account has no password yet. Use Sign in with Google, or ask for a password link.');
    throw wrong;
  }
  await run(d, 'DELETE FROM login_fails WHERE email = ?', email);
  return startSession(d, email);
}
export async function setPassword(d, email, password) {
  checkPasswordRules(password);
  await ensureUser(d, email);
  const { hash, salt } = await hashPassword(password);
  await run(d, 'UPDATE users SET pw_hash = ?, pw_salt = ? WHERE email = ?', hash, salt, email);
  // Signing out everywhere else is the safe default after a password change.
  await run(d, 'DELETE FROM sessions WHERE email = ?', email);
}
export async function verifyPassword(d, email, password) {
  const u = await one(d, 'SELECT pw_hash, pw_salt FROM users WHERE email = ?', email);
  return !!(u && u.pw_hash && sameString((await hashPassword(String(password || ''), u.pw_salt)).hash, u.pw_hash));
}

// ── One-time password links ────────────────────────────────────────────
export async function makeLink(d, request, email) {
  const token = randomHex(24);
  await run(d, 'DELETE FROM links WHERE expires_at < ? OR email = ?', Date.now(), email);
  await run(d, 'INSERT INTO links (id, email, expires_at) VALUES (?, ?, ?)', await sha256(token), email, Date.now() + LINK_DAYS * 864e5);
  return new URL('/app/login.html#set=' + token, request.url).href;
}
export async function readLink(d, token) {
  if (!/^[0-9a-f]{48}$/.test(token || '')) return null;
  const l = await one(d, 'SELECT email, expires_at FROM links WHERE id = ?', await sha256(token));
  return l && l.expires_at > Date.now() ? l.email : null;
}
export async function useLink(d, env, token, password, name) {
  const email = await readLink(d, token);
  if (!email) throw new HttpError(400, 'This link has expired or was already used. Ask for a new one.');
  if (!(await mayUsePortal(d, env, email))) throw new HttpError(403, 'This email no longer has access to any church.');
  await setPassword(d, email, password);
  if (name) await run(d, 'UPDATE users SET name = ? WHERE email = ?', String(name).slice(0, 80), email);
  await run(d, 'DELETE FROM links WHERE email = ?', email);
  return startSession(d, email);
}

// ── Sign in with Google (OpenID Connect, authorization code flow) ──────
export const googleEnabled = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const googleRedirect = (request) => new URL('/api/auth/google/callback', request.url).href;

export function googleStart(env, request) {
  if (!googleEnabled(env)) throw new HttpError(404, 'Google sign-in is not set up.');
  const state = randomHex(16);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(request), response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  return new Response(null, { status: 302, headers: {
    Location: u.href,
    'Set-Cookie': 'td_gstate=' + state + '; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600',
  } });
}

export async function googleCallback(d, env, request) {
  const url = new URL(request.url);
  const back = (msg) => new Response(null, { status: 302, headers: {
    Location: '/app/login.html#error=' + encodeURIComponent(msg),
    'Set-Cookie': 'td_gstate=; Path=/api/auth/google; Max-Age=0',
  } });
  if (!googleEnabled(env)) return back('Google sign-in is not set up.');
  const state = url.searchParams.get('state');
  if (!state || state !== readCookie(request, 'td_gstate')) return back('Google sign-in timed out. Please try again.');
  const code = url.searchParams.get('code');
  if (!code) return back('Google sign-in was cancelled.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirect(request), grant_type: 'authorization_code' }),
  });
  if (!r.ok) return back('Google sign-in failed. Please try again.');
  const tok = await r.json();
  // The ID token came straight from Google over HTTPS, so its claims can be read without
  // checking the signature (OpenID Connect Core 3.1.3.7); the audience is still checked.
  let claims;
  try {
    const part = tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch (e) { return back('Google sign-in failed. Please try again.'); }
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss) || claims.exp * 1000 < Date.now()) return back('Google sign-in failed. Please try again.');
  if (!claims.email || claims.email_verified !== true) return back('Your Google account’s email is not verified.');
  const email = normEmail(claims.email);
  if (!(await mayUsePortal(d, env, email))) return back(email + ' hasn’t been added to a church yet. Ask whoever runs your church’s pages to add you.');
  const u = await one(d, 'SELECT google_sub FROM users WHERE email = ?', email);
  if (u && u.google_sub && u.google_sub !== claims.sub) return back('A different Google account is linked to ' + email + '.');
  await ensureUser(d, email);
  await run(d, "UPDATE users SET google_sub = ?, name = CASE WHEN name = '' THEN ? ELSE name END WHERE email = ?", claims.sub, String(claims.name || '').slice(0, 80), email);
  const cookie = await startSession(d, email);
  const h = new Headers({ Location: '/app/' });
  h.append('Set-Cookie', cookie);
  h.append('Set-Cookie', 'td_gstate=; Path=/api/auth/google; Max-Age=0');
  return new Response(null, { status: 302, headers: h });
}
