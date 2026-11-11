// The Admin screen (/app/#admin): every account, church and change across DoorStep, for admins.
//
// Admins: main admins come from ADMIN_EMAILS and can't be changed here. A main admin can make
// other people admins (the `admins` table). Those admins can do everything on this screen except
// make or remove admins, and they can't act on another admin's account (reset its password, turn it
// off, ...), so an admin can never take over or lock out someone above them.
//
// Routes (all under /api/admin/, signed-in admins only):
//   GET    overview                       totals for the top of the screen
//   GET    people                         every account, with churches, roles and sign-in details
//   POST   people                         add a person {email, name, church?, role?, admin?}
//   GET    people/<email>                 one person, with their recent activity
//   PATCH  people/<email>                 {name?, disabled?, email?} (email = change their address)
//   DELETE people/<email>                 delete the account and all its access
//   POST   people/<email>/link            a one-time link to set a new password
//   POST   people/<email>/signout         sign them out everywhere
//   POST   people/<email>/remove-password the password stops working (Google or a new link still do)
//   POST   people/<email>/unlink-google   a different Google account with this email can link next time
//   PUT    people/<email>/admin           {admin: true|false} (main admins only)
//   PUT    people/<email>/churches/<id>   {role} add to a church or change role
//   DELETE people/<email>/churches/<id>   remove from a church
//   GET    churches                       every church with page, people and publish counts
//   GET    activity?before=<id>&q=<text>  the change log, newest first, 100 at a time
import { HttpError, now, all, one, run, normEmail, isEmail, isSlug } from './db.js';
import * as auth from './auth.js';

const ROLES = ['owner', 'editor', 'viewer'];
const KEEP_LOG_DAYS = 365;

// Who someone is, admin-wise: 'main' (ADMIN_EMAILS), 'admin' (made here), or ''.
async function adminKind(d, env, email) {
  if (auth.isMainAdmin(env, email)) return 'main';
  return (await one(d, 'SELECT 1 FROM admins WHERE email = ?', email)) ? 'admin' : '';
}

// Every email the portal knows: accounts, church members and admins (members who never signed in
// have no account row yet).
async function knownEmails(d, env) {
  const rows = await all(d, 'SELECT email FROM users UNION SELECT email FROM members UNION SELECT email FROM admins');
  const set = new Set(rows.map((r) => r.email));
  auth.adminEmails(env).forEach((e) => set.add(e));
  return [...set];
}

