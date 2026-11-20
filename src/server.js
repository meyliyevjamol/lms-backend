'use strict';
const express = require('express');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME || 'Korporativ LMS';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const FILES_DIR = path.join(DATA_DIR, 'files');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}
const SECRET = loadSecret();

// ---------------------------------------------------------------- DB
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
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  departments TEXT NOT NULL DEFAULT '[]',
  deadline TEXT,
  pass_score INTEGER NOT NULL DEFAULT 70,
  time_limit_min INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  question_count INTEGER NOT NULL DEFAULT 0,
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
  original_name TEXT,
  source_type TEXT,
  size INTEGER,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  options TEXT NOT NULL,
  correct INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  completed_at TEXT NOT NULL,
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
  answers TEXT
);
CREATE TABLE IF NOT EXISTS video_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  max_pos REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'periodic',
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_attempt ON snapshots(attempt_id);
CREATE INDEX IF NOT EXISTS idx_lessons_course ON lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_questions_course ON questions(course_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_course ON attempts(user_id, course_id);
`);

const nowIso = () => new Date().toISOString();
const q = (sql) => db.prepare(sql);
function addColumn(table, col, def) {
  const cols = q(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}
addColumn('courses', 'proctor_camera', 'INTEGER NOT NULL DEFAULT 0');
addColumn('courses', 'proctor_screen', 'INTEGER NOT NULL DEFAULT 1');
addColumn('courses', 'max_violations', 'INTEGER NOT NULL DEFAULT 5');
addColumn('courses', 'category', "TEXT NOT NULL DEFAULT ''");
addColumn('lessons', 'duration', 'REAL');
addColumn('attempts', 'violations', "TEXT NOT NULL DEFAULT '[]'");
addColumn('attempts', 'auto_submitted', 'TEXT');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
fs.mkdirSync(SNAP_DIR, { recursive: true });
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------------------------------------------------------------- helpers
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
function makeToken(uid) {
  const v = `${uid}.${Date.now() + SESSION_DAYS * 864e5}`;
  return `${v}.${sign(v)}`;
}
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
const int = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
};
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function publicUser(u) {
  return u && { id: u.id, name: u.name, phone: u.phone, role: u.role, department: u.department, position: u.position, createdAt: u.created_at };
}
function courseOut(c) {
  return {
    id: c.id, title: c.title, description: c.description, departments: JSON.parse(c.departments || '[]'),
    deadline: c.deadline, passScore: c.pass_score, timeLimitMin: c.time_limit_min, maxAttempts: c.max_attempts,
    questionCount: c.question_count, published: !!c.published, createdAt: c.created_at,
    proctorCamera: !!c.proctor_camera, proctorScreen: !!c.proctor_screen, maxViolations: c.max_violations, category: c.category,
  };
}
function lessonOut(l) {
  return {
    id: l.id, courseId: l.course_id, position: l.position, title: l.title, type: l.type, duration: l.duration,
    originalName: l.original_name, sourceType: l.source_type, size: l.size, content: l.content, hasFile: !!l.file_name,
  };
}
const violationCount = (a) => JSON.parse(a.violations || '[]').filter((v) => v.type !== 'info').length;
function questionOut(x) {
  return { id: x.id, position: x.position, text: x.text, options: JSON.parse(x.options), correct: x.correct };
}

function isAssigned(course, user) {
  if (user.role === 'admin') return true;
  if (!course.published) return false;
  const deps = JSON.parse(course.departments || '[]');
  return deps.length === 0 || deps.includes(user.department);
}
function assignedUsers(course) {
  const deps = JSON.parse(course.departments || '[]');
  const all = q("SELECT * FROM users WHERE role = 'employee' ORDER BY name").all();
  return deps.length === 0 ? all : all.filter((u) => deps.includes(u.department));
}

// ---------------------------------------------------------------- attempts / grading
const GRACE_MS = 90 * 1000;
function gradeAttempt(a, rawAnswers) {
  const course = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  const layout = JSON.parse(a.layout);
  const ids = layout.map((l) => l.q);
  const qmap = new Map(ids.length
    ? q(`SELECT id, correct FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => [x.id, x])
    : []);
  const answers = {};
  let correct = 0, total = 0;
  for (const l of layout) {
    const qq = qmap.get(l.q);
    if (!qq) continue;
    total++;
    const shown = rawAnswers ? rawAnswers[l.q] ?? rawAnswers[String(l.q)] : undefined;
    const orig = Number.isInteger(shown) && shown >= 0 && shown < l.o.length ? l.o[shown] : null;
    answers[l.q] = orig;
    if (orig !== null && orig === qq.correct) correct++;
  }
  const score = total ? Math.round((correct / total) * 100) : 0;
  const passed = score >= course.pass_score ? 1 : 0;
  q('UPDATE attempts SET finished_at = ?, score = ?, correct_count = ?, total = ?, passed = ?, answers = ? WHERE id = ?')
    .run(nowIso(), score, correct, total, passed, JSON.stringify(answers), a.id);
  return q('SELECT * FROM attempts WHERE id = ?').get(a.id);
}
function expireOpenAttempts(userId, courseId) {
  const open = q('SELECT * FROM attempts WHERE user_id = ? AND course_id = ? AND finished_at IS NULL').all(userId, courseId);
  for (const a of open) {
    if (a.deadline_at && Date.now() > Date.parse(a.deadline_at) + GRACE_MS) gradeAttempt(a, null);
  }
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
  const attemptsLeft = course.max_attempts > 0 ? Math.max(0, course.max_attempts - finished.length) : null;

  let completed, completedAt = null;
  if (hasTest) { completed = !!passedAttempt; completedAt = passedAttempt?.finished_at || null; }
  else {
    completed = ls.length > 0 && allLessonsDone;
    if (completed) completedAt = ls.map((l) => l.completedAt).sort().pop();
  }
  let status = 'not_started';
  if (completed) status = 'completed';
  else if (hasTest && attemptsLeft === 0) status = 'failed';
  else if (lessonsDone > 0 || finished.length > 0 || open) status = 'in_progress';
  const overdue = !completed && !!course.deadline && Date.parse(course.deadline + 'T23:59:59') < Date.now();

  const steps = ls.length + (hasTest ? 1 : 0);
  const stepsDone = lessonsDone + (hasTest && passedAttempt ? 1 : 0);
  return {
    lessons: ls, lessonsDone, lessonsTotal: ls.length, hasTest, questionTotal,
    testQuestionCount: course.question_count > 0 ? Math.min(course.question_count, questionTotal) : questionTotal,
    attemptsUsed: finished.length, attemptsLeft, best, passed: !!passedAttempt, status, overdue, completedAt,
    progress: steps ? Math.round((stepsDone / steps) * 100) : 0,
    openAttemptId: open?.id || null,
    lastAttemptId: finished.length ? finished[finished.length - 1].id : null,
    canStartTest: hasTest && allLessonsDone && !passedAttempt && (attemptsLeft === null || attemptsLeft > 0 || !!open),
  };
}

