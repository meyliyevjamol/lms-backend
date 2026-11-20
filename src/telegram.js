'use strict';
/*
 * Telegram bot: xodim o'z Telegram akkauntini ulaydi va muddatlar bo'yicha eslatmalar oladi.
 *  - Ulash: profil → "Telegramni ulash" → t.me/<bot>?start=<bir martalik token>
 *  - Long polling (webhook shart emas), TELEGRAM_BOT_TOKEN bo'lmasa — o'chiq.
 */
const crypto = require('node:crypto');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API = `https://api.telegram.org/bot${TOKEN}`;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

let botUsername = '';
let ctx = null; // { q, courseState, isAssignedTo, courseOut }

async function call(method, body) {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(65000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`${method}: ${j.description || r.status}`);
  return j.result;
}

function linkButton(path, text) {
  if (!PUBLIC_URL || !PUBLIC_URL.startsWith('https://')) return undefined;
  return { inline_keyboard: [[{ text, url: `${PUBLIC_URL}/#${path}` }]] };
}

async function send(chatId, html, markup) {
  if (!TOKEN || !chatId) return false;
  try {
    await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup });
    return true;
  } catch (e) {
    // Xodim botni bloklagan bo'lsa — ulanishni o'chiramiz
    if (/blocked|chat not found|deactivated/i.test(e.message) && ctx) ctx.q('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').run(String(chatId));
    console.error('telegram send:', e.message);
    return false;
  }
}

function sendToUser(userId, html, path, button = 'Platformani ochish') {
  if (!TOKEN || !ctx) return;
  const u = ctx.q('SELECT telegram_chat_id FROM users WHERE id = ?').get(userId);
  if (u?.telegram_chat_id) send(u.telegram_chat_id, html, path ? linkButton(path, button) : undefined);
}

