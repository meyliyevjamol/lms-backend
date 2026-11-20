'use strict';
/*
 * Malaka LMS — backend API
 * Trening (materiallar) + unga bog'langan test, tayinlash, proktoring, natijalar, Excel import/eksport.
 */
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const ExcelJS = require('exceljs');

const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME || "O'quv markazi";
const COMPANY_NAME = process.env.COMPANY_NAME || '';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
for (const d of [FILES_DIR, TMP_DIR, SNAP_DIR]) fs.mkdirSync(d, { recursive: true });

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
const SECRET = loadSecret();

// ================================================================ DB
const db = new DatabaseSync(path.join(DATA_DIR, 'lms.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  department TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',
  last_login_at TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_linked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_links (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_sent (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, course_id, stage)
);
-- Trening + bog'langan test (1:1)
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  test_title TEXT NOT NULL DEFAULT '',
  assign_all INTEGER NOT NULL DEFAULT 0,
  departments TEXT NOT NULL DEFAULT '[]',
  assigned_users TEXT NOT NULL DEFAULT '[]',
  deadline TEXT,
  pass_score INTEGER NOT NULL DEFAULT 70,
  time_limit_min INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 1,
  question_count INTEGER NOT NULL DEFAULT 0,
  shuffle INTEGER NOT NULL DEFAULT 1,
  show_result INTEGER NOT NULL DEFAULT 1,
  show_correct INTEGER NOT NULL DEFAULT 0,
  require_materials INTEGER NOT NULL DEFAULT 1,
  allow_download INTEGER NOT NULL DEFAULT 0,
  proctor_camera INTEGER NOT NULL DEFAULT 0,
  proctor_screen INTEGER NOT NULL DEFAULT 1,
  max_violations INTEGER NOT NULL DEFAULT 5,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  file_name TEXT,
  orig_file_name TEXT,
  original_name TEXT,
  source_type TEXT,
  size INTEGER,
  pages INTEGER,
  duration REAL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  options TEXT NOT NULL,
  correct TEXT NOT NULL,
  multi INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS video_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  max_pos REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  deadline_at TEXT,
  finished_at TEXT,
  score INTEGER,
  correct_count INTEGER,
  total INTEGER,
  passed INTEGER,
  layout TEXT NOT NULL,
  answers TEXT,
  violations TEXT NOT NULL DEFAULT '[]',
  auto_submitted TEXT
);
CREATE TABLE IF NOT EXISTS attempt_grants (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  extra INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'periodic',
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'info',
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_questions_course ON questions(course_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_course ON attempts(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_attempts_finished ON attempts(finished_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_attempt ON snapshots(attempt_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`);

const nowIso = () => new Date().toISOString();
const q = (sql) => db.prepare(sql);
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

// ================================================================ helpers
function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  return d;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function verifyPassword(pw, stored) {
  const [s, h] = String(stored).split(':');
  if (!s || !h) return false;
  const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 32);
  const hb = Buffer.from(h, 'hex');
  return hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
}
const randomPassword = () => String(crypto.randomInt(100000, 1000000));
const SESSION_DAYS = 30;
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const makeToken = (uid) => { const v = `${uid}.${Date.now() + SESSION_DAYS * 864e5}`; return `${v}.${sign(v)}`; };
function readToken(t) {
  if (!t) return null;
  const p = t.split('.');
  if (p.length !== 3) return null;
  const s = sign(`${p[0]}.${p[1]}`);
  if (s.length !== p[2].length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(p[2]))) return null;
  if (Number(p[1]) < Date.now()) return null;
  return Number(p[0]);
}
function parseCookies(h) {
  const o = {};
  (h || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) { try { o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); } catch { /* ignore */ } }
  });
  return o;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const int = (v, def, min, max) => { const n = Number.parseInt(v, 10); return Number.isNaN(n) ? def : Math.min(max, Math.max(min, n)); };
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const bool = (v, def) => (v === undefined ? def : v ? 1 : 0);
const J = (s, d = []) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const ACTIVE_DAYS = 14;
const isActive = (u) => !!u.last_login_at && Date.now() - Date.parse(u.last_login_at) < ACTIVE_DAYS * 864e5;
const parseDeadline = (v) => {
  if (!v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T23:59:59+05:00' : v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

function publicUser(u) {
  return u && { id: u.id, name: u.name, phone: u.phone, role: u.role, department: u.department, position: u.position, createdAt: u.created_at, lastLoginAt: u.last_login_at, active: isActive(u), telegram: !!u.telegram_chat_id };
}
function courseOut(c) {
  return {
    id: c.id, title: c.title, description: c.description, category: c.category, testTitle: c.test_title || (c.title + ': yakuniy test'),
    assignAll: !!c.assign_all, departments: J(c.departments), assignedUsers: J(c.assigned_users), deadline: c.deadline,
    passScore: c.pass_score, timeLimitMin: c.time_limit_min, maxAttempts: c.max_attempts, questionCount: c.question_count,
    shuffle: !!c.shuffle, showResult: !!c.show_result, showCorrect: !!c.show_correct, requireMaterials: !!c.require_materials, allowDownload: !!c.allow_download,
    proctorCamera: !!c.proctor_camera, proctorScreen: !!c.proctor_screen, maxViolations: c.max_violations, published: !!c.published, createdAt: c.created_at,
  };
}
function lessonOut(l) {
  return {
    id: l.id, courseId: l.course_id, position: l.position, title: l.title, type: l.type, duration: l.duration, pages: l.pages,
    originalName: l.original_name, sourceType: l.source_type, size: l.size, content: l.content, hasFile: !!l.file_name,
  };
}
function questionOut(x) {
  return { id: x.id, position: x.position, text: x.text, options: J(x.options), correct: J(x.correct), multi: !!x.multi };
}
const violationCount = (a) => J(a.violations).filter((v) => v.type !== 'info').length;
const durationSec = (a) => (a.finished_at ? Math.max(0, Math.round((Date.parse(a.finished_at) - Date.parse(a.started_at)) / 1000)) : null);

function isAssignedTo(c, u) {
  return !!c.assign_all || J(c.departments).includes(u.department) || J(c.assigned_users).includes(u.id);
}
function isAssigned(c, u) {
  if (u.role === 'admin') return true;
  return !!c.published && isAssignedTo(c, u);
}
function assignedUsers(c, dep) {
  return q("SELECT * FROM users WHERE role = 'employee' ORDER BY name").all().filter((u) => isAssignedTo(c, u) && (!dep || u.department === dep));
}
const tg = require('./telegram');
const TG_ICON = { assigned: '📚', reminder: '⏰', grant: '🔁', reassigned: '🔁', info: 'ℹ️' };
function notify(userIds, courseId, kind, text) {
  const st = q('INSERT INTO notifications (user_id, course_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)');
  const html = `${TG_ICON[kind] || 'ℹ️'} ${String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
  for (const id of userIds) {
    st.run(id, courseId, kind, text, nowIso());
    tg.sendToUser(id, html, courseId ? `/course/${courseId}` : '/', kind === 'grant' ? 'Testni topshirish' : 'Platformani ochish');
  }
}

// ================================================================ attempts / state
const GRACE_MS = 90 * 1000;
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
function gradeAttempt(a, rawAnswers) {
  const course = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  const layout = J(a.layout);
  const ids = layout.map((l) => l.q);
  const qmap = new Map(ids.length ? q(`SELECT id, correct FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => [x.id, x]) : []);
  const answers = {};
  let correct = 0, total = 0;
  for (const l of layout) {
    const qq = qmap.get(l.q);
    if (!qq) continue;
    total++;
    let shown = rawAnswers ? rawAnswers[l.q] ?? rawAnswers[String(l.q)] : undefined;
    if (Number.isInteger(shown)) shown = [shown];
    const orig = Array.isArray(shown) ? [...new Set(shown.filter((i) => Number.isInteger(i) && i >= 0 && i < l.o.length).map((i) => l.o[i]))] : [];
    answers[l.q] = orig;
    if (orig.length && sameSet(orig, J(qq.correct))) correct++;
  }
  const score = total ? Math.round((correct / total) * 100) : 0;
  q('UPDATE attempts SET finished_at = ?, score = ?, correct_count = ?, total = ?, passed = ?, answers = ? WHERE id = ?')
    .run(nowIso(), score, correct, total, score >= course.pass_score ? 1 : 0, JSON.stringify(answers), a.id);
  return q('SELECT * FROM attempts WHERE id = ?').get(a.id);
}
function expireOpenAttempts(userId, courseId) {
  for (const a of q('SELECT * FROM attempts WHERE user_id = ? AND course_id = ? AND finished_at IS NULL').all(userId, courseId)) {
    if (a.deadline_at && Date.now() > Date.parse(a.deadline_at) + GRACE_MS) gradeAttempt(a, null);
  }
}
function attemptLimit(course, userId) {
  if (course.max_attempts <= 0) return null;
  const g = q('SELECT extra FROM attempt_grants WHERE user_id = ? AND course_id = ?').get(userId, course.id);
  return course.max_attempts + (g?.extra || 0);
}

function courseState(course, user) {
  expireOpenAttempts(user.id, course.id);
  const lessons = q('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id').all(course.id);
  const done = new Map(q('SELECT lp.lesson_id, lp.completed_at FROM lesson_progress lp JOIN lessons l ON l.id = lp.lesson_id WHERE lp.user_id = ? AND l.course_id = ?')
    .all(user.id, course.id).map((r) => [r.lesson_id, r.completed_at]));
  const vp = new Map(q('SELECT vp.lesson_id, vp.max_pos FROM video_progress vp JOIN lessons l ON l.id = vp.lesson_id WHERE vp.user_id = ? AND l.course_id = ?')
    .all(user.id, course.id).map((r) => [r.lesson_id, r.max_pos]));
  let unlocked = true;
  const ls = lessons.map((l) => {
    const completed = done.has(l.id);
    const locked = user.role !== 'admin' && !unlocked;
    if (!completed) unlocked = false;
    return { ...lessonOut(l), completed, completedAt: done.get(l.id) || null, locked, watchedPos: vp.get(l.id) || 0 };
  });
  const lessonsDone = ls.filter((l) => l.completed).length;
  const allLessonsDone = lessonsDone === ls.length;
  const questionTotal = q('SELECT COUNT(*) AS c FROM questions WHERE course_id = ?').get(course.id).c;
  const hasTest = questionTotal > 0;
  const atts = q('SELECT * FROM attempts WHERE user_id = ? AND course_id = ? ORDER BY id').all(user.id, course.id);
  const finished = atts.filter((a) => a.finished_at);
  const open = atts.find((a) => !a.finished_at) || null;
  const passedAttempt = finished.find((a) => a.passed);
  const best = finished.length ? Math.max(...finished.map((a) => a.score)) : null;
  const bestAttempt = finished.length ? finished.reduce((m, a) => (a.score > m.score ? a : m), finished[0]) : null;
  const last = finished.length ? finished[finished.length - 1] : null;
  const limit = attemptLimit(course, user.id);
  const attemptsLeft = limit === null ? null : Math.max(0, limit - finished.length);

  let completed, completedAt = null;
  if (hasTest) { completed = !!passedAttempt; completedAt = passedAttempt?.finished_at || null; }
  else { completed = ls.length > 0 && allLessonsDone; if (completed) completedAt = ls.map((l) => l.completedAt).sort().pop(); }
  let status = 'not_started';
  if (completed) status = 'completed';
  else if (hasTest && finished.length) status = 'failed';
  else if (lessonsDone > 0 || open) status = 'in_progress';
  const overdue = !completed && !!course.deadline && Date.parse(course.deadline) < Date.now();
  const materialsOk = !course.require_materials || allLessonsDone;
  const steps = ls.length + (hasTest ? 1 : 0);
  const stepsDone = lessonsDone + (hasTest && passedAttempt ? 1 : 0);
  return {
    lessons: ls, lessonsDone, lessonsTotal: ls.length, hasTest, questionTotal,
    testQuestionCount: course.question_count > 0 ? Math.min(course.question_count, questionTotal) : questionTotal,
    attemptsUsed: finished.length, attemptsLimit: limit, attemptsLeft, best, passed: !!passedAttempt, submitted: finished.length > 0,
    status, overdue, completedAt, progress: steps ? Math.round((stepsDone / steps) * 100) : 0,
    openAttemptId: open?.id || null, lastAttemptId: last?.id || null, bestAttemptId: bestAttempt?.id || null,
    lastScore: last?.score ?? null, lastFinishedAt: last?.finished_at || null, lastDuration: last ? durationSec(last) : null,
    materialsOk,
    canStartTest: hasTest && materialsOk && !passedAttempt && (attemptsLeft === null || attemptsLeft > 0 || !!open),
  };
}

function attemptPayload(a) {
  const layout = J(a.layout);
  const ids = layout.map((l) => l.q);
  const qmap = new Map(ids.length ? q(`SELECT id, text, options, multi FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => [x.id, x]) : []);
  const c = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  return {
    id: a.id, courseId: a.course_id, courseTitle: c.title, testTitle: courseOut(c).testTitle, startedAt: a.started_at, deadlineAt: a.deadline_at, serverNow: nowIso(),
    passScore: c.pass_score,
    proctor: { camera: !!c.proctor_camera, screen: !!c.proctor_screen, maxViolations: c.max_violations, violations: violationCount(a) },
    questions: layout.filter((l) => qmap.has(l.q)).map((l) => {
      const x = qmap.get(l.q); const opts = J(x.options);
      return { id: x.id, text: x.text, multi: !!x.multi, options: l.o.map((i) => opts[i]) };
    }),
  };
}
function reviewOf(a) {
  const layout = J(a.layout);
  const ans = J(a.answers, {});
  const ids = layout.map((l) => l.q);
  const qmap = new Map(ids.length ? q(`SELECT * FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => [x.id, x]) : []);
  return layout.filter((l) => qmap.has(l.q)).map((l, i) => {
    const x = qmap.get(l.q);
    const correct = J(x.correct);
    const chosen = Array.isArray(ans[l.q]) ? ans[l.q] : ans[l.q] === null || ans[l.q] === undefined ? [] : [ans[l.q]];
    return { n: i + 1, id: x.id, text: x.text, multi: !!x.multi, options: J(x.options), correct, chosen, isCorrect: chosen.length > 0 && sameSet(chosen, correct) };
  });
}
function resultPayload(a, user) {
  const c = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  const st = courseState(c, user);
  const number = q('SELECT COUNT(*) AS c FROM attempts WHERE user_id = ? AND course_id = ? AND id <= ? AND finished_at IS NOT NULL').get(a.user_id, a.course_id, a.id).c;
  const base = {
    id: a.id, courseId: a.course_id, courseTitle: c.title, testTitle: courseOut(c).testTitle, finishedAt: a.finished_at, durationSec: durationSec(a),
    attemptNumber: number, attemptsLimit: st.attemptsLimit, attemptsLeft: st.attemptsLeft, canRetry: st.canStartTest,
    autoSubmitted: a.auto_submitted, violations: violationCount(a), passScore: c.pass_score, showResult: !!c.show_result || user.role === 'admin',
  };
  if (!base.showResult) return base;
  return {
    ...base, score: a.score, passed: !!a.passed, correct: a.correct_count, total: a.total,
    review: c.show_correct || user.role === 'admin' ? reviewOf(a) : null,
  };
}

// ================================================================ app
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  const uid = readToken(parseCookies(req.headers.cookie).lms_session);
  req.user = uid ? q('SELECT * FROM users WHERE id = ?').get(uid) || null : null;
  next();
});
const auth = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Avval tizimga kiring' }));
const admin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: "Ruxsat yo'q" }));
const setSession = (req, res, uid) => res.cookie('lms_session', makeToken(uid), {
  httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: SESSION_DAYS * 864e5, path: '/',
});

// ---------------------------------------------------------------- auth
const loginFails = new Map();
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip;
  const rec = loginFails.get(ip);
  if (rec && rec.count >= 10 && Date.now() - rec.first < 15 * 60e3) fail(429, "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring");
  const user = q('SELECT * FROM users WHERE phone = ?').get(normalizePhone(req.body?.phone));
  if (!user || !verifyPassword(req.body?.password || '', user.password_hash)) {
    const r = rec && Date.now() - rec.first < 15 * 60e3 ? rec : { count: 0, first: Date.now() };
    r.count++; loginFails.set(ip, r);
    fail(401, "Telefon raqam yoki parol noto'g'ri");
  }
  loginFails.delete(ip);
  q('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
  setSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('lms_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  if (req.user && (!req.user.last_login_at || Date.now() - Date.parse(req.user.last_login_at) > 3600e3)) q('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), req.user.id);
  res.json({ user: publicUser(req.user), appName: APP_NAME, companyName: COMPANY_NAME });
});
app.post('/api/me/password', auth, (req, res) => {
  if (!verifyPassword(req.body?.oldPassword || '', req.user.password_hash)) fail(400, "Joriy parol noto'g'ri");
  const np = String(req.body?.newPassword || '');
  if (np.length < 6) fail(400, "Yangi parol kamida 6 belgi bo'lsin");
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), req.user.id);
  res.json({ ok: true });
});
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'lms-backend', time: nowIso() }));

// ---------------------------------------------------------------- admin: users
function saveUser(id, b) {
  const name = str(b.name, 120);
  const phone = normalizePhone(b.phone);
  if (!name) fail(400, 'Ism kiritilmagan');
  if (phone.length !== 12) fail(400, "Telefon raqam noto'g'ri");
  const role = b.role === 'admin' ? 'admin' : 'employee';
  const dup = q('SELECT id FROM users WHERE phone = ?').get(phone);
  if (dup && dup.id !== id) fail(400, 'Bu telefon raqam bilan foydalanuvchi allaqachon bor');
  const department = str(b.department, 100), position = str(b.position, 100);
  if (id) {
    q('UPDATE users SET name = ?, phone = ?, role = ?, department = ?, position = ? WHERE id = ?').run(name, phone, role, department, position, id);
    if (b.password) {
      if (String(b.password).length < 6) fail(400, "Parol kamida 6 belgi bo'lsin");
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
    }
    return { id, password: b.password || null };
  }
  const password = b.password ? String(b.password) : randomPassword();
  if (password.length < 6) fail(400, "Parol kamida 6 belgi bo'lsin");
  const r = q('INSERT INTO users (name, phone, password_hash, role, department, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(name, phone, hashPassword(password), role, department, position, nowIso());
  return { id: Number(r.lastInsertRowid), password };
}
function importUserRows(rows) {
  const created = [], errors = [];
  tx(() => rows.forEach((cells, i) => {
    const [name, phone, department, position, password] = cells.map((x) => String(x ?? '').trim());
    if (!name && !phone) return;
    if (i === 0 && /^(ism|f\.?i\.?sh|name|xodim)/i.test(name)) return;
    try {
      const r = saveUser(null, { name, phone, department, position, password });
      created.push({ name, phone: normalizePhone(phone), department, password: r.password });
    } catch (e) { errors.push({ line: i + 1, text: cells.filter(Boolean).join(' · '), error: e.message }); }
  }));
  return { created, errors };
}
app.get('/api/admin/users', auth, admin, (req, res) => {
  const users = q('SELECT * FROM users ORDER BY role, name').all();
  const courses = q('SELECT * FROM courses WHERE published = 1').all();
  res.json(users.map((u) => {
    let assigned = 0, completed = 0; const scores = [];
    if (u.role === 'employee') {
      for (const c of courses) {
        if (!isAssignedTo(c, u)) continue;
        assigned++;
        const st = courseState(c, u);
        if (st.status === 'completed') completed++;
        if (st.best !== null) scores.push(st.best);
      }
    }
    return { ...publicUser(u), assigned, completed, avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null };
  }));
});
app.get('/api/admin/departments', auth, admin, (req, res) => {
  res.json(q("SELECT department, COUNT(*) AS n FROM users WHERE role = 'employee' AND department <> '' GROUP BY department ORDER BY department").all()
    .map((r) => ({ name: r.department, count: r.n })));
});
app.post('/api/admin/users', auth, admin, (req, res) => {
  const r = saveUser(null, req.body || {});
  res.json({ user: publicUser(q('SELECT * FROM users WHERE id = ?').get(r.id)), password: r.password });
});
app.put('/api/admin/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  q('SELECT id FROM users WHERE id = ?').get(id) || fail(404, 'Topilmadi');
  if (id === req.user.id && req.body?.role !== 'admin') fail(400, "O'zingizni admin rolidan chiqara olmaysiz");
  saveUser(id, req.body || {});
  res.json({ user: publicUser(q('SELECT * FROM users WHERE id = ?').get(id)) });
});
app.delete('/api/admin/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) fail(400, "O'zingizni o'chira olmaysiz");
  q('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});
app.post('/api/admin/users/import', auth, admin, (req, res) => {
  const rows = String(req.body?.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\t|;/));
  res.json(importUserRows(rows));
});
const xlsxUpload = multer({ dest: TMP_DIR, limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
async function readSheet(file) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(file); } catch { fail(400, "Faylni o'qib bo'lmadi. Excel (.xlsx) fayl yuklang"); }
  const ws = wb.worksheets[0];
  if (!ws) fail(400, "Faylda varaq yo'q");
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let i = 1; i <= Math.max(row.cellCount, 8); i++) {
      const v = row.getCell(i).value;
      vals.push(v && typeof v === 'object' ? (v.text ?? v.result ?? v.richText?.map((t) => t.text).join('') ?? '') : v ?? '');
    }
    rows.push(vals);
  });
  return rows;
}
app.post('/api/admin/users/import-file', auth, admin, xlsxUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) fail(400, 'Fayl tanlanmagan');
    res.json(importUserRows(await readSheet(req.file.path)));
  } finally { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); }
});

// ---------------------------------------------------------------- admin: courses (trening + test)
const getCourse = (id) => q('SELECT * FROM courses WHERE id = ?').get(Number(id)) || fail(404, 'Trening topilmadi');
const COURSE_COLS = ['title', 'description', 'category', 'test_title', 'pass_score', 'time_limit_min', 'max_attempts', 'question_count', 'shuffle', 'show_result',
  'show_correct', 'require_materials', 'allow_download', 'proctor_camera', 'proctor_screen', 'max_violations', 'published'];
function readCourseBody(b, o = {}) {
  const title = str(b.title ?? o.title, 200);
  if (!title) fail(400, 'Trening nomi kiritilmagan');
  return {
    title, description: str(b.description ?? o.description ?? '', 5000), category: str(b.category ?? o.category ?? '', 60),
    test_title: str(b.testTitle ?? o.test_title ?? '', 200),
    pass_score: int(b.passScore, o.pass_score ?? 70, 1, 100), time_limit_min: int(b.timeLimitMin, o.time_limit_min ?? 0, 0, 600),
    max_attempts: int(b.maxAttempts, o.max_attempts ?? 1, 0, 100), question_count: int(b.questionCount, o.question_count ?? 0, 0, 1000),
    shuffle: bool(b.shuffle, o.shuffle ?? 1), show_result: bool(b.showResult, o.show_result ?? 1), show_correct: bool(b.showCorrect, o.show_correct ?? 0),
    require_materials: bool(b.requireMaterials, o.require_materials ?? 1), allow_download: bool(b.allowDownload, o.allow_download ?? 0),
    proctor_camera: bool(b.proctorCamera, o.proctor_camera ?? 0), proctor_screen: bool(b.proctorScreen, o.proctor_screen ?? 1),
    max_violations: int(b.maxViolations, o.max_violations ?? 5, 0, 100), published: bool(b.published, o.published ?? 0),
  };
}
function courseSummary(c) {
  const users = assignedUsers(c);
  let completed = 0, submitted = 0, passed = 0; const scores = [];
  for (const u of users) {
    const st = courseState(c, u);
    if (st.status === 'completed') completed++;
    if (st.submitted) { submitted++; scores.push(st.best); }
    if (st.passed) passed++;
  }
  return {
    ...courseOut(c),
    lessonCount: q('SELECT COUNT(*) AS c FROM lessons WHERE course_id = ?').get(c.id).c,
    questionTotal: q('SELECT COUNT(*) AS c FROM questions WHERE course_id = ?').get(c.id).c,
    lessonTypes: q('SELECT type, source_type FROM lessons WHERE course_id = ?').all(c.id).map((l) => (l.type === 'pdf' && l.source_type ? 'ppt' : l.type)),
    assigned: users.length, completed, submitted, passed, avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
  };
}
app.get('/api/admin/courses', auth, admin, (req, res) => res.json(q('SELECT * FROM courses ORDER BY id DESC').all().map(courseSummary)));
app.post('/api/admin/courses', auth, admin, (req, res) => {
  const v = readCourseBody(req.body || {});
  const r = q(`INSERT INTO courses (${COURSE_COLS.join(', ')}, created_at) VALUES (${COURSE_COLS.map(() => '?').join(', ')}, ?)`).run(...COURSE_COLS.map((k) => v[k]), nowIso());
  res.json(courseOut(getCourse(r.lastInsertRowid)));
});
app.get('/api/admin/courses/:id', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  res.json({
    course: courseSummary(c),
    lessons: q('SELECT * FROM lessons WHERE course_id = ? ORDER BY position, id').all(c.id).map(lessonOut),
    questions: q('SELECT * FROM questions WHERE course_id = ? ORDER BY position, id').all(c.id).map(questionOut),
  });
});
app.put('/api/admin/courses/:id', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const v = readCourseBody(req.body || {}, c);
  q(`UPDATE courses SET ${COURSE_COLS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...COURSE_COLS.map((k) => v[k]), c.id);
  res.json(courseOut(getCourse(c.id)));
});
app.delete('/api/admin/courses/:id', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const files = q('SELECT file_name, orig_file_name FROM lessons WHERE course_id = ?').all(c.id);
  const atts = q('SELECT id FROM attempts WHERE course_id = ?').all(c.id);
  q('DELETE FROM courses WHERE id = ?').run(c.id);
  for (const f of files) for (const n of [f.file_name, f.orig_file_name]) if (n) fs.rm(path.join(FILES_DIR, n), { force: true }, () => {});
  for (const a of atts) fs.rm(path.join(SNAP_DIR, String(a.id)), { recursive: true, force: true }, () => {});
  res.json({ ok: true });
});
// Tayinlash: hammaga / bo'limlarga / alohida xodimlarga + muddat
app.put('/api/admin/courses/:id/assign', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const b = req.body || {};
  const before = new Set(assignedUsers(c).map((u) => u.id));
  const deps = Array.isArray(b.departments) ? [...new Set(b.departments.map((d) => str(d, 100)).filter(Boolean))] : [];
  const users = Array.isArray(b.users) ? [...new Set(b.users.map(Number).filter(Number.isInteger))] : [];
  const deadline = b.deadline === undefined ? c.deadline : parseDeadline(b.deadline);
  q('UPDATE courses SET assign_all = ?, departments = ?, assigned_users = ?, deadline = ?, published = 1 WHERE id = ?')
    .run(b.all ? 1 : 0, JSON.stringify(deps), JSON.stringify(users), deadline, c.id);
  const fresh = getCourse(c.id);
  const now = assignedUsers(fresh);
  const added = now.filter((u) => !before.has(u.id)).map((u) => u.id);
  const t = courseOut(fresh);
  if (added.length) notify(added, c.id, 'assigned', `Sizga yangi trening tayinlandi: «${fresh.title}»${deadline ? '. Muddat: ' + deadline : ''}`);
  res.json({ course: t, assigned: now.length, added: added.length });
});
app.post('/api/admin/courses/:id/remind', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  let targets = assignedUsers(c).filter((u) => !courseState(c, u).submitted);
  if (Array.isArray(req.body?.userIds)) targets = targets.filter((u) => req.body.userIds.map(Number).includes(u.id));
  notify(targets.map((u) => u.id), c.id, 'reminder', `Eslatma: «${courseOut(c).testTitle}» testini topshirishingiz kerak${c.deadline ? '. Muddat: ' + c.deadline : ''}`);
  res.json({ sent: targets.length });
});

// ---------------------------------------------------------------- admin: lessons
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv']);
const CONVERT_EXT = new Set(['.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.odt', '.rtf']);
const upload = multer({ dest: TMP_DIR, limits: { fileSize: 2 * 1024 ** 3, files: 1 } });
function convertToPdf(src, outDir) {
  const profile = path.join('/tmp', 'lo-' + crypto.randomBytes(6).toString('hex'));
  return new Promise((resolve, reject) => {
    execFile('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${profile}`, '--convert-to', 'pdf', '--outdir', outDir, src],
      { timeout: 240000 }, (err) => {
        fs.rm(profile, { recursive: true, force: true }, () => {});
        if (err) { console.error('convert failed', err.message); return reject(new HttpError(500, "Faylni PDF ko'rinishiga aylantirib bo'lmadi")); }
        resolve();
      });
  });
}
function probeDuration(file) {
  return new Promise((resolve) => execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 60000 },
    (err, out) => resolve(err ? null : Number.parseFloat(out) || null)));
}
const pdfPages = (file) => { try { const s = fs.readFileSync(file).toString('latin1'); return (s.match(/\/Type\s*\/Page[^s]/g) || []).length || null; } catch { return null; } };
const fixName = (n) => { const u = Buffer.from(n, 'latin1').toString('utf8'); return u.includes('�') ? n : u; };
app.post('/api/admin/courses/:id/lessons', auth, admin, upload.single('file'), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const c = getCourse(req.params.id);
    let title = str(req.body?.title, 200);
    const content = str(req.body?.content, 50000);
    let type, fileName = null, origName = null, originalName = null, sourceType = null, size = null, duration = null, pages = null;
    if (req.file) {
      originalName = fixName(req.file.originalname);
      const ext = path.extname(originalName).toLowerCase();
      const id = crypto.randomBytes(12).toString('hex');
      if (VIDEO_EXT.has(ext)) {
        type = 'video'; fileName = id + ext; fs.renameSync(tmp, path.join(FILES_DIR, fileName));
        duration = await probeDuration(path.join(FILES_DIR, fileName));
      } else if (ext === '.pdf') {
        type = 'pdf'; fileName = id + '.pdf'; fs.renameSync(tmp, path.join(FILES_DIR, fileName));
      } else if (CONVERT_EXT.has(ext)) {
        type = 'pdf'; sourceType = ext.slice(1);
        const work = path.join(TMP_DIR, id);
        fs.mkdirSync(work);
        try {
          const src = path.join(work, 'source' + ext);
          fs.renameSync(tmp, src);
          await convertToPdf(src, work);
          fileName = id + '.pdf'; origName = id + '-orig' + ext;
          fs.renameSync(path.join(work, 'source.pdf'), path.join(FILES_DIR, fileName));
          fs.renameSync(src, path.join(FILES_DIR, origName));
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
      } else fail(400, "Bu fayl turi qo'llab-quvvatlanmaydi. Video (MP4), PDF, PPT/PPTX yoki DOC/DOCX yuklang");
      size = fs.statSync(path.join(FILES_DIR, fileName)).size;
      if (type === 'pdf') pages = pdfPages(path.join(FILES_DIR, fileName));
      if (!title) title = originalName.replace(/\.[^.]+$/, '');
    } else {
      if (!content) fail(400, 'Fayl tanlang yoki matn kiriting');
      type = 'text';
    }
    if (!title) fail(400, 'Material nomi kiritilmagan');
    const pos = q('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?').get(c.id).p;
    const r = q(`INSERT INTO lessons (course_id, position, title, type, file_name, orig_file_name, original_name, source_type, size, pages, duration, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(c.id, pos, title, type, fileName, origName, originalName, sourceType, size, pages, duration, content, nowIso());
    res.json(lessonOut(q('SELECT * FROM lessons WHERE id = ?').get(r.lastInsertRowid)));
  } finally { if (tmp) fs.rm(tmp, { force: true }, () => {}); }
});
app.put('/api/admin/lessons/:id', auth, admin, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Material topilmadi');
  const title = str(req.body?.title ?? l.title, 200) || fail(400, 'Material nomi kiritilmagan');
  const content = str(req.body?.content ?? l.content, 50000);
  if (l.type === 'text' && !content) fail(400, "Matn bo'sh bo'lishi mumkin emas");
  q('UPDATE lessons SET title = ?, content = ? WHERE id = ?').run(title, content, l.id);
  res.json(lessonOut(q('SELECT * FROM lessons WHERE id = ?').get(l.id)));
});
app.delete('/api/admin/lessons/:id', auth, admin, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Material topilmadi');
  q('DELETE FROM lessons WHERE id = ?').run(l.id);
  for (const n of [l.file_name, l.orig_file_name]) if (n) fs.rm(path.join(FILES_DIR, n), { force: true }, () => {});
  res.json({ ok: true });
});
app.post('/api/admin/courses/:id/lessons/reorder', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  tx(() => ids.forEach((id, i) => q('UPDATE lessons SET position = ? WHERE id = ? AND course_id = ?').run(i + 1, id, c.id)));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin: questions
function readQuestion(b) {
  const text = str(b.text, 2000);
  const options = Array.isArray(b.options) ? b.options.map((o) => str(o, 1000)).filter(Boolean) : [];
  let correct = Array.isArray(b.correct) ? b.correct : [b.correct];
  correct = [...new Set(correct.map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < options.length))].sort();
  if (!text) fail(400, 'Savol matni kiritilmagan');
  if (options.length < 2) fail(400, 'Kamida 2 ta javob varianti kerak');
  if (options.length > 8) fail(400, "Ko'pi bilan 8 ta variant");
  if (!correct.length) fail(400, "To'g'ri javobni belgilang");
  const multi = b.multi === undefined ? correct.length > 1 : !!b.multi;
  if (!multi && correct.length > 1) fail(400, "Bitta to'g'ri javobli savolda faqat bitta javob belgilanadi");
  return { text, options: JSON.stringify(options), correct: JSON.stringify(correct), multi: multi ? 1 : 0 };
}
function insertQuestion(courseId, v) {
  const pos = q('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM questions WHERE course_id = ?').get(courseId).p;
  return Number(q('INSERT INTO questions (course_id, position, text, options, correct, multi) VALUES (?, ?, ?, ?, ?, ?)')
    .run(courseId, pos, v.text, v.options, v.correct, v.multi).lastInsertRowid);
}
app.post('/api/admin/courses/:id/questions', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  res.json(questionOut(q('SELECT * FROM questions WHERE id = ?').get(insertQuestion(c.id, readQuestion(req.body || {})))));
});
app.put('/api/admin/questions/:id', auth, admin, (req, res) => {
  const x = q('SELECT * FROM questions WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Savol topilmadi');
  const v = readQuestion(req.body || {});
  q('UPDATE questions SET text = ?, options = ?, correct = ?, multi = ? WHERE id = ?').run(v.text, v.options, v.correct, v.multi, x.id);
  res.json(questionOut(q('SELECT * FROM questions WHERE id = ?').get(x.id)));
});
app.delete('/api/admin/questions/:id', auth, admin, (req, res) => { q('DELETE FROM questions WHERE id = ?').run(Number(req.params.id)); res.json({ ok: true }); });
// Matn: bo'sh qator bilan ajratilgan bloklar, 1-qator savol, to'g'ri javob(lar) oldida * yoki +
app.post('/api/admin/courses/:id/questions/import', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const blocks = String(req.body?.text || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  let added = 0; const errors = [];
  tx(() => blocks.forEach((b, i) => {
    try {
      const text = b[0].replace(/^\d+\s*[.)]\s*/, '');
      const correct = [];
      const options = b.slice(1).map((l, j) => {
        let s = l;
        if (/^[*+]/.test(s)) { correct.push(j); s = s.replace(/^[*+]\s*/, ''); }
        s = s.replace(/^[A-Za-zА-Яа-я]\s*[).]\s*/, '');
        if (/^[*+]/.test(s)) { correct.push(j); s = s.replace(/^[*+]\s*/, ''); }
        return s;
      });
      insertQuestion(c.id, readQuestion({ text, options, correct }));
      added++;
    } catch (e) { errors.push({ block: i + 1, text: b[0], error: e.message }); }
  }));
  res.json({ added, errors });
});
// Excel: Savol | A | B | C | D | E | F | To'g'ri javob (masalan "B" yoki "A,C")
app.post('/api/admin/courses/:id/questions/import-file', auth, admin, xlsxUpload.single('file'), async (req, res) => {
  try {
    const c = getCourse(req.params.id);
    if (!req.file) fail(400, 'Fayl tanlanmagan');
    const rows = await readSheet(req.file.path);
    let added = 0; const errors = [];
    tx(() => rows.forEach((cells, i) => {
      const vals = cells.map((x) => String(x ?? '').trim());
      if (!vals[0] || (i === 0 && /^savol/i.test(vals[0]))) return;
      const answerCol = vals.slice(1).map((v, j) => ({ v, j })).filter((x) => x.v).pop();
      try {
        if (!answerCol) fail(400, "To'g'ri javob ustuni bo'sh");
        const letters = answerCol.v.toUpperCase().split(/[\s,;]+/).filter(Boolean);
        const options = vals.slice(1, 1 + answerCol.j).filter(Boolean);
        const correct = letters.map((ch) => (/^\d+$/.test(ch) ? Number(ch) - 1 : 'ABCDEFGH'.indexOf(ch)));
        insertQuestion(c.id, readQuestion({ text: vals[0], options, correct }));
        added++;
      } catch (e) { errors.push({ block: i + 1, text: vals[0], error: e.message }); }
    }));
    res.json({ added, errors });
  } finally { if (req.file) fs.rm(req.file.path, { force: true }, () => {}); }
});

// ---------------------------------------------------------------- admin: results & analytics
function resultRows(c, dep) {
  return assignedUsers(c, dep).map((u) => {
    const st = courseState(c, u);
    return {
      user: publicUser(u), status: st.status, overdue: st.overdue, submitted: st.submitted, passed: st.passed, best: st.best, progress: st.progress,
      lessonsDone: st.lessonsDone, lessonsTotal: st.lessonsTotal, attemptsUsed: st.attemptsUsed, attemptsLimit: st.attemptsLimit, attemptsLeft: st.attemptsLeft,
      lastAttemptId: st.lastAttemptId, bestAttemptId: st.bestAttemptId, lastScore: st.lastScore, lastFinishedAt: st.lastFinishedAt, durationSec: st.lastDuration,
      completedAt: st.completedAt,
      violations: st.lastAttemptId ? violationCount(q('SELECT violations FROM attempts WHERE id = ?').get(st.lastAttemptId)) : 0,
    };
  });
}
const BINS = [[0, 49, '0–49'], [50, 59, '50–59'], [60, 69, '60–69'], [70, 79, '70–79'], [80, 89, '80–89'], [90, 100, '90–100']];
const histogram = (scores) => BINS.map(([a, b, label]) => ({ label, from: a, to: b, count: scores.filter((s) => s >= a && s <= b).length }));
const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
app.get('/api/admin/courses/:id/results', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const rows = resultRows(c, req.query.department || '');
  const questions = q('SELECT * FROM questions WHERE course_id = ?').all(c.id);
  const qById = new Map(questions.map((x) => [x.id, x]));
  const stats = new Map(questions.map((x) => [x.id, { id: x.id, text: x.text, shown: 0, wrong: 0 }]));
  for (const a of q('SELECT layout, answers FROM attempts WHERE course_id = ? AND finished_at IS NOT NULL').all(c.id)) {
    const ans = J(a.answers, {});
    for (const l of J(a.layout)) {
      const s = stats.get(l.q); if (!s) continue;
      s.shown++;
      const chosen = Array.isArray(ans[l.q]) ? ans[l.q] : [ans[l.q]];
      if (!sameSet(chosen.filter((x) => x !== null && x !== undefined), J(qById.get(l.q).correct))) s.wrong++;
    }
  }
  const scores = rows.filter((r) => r.submitted).map((r) => r.best);
  res.json({
    course: courseSummary(c), rows, histogram: histogram(scores),
    hardest: [...stats.values()].filter((s) => s.shown).map((s) => ({ ...s, wrongRate: Math.round((s.wrong / s.shown) * 100) })).sort((a, b) => b.wrongRate - a.wrongRate).slice(0, 10),
    summary: {
      assigned: rows.length, submitted: rows.filter((r) => r.submitted).length, passed: rows.filter((r) => r.passed).length,
      failed: rows.filter((r) => r.submitted && !r.passed).length, notSubmitted: rows.filter((r) => !r.submitted).length,
      overdue: rows.filter((r) => r.overdue).length, avgScore: avg(scores),
    },
  });
});
app.get('/api/admin/attempts/:id', auth, admin, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Urinish topilmadi');
  const u = q('SELECT * FROM users WHERE id = ?').get(a.user_id);
  const c = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  const st = courseState(c, u);
  const all = q('SELECT id, score, passed, finished_at, started_at FROM attempts WHERE user_id = ? AND course_id = ? AND finished_at IS NOT NULL ORDER BY id').all(u.id, c.id);
  res.json({
    id: a.id, user: publicUser(u), course: courseOut(c), startedAt: a.started_at, finishedAt: a.finished_at, durationSec: durationSec(a),
    score: a.score, passed: !!a.passed, correct: a.correct_count, total: a.total, autoSubmitted: a.auto_submitted,
    attemptNumber: all.findIndex((x) => x.id === a.id) + 1, attemptsUsed: st.attemptsUsed, attemptsLimit: st.attemptsLimit, attemptsLeft: st.attemptsLeft,
    attempts: all.map((x, i) => ({ id: x.id, n: i + 1, score: x.score, passed: !!x.passed, finishedAt: x.finished_at })),
    violations: J(a.violations).map((v) => ({ ...v, label: EVENT_TYPES[v.type] || v.type })),
    snapshots: q('SELECT id, kind, created_at FROM snapshots WHERE attempt_id = ? ORDER BY id').all(a.id).map((s) => ({ id: s.id, kind: s.kind, createdAt: s.created_at })),
    review: a.finished_at ? reviewOf(a) : [],
  });
});
app.get('/api/admin/snapshots/:id', auth, admin, (req, res) => {
  const s = q('SELECT * FROM snapshots WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Topilmadi');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(SNAP_DIR, s.file_name));
});
// Qayta topshirishga ruxsat: +1 urinish
app.post('/api/admin/courses/:id/users/:uid/grant', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const uid = Number(req.params.uid);
  q('SELECT id FROM users WHERE id = ?').get(uid) || fail(404, 'Xodim topilmadi');
  q('INSERT INTO attempt_grants (user_id, course_id, extra) VALUES (?, ?, 1) ON CONFLICT(user_id, course_id) DO UPDATE SET extra = extra + 1').run(uid, c.id);
  notify([uid], c.id, 'grant', `«${courseOut(c).testTitle}» testini qayta topshirishga ruxsat berildi`);
  res.json({ ok: true });
});
// Treningni qayta tayinlash: materiallar progressi va urinishlar tozalanadi
app.post('/api/admin/courses/:id/users/:uid/reset', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const uid = Number(req.params.uid);
  const ids = q('SELECT id FROM attempts WHERE course_id = ? AND user_id = ?').all(c.id, uid).map((x) => x.id);
  tx(() => {
    q('DELETE FROM attempts WHERE course_id = ? AND user_id = ?').run(c.id, uid);
    q('DELETE FROM attempt_grants WHERE course_id = ? AND user_id = ?').run(c.id, uid);
    if (req.body?.materials) {
      q('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)').run(uid, c.id);
      q('DELETE FROM video_progress WHERE user_id = ? AND lesson_id IN (SELECT id FROM lessons WHERE course_id = ?)').run(uid, c.id);
    }
  });
  for (const id of ids) fs.rm(path.join(SNAP_DIR, String(id)), { recursive: true, force: true }, () => {});
  notify([uid], c.id, 'reassigned', `«${c.title}» treningi sizga qayta tayinlandi`);
  res.json({ ok: true });
});
app.get('/api/admin/users/:id/progress', auth, admin, (req, res) => {
  const u = q('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Topilmadi');
  const courses = q('SELECT * FROM courses WHERE published = 1 ORDER BY id DESC').all().filter((c) => isAssignedTo(c, u));
  const attempts = q('SELECT a.*, c.title AS course_title, c.test_title FROM attempts a JOIN courses c ON c.id = a.course_id WHERE a.user_id = ? AND a.finished_at IS NOT NULL ORDER BY a.id DESC').all(u.id);
  res.json({
    user: publicUser(u),
    courses: courses.map((c) => { const st = courseState(c, u); return { id: c.id, title: c.title, deadline: c.deadline, status: st.status, overdue: st.overdue, progress: st.progress, best: st.best, attemptsUsed: st.attemptsUsed }; }),
    attempts: attempts.map((a) => ({ id: a.id, courseTitle: a.course_title, testTitle: a.test_title, score: a.score, passed: !!a.passed, correct: a.correct_count, total: a.total, finishedAt: a.finished_at, durationSec: durationSec(a), violations: violationCount(a) })),
  });
});

// Bosh sahifa analitikasi. Filtrlar: weeks (4|12|26|0), department, courseId
function analytics({ weeks = 12, department = '', courseId = 0 } = {}) {
  const courses = q('SELECT * FROM courses WHERE published = 1').all().filter((c) => !courseId || c.id === courseId);
  const now = Date.now();
  const since = weeks > 0 ? now - weeks * 7 * 864e5 : 0;
  const pairs = [];
  for (const c of courses) {
    const hasTest = q('SELECT COUNT(*) AS c FROM questions WHERE course_id = ?').get(c.id).c > 0;
    if (!hasTest) continue;
    for (const u of assignedUsers(c, department)) pairs.push({ c, u, st: courseState(c, u) });
  }
  const passed = pairs.filter((p) => p.st.passed).length;
  const failed = pairs.filter((p) => p.st.submitted && !p.st.passed).length;
  const overdue = pairs.filter((p) => !p.st.submitted && p.st.overdue).length;
  const pending = pairs.length - passed - failed - overdue;
  const submitted = passed + failed;
  const employees = q("SELECT * FROM users WHERE role = 'employee'").all().filter((u) => !department || u.department === department);
  const active = employees.filter(isActive).length;
  const courseIds = courses.map((c) => c.id);
  const att = courseIds.length ? q(`SELECT a.*, u.department FROM attempts a JOIN users u ON u.id = a.user_id WHERE a.finished_at IS NOT NULL AND a.course_id IN (${courseIds.map(() => '?').join(',')})`).all(...courseIds)
    .filter((a) => !department || a.department === department) : [];
  const nW = weeks > 0 ? Math.min(weeks, 26) : 12;
  const weekly = [];
  for (let i = nW - 1; i >= 0; i--) {
    const end = now - i * 7 * 864e5, start = end - 7 * 864e5;
    const inW = att.filter((a) => { const t = Date.parse(a.finished_at); return t > start && t <= end; });
    weekly.push({ weekStart: new Date(start).toISOString(), attempts: inW.length, avgScore: avg(inW.map((a) => a.score)), passRate: inW.length ? Math.round((inW.filter((a) => a.passed).length / inW.length) * 100) : null });
  }
  const period = (from, to) => att.filter((a) => { const t = Date.parse(a.finished_at); return t > from && t <= to; });
  const cur = period(now - 28 * 864e5, now), prev = period(now - 56 * 864e5, now - 28 * 864e5);
  const rate = (xs) => (xs.length ? Math.round((xs.filter((a) => a.passed).length / xs.length) * 100) : null);
  const delta = (a, b) => (a === null || b === null ? null : a - b);
  const bestScores = pairs.filter((p) => p.st.submitted).map((p) => p.st.best);
  const deps = new Map();
  for (const p of pairs) {
    const k = p.u.department || "Bo'limsiz";
    const d = deps.get(k) || { department: k, assigned: 0, submitted: 0, passed: 0, scores: [], users: new Set() };
    d.assigned++; d.users.add(p.u.id);
    if (p.st.submitted) { d.submitted++; d.scores.push(p.st.best); }
    if (p.st.passed) d.passed++;
    deps.set(k, d);
  }
  return {
    filters: { weeks, department, courseId },
    assignments: pairs.length, submitted, passed, failed, overdue, pending,
    completionRate: pairs.length ? Math.round((submitted / pairs.length) * 100) : 0,
    avgScore: avg(bestScores), passRate: submitted ? Math.round((passed / submitted) * 100) : null,
    deltaAvg: delta(avg(cur.map((a) => a.score)), avg(prev.map((a) => a.score))), deltaPass: delta(rate(cur), rate(prev)),
    employees: employees.length, activeEmployees: active, inactiveEmployees: employees.length - active,
    overdueThisWeek: pairs.filter((p) => !p.st.submitted && p.c.deadline && Date.parse(p.c.deadline) > now - 7 * 864e5 && Date.parse(p.c.deadline) < now).length,
    weekly, histogram: histogram(bestScores),
    departments: [...deps.values()].map((d) => ({ department: d.department, employees: d.users.size, assigned: d.assigned, submitted: d.submitted, passed: d.passed,
      completionRate: Math.round((d.submitted / d.assigned) * 100), passRate: d.submitted ? Math.round((d.passed / d.submitted) * 100) : null, avgScore: avg(d.scores) }))
      .sort((a, b) => b.completionRate - a.completionRate),
    courses: courses.map((c) => {
      const ps = pairs.filter((p) => p.c.id === c.id);
      return { id: c.id, title: c.title, testTitle: courseOut(c).testTitle, deadline: c.deadline, assigned: ps.length, submitted: ps.filter((p) => p.st.submitted).length,
        passed: ps.filter((p) => p.st.passed).length, overdue: ps.filter((p) => !p.st.submitted && p.st.overdue).length, avgScore: avg(ps.filter((p) => p.st.submitted).map((p) => p.st.best)) };
    }).filter((c) => c.assigned),
    recent: att.filter((a) => Date.parse(a.finished_at) > since).sort((a, b) => b.finished_at.localeCompare(a.finished_at)).slice(0, 8).map((a) => {
      const u = q('SELECT name, department FROM users WHERE id = ?').get(a.user_id); const c = courses.find((x) => x.id === a.course_id);
      return { id: a.id, name: u.name, department: u.department, courseTitle: courseOut(c).testTitle, score: a.score, passed: !!a.passed, finishedAt: a.finished_at };
    }),
    updatedAt: nowIso(),
  };
}
const analyticsQuery = (qs) => ({ weeks: int(qs.weeks, 12, 0, 520), department: str(qs.department, 100), courseId: int(qs.courseId, 0, 0, 1e9) });
app.get('/api/admin/dashboard', auth, admin, (req, res) => res.json(analytics(analyticsQuery(req.query))));

// ---------------------------------------------------------------- Excel eksport / shablonlar
const STATUS_UZ = { completed: "O'tdi", failed: "O'tmadi", in_progress: 'Jarayonda', not_started: 'Topshirilmagan' };
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Asia/Tashkent' }) : '');
const fmtDur = (s) => (s === null || s === undefined ? '' : `${Math.floor(s / 60)} daq ${s % 60} s`);
function styleSheet(ws) {
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.getRow(1).height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}
async function sendWorkbook(res, wb, name) {
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  await wb.xlsx.write(res);
  res.end();
}
function addResultsSheet(wb, c, name) {
  const ws = wb.addWorksheet(name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.columns = [
    { header: 'Xodim', width: 26 }, { header: 'Telefon', width: 15 }, { header: "Bo'lim", width: 20 }, { header: 'Lavozim', width: 22 },
    { header: 'Holat', width: 15 }, { header: "Muddati o'tgan", width: 14 }, { header: 'Ball, %', width: 9 }, { header: 'Materiallar', width: 12 },
    { header: 'Urinishlar', width: 11 }, { header: 'Sarflangan vaqt', width: 15 }, { header: 'Topshirilgan sana', width: 20 }, { header: 'Qoidabuzarlik', width: 13 },
  ];
  for (const r of resultRows(c)) {
    ws.addRow([r.user.name, '+' + r.user.phone, r.user.department, r.user.position, STATUS_UZ[r.status], r.overdue ? 'Ha' : "Yo'q", r.best ?? '',
      `${r.lessonsDone}/${r.lessonsTotal}`, r.attemptsLimit ? `${r.attemptsUsed}/${r.attemptsLimit}` : r.attemptsUsed, fmtDur(r.durationSec), fmtDT(r.lastFinishedAt), r.violations]);
  }
  styleSheet(ws);
  return ws;
}
app.get('/api/admin/courses/:id/results.xlsx', auth, admin, async (req, res) => {
  const c = getCourse(req.params.id);
  const wb = new ExcelJS.Workbook();
  addResultsSheet(wb, c, 'Natijalar');
  await sendWorkbook(res, wb, `natijalar-${c.title}.xlsx`);
});
app.get('/api/admin/report.xlsx', auth, admin, async (req, res) => {
  const a = analytics(analyticsQuery(req.query));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Umumiy');
  ws.columns = [{ header: 'Test', width: 44 }, { header: 'Tayinlangan', width: 13 }, { header: 'Topshirdi', width: 11 }, { header: "O'tdi", width: 9 }, { header: "Muddati o'tgan", width: 15 }, { header: "O'rtacha ball", width: 13 }, { header: 'Muddat', width: 20 }];
  for (const c of a.courses) ws.addRow([c.testTitle, c.assigned, c.submitted, c.passed, c.overdue, c.avgScore ?? '', fmtDT(c.deadline)]);
  styleSheet(ws);
  const wd = wb.addWorksheet("Bo'limlar");
  wd.columns = [{ header: "Bo'lim", width: 24 }, { header: 'Xodimlar', width: 10 }, { header: 'Tayinlov', width: 10 }, { header: 'Topshirdi', width: 11 }, { header: "O'tdi", width: 9 }, { header: 'Bajarilish, %', width: 13 }, { header: "O'rtacha ball", width: 13 }];
  for (const d of a.departments) wd.addRow([d.department, d.employees, d.assigned, d.submitted, d.passed, d.completionRate, d.avgScore ?? '']);
  styleSheet(wd);
  for (const c of q('SELECT * FROM courses WHERE published = 1').all().filter((c) => a.courses.some((x) => x.id === c.id))) addResultsSheet(wb, c, c.title);
  await sendWorkbook(res, wb, `hisobot-${new Date().toISOString().slice(0, 10)}.xlsx`);
});
app.get('/api/admin/templates/:kind.xlsx', auth, admin, async (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Shablon');
  if (req.params.kind === 'users') {
    ws.columns = [{ header: 'Ism familiya', width: 26 }, { header: 'Telefon', width: 16 }, { header: "Bo'lim", width: 22 }, { header: 'Lavozim', width: 22 }, { header: 'Parol (ixtiyoriy)', width: 16 }];
    ws.addRow(['Dilnoza Karimova', '901234567', 'Dorixona filiallari', 'Farmatsevt', '']);
    ws.addRow(['Sardor Rahimov', '+998 91 234 56 78', "Sotuv bo'limi", 'Medical representative', '']);
  } else if (req.params.kind === 'questions') {
    ws.columns = [{ header: 'Savol', width: 50 }, { header: 'A', width: 22 }, { header: 'B', width: 22 }, { header: 'C', width: 22 }, { header: 'D', width: 22 }, { header: "To'g'ri javob", width: 14 }];
    ws.addRow(['Insulin preparatlari qaysi haroratda saqlanishi kerak?', '+15 °C dan +25 °C gacha', '+2 °C dan +8 °C gacha', '0 °C dan past', 'Xona haroratida', 'B']);
    ws.addRow(["Qaysilari sovuq zanjirni talab qiladi? (bir nechta)", 'Insulin', 'Vaksinalar', 'Paratsetamol', 'Vitamin C', 'A,B']);
  } else fail(404, 'Topilmadi');
  styleSheet(ws);
  await sendWorkbook(res, wb, `shablon-${req.params.kind === 'users' ? 'xodimlar' : 'savollar'}.xlsx`);
});

// ---------------------------------------------------------------- xodim
const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
function myCourses(user) {
  return q('SELECT * FROM courses WHERE published = 1 ORDER BY id DESC').all().filter((c) => isAssignedTo(c, user)).map((c) => {
    const st = courseState(c, user);
    return { ...courseOut(c), status: st.status, progress: st.progress, overdue: st.overdue, lessonsTotal: st.lessonsTotal, lessonsDone: st.lessonsDone,
      hasTest: st.hasTest, best: c.show_result ? st.best : null, passed: st.passed, submitted: st.submitted, testQuestionCount: st.testQuestionCount,
      canStartTest: st.canStartTest, materialsOk: st.materialsOk, attemptsLeft: st.attemptsLeft, completedAt: st.completedAt,
      lessonTypes: st.lessons.map((l) => (l.type === 'pdf' && l.sourceType ? 'ppt' : l.type)) };
  });
}
const courseFor = (req) => { const c = getCourse(req.params.id); if (!isAssigned(c, req.user)) fail(404, 'Trening topilmadi'); return c; };
app.get('/api/my/home', auth, (req, res) => {
  const list = myCourses(req.user);
  const d = new Date();
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const withTest = list.filter((c) => c.hasTest);
  const scores = withTest.filter((c) => c.best !== null).map((c) => c.best);
  res.json({
    month: { name: UZ_MONTHS[d.getMonth()], total: list.length, done: list.filter((c) => c.status === 'completed').length,
      doneThisMonth: list.filter((c) => c.completedAt && Date.parse(c.completedAt) >= monthStart).length },
    avgScore: avg(scores),
    dueSoon: list.filter((c) => c.status !== 'completed' && c.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 3),
    courses: list,
    unread: q('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).c,
  });
});
app.get('/api/my/courses', auth, (req, res) => res.json(myCourses(req.user)));
app.get('/api/my/courses/:id', auth, (req, res) => {
  const c = courseFor(req);
  res.json({ course: courseOut(c), state: courseState(c, req.user) });
});
app.get('/api/my/results', auth, (req, res) => {
  const rows = q('SELECT a.*, c.title AS course_title, c.test_title, c.show_result, c.pass_score FROM attempts a JOIN courses c ON c.id = a.course_id WHERE a.user_id = ? AND a.finished_at IS NOT NULL ORDER BY a.finished_at DESC').all(req.user.id);
  const counter = {};
  const numbered = [...rows].reverse().map((a) => { counter[a.course_id] = (counter[a.course_id] || 0) + 1; return [a.id, counter[a.course_id]]; });
  const num = new Map(numbered);
  res.json(rows.map((a) => ({
    id: a.id, courseId: a.course_id, courseTitle: a.course_title, testTitle: a.test_title || a.course_title + ': yakuniy test', finishedAt: a.finished_at,
    durationSec: durationSec(a), attemptNumber: num.get(a.id), passScore: a.pass_score, showResult: !!a.show_result,
    score: a.show_result ? a.score : null, passed: a.show_result ? !!a.passed : null, correct: a.show_result ? a.correct_count : null, total: a.total,
  })));
});
// Telegram: xodim o'zi ulaydi
app.get('/api/my/telegram', auth, (req, res) => {
  res.json({ enabled: tg.enabled(), botUsername: tg.botName(), linked: !!req.user.telegram_chat_id, username: req.user.telegram_username || '', linkedAt: req.user.telegram_linked_at });
});
app.post('/api/my/telegram/link', auth, (req, res) => {
  if (!tg.enabled()) fail(503, 'Telegram bot hozircha ulanmagan');
  res.json(tg.createLink(req.user.id));
});
app.delete('/api/my/telegram', auth, (req, res) => {
  q('UPDATE users SET telegram_chat_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});
app.get('/api/my/notifications', auth, (req, res) => {
  res.json(q('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.user.id)
    .map((n) => ({ id: n.id, courseId: n.course_id, kind: n.kind, text: n.text, createdAt: n.created_at, read: !!n.read_at })));
});
app.post('/api/my/notifications/read', auth, (req, res) => {
  q('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(nowIso(), req.user.id);
  res.json({ ok: true });
});
app.post('/api/my/lessons/:id/complete', auth, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Material topilmadi');
  const c = getCourse(l.course_id);
  if (!isAssigned(c, req.user)) fail(404, 'Material topilmadi');
  if (courseState(c, req.user).lessons.find((x) => x.id === l.id)?.locked) fail(403, 'Avval oldingi materiallarni tugating');
  if (l.type === 'video' && l.duration && req.user.role !== 'admin') {
    const vp = q('SELECT max_pos FROM video_progress WHERE user_id = ? AND lesson_id = ?').get(req.user.id, l.id);
    if (!vp || vp.max_pos < l.duration * 0.95) fail(400, "Videoni oxirigacha ko'ring");
  }
  q('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)').run(req.user.id, l.id, nowIso());
  res.json({ ok: true });
});
// Video: server faqat real vaqtga mos o'sishni qabul qiladi (oldinga sakrash hisoblanmaydi)
app.post('/api/my/lessons/:id/progress', auth, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Material topilmadi');
  if (l.type !== 'video') fail(400, 'Bu video emas');
  const c = getCourse(l.course_id);
  if (!isAssigned(c, req.user)) fail(404, 'Material topilmadi');
  if (courseState(c, req.user).lessons.find((x) => x.id === l.id)?.locked) fail(403, 'Avval oldingi materiallarni tugating');
  const pos = Number(req.body?.pos);
  if (!Number.isFinite(pos) || pos < 0) fail(400, "Noto'g'ri qiymat");
  if (!l.duration && Number(req.body?.duration) > 0) { q('UPDATE lessons SET duration = ? WHERE id = ? AND duration IS NULL').run(Number(req.body.duration), l.id); l.duration = Number(req.body.duration); }
  const now = Date.now();
  const vp = q('SELECT * FROM video_progress WHERE user_id = ? AND lesson_id = ?').get(req.user.id, l.id);
  const prev = vp ? vp.max_pos : 0;
  const elapsed = vp ? (now - Date.parse(vp.updated_at)) / 1000 : 0;
  let maxPos = Math.max(prev, Math.min(pos, prev + Math.min(elapsed * 1.6, 15) + 4));
  if (l.duration) maxPos = Math.min(maxPos, l.duration);
  q('INSERT INTO video_progress (user_id, lesson_id, max_pos, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, lesson_id) DO UPDATE SET max_pos = excluded.max_pos, updated_at = excluded.updated_at')
    .run(req.user.id, l.id, maxPos, new Date(now).toISOString());
  let completed = !!q('SELECT 1 FROM lesson_progress WHERE user_id = ? AND lesson_id = ?').get(req.user.id, l.id);
  if (!completed && l.duration && maxPos >= l.duration * 0.95) {
    q('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)').run(req.user.id, l.id, nowIso());
    completed = true;
  }
  res.json({ maxPos, completed, duration: l.duration });
});
function fileAccess(req) {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.lessonId));
  if (!l || !l.file_name) fail(404, 'Fayl topilmadi');
  const c = getCourse(l.course_id);
  if (!isAssigned(c, req.user)) fail(404, 'Fayl topilmadi');
  if (req.user.role !== 'admin' && courseState(c, req.user).lessons.find((x) => x.id === l.id)?.locked) fail(403, 'Avval oldingi materiallarni tugating');
  return { l, c };
}
app.get('/api/files/:lessonId', auth, (req, res) => {
  const { l } = fileAccess(req);
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Disposition', 'inline');
  res.sendFile(path.join(FILES_DIR, l.file_name));
});
app.get('/api/files/:lessonId/download', auth, (req, res) => {
  const { l, c } = fileAccess(req);
  if (!c.allow_download && req.user.role !== 'admin') fail(403, 'Bu trening materiallarini yuklab olish ruxsat etilmagan');
  if (l.type === 'video') fail(400, 'Videoni yuklab olib bo\'lmaydi');
  const file = l.orig_file_name || l.file_name;
  const ext = path.extname(file);
  res.download(path.join(FILES_DIR, file), (l.original_name || l.title + ext).replace(/[\\/]/g, '_'));
});
app.post('/api/my/courses/:id/attempts', auth, (req, res) => {
  const c = courseFor(req);
  const st = courseState(c, req.user);
  if (st.openAttemptId) return res.json(attemptPayload(q('SELECT * FROM attempts WHERE id = ?').get(st.openAttemptId)));
  if (!st.hasTest) fail(400, "Bu treningda test yo'q");
  if (st.passed) fail(400, "Siz bu testdan allaqachon o'tgansiz");
  if (!st.materialsOk) fail(400, "Avval trening materiallarini to'liq ko'rib chiqing");
  if (!st.canStartTest) fail(400, 'Urinishlar soni tugagan. Qayta topshirish uchun administratorga murojaat qiling');
  let qs = q('SELECT id, options FROM questions WHERE course_id = ? ORDER BY position, id').all(c.id);
  if (c.shuffle) shuffle(qs);
  if (c.question_count > 0) qs = (c.shuffle ? qs : shuffle([...qs])).slice(0, c.question_count);
  const layout = qs.map((x) => { const n = J(x.options).length; const o = [...Array(n).keys()]; return { q: x.id, o: c.shuffle ? shuffle(o) : o }; });
  const started = new Date();
  const r = q('INSERT INTO attempts (user_id, course_id, started_at, deadline_at, layout) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, c.id, started.toISOString(), c.time_limit_min > 0 ? new Date(started.getTime() + c.time_limit_min * 60000).toISOString() : null, JSON.stringify(layout));
  res.json(attemptPayload(q('SELECT * FROM attempts WHERE id = ?').get(r.lastInsertRowid)));
});
app.post('/api/my/attempts/:id/submit', auth, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
  if (a.finished_at) return res.json(resultPayload(a, req.user));
  const late = a.deadline_at && Date.now() > Date.parse(a.deadline_at) + GRACE_MS;
  const reason = ['timeout', 'violations'].includes(req.body?.reason) ? req.body.reason : null;
  if (reason) q('UPDATE attempts SET auto_submitted = ? WHERE id = ?').run(reason, a.id);
  res.json(resultPayload(gradeAttempt(a, late ? null : req.body?.answers || {}), req.user));
});
const EVENT_TYPES = {
  tab_hidden: "Boshqa oyna/tabga o'tdi", blur: 'Test oynasidan chiqdi', fullscreen_exit: "To'liq ekrandan chiqdi", printscreen: 'Skrinshot olishga urindi',
  copy: 'Nusxa olishga urindi', print: 'Chop etishga urindi', camera_off: "Kamera o'chdi", camera_denied: 'Kameraga ruxsat bermadi', devtools: 'Dasturchi vositalarini ochdi', info: "Ma'lumot",
};
app.post('/api/my/attempts/:id/events', auth, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
  if (a.finished_at) return res.json({ finished: true });
  const type = Object.hasOwn(EVENT_TYPES, req.body?.type) ? req.body.type : 'info';
  const list = J(a.violations);
  if (list.length < 300) list.push({ type, at: nowIso(), detail: str(req.body?.detail, 200) });
  q('UPDATE attempts SET violations = ? WHERE id = ?').run(JSON.stringify(list), a.id);
  const c = q('SELECT max_violations FROM courses WHERE id = ?').get(a.course_id);
  const count = list.filter((v) => v.type !== 'info').length;
  res.json({ count, max: c.max_violations, limitReached: c.max_violations > 0 && count >= c.max_violations });
});
const snapUpload = multer({ dest: TMP_DIR, limits: { fileSize: 1.5 * 1024 * 1024, files: 1 } });
app.post('/api/my/attempts/:id/snapshots', auth, snapUpload.single('image'), (req, res) => {
  const tmp = req.file?.path;
  try {
    const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
    if (!req.file) fail(400, 'Rasm yuborilmadi');
    if (a.finished_at && Date.now() - Date.parse(a.finished_at) > 60000) fail(400, 'Urinish yakunlangan');
    if (q('SELECT COUNT(*) AS c FROM snapshots WHERE attempt_id = ?').get(a.id).c >= 400) fail(400, 'Limit');
    const head = fs.readFileSync(tmp).subarray(0, 2);
    if (!(head[0] === 0xff && head[1] === 0xd8)) fail(400, 'Faqat JPEG');
    const dir = path.join(SNAP_DIR, String(a.id));
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.renameSync(tmp, path.join(dir, name));
    const kind = ['periodic', 'violation', 'start', 'finish'].includes(req.body?.kind) ? req.body.kind : 'periodic';
    q('INSERT INTO snapshots (attempt_id, kind, file_name, created_at) VALUES (?, ?, ?, ?)').run(a.id, kind, `${a.id}/${name}`, nowIso());
    res.json({ ok: true });
  } finally { if (tmp) fs.rm(tmp, { force: true }, () => {}); }
});
app.get('/api/my/attempts/:id', auth, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
  if (!a.finished_at) return res.json({ open: true, ...attemptPayload(a) });
  res.json(resultPayload(a, req.user));
});
app.get('/api/my/certificate/:id', auth, (req, res) => {
  const c = courseFor(req);
  const st = courseState(c, req.user);
  if (st.status !== 'completed') fail(400, 'Trening hali tugatilmagan');
  const num = `${String(c.id).padStart(3, '0')}-${String(req.user.id).padStart(4, '0')}-${(st.completedAt || '').slice(0, 10).replace(/-/g, '')}`;
  res.json({ name: req.user.name, department: req.user.department, position: req.user.position, courseTitle: c.title, score: c.show_result ? st.best : null, completedAt: st.completedAt, number: num, appName: APP_NAME, companyName: COMPANY_NAME });
});

// ---------------------------------------------------------------- static / errors
app.use('/api', (req, res) => res.status(404).json({ error: 'Topilmadi' }));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'public'));
if (fs.existsSync(path.join(STATIC_DIR, 'index.html'))) app.use(express.static(STATIC_DIR, { extensions: ['html'], maxAge: '5m' }));
else app.get('/', (req, res) => res.json({ name: 'lms-backend', ok: true, hint: 'Frontend: lms-ui repozitoriysi. API: /api/*' }));
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fayl juda katta' : err.message });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: "So'rov noto'g'ri" });
  if (err?.status === 404 || err?.code === 'ENOENT') return res.status(404).json({ error: 'Fayl topilmadi' });
  console.error(err);
  res.status(500).json({ error: 'Serverda xatolik' });
});

// ================================================================ seed
function seed() {
  if (!q("SELECT id FROM users WHERE role = 'admin'").get()) {
    const phone = normalizePhone(process.env.ADMIN_PHONE || '998900000000');
    const pw = process.env.ADMIN_PASSWORD || randomPassword();
    q("INSERT INTO users (name, phone, password_hash, role, department, position, created_at) VALUES (?, ?, ?, 'admin', 'Boshqaruv', 'HR menejer', ?)")
      .run(process.env.ADMIN_NAME || 'Administrator', phone, hashPassword(pw), nowIso());
    console.log(`Admin yaratildi: ${phone}${process.env.ADMIN_PASSWORD ? '' : ' / ' + pw}`);
  }
  if (process.env.DEMO_SEED === '1' && !q('SELECT id FROM courses').get()) {
    require('./seed').seedDemo({ q, tx, hashPassword, insertQuestion, readQuestion, FILES_DIR, convertToPdf, probeDuration, pdfPages, shuffle })
      .then(() => console.log("Demo ma'lumotlar yaratildi")).catch((e) => console.error('Demo seed xatosi', e));
  }
}
seed();
tg.start({ q, courseState, isAssignedTo, courseOut });
app.listen(PORT, () => console.log(`LMS ${PORT}-portda ishga tushdi`));