function attemptPayload(a) {
  const layout = JSON.parse(a.layout);
  const ids = layout.map((l) => l.q);
  const qmap = new Map(ids.length
    ? q(`SELECT id, text, options FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => [x.id, x])
    : []);
  const course = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  return {
    id: a.id, courseId: a.course_id, courseTitle: course?.title, startedAt: a.started_at, deadlineAt: a.deadline_at, serverNow: nowIso(),
    proctor: { camera: !!course.proctor_camera, screen: !!course.proctor_screen, maxViolations: course.max_violations, violations: violationCount(a) },
    questions: layout.filter((l) => qmap.has(l.q)).map((l) => {
      const x = qmap.get(l.q); const opts = JSON.parse(x.options);
      return { id: x.id, text: x.text, options: l.o.map((i) => opts[i]) };
    }),
  };
}
function resultPayload(a, user) {
  const course = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  const st = courseState(course, user);
  return {
    id: a.id, courseId: a.course_id, courseTitle: course.title, score: a.score, passed: !!a.passed, correct: a.correct_count,
    total: a.total, passScore: course.pass_score, finishedAt: a.finished_at, attemptsLeft: st.attemptsLeft, canRetry: st.canStartTest,
    autoSubmitted: a.auto_submitted, violations: violationCount(a),
  };
}

// ---------------------------------------------------------------- app
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

function setSession(req, res, uid) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('lms_session', makeToken(uid), { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_DAYS * 864e5, path: '/' });
}

// --- auth
const loginFails = new Map();
app.post('/api/auth/login', (req, res) => {
  const ip = req.ip;
  const rec = loginFails.get(ip);
  if (rec && rec.count >= 10 && Date.now() - rec.first < 15 * 60e3) fail(429, "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring");
  const phone = normalizePhone(req.body?.phone);
  const user = q('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !verifyPassword(req.body?.password || '', user.password_hash)) {
    const r = rec && Date.now() - rec.first < 15 * 60e3 ? rec : { count: 0, first: Date.now() };
    r.count++; loginFails.set(ip, r);
    fail(401, "Telefon raqam yoki parol noto'g'ri");
  }
  loginFails.delete(ip);
  setSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('lms_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user), appName: APP_NAME }));
app.post('/api/me/password', auth, (req, res) => {
  if (!verifyPassword(req.body?.oldPassword || '', req.user.password_hash)) fail(400, "Joriy parol noto'g'ri");
  const np = String(req.body?.newPassword || '');
  if (np.length < 6) fail(400, "Yangi parol kamida 6 belgi bo'lsin");
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), req.user.id);
  res.json({ ok: true });
});

// --- admin: users
app.get('/api/admin/users', auth, admin, (req, res) => {
  res.json(q('SELECT * FROM users ORDER BY role, name').all().map(publicUser));
});
app.get('/api/admin/departments', auth, admin, (req, res) => {
  res.json(q("SELECT DISTINCT department FROM users WHERE department <> '' ORDER BY department").all().map((r) => r.department));
});
function saveUser(id, b) {
  const name = str(b.name, 120);
  const phone = normalizePhone(b.phone);
  if (!name) fail(400, 'Ism kiritilmagan');
  if (phone.length < 9) fail(400, "Telefon raqam noto'g'ri");
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
app.post('/api/admin/users', auth, admin, (req, res) => {
  const r = saveUser(null, req.body || {});
  res.json({ user: publicUser(q('SELECT * FROM users WHERE id = ?').get(r.id)), password: r.password });
});
app.put('/api/admin/users/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  const u = q('SELECT * FROM users WHERE id = ?').get(id) || fail(404, 'Topilmadi');
  if (u.id === req.user.id && req.body?.role !== 'admin') fail(400, "O'zingizni admin rolidan chiqara olmaysiz");
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
  const lines = String(req.body?.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const created = [], errors = [];
  tx(() => {
    lines.forEach((line, i) => {
      const [name, phone, department, position, password] = line.split(/\t|;/).map((x) => x.trim());
      try {
        if (/^(ism|f\.?i\.?sh|name)/i.test(name || '') && i === 0) return; // sarlavha qatori
        const r = saveUser(null, { name, phone, department, position, password });
        created.push({ name, phone: normalizePhone(phone), department, password: r.password });
      } catch (e) { errors.push({ line: i + 1, text: line, error: e.message }); }
    });
  });
  res.json({ created, errors });
});

// --- admin: courses
function getCourse(id) { return q('SELECT * FROM courses WHERE id = ?').get(Number(id)) || fail(404, 'Kurs topilmadi'); }
function readCourseBody(b, old) {
  const title = str(b.title ?? old?.title, 200);
  if (!title) fail(400, 'Kurs nomi kiritilmagan');
  const deps = Array.isArray(b.departments) ? b.departments.map((d) => str(d, 100)).filter(Boolean) : JSON.parse(old?.departments || '[]');
  const deadline = b.deadline === undefined ? old?.deadline ?? null : (/^\d{4}-\d{2}-\d{2}$/.test(b.deadline || '') ? b.deadline : null);
  return {
    title, description: str(b.description ?? old?.description ?? '', 5000), departments: JSON.stringify(deps), deadline,
    pass_score: int(b.passScore, old?.pass_score ?? 70, 1, 100),
    time_limit_min: int(b.timeLimitMin, old?.time_limit_min ?? 0, 0, 600),
    max_attempts: int(b.maxAttempts, old?.max_attempts ?? 3, 0, 100),
    question_count: int(b.questionCount, old?.question_count ?? 0, 0, 1000),
    published: b.published === undefined ? old?.published ?? 0 : b.published ? 1 : 0,
    proctor_camera: b.proctorCamera === undefined ? old?.proctor_camera ?? 0 : b.proctorCamera ? 1 : 0,
    proctor_screen: b.proctorScreen === undefined ? old?.proctor_screen ?? 1 : b.proctorScreen ? 1 : 0,
    max_violations: int(b.maxViolations, old?.max_violations ?? 5, 0, 100),
    category: str(b.category ?? old?.category ?? '', 60),
  };
}
const COURSE_COLS = ['title', 'description', 'departments', 'deadline', 'pass_score', 'time_limit_min', 'max_attempts', 'question_count', 'published', 'proctor_camera', 'proctor_screen', 'max_violations', 'category'];
app.get('/api/admin/courses', auth, admin, (req, res) => {
  const courses = q('SELECT * FROM courses ORDER BY id DESC').all();
  res.json(courses.map((c) => {
    const users = assignedUsers(c);
    let completed = 0;
    for (const u of users) if (courseState(c, u).status === 'completed') completed++;
    return {
      ...courseOut(c),
      lessonCount: q('SELECT COUNT(*) AS c FROM lessons WHERE course_id = ?').get(c.id).c,
      questionTotal: q('SELECT COUNT(*) AS c FROM questions WHERE course_id = ?').get(c.id).c,
      assigned: users.length, completed,
    };
  }));
});
app.post('/api/admin/courses', auth, admin, (req, res) => {
  const v = readCourseBody(req.body || {});
  const r = q(`INSERT INTO courses (${COURSE_COLS.join(', ')}, created_at) VALUES (${COURSE_COLS.map(() => '?').join(', ')}, ?)`)
    .run(...COURSE_COLS.map((k) => v[k]), nowIso());
  res.json(courseOut(getCourse(r.lastInsertRowid)));
});
app.get('/api/admin/courses/:id', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  res.json({
    course: courseOut(c),
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
  const files = q('SELECT file_name FROM lessons WHERE course_id = ? AND file_name IS NOT NULL').all(c.id);
  q('DELETE FROM courses WHERE id = ?').run(c.id);
  for (const f of files) fs.rm(path.join(FILES_DIR, f.file_name), { force: true }, () => {});
  res.json({ ok: true });
});

// --- admin: lessons
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv']);
const CONVERT_EXT = new Set(['.ppt', '.pptx', '.pps', '.ppsx', '.odp', '.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx']);
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
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { timeout: 60000 },
      (err, out) => resolve(err ? null : Number.parseFloat(out) || null));
  });
}
function fixName(n) {
  const u = Buffer.from(n, 'latin1').toString('utf8');
  return u.includes('�') ? n : u;
}
app.post('/api/admin/courses/:id/lessons', auth, admin, upload.single('file'), async (req, res) => {
  const tmp = req.file?.path;
  try {
    const c = getCourse(req.params.id);
    let title = str(req.body?.title, 200);
    const content = str(req.body?.content, 50000);
    let type, fileName = null, originalName = null, sourceType = null, size = null, duration = null;
    if (req.file) {
      originalName = fixName(req.file.originalname);
      const ext = path.extname(originalName).toLowerCase();
      const id = crypto.randomBytes(12).toString('hex');
      if (VIDEO_EXT.has(ext)) {
        type = 'video'; fileName = id + ext; fs.renameSync(tmp, path.join(FILES_DIR, fileName));
        duration = await probeDuration(path.join(FILES_DIR, fileName));
      }
      else if (ext === '.pdf') { type = 'pdf'; fileName = id + '.pdf'; fs.renameSync(tmp, path.join(FILES_DIR, fileName)); }
      else if (CONVERT_EXT.has(ext)) {
        type = 'pdf'; sourceType = ext.slice(1);
        const work = path.join(TMP_DIR, id);
        fs.mkdirSync(work);
        try {
          const src = path.join(work, 'source' + ext);
          fs.renameSync(tmp, src);
          await convertToPdf(src, work);
          fileName = id + '.pdf';
          fs.renameSync(path.join(work, 'source.pdf'), path.join(FILES_DIR, fileName));
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
      } else fail(400, "Bu fayl turi qo'llab-quvvatlanmaydi. Video (MP4), PDF, PPTX yoki DOCX yuklang");
      size = fs.statSync(path.join(FILES_DIR, fileName)).size;
      if (!title) title = originalName.replace(/\.[^.]+$/, '');
    } else {
      if (!content) fail(400, 'Fayl tanlang yoki matn kiriting');
      type = 'text';
    }
    if (!title) fail(400, 'Dars nomi kiritilmagan');
    const pos = q('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM lessons WHERE course_id = ?').get(c.id).p;
    const r = q('INSERT INTO lessons (course_id, position, title, type, file_name, original_name, source_type, size, content, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(c.id, pos, title, type, fileName, originalName, sourceType, size, content, duration, nowIso());
    res.json(lessonOut(q('SELECT * FROM lessons WHERE id = ?').get(r.lastInsertRowid)));
  } finally {
    if (tmp) fs.rm(tmp, { force: true }, () => {});
  }
});
app.put('/api/admin/lessons/:id', auth, admin, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Dars topilmadi');
  const title = str(req.body?.title ?? l.title, 200) || fail(400, 'Dars nomi kiritilmagan');
  const content = str(req.body?.content ?? l.content, 50000);
  if (l.type === 'text' && !content) fail(400, "Matn bo'sh bo'lishi mumkin emas");
  q('UPDATE lessons SET title = ?, content = ? WHERE id = ?').run(title, content, l.id);
  res.json(lessonOut(q('SELECT * FROM lessons WHERE id = ?').get(l.id)));
});
app.delete('/api/admin/lessons/:id', auth, admin, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Dars topilmadi');
  q('DELETE FROM lessons WHERE id = ?').run(l.id);
  if (l.file_name) fs.rm(path.join(FILES_DIR, l.file_name), { force: true }, () => {});
  res.json({ ok: true });
});
app.post('/api/admin/courses/:id/lessons/reorder', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  tx(() => ids.forEach((id, i) => q('UPDATE lessons SET position = ? WHERE id = ? AND course_id = ?').run(i + 1, id, c.id)));
  res.json({ ok: true });
});

// --- admin: questions
function readQuestion(b) {
  const text = str(b.text, 2000);
  const options = Array.isArray(b.options) ? b.options.map((o) => str(o, 1000)).filter(Boolean) : [];
  const correct = Number(b.correct);
  if (!text) fail(400, 'Savol matni kiritilmagan');
  if (options.length < 2) fail(400, 'Kamida 2 ta javob varianti kerak');
  if (options.length > 8) fail(400, "Ko'pi bilan 8 ta variant");
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) fail(400, "To'g'ri javobni belgilang");
  return { text, options: JSON.stringify(options), correct };
}
function insertQuestion(courseId, v) {
  const pos = q('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM questions WHERE course_id = ?').get(courseId).p;
  const r = q('INSERT INTO questions (course_id, position, text, options, correct) VALUES (?, ?, ?, ?, ?)').run(courseId, pos, v.text, v.options, v.correct);
  return Number(r.lastInsertRowid);
}
app.post('/api/admin/courses/:id/questions', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const id = insertQuestion(c.id, readQuestion(req.body || {}));
  res.json(questionOut(q('SELECT * FROM questions WHERE id = ?').get(id)));
});
app.put('/api/admin/questions/:id', auth, admin, (req, res) => {
  const x = q('SELECT * FROM questions WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Savol topilmadi');
  const v = readQuestion(req.body || {});
  q('UPDATE questions SET text = ?, options = ?, correct = ? WHERE id = ?').run(v.text, v.options, v.correct, x.id);
  res.json(questionOut(q('SELECT * FROM questions WHERE id = ?').get(x.id)));
});
app.delete('/api/admin/questions/:id', auth, admin, (req, res) => {
  q('DELETE FROM questions WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
// Format: bo'sh qator bilan ajratilgan bloklar. 1-qator savol, keyingilari variantlar, to'g'risi oldida * yoki +
app.post('/api/admin/courses/:id/questions/import', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const blocks = String(req.body?.text || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length);
  let added = 0; const errors = [];
  tx(() => {
    blocks.forEach((b, i) => {
      try {
        const text = b[0].replace(/^\d+\s*[.)]\s*/, '');
        let correct = -1;
        const options = b.slice(1).map((l, j) => {
          let s = l;
          if (/^[*+]/.test(s)) { correct = j; s = s.replace(/^[*+]\s*/, ''); }
          s = s.replace(/^[A-Za-zА-Яа-я]\s*[).]\s*/, '');
          if (/^[*+]/.test(s)) { correct = j; s = s.replace(/^[*+]\s*/, ''); }
          return s;
        });
        insertQuestion(c.id, readQuestion({ text, options, correct }));
        added++;
      } catch (e) { errors.push({ block: i + 1, text: b[0], error: e.message }); }
    });
  });
  res.json({ added, errors });
});

// --- admin: results & dashboard
app.get('/api/admin/courses/:id/results', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const users = assignedUsers(c);
  const rows = users.map((u) => {
    const st = courseState(c, u);
    const last = q('SELECT * FROM attempts WHERE user_id = ? AND course_id = ? AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1').get(u.id, c.id);
    return {
      user: publicUser(u), status: st.status, overdue: st.overdue, progress: st.progress, lessonsDone: st.lessonsDone, lessonsTotal: st.lessonsTotal,
      attemptsUsed: st.attemptsUsed, best: st.best, passed: st.passed, completedAt: st.completedAt, lastAttemptAt: last?.finished_at || null,
      lastAttemptId: last?.id || null, violations: last ? violationCount(last) : 0,
      snapshots: last ? q('SELECT COUNT(*) AS c FROM snapshots WHERE attempt_id = ?').get(last.id).c : 0,
    };
  });
  const questions = q('SELECT * FROM questions WHERE course_id = ?').all(c.id);
  const stats = new Map(questions.map((x) => [x.id, { id: x.id, text: x.text, shown: 0, wrong: 0 }]));
  for (const a of q('SELECT layout, answers FROM attempts WHERE course_id = ? AND finished_at IS NOT NULL').all(c.id)) {
    const ans = JSON.parse(a.answers || '{}');
    for (const l of JSON.parse(a.layout)) {
      const s = stats.get(l.q); if (!s) continue;
      const qq = questions.find((x) => x.id === l.q);
      s.shown++;
      if (ans[l.q] !== qq.correct) s.wrong++;
    }
  }
  const hardest = [...stats.values()].filter((s) => s.shown > 0)
    .map((s) => ({ ...s, wrongRate: Math.round((s.wrong / s.shown) * 100) }))
    .sort((a, b) => b.wrongRate - a.wrongRate || b.shown - a.shown).slice(0, 10);
  const scores = rows.filter((r) => r.best !== null).map((r) => r.best);
  res.json({
    course: courseOut(c), rows, hardest,
    summary: {
      assigned: rows.length,
      completed: rows.filter((r) => r.status === 'completed').length,
      inProgress: rows.filter((r) => r.status === 'in_progress').length,
      notStarted: rows.filter((r) => r.status === 'not_started').length,
      failed: rows.filter((r) => r.status === 'failed').length,
      overdue: rows.filter((r) => r.overdue).length,
      avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    },
  });
});
app.get('/api/admin/attempts/:id', auth, admin, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Urinish topilmadi');
  const u = q('SELECT * FROM users WHERE id = ?').get(a.user_id);
  const c = q('SELECT * FROM courses WHERE id = ?').get(a.course_id);
  const layout = JSON.parse(a.layout);
  const ans = JSON.parse(a.answers || '{}');
  const ids = layout.map((l) => l.q);
  const qmap = new Map(ids.length ? q(`SELECT * FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map((x) => [x.id, x]) : []);
  res.json({
    id: a.id, user: publicUser(u), course: courseOut(c), startedAt: a.started_at, finishedAt: a.finished_at, score: a.score, passed: !!a.passed,
    correct: a.correct_count, total: a.total, autoSubmitted: a.auto_submitted,
    violations: JSON.parse(a.violations || '[]').map((v) => ({ ...v, label: EVENT_TYPES[v.type] || v.type })),
    snapshots: q('SELECT id, kind, created_at FROM snapshots WHERE attempt_id = ? ORDER BY id').all(a.id).map((s) => ({ id: s.id, kind: s.kind, createdAt: s.created_at })),
    answers: layout.filter((l) => qmap.has(l.q)).map((l) => {
      const x = qmap.get(l.q); const opts = JSON.parse(x.options); const chosen = ans[l.q] ?? null;
      return { text: x.text, chosen: chosen === null ? null : opts[chosen], correctAnswer: opts[x.correct], isCorrect: chosen === x.correct };
    }),
  });
});
app.get('/api/admin/snapshots/:id', auth, admin, (req, res) => {
  const s = q('SELECT * FROM snapshots WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Topilmadi');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(SNAP_DIR, s.file_name));
});
app.post('/api/admin/courses/:id/users/:uid/reset', auth, admin, (req, res) => {
  const c = getCourse(req.params.id);
  const ids = q('SELECT id FROM attempts WHERE course_id = ? AND user_id = ?').all(c.id, Number(req.params.uid)).map((x) => x.id);
  q('DELETE FROM attempts WHERE course_id = ? AND user_id = ?').run(c.id, Number(req.params.uid));
  for (const id of ids) fs.rm(path.join(SNAP_DIR, String(id)), { recursive: true, force: true }, () => {});
  res.json({ ok: true });
});
app.get('/api/admin/users/:id/progress', auth, admin, (req, res) => {
  const u = q('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Topilmadi');
  const courses = q('SELECT * FROM courses WHERE published = 1 ORDER BY id DESC').all().filter((c) => {
    const deps = JSON.parse(c.departments || '[]'); return deps.length === 0 || deps.includes(u.department);
  });
  const attempts = q('SELECT a.*, c.title AS course_title FROM attempts a JOIN courses c ON c.id = a.course_id WHERE a.user_id = ? AND a.finished_at IS NOT NULL ORDER BY a.id DESC').all(u.id);
  res.json({
    user: publicUser(u),
    courses: courses.map((c) => { const st = courseState(c, u); return { id: c.id, title: c.title, deadline: c.deadline, status: st.status, overdue: st.overdue, progress: st.progress, best: st.best, attemptsUsed: st.attemptsUsed }; }),
    attempts: attempts.map((a) => ({ id: a.id, courseTitle: a.course_title, score: a.score, passed: !!a.passed, correct: a.correct_count, total: a.total, finishedAt: a.finished_at, violations: violationCount(a) })),
  });
});
app.get('/api/admin/dashboard', auth, admin, (req, res) => {
  const employees = q("SELECT COUNT(*) AS c FROM users WHERE role = 'employee'").get().c;
  const courses = q('SELECT * FROM courses WHERE published = 1').all();
  let pairs = 0, completed = 0, overdue = 0, inProgress = 0;
  const deps = new Map();
  const perCourse = courses.map((c) => {
    const users = assignedUsers(c);
    let done = 0, od = 0;
    for (const u of users) {
      const st = courseState(c, u);
      const dk = u.department || "Bo'limsiz";
      const dv = deps.get(dk) || { department: dk, assigned: 0, completed: 0, users: new Set() };
      dv.assigned++; dv.users.add(u.id); if (st.status === 'completed') dv.completed++;
      deps.set(dk, dv);
      if (st.status === 'completed') done++;
      if (st.status === 'in_progress') inProgress++;
      if (st.overdue) od++;
    }
    pairs += users.length; completed += done; overdue += od;
    return { id: c.id, title: c.title, deadline: c.deadline, assigned: users.length, completed: done, overdue: od };
  });
  const recent = q(`SELECT a.id, a.score, a.passed, a.finished_at, u.name, u.department, c.title AS course_title
    FROM attempts a JOIN users u ON u.id = a.user_id JOIN courses c ON c.id = a.course_id
    WHERE a.finished_at IS NOT NULL ORDER BY a.finished_at DESC LIMIT 8`).all();
  res.json({
    employees, publishedCourses: courses.length, draftCourses: q('SELECT COUNT(*) AS c FROM courses WHERE published = 0').get().c,
    assignments: pairs, completed, inProgress, overdue, completionRate: pairs ? Math.round((completed / pairs) * 100) : 0,
    perDepartment: [...deps.values()].map((x) => ({ department: x.department, employees: x.users.size, rate: Math.round((x.completed / x.assigned) * 100) }))
      .sort((a, b) => b.rate - a.rate),
    perCourse, recent: recent.map((r) => ({ id: r.id, score: r.score, passed: !!r.passed, finishedAt: r.finished_at, name: r.name, department: r.department, courseTitle: r.course_title })),
  });
});