function createLink(userId) {
  const token = crypto.randomBytes(16).toString('hex');
  ctx.q('DELETE FROM tg_links WHERE user_id = ? OR created_at < ?').run(userId, new Date(Date.now() - 864e5).toISOString());
  ctx.q('INSERT INTO tg_links (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, new Date().toISOString());
  return { url: `https://t.me/${botUsername}?start=${token}`, botUsername };
}

function statusText(user) {
  const { q, courseState, isAssignedTo, courseOut } = ctx;
  const courses = q('SELECT * FROM courses WHERE published = 1').all().filter((c) => isAssignedTo(c, user));
  if (!courses.length) return 'Sizga hozircha trening tayinlanmagan.';
  const lines = courses.map((c) => {
    const st = courseState(c, user);
    const icon = st.status === 'completed' ? '✅' : st.overdue ? '⛔️' : st.status === 'failed' ? '❌' : '🕓';
    const extra = st.status === 'completed' ? (st.best !== null && c.show_result ? ` — ${st.best}%` : '')
      : st.status === 'failed' ? ` — o‘tmadi${st.attemptsLeft ? ', qayta topshirish mumkin' : ''}`
      : ` — ${st.lessonsDone}/${st.lessonsTotal} material${c.deadline ? `, muddat: ${fmt(c.deadline)}` : ''}`;
    return `${icon} <b>${esc(courseOut(c).testTitle)}</b>${esc(extra)}`;
  });
  return `<b>Sizning vazifalaringiz:</b>\n\n${lines.join('\n')}`;
}

async function onUpdate(upd) {
  const m = upd.message;
  if (!m?.text || m.chat?.type !== 'private') return;
  const chatId = String(m.chat.id);
  const { q } = ctx;
  const [cmd, arg] = m.text.trim().split(/\s+/, 2);
  const linked = q('SELECT * FROM users WHERE telegram_chat_id = ?').get(chatId);
  if (cmd === '/start' && arg) {
    const row = q('SELECT * FROM tg_links WHERE token = ?').get(arg);
    if (!row || Date.now() - Date.parse(row.created_at) > 864e5) {
      return send(chatId, '⚠️ Havola eskirgan. Platformadagi profilingizdan «Telegramni ulash» tugmasini qayta bosing.');
    }
    q('UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = ?').run(chatId);
    q('UPDATE users SET telegram_chat_id = ?, telegram_username = ?, telegram_linked_at = ? WHERE id = ?')
      .run(chatId, m.from?.username || m.from?.first_name || '', new Date().toISOString(), row.user_id);
    q('DELETE FROM tg_links WHERE token = ?').run(arg);
    const u = q('SELECT * FROM users WHERE id = ?').get(row.user_id);
    await send(chatId, `✅ <b>${esc(u.name)}</b>, Telegram muvaffaqiyatli ulandi!\n\nEndi yangi treninglar, muddatlar va natijalar haqida shu yerga xabar keladi.\n\n/status — vazifalaringiz\n/stop — ulanishni o‘chirish`, linkButton('/', 'Platformani ochish'));
    return send(chatId, statusText(u));
  }
  if (cmd === '/status' || cmd === '/vazifalar') {
    if (!linked) return send(chatId, 'Avval platformadagi profilingizdan «Telegramni ulash» tugmasini bosing.');
    return send(chatId, statusText(linked), linkButton('/', 'Platformani ochish'));
  }
  if (cmd === '/stop') {
    if (linked) q('UPDATE users SET telegram_chat_id = NULL WHERE id = ?').run(linked.id);
    return send(chatId, 'Ulanish o‘chirildi. Qayta ulash uchun platformadagi profilingizdan foydalaning.');
  }
  return send(chatId, linked
    ? `Salom, <b>${esc(linked.name)}</b>!\n\n/status — vazifalaringiz va muddatlar\n/stop — ulanishni o‘chirish`
    : '👋 Bu — xodimlarni o‘qitish platformasining boti.\n\nUlash uchun platformaga kiring → <b>Profil</b> → «Telegramni ulash».');
}

let offset = 0;
async function poll() {
  for (;;) {
    try {
      const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      for (const u of updates) { offset = u.update_id + 1; await onUpdate(u).catch((e) => console.error('telegram update:', e.message)); }
    } catch (e) {
      console.error('telegram poll:', e.message);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

// Muddat eslatmalari: 3 kun qolganda, 1 kun qolganda, muddat o'tganda (har biri bir marta)
function checkDeadlines() {
  const { q, courseState, isAssignedTo, courseOut } = ctx;
  const now = Date.now();
  const users = q("SELECT * FROM users WHERE role = 'employee' AND telegram_chat_id IS NOT NULL").all();
  if (!users.length) return;
  for (const c of q('SELECT * FROM courses WHERE published = 1 AND deadline IS NOT NULL').all()) {
    const left = Date.parse(c.deadline) - now;
    const stage = left < 0 ? (left > -3 * 864e5 ? 'overdue' : null) : left <= 864e5 ? '1d' : left <= 3 * 864e5 ? '3d' : null;
    if (!stage) continue;
    for (const u of users) {
      if (!isAssignedTo(c, u)) continue;
      const st = courseState(c, u);
      if (st.status === 'completed' || st.submitted) continue;
      if (q('SELECT 1 FROM tg_sent WHERE user_id = ? AND course_id = ? AND stage = ?').get(u.id, c.id, stage)) continue;
      q('INSERT INTO tg_sent (user_id, course_id, stage, sent_at) VALUES (?, ?, ?, ?)').run(u.id, c.id, stage, new Date().toISOString());
      const t = esc(courseOut(c).testTitle);
      const text = stage === 'overdue'
        ? `⛔️ <b>Muddat o‘tdi</b>\n\n«${t}» testini topshirish muddati ${fmt(c.deadline)} da tugadi. Iltimos, imkon qadar tezroq topshiring.`
        : `⏰ <b>Muddat yaqinlashmoqda</b>\n\n«${t}» — ${stage === '1d' ? '1 kundan kam' : '3 kun'} qoldi (${fmt(c.deadline)}).\nMateriallar: ${st.lessonsDone}/${st.lessonsTotal}`;
      send(u.telegram_chat_id, text, linkButton(`/course/${c.id}`, stage === 'overdue' ? 'Testni topshirish' : 'Davom ettirish'));
    }
  }
}

async function start(context) {
  ctx = context;
  if (!TOKEN) { console.log('Telegram: TELEGRAM_BOT_TOKEN berilmagan — bot o‘chiq'); return; }
  try {
    const me = await call('getMe');
    botUsername = me.username;
    await call('setMyCommands', { commands: [{ command: 'status', description: 'Vazifalarim va muddatlar' }, { command: 'stop', description: 'Ulanishni o‘chirish' }] }).catch(() => {});
    await call('deleteWebhook', {}).catch(() => {});
    console.log(`Telegram bot: @${botUsername}`);
    poll();
    setTimeout(checkDeadlines, 30000);
    setInterval(checkDeadlines, 30 * 60e3);
  } catch (e) { console.error('Telegram bot ishga tushmadi:', e.message); }
}

module.exports = { start, sendToUser, createLink, enabled: () => !!TOKEN && !!botUsername, botName: () => botUsername };
