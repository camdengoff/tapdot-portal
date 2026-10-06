// Connect card answers: visitors fill in a Connect card block on a live page, and the answers are
// kept here for the church's staff to read in the portal (and emailed to them when email is set up).
//
// Email is optional and uses Resend (resend.com): set RESEND_API_KEY (secret) and MAIL_FROM
// (e.g. "TapDot <forms@camdengoff.com>", on a domain verified in Resend).
import { HttpError, all, one, run, now, isEmail, normEmail } from './db.js';

const MAX_BODY = 30000;
const PER_VISITOR = 5; // sends per visitor per page every 10 minutes
const PER_PAGE_DAY = 500;

const enc = new TextEncoder();
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
// Rich text marks from the editor ([[color|words]], **bold**, ==accent==, [text](url)) → plain words.
const plain = (s) => String(s || '').replace(/\[\[[^|\]]*\|([^\]]*)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*\*|==|\*/g, '').trim();

// The form block as last saved in the editor, for its title and who to email.
async function formBlock(env, churchId, pageId, blockId) {
  try {
    const draft = JSON.parse((await env.PAGES.get('draft:' + churchId + '/' + pageId)) || 'null');
    return (draft && Array.isArray(draft.blocks) && draft.blocks.find((b) => b && b.id === blockId && b.type === 'form')) || null;
  } catch (e) { return null; }
}

export async function submit(d, env, request, churchId, pageId, waitUntil) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'That’s too much text to send.');
  let b;
  try { b = JSON.parse(text); } catch (e) { throw new HttpError(400, 'The form could not be read.'); }
  const page = await one(d, 'SELECT name FROM pages WHERE church_id = ? AND id = ? AND published_at IS NOT NULL', churchId, pageId);
  if (!page) throw new HttpError(404, 'This form is no longer taking answers.');
  // Bots fill in the hidden "website" box, or send faster than a person can type: pretend it worked.
  if (b.website || (+b.ms || 0) < 1500) return;
  const answers = (Array.isArray(b.answers) ? b.answers : []).slice(0, 40).map((x) => ({
    q: String((x && x.q) || '').slice(0, 200), a: String((x && x.a) || '').slice(0, 2000),
  }));
  if (!answers.some((x) => x.a.trim())) throw new HttpError(400, 'Please fill in the form first.');

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const who = await sha256(ip + '|' + churchId + '/' + pageId);
  await run(d, 'DELETE FROM form_hits WHERE at < ?', Date.now() - 10 * 60 * 1000);
  const hits = await one(d, 'SELECT COUNT(*) AS n FROM form_hits WHERE id = ?', who);
  if (hits.n >= PER_VISITOR) throw new HttpError(429, 'You’ve sent this a few times already. Please wait a few minutes.');
  const today = await one(d, 'SELECT COUNT(*) AS n FROM responses WHERE church_id = ? AND page_id = ? AND created_at >= ?', churchId, pageId, now().slice(0, 10));
  if (today.n >= PER_PAGE_DAY) throw new HttpError(429, 'This form has had a lot of answers today. Please try again tomorrow.');
  await run(d, 'INSERT INTO form_hits (id, at) VALUES (?, ?)', who, Date.now());

  const blockId = String(b.block || '').slice(0, 40);
  const block = await formBlock(env, churchId, pageId, blockId);
  const form = (block && plain(block.title)) || 'Connect card';
  const id = crypto.randomUUID();
  const at = now();
  await run(d, 'INSERT INTO responses (id, church_id, page_id, block_id, form, answers, created_at, seen) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
    id, churchId, pageId, blockId, form, JSON.stringify(answers), at);

  const to = String((block && block.notify) || '').split(/[,;\s]+/).map(normEmail).filter(isEmail).slice(0, 5);
  if (to.length && env.RESEND_API_KEY && env.MAIL_FROM) {
    const portal = new URL('/app/#' + churchId, request.url).href;
    const send = sendEmail(env, to, form, page.name, answers, portal).catch((e) => console.error('form email failed', e));
    if (waitUntil) waitUntil(send); else await send;
  }
}

async function sendEmail(env, to, form, pageName, answers, portal) {
  const filled = answers.filter((x) => x.a.trim());
  const replyTo = filled.map((x) => x.a.trim()).find((a) => isEmail(a));
  const name = (filled.find((x) => /name/i.test(x.q)) || filled[0]).a.trim();
  const text = filled.map((x) => x.q + ':\n' + x.a).join('\n\n') + '\n\n—\nSent from “' + pageName + '”. See every answer in the TapDot portal: ' + portal + '\n';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ from: env.MAIL_FROM, to, subject: form + ': ' + name.slice(0, 60), text }, replyTo ? { reply_to: replyTo } : {})),
  });
  if (!r.ok) throw new Error('Resend ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

// ── For signed-in church members ──────────────────────────────────────
export async function counts(d, churchId) {
  const rows = await all(d, 'SELECT page_id, COUNT(*) AS total, SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS unseen FROM responses WHERE church_id = ? GROUP BY page_id', churchId);
  const out = {};
  rows.forEach((r) => { out[r.page_id] = { total: r.total, unseen: r.unseen || 0 }; });
  return out;
}
export async function list(d, churchId, pageId) {
  const rows = await all(d, 'SELECT id, page_id, form, answers, created_at, seen FROM responses WHERE church_id = ? AND page_id = ? ORDER BY created_at DESC LIMIT 2000', churchId, pageId);
  return rows.map((r) => ({ id: r.id, pageId: r.page_id, form: r.form, answers: JSON.parse(r.answers), createdAt: r.created_at, seen: !!r.seen }));
}
export const markSeen = (d, churchId, pageId) => run(d, 'UPDATE responses SET seen = 1 WHERE church_id = ? AND page_id = ? AND seen = 0', churchId, pageId);
export const remove = (d, churchId, id) => run(d, 'DELETE FROM responses WHERE church_id = ? AND id = ?', churchId, id);