// --- employee
function courseFor(req) {
  const c = getCourse(req.params.id);
  if (!isAssigned(c, req.user)) fail(404, 'Kurs topilmadi');
  return c;
}
app.get('/api/my/courses', auth, (req, res) => {
  const courses = q('SELECT * FROM courses WHERE published = 1 ORDER BY id DESC').all().filter((c) => isAssigned(c, { ...req.user, role: 'employee' }));
  res.json(courses.map((c) => {
    const st = courseState(c, req.user);
    return { ...courseOut(c), status: st.status, progress: st.progress, overdue: st.overdue, lessonsTotal: st.lessonsTotal, hasTest: st.hasTest, best: st.best, passed: st.passed };
  }));
});
app.get('/api/my/courses/:id', auth, (req, res) => {
  const c = courseFor(req);
  res.json({ course: courseOut(c), state: courseState(c, req.user) });
});
app.post('/api/my/lessons/:id/complete', auth, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Dars topilmadi');
  const c = getCourse(l.course_id);
  if (!isAssigned(c, req.user)) fail(404, 'Dars topilmadi');
  const st = courseState(c, req.user);
  if (st.lessons.find((x) => x.id === l.id)?.locked) fail(403, 'Avval oldingi darslarni tugating');
  if (l.type === 'video' && l.duration && req.user.role !== 'admin') {
    const vp = q('SELECT max_pos FROM video_progress WHERE user_id = ? AND lesson_id = ?').get(req.user.id, l.id);
    if (!vp || vp.max_pos < l.duration * 0.95) fail(400, "Videoni oxirigacha ko'ring");
  }
  q('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)').run(req.user.id, l.id, nowIso());
  res.json({ ok: true });
});
// Video ko'rish jarayoni: server faqat real vaqtga mos o'sishni qabul qiladi (oldinga sakrash hisoblanmaydi)
app.post('/api/my/lessons/:id/progress', auth, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.id)) || fail(404, 'Dars topilmadi');
  if (l.type !== 'video') fail(400, 'Bu video dars emas');
  const c = getCourse(l.course_id);
  if (!isAssigned(c, req.user)) fail(404, 'Dars topilmadi');
  if (courseState(c, req.user).lessons.find((x) => x.id === l.id)?.locked) fail(403, 'Avval oldingi darslarni tugating');
  const pos = Number(req.body?.pos);
  if (!Number.isFinite(pos) || pos < 0) fail(400, "Noto'g'ri qiymat");
  if (!l.duration && Number(req.body?.duration) > 0) {
    q('UPDATE lessons SET duration = ? WHERE id = ? AND duration IS NULL').run(Number(req.body.duration), l.id);
    l.duration = Number(req.body.duration);
  }
  const now = Date.now();
  const vp = q('SELECT * FROM video_progress WHERE user_id = ? AND lesson_id = ?').get(req.user.id, l.id);
  const prev = vp ? vp.max_pos : 0;
  const elapsed = vp ? (now - Date.parse(vp.updated_at)) / 1000 : 0;
  const allowed = prev + Math.min(elapsed * 1.6, 15) + 4;
  let maxPos = Math.max(prev, Math.min(pos, allowed));
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
app.get('/api/files/:lessonId', auth, (req, res) => {
  const l = q('SELECT * FROM lessons WHERE id = ?').get(Number(req.params.lessonId));
  if (!l || !l.file_name) fail(404, 'Fayl topilmadi');
  const c = getCourse(l.course_id);
  if (!isAssigned(c, req.user)) fail(404, 'Fayl topilmadi');
  if (req.user.role !== 'admin') {
    const st = courseState(c, req.user);
    if (st.lessons.find((x) => x.id === l.id)?.locked) fail(403, 'Avval oldingi darslarni tugating');
  }
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Disposition', 'inline');
  res.sendFile(path.join(FILES_DIR, l.file_name));
});
app.post('/api/my/courses/:id/attempts', auth, (req, res) => {
  const c = courseFor(req);
  const st = courseState(c, req.user);
  if (st.openAttemptId) return res.json(attemptPayload(q('SELECT * FROM attempts WHERE id = ?').get(st.openAttemptId)));
  if (!st.hasTest) fail(400, 'Bu kursda test yo\'q');
  if (st.passed) fail(400, "Siz bu testdan allaqachon o'tgansiz");
  if (st.lessonsDone < st.lessonsTotal) fail(400, 'Avval barcha darslarni tugating');
  if (!st.canStartTest) fail(400, 'Urinishlar soni tugagan');
  let qs = q('SELECT id, options FROM questions WHERE course_id = ?').all(c.id);
  shuffle(qs);
  if (c.question_count > 0) qs = qs.slice(0, c.question_count);
  const layout = qs.map((x) => ({ q: x.id, o: shuffle([...Array(JSON.parse(x.options).length).keys()]) }));
  const started = new Date();
  const deadline = c.time_limit_min > 0 ? new Date(started.getTime() + c.time_limit_min * 60000).toISOString() : null;
  const r = q('INSERT INTO attempts (user_id, course_id, started_at, deadline_at, layout) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, c.id, started.toISOString(), deadline, JSON.stringify(layout));
  res.json(attemptPayload(q('SELECT * FROM attempts WHERE id = ?').get(r.lastInsertRowid)));
});
app.post('/api/my/attempts/:id/submit', auth, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
  if (a.finished_at) return res.json(resultPayload(a, req.user));
  const late = a.deadline_at && Date.now() > Date.parse(a.deadline_at) + GRACE_MS;
  const reason = ['timeout', 'violations'].includes(req.body?.reason) ? req.body.reason : null;
  if (reason) q('UPDATE attempts SET auto_submitted = ? WHERE id = ?').run(reason, a.id);
  const done = gradeAttempt(a, late ? null : req.body?.answers || {});
  res.json(resultPayload(done, req.user));
});
// Test paytidagi hodisalar (tab almashtirish, to'liq ekrandan chiqish, PrintScreen va h.k.)
const EVENT_TYPES = {
  tab_hidden: 'Boshqa oyna/tabga o\'tdi', blur: 'Test oynasidan chiqdi', fullscreen_exit: "To'liq ekrandan chiqdi",
  printscreen: 'Skrinshot olishga urindi', copy: 'Nusxa olishga urindi', print: 'Chop etishga urindi',
  camera_off: "Kamera o'chdi", camera_denied: 'Kameraga ruxsat bermadi', devtools: 'Dasturchi vositalarini ochdi', info: 'Maʼlumot',
};
app.post('/api/my/attempts/:id/events', auth, (req, res) => {
  const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
  if (a.finished_at) return res.json({ finished: true });
  const type = Object.hasOwn(EVENT_TYPES, req.body?.type) ? req.body.type : 'info';
  const list = JSON.parse(a.violations || '[]');
  if (list.length < 300) list.push({ type, at: nowIso(), detail: str(req.body?.detail, 200) });
  q('UPDATE attempts SET violations = ? WHERE id = ?').run(JSON.stringify(list), a.id);
  const course = q('SELECT max_violations FROM courses WHERE id = ?').get(a.course_id);
  const count = list.filter((v) => v.type !== 'info').length;
  res.json({ count, max: course.max_violations, limitReached: course.max_violations > 0 && count >= course.max_violations });
});
const snapUpload = multer({ dest: TMP_DIR, limits: { fileSize: 1.5 * 1024 * 1024, files: 1 } });
app.post('/api/my/attempts/:id/snapshots', auth, snapUpload.single('image'), (req, res) => {
  const tmp = req.file?.path;
  try {
    const a = q('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id) || fail(404, 'Urinish topilmadi');
    if (!req.file) fail(400, 'Rasm yuborilmadi');
    if (a.finished_at && Date.now() - Date.parse(a.finished_at) > 60000) fail(400, 'Urinish yakunlangan');
    if (q('SELECT COUNT(*) AS c FROM snapshots WHERE attempt_id = ?').get(a.id).c >= 400) fail(400, 'Limit');
    const head = fs.readFileSync(tmp).subarray(0, 3);
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
  if (st.status !== 'completed') fail(400, 'Kurs hali tugatilmagan');
  const num = `${String(c.id).padStart(3, '0')}-${String(req.user.id).padStart(4, '0')}-${(st.completedAt || '').slice(0, 10).replace(/-/g, '')}`;
  res.json({ name: req.user.name, department: req.user.department, position: req.user.position, courseTitle: c.title, score: st.best, completedAt: st.completedAt, number: num, appName: APP_NAME });
});

// --- static
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'lms-backend', time: nowIso() }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Topilmadi' }));
// Frontend (lms-ui) build/statik fayllari bo'lsa — shu serverning o'zidan beriladi (production). Bo'lmasa — faqat API.
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..', 'public'));
if (fs.existsSync(path.join(STATIC_DIR, 'index.html'))) {
  app.use(express.static(STATIC_DIR, { extensions: ['html'], maxAge: '5m' }));
} else {
  app.get('/', (req, res) => res.json({ name: 'lms-backend', ok: true, hint: 'Frontend: lms-ui repozitoriysi. API: /api/*' }));
}

app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fayl juda katta (maks. 2 GB)' : err.message });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: "So'rov noto'g'ri" });
  console.error(err);
  res.status(500).json({ error: 'Serverda xatolik' });
});

// ---------------------------------------------------------------- seed
function seed() {
  if (!q("SELECT id FROM users WHERE role = 'admin'").get()) {
    const phone = normalizePhone(process.env.ADMIN_PHONE || '998900000000');
    const pw = process.env.ADMIN_PASSWORD || randomPassword();
    q("INSERT INTO users (name, phone, password_hash, role, department, position, created_at) VALUES (?, ?, ?, 'admin', 'Boshqaruv', 'Administrator', ?)")
      .run(process.env.ADMIN_NAME || 'Administrator', phone, hashPassword(pw), nowIso());
    console.log(`Admin yaratildi: ${phone}${process.env.ADMIN_PASSWORD ? '' : ' / ' + pw}`);
  }
  if (process.env.DEMO_SEED === '1' && !q('SELECT id FROM courses').get()) {
    require('./seed').seedDemo({ q, tx, hashPassword, insertQuestion, FILES_DIR, convertToPdf, probeDuration, shuffle })
      .then(() => console.log('Demo maʼlumotlar yaratildi')).catch((e) => console.error('Demo seed xatosi', e));
  }
}
seed();

app.listen(PORT, () => console.log(`LMS ${PORT}-portda ishga tushdi`));