async function people(d, env, only) {
  const emails = only ? [only] : await knownEmails(d, env);
  if (!emails.length) return [];
  const where = only ? ' WHERE email = ?' : '';
  const arg = only ? [only] : [];
  const [users, info, members, admins, sessions] = await Promise.all([
    all(d, 'SELECT email, name, created_at, (pw_hash IS NOT NULL) AS pw, (google_sub IS NOT NULL) AS g FROM users' + where, ...arg),
    all(d, 'SELECT * FROM account_info' + where, ...arg),
    all(d, 'SELECT m.email, m.church_id AS id, c.name, m.role, m.added_at AS addedAt FROM members m JOIN churches c ON c.id = m.church_id' + (only ? ' WHERE m.email = ?' : '') + ' ORDER BY c.name', ...arg),
    all(d, 'SELECT * FROM admins' + where, ...arg),
    all(d, 'SELECT email, COUNT(*) AS n FROM sessions WHERE expires_at > ?' + (only ? ' AND email = ?' : '') + ' GROUP BY email', Date.now(), ...arg),
  ]);
  const by = (list) => Object.fromEntries(list.map((r) => [r.email, r]));
  const U = by(users), I = by(info), A = by(admins), S = by(sessions);
  return emails.map((email) => {
    const u = U[email] || {}, i = I[email] || {};
    const main = auth.isMainAdmin(env, email);
    return {
      email, name: u.name || '',
      hasAccount: !!U[email], hasPassword: !!u.pw, hasGoogle: !!u.g, createdAt: u.created_at || null,
      lastLoginAt: i.last_login_at || null, lastLoginHow: i.last_login_how || null,
      disabled: !main && !!i.disabled_at, disabledAt: main ? null : i.disabled_at || null, disabledBy: main ? null : i.disabled_by || null,
      admin: main ? 'main' : A[email] ? 'admin' : '', adminSince: A[email] ? A[email].added_at : null,
      sessions: S[email] ? S[email].n : 0,
      churches: members.filter((m) => m.email === email).map(({ id, name, role, addedAt }) => ({ id, name, role, addedAt })),
    };
  }).sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

// May `user` change `email`'s account? Nobody changes a main admin here (they change themselves
// from their own Account menu); only a main admin changes another admin.
async function guard(d, env, user, email, what) {
  const kind = await adminKind(d, env, email);
  if (kind === 'main') throw new HttpError(403, email + ' is a main admin (set in ADMIN_EMAILS), so they can’t be ' + what + ' here.');
  if (kind === 'admin' && !user.mainAdmin) throw new HttpError(403, 'Only a main admin can change another admin’s account.');
  return kind;
}
async function mustKnow(d, env, email) {
  if (!(await knownEmails(d, env)).includes(email)) throw new HttpError(404, 'There’s no account for ' + email + '.');
}

export async function route({ d, env, request, user, parts, url, json, body }) {
  if (!user.admin) throw new HttpError(403, 'Only a DoorStep admin can open the Admin screen.');
  const M = request.method;
  const n = parts.length;
  const log = (action, target, detail, churchId) => auth.log(d, user.email, action, target, detail, churchId);

  if (M === 'GET' && n === 2 && parts[1] === 'overview') {
    const day30 = new Date(Date.now() - 30 * 864e5).toISOString();
    const [c, p, live, active, off, ad] = await Promise.all([
      one(d, 'SELECT COUNT(*) AS n FROM churches'),
      one(d, 'SELECT COUNT(*) AS n FROM pages'),
      one(d, 'SELECT COUNT(*) AS n FROM pages WHERE published_at IS NOT NULL'),
      one(d, 'SELECT COUNT(*) AS n FROM account_info WHERE last_login_at > ?', day30),
      one(d, 'SELECT COUNT(*) AS n FROM account_info WHERE disabled_at IS NOT NULL'),
      one(d, 'SELECT COUNT(*) AS n FROM admins'),
    ]);
    const all_ = await knownEmails(d, env);
    return json({
      churches: c.n, pages: p.n, livePages: live.n, people: all_.length, active30: active.n, disabled: off.n,
      admins: ad.n + auth.adminEmails(env).length, you: { email: user.email, main: !!user.mainAdmin },
    });
  }

  if (M === 'GET' && n === 2 && parts[1] === 'churches') {
    const rows = await all(d, `SELECT c.id, c.name, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM pages p WHERE p.church_id = c.id) AS pages,
      (SELECT COUNT(*) FROM pages p WHERE p.church_id = c.id AND p.published_at IS NOT NULL) AS livePages,
      (SELECT MAX(p.draft_at) FROM pages p WHERE p.church_id = c.id) AS lastEdit,
      (SELECT MAX(p.published_at) FROM pages p WHERE p.church_id = c.id) AS lastPublish,
      (SELECT COUNT(*) FROM members m WHERE m.church_id = c.id) AS people,
      (SELECT COUNT(*) FROM members m WHERE m.church_id = c.id AND m.role = 'owner') AS owners
      FROM churches c ORDER BY c.name`);
    return json({ churches: rows });
  }

  if (M === 'GET' && n === 2 && parts[1] === 'activity') {
    const before = +url.searchParams.get('before') || 0;
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
    if (!before) await run(d, 'DELETE FROM audit WHERE at < ?', new Date(Date.now() - KEEP_LOG_DAYS * 864e5).toISOString());
    const like = '%' + q.replace(/[%_\\]/g, (c) => '\\' + c) + '%';
    const rows = await all(d, 'SELECT * FROM audit WHERE (? = 0 OR id < ?)' + (q ? " AND (actor LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR church_id LIKE ? ESCAPE '\\' OR action LIKE ? ESCAPE '\\')" : '') + ' ORDER BY id DESC LIMIT 101',
      before, before, ...(q ? [like, like, like, like] : []));
    return json({ items: rows.slice(0, 100), more: rows.length > 100 });
  }

  if (parts[1] !== 'people') throw new HttpError(404, 'Not found.');

  if (n === 2 && M === 'GET') return json({ people: await people(d, env) });

  if (n === 2 && M === 'POST') {
    const b = await body(request);
    const email = normEmail(b.email);
    if (!isEmail(email)) throw new HttpError(400, 'That doesn’t look like an email address.');
    const name = String(b.name || '').trim().slice(0, 80);
    const church = b.church ? String(b.church) : '';
    if (church && !(isSlug(church) && (await one(d, 'SELECT 1 FROM churches WHERE id = ?', church)))) throw new HttpError(400, 'Pick a church from the list.');
    if (!church && !b.admin) throw new HttpError(400, 'Add them to a church, or make them an admin, so they can sign in.');
    if (b.admin && !user.mainAdmin) throw new HttpError(403, 'Only a main admin can make someone an admin.');
    const existed = await one(d, 'SELECT pw_hash, google_sub FROM users WHERE email = ?', email);
    await run(d, 'INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)', email, now());
    if (name) await run(d, "UPDATE users SET name = ? WHERE email = ? AND name = ''", name, email);
    if (church) {
      const role = ROLES.includes(b.role) ? b.role : 'editor';
      await run(d, 'INSERT INTO members (church_id, email, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (church_id, email) DO UPDATE SET role = excluded.role', church, email, role, now());
      await log('member.add', email, role, church);
    }
    if (b.admin) {
      await run(d, 'INSERT OR IGNORE INTO admins (email, added_at, added_by) VALUES (?, ?, ?)', email, now(), user.email);
      await log('admin.add', email);
    }
    const fresh = !existed || (!existed.pw_hash && !existed.google_sub);
    const link = fresh && !auth.isMainAdmin(env, email) ? await auth.makeLink(d, request, email) : null;
    return json({ email, link }, 201);
  }

  const email = normEmail(parts[2]);
  if (!isEmail(email)) throw new HttpError(404, 'No such person.');

  if (n === 3 && M === 'GET') {
    await mustKnow(d, env, email);
    const [p] = await people(d, env, email);
    const activity = await all(d, 'SELECT * FROM audit WHERE target = ? OR actor = ? ORDER BY id DESC LIMIT 50', email, email);
    return json({ person: p, activity, you: { email: user.email, main: !!user.mainAdmin } });
  }

  if (n === 3 && M === 'PATCH') {
    await mustKnow(d, env, email);
    const b = await body(request);
    if (typeof b.name === 'string') {
      if (email !== user.email) await guard(d, env, user, email, 'renamed');
      await run(d, 'INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)', email, now());
      await run(d, 'UPDATE users SET name = ? WHERE email = ?', b.name.trim().slice(0, 80), email);
      await log('person.rename', email, b.name.trim().slice(0, 80));
    }
    if (typeof b.disabled === 'boolean') {
      if (email === user.email) throw new HttpError(400, 'You can’t turn off your own account.');
      await guard(d, env, user, email, 'turned off');
      if (b.disabled) {
        await run(d, 'INSERT INTO account_info (email, disabled_at, disabled_by) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET disabled_at = excluded.disabled_at, disabled_by = excluded.disabled_by', email, now(), user.email);
        await run(d, 'DELETE FROM sessions WHERE email = ?', email);
        await run(d, 'DELETE FROM links WHERE email = ?', email);
      } else {
        await run(d, 'UPDATE account_info SET disabled_at = NULL, disabled_by = NULL WHERE email = ?', email);
      }
      await log(b.disabled ? 'person.disable' : 'person.enable', email);
    }
    if (typeof b.email === 'string' && normEmail(b.email) !== email) {
      if (email === user.email) throw new HttpError(400, 'Ask another admin to change your own email.');
      await guard(d, env, user, email, 'changed');
      const to = normEmail(b.email);
      if (!isEmail(to)) throw new HttpError(400, 'That doesn’t look like an email address.');
      if (auth.isMainAdmin(env, to) || (await knownEmails(d, env)).includes(to)) throw new HttpError(409, to + ' already has an account. Delete one of them first, or add that one to the churches instead.');
      // Their Google link is dropped (it was for the old address); everything else moves over.
      await d.batch([
        d.prepare('UPDATE users SET email = ?, google_sub = NULL WHERE email = ?').bind(to, email),
        d.prepare('UPDATE members SET email = ? WHERE email = ?').bind(to, email),
        d.prepare('UPDATE admins SET email = ? WHERE email = ?').bind(to, email),
        d.prepare('UPDATE account_info SET email = ? WHERE email = ?').bind(to, email),
        d.prepare('DELETE FROM sessions WHERE email = ?').bind(email),
        d.prepare('DELETE FROM links WHERE email = ?').bind(email),
        d.prepare('DELETE FROM login_fails WHERE email = ?').bind(email),
      ]);
      await log('person.email', to, 'was ' + email);
      return json({ ok: true, email: to });
    }
    return json({ ok: true });
  }

  if (n === 3 && M === 'DELETE') {
    await mustKnow(d, env, email);
    if (email === user.email) throw new HttpError(400, 'You can’t delete your own account.');
    await guard(d, env, user, email, 'deleted');
    await d.batch([
      d.prepare('DELETE FROM members WHERE email = ?').bind(email),
      d.prepare('DELETE FROM admins WHERE email = ?').bind(email),
      d.prepare('DELETE FROM sessions WHERE email = ?').bind(email),
      d.prepare('DELETE FROM links WHERE email = ?').bind(email),
      d.prepare('DELETE FROM login_fails WHERE email = ?').bind(email),
      d.prepare('DELETE FROM account_info WHERE email = ?').bind(email),
      d.prepare('DELETE FROM users WHERE email = ?').bind(email),
    ]);
    await log('person.delete', email);
    return json({ ok: true });
  }

  if (n === 4 && M === 'POST') {
    await mustKnow(d, env, email);
    const what = parts[3];
    if (what === 'link') {
      await guard(d, env, user, email, 'sent a password link');
      if (await auth.isDisabled(d, email)) throw new HttpError(400, 'Turn their account back on first.');
      if (!(await auth.mayUsePortal(d, env, email))) throw new HttpError(400, 'Add them to a church first, so they have something to sign in to.');
      const link = await auth.makeLink(d, request, email);
      await log('person.link', email);
      return json({ link });
    }
    if (what === 'signout') {
      if (email !== user.email) await guard(d, env, user, email, 'signed out');
      await run(d, 'DELETE FROM sessions WHERE email = ?', email);
      await log('person.signout', email);
      return json({ ok: true });
    }
    if (what === 'remove-password') {
      await guard(d, env, user, email, 'changed');
      await run(d, 'UPDATE users SET pw_hash = NULL, pw_salt = NULL WHERE email = ?', email);
      await run(d, 'DELETE FROM sessions WHERE email = ?', email);
      await log('person.nopassword', email);
      return json({ ok: true });
    }
    if (what === 'unlink-google') {
      await guard(d, env, user, email, 'changed');
      await run(d, 'UPDATE users SET google_sub = NULL WHERE email = ?', email);
      await log('person.nogoogle', email);
      return json({ ok: true });
    }
    throw new HttpError(404, 'Not found.');
  }

  if (n === 4 && M === 'PUT' && parts[3] === 'admin') {
    if (!user.mainAdmin) throw new HttpError(403, 'Only a main admin can make or remove admins.');
    if (auth.isMainAdmin(env, email)) throw new HttpError(400, email + ' is a main admin. Change ADMIN_EMAILS in Cloudflare to change that.');
    await mustKnow(d, env, email);
    const b = await body(request);
    if (b.admin) {
      await run(d, 'INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)', email, now());
      await run(d, 'INSERT OR IGNORE INTO admins (email, added_at, added_by) VALUES (?, ?, ?)', email, now(), user.email);
    } else {
      await run(d, 'DELETE FROM admins WHERE email = ?', email);
      if (!(await auth.mayUsePortal(d, env, email))) await run(d, 'DELETE FROM sessions WHERE email = ?', email);
    }
    await log(b.admin ? 'admin.add' : 'admin.remove', email);
    return json({ ok: true });
  }

  if (n === 5 && parts[3] === 'churches') {
    const cid = parts[4];
    const c = isSlug(cid) && (await one(d, 'SELECT id FROM churches WHERE id = ?', cid));
    if (!c) throw new HttpError(404, 'No such church.');
    if (M === 'PUT') {
      const b = await body(request);
      const role = ROLES.includes(b.role) ? b.role : 'editor';
      const was = await one(d, 'SELECT 1 FROM members WHERE church_id = ? AND email = ?', cid, email);
      await run(d, 'INSERT INTO members (church_id, email, role, added_at) VALUES (?, ?, ?, ?) ON CONFLICT (church_id, email) DO UPDATE SET role = excluded.role', cid, email, role, now());
      await log(was ? 'member.role' : 'member.add', email, role, cid);
      return json({ ok: true });
    }
    if (M === 'DELETE') {
      await run(d, 'DELETE FROM members WHERE church_id = ? AND email = ?', cid, email);
      if (!(await auth.mayUsePortal(d, env, email))) await run(d, 'DELETE FROM sessions WHERE email = ?', email);
      await log('member.remove', email, '', cid);
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found.');
}
