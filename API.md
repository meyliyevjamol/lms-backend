# API hujjati

Barcha endpointlar `/api` bilan boshlanadi. So'rov va javoblar JSON (fayl yuklashdan tashqari — `multipart/form-data`).

**Autentifikatsiya** — cookie (`lms_session`, httpOnly, 30 kun). `POST /api/auth/login` dan keyin brauzer cookie'ni o'zi yuboradi; `fetch` da `credentials: 'same-origin'` yetarli (frontend va API bitta domenda, lokalda esa `lms-ui` dev-server proksi qiladi).

**Xatolar** — `4xx/5xx` status va `{ "error": "Matn (o'zbekcha)" }`. `401` — tizimga kirilmagan, `403` — ruxsat yo'q yoki dars yopiq.

**Rollar** — `admin` (`/api/admin/*`) va `employee` (`/api/my/*`). Admin `/api/my/*` ni ham chaqira oladi (xodim ko'rinishi, cheklovlarsiz).

---

## Auth

| Metod | Yo'l | Body | Javob |
|---|---|---|---|
| POST | `/auth/login` | `{ phone: "998901234567", password }` | `{ user }` + cookie. 10 ta xato urinishdan so'ng 15 daqiqa blok (`429`) |
| POST | `/auth/logout` | — | `{ ok }` |
| GET | `/me` | — | `{ user \| null, appName }` |
| POST | `/me/password` | `{ oldPassword, newPassword }` | `{ ok }` |
| GET | `/health` | — | `{ ok, name, time }` |

`user`: `{ id, name, phone, role: "admin"|"employee", department, position, createdAt }`

## Xodim (`/api/my/*`)

| Metod | Yo'l | Izoh |
|---|---|---|
| GET | `/my/courses` | Tayinlangan kurslar: `course` + `status, progress, overdue, lessonsTotal, hasTest, best, passed` |
| GET | `/my/courses/:id` | `{ course, state }` — pastda `state` |
| POST | `/my/lessons/:id/progress` | Video: `{ pos, duration }` har ~5 soniyada. Server faqat real vaqtga mos o'sishni qabul qiladi (oldinga sakrash hisoblanmaydi). Javob `{ maxPos, completed, duration }`; 95% ko'rilganda dars avtomatik tugaydi |
| POST | `/my/lessons/:id/complete` | PDF/matn darsini tugatish. Video uchun server ko'rilganini tekshiradi |
| GET | `/files/:lessonId` | Dars fayli (video — Range qo'llab-quvvatlanadi, PDF). Yopiq dars uchun `403` |
| POST | `/my/courses/:id/attempts` | Testni boshlash yoki ochiq urinishni davom ettirish → `attempt` (pastda) |
| POST | `/my/attempts/:id/submit` | `{ answers: { [questionId]: optionIndex }, reason?: "timeout"\|"violations" }` → `result` |
| POST | `/my/attempts/:id/events` | Proktoring hodisasi `{ type, detail? }` → `{ count, max, limitReached }` |
| POST | `/my/attempts/:id/snapshots` | `multipart`: `image` (JPEG, ≤1.5MB), `kind` = `start\|periodic\|violation\|finish` |
| GET | `/my/attempts/:id` | Yakunlangan bo'lsa `result`, aks holda `{ open: true, ...attempt }` |
| GET | `/my/certificate/:courseId` | `{ name, courseTitle, score, completedAt, number, appName }` |

**`course`**: `{ id, title, description, category, departments[], deadline "YYYY-MM-DD"|null, passScore, timeLimitMin, maxAttempts, questionCount, published, proctorCamera, proctorScreen, maxViolations }` (`0` — cheklanmagan)

**`state`**:
```json
{
  "lessons": [{ "id": 4, "title": "...", "type": "video|pdf|text", "duration": 42, "content": "...",
                "sourceType": "pptx|null", "completed": true, "locked": false, "watchedPos": 42 }],
  "lessonsDone": 1, "lessonsTotal": 3, "hasTest": true, "questionTotal": 10, "testQuestionCount": 8,
  "attemptsUsed": 0, "attemptsLeft": 2, "best": null, "passed": false,
  "status": "not_started|in_progress|completed|failed", "overdue": false, "progress": 25,
  "openAttemptId": null, "lastAttemptId": null, "canStartTest": false, "completedAt": null
}
```
Darslar ketma-ket ochiladi: oldingisi tugamaguncha keyingisi `locked: true`. Test barcha darslar tugagach ochiladi.

**`attempt`**: `{ id, courseId, courseTitle, startedAt, deadlineAt|null, serverNow, proctor: { camera, screen, maxViolations, violations }, questions: [{ id, text, options[] }] }` — savollar va variantlar har bir xodim uchun aralashtirilgan, to'g'ri javob yuborilmaydi.

**`result`**: `{ id, courseId, courseTitle, score, passed, correct, total, passScore, finishedAt, attemptsLeft, canRetry, autoSubmitted, violations }`

Proktoring hodisa turlari: `tab_hidden, blur, fullscreen_exit, printscreen, copy, print, camera_off, camera_denied, devtools, info` (`info` qoidabuzarlik hisoblanmaydi).

## Admin (`/api/admin/*`)

| Metod | Yo'l | Izoh |
|---|---|---|
| GET | `/admin/dashboard` | Umumiy statistika, `perCourse`, `perDepartment`, `recent` |
| GET | `/admin/users` | Barcha foydalanuvchilar |
| GET | `/admin/departments` | Bo'limlar ro'yxati |
| POST | `/admin/users` | `{ name, phone, department, position, role, password? }` → `{ user, password }` (parol bo'sh bo'lsa avtomatik) |
| PUT | `/admin/users/:id` | Xuddi shu maydonlar; `password` — faqat almashtirish uchun |
| DELETE | `/admin/users/:id` | |
| POST | `/admin/users/import` | `{ text }` — har qator: `Ism; telefon; bo'lim; lavozim; parol` (tab ham bo'ladi) → `{ created[], errors[] }` |
| GET | `/admin/users/:id/progress` | Xodimning kurslari va urinishlari |
| GET | `/admin/courses` | Kurslar + `lessonCount, questionTotal, assigned, completed` |
| POST | `/admin/courses` | `course` maydonlari (`title` majburiy) |
| GET | `/admin/courses/:id` | `{ course, lessons[], questions[] }` (savollarda `correct` bor) |
| PUT | `/admin/courses/:id` | Faqat yuborilgan maydonlar o'zgaradi |
| DELETE | `/admin/courses/:id` | Materiallar va natijalar bilan birga |
| POST | `/admin/courses/:id/lessons` | `multipart`: `file` (mp4/webm/mov, pdf, pptx/ppt/docx/doc/odp…), `title`, `content`. Fayl bo'lmasa — matnli dars. PPTX/DOCX serverda PDF ga aylantiriladi |
| PUT | `/admin/lessons/:id` | `{ title, content }` |
| DELETE | `/admin/lessons/:id` | |
| POST | `/admin/courses/:id/lessons/reorder` | `{ ids: [3, 1, 2] }` |
| POST | `/admin/courses/:id/questions` | `{ text, options: [..2-8], correct: index }` |
| PUT | `/admin/questions/:id` | Xuddi shu |
| DELETE | `/admin/questions/:id` | |
| POST | `/admin/courses/:id/questions/import` | `{ text }` — bloklar bo'sh qator bilan ajratiladi, 1-qator savol, to'g'ri javob oldida `*` → `{ added, errors[] }` |
| GET | `/admin/courses/:id/results` | `{ course, rows[], hardest[], summary }` |
| GET | `/admin/attempts/:id` | Urinish tafsiloti: javoblar, `violations[]`, `snapshots[]` |
| GET | `/admin/snapshots/:id` | Kamera surati (JPEG) |
| POST | `/admin/courses/:id/users/:uid/reset` | Xodimning shu kursdagi urinishlarini o'chirish |

## Qo'shimcha endpointlar (v2)

### Xodim
| Metod | Yo'l | Izoh |
|---|---|---|
| GET | `/my/home` | Bosh sahifa: `month {name,total,done}`, `avgScore`, `dueSoon[]`, `courses[]`, `unread` |
| GET | `/my/results` | Topshirilgan testlar tarixi (`showResult=false` bo'lsa ball yashiriladi) |
| GET | `/my/notifications` · POST `/my/notifications/read` | Bildirishnomalar |
| GET | `/my/telegram` | `{ enabled, botUsername, linked, username }` |
| POST | `/my/telegram/link` | `{ url }` — `t.me/<bot>?start=<bir martalik token>` (24 soat) |
| DELETE | `/my/telegram` | Telegramni uzish |
| GET | `/files/:lessonId/download` | Asl faylni yuklab olish (`allowDownload` yoqilgan bo'lsa) |

Savollar endi bir nechta to'g'ri javobli bo'lishi mumkin: `question.multi`, javob `answers: { [questionId]: [index, ...] }`.

### Admin
| Metod | Yo'l | Izoh |
|---|---|---|
| GET | `/admin/dashboard?weeks=12&department=&courseId=` | Bajarilish, holatlar taqsimoti, o'rtacha ball, o'tish %, faol xodimlar, haftalik dinamika, ballar taqsimoti, bo'limlar |
| PUT | `/admin/courses/:id/assign` | `{ all, departments[], users[], deadline (ISO) }` — tayinlash (avtomatik nashr qiladi, yangi xodimlarga xabar yuboradi) |
| POST | `/admin/courses/:id/remind` | `{ userIds? }` — topshirmaganlarga eslatma (platforma + Telegram) |
| POST | `/admin/courses/:id/users/:uid/grant` | Qayta topshirishga ruxsat (+1 urinish) |
| POST | `/admin/courses/:id/users/:uid/reset` | `{ materials: true }` — treningni qayta tayinlash |
| POST | `/admin/users/import-file` | `multipart file` (.xlsx): Ism · Telefon · Bo'lim · Lavozim · Parol |
| POST | `/admin/courses/:id/questions/import-file` | `.xlsx`: Savol · A · B · C · D … · To'g'ri javob (`B` yoki `A,C`) |
| GET | `/admin/templates/users.xlsx` · `/admin/templates/questions.xlsx` | Shablonlar |
| GET | `/admin/courses/:id/results.xlsx` · `/admin/report.xlsx` | Excel hisobotlar |

Trening sozlamalari (`course`): `testTitle, shuffle, showResult, showCorrect, requireMaterials, allowDownload, assignAll, assignedUsers[]`.

## Telegram bot
`TELEGRAM_BOT_TOKEN` berilsa, server long polling bilan botni ishga tushiradi (webhook kerak emas).
Xodim profilida «Telegramni ulash» → bot ochiladi → «Start». Bot xabar yuboradi: yangi tayinlov, eslatma, qayta ruxsat,
muddatga 3 kun / 1 kun qolganda va muddat o'tganda (har biri bir marta). Buyruqlar: `/status`, `/stop`.
