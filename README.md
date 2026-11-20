# lms-backend

**Malaka** — xodimlarni o'qitish va bilimini tekshirish platformasi (korporativ LMS) uchun backend API.

Frontend: [meyliyevjamol/lms-ui](https://github.com/meyliyevjamol/lms-ui)

## Imkoniyatlar

- Kurslar: video, PDF, PowerPoint/Word (serverda PDF ga aylantiriladi) va matnli darslar
- Darslar ketma-ket ochiladi; video oxirigacha ko'rilmaguncha keyingisi yopiq — **tekshiruv serverda**
- Testlar: savollar banki, aralashtirish, vaqt, urinishlar, o'tish bali, matndan import
- Proktoring: to‘liq ekran, boshqa oynaga o‘tish/skrinshot urinishlarini qayd etish, kamera suratlari
- Tayinlash: hammaga / bo‘limlarga / alohida xodimlarga, muddat (sana + soat)
- Excel: xodim va savollarni .xlsx dan import, natijalar va umumiy hisobot eksporti
- Telegram bot: xodim o‘zi ulaydi, muddat eslatmalari avtomatik
- Deploy: GitHub Actions — main’ga push → serverga avtomatik chiqadi
- Natijalar, bo'limlar reytingi, eng qiyin savollar, sertifikat, xodimlarni ro'yxatdan import

## Stack

Node.js 22.13+ (tavsiya 24) · Express 5 · SQLite (`node:sqlite`, tashqi DB kerak emas) · Multer · LibreOffice (PPTX→PDF) · ffmpeg (video davomiyligi, demo videolar)

## Tez ishga tushirish (Docker — tavsiya etiladi)

```bash
git clone https://github.com/meyliyevjamol/lms-backend.git
git clone https://github.com/meyliyevjamol/lms-ui.git          # yonma-yon: ../lms-ui/public frontend sifatida ulanadi
cd lms-backend
cp lms.env.example lms.env       # ADMIN_PASSWORD ni o'zgartiring
docker compose up -d --build
```

http://localhost:3000 — sayt (frontend + API). Birinchi ishga tushishda `DEMO_SEED=1` bo'lsa demo ma'lumotlar yaratiladi (videolar generatsiyasi ~1 daqiqa).

## Docker'siz (faqat API ustida ishlash uchun)

```bash
npm install
ADMIN_PASSWORD=admin123 DEMO_SEED=1 npm run dev
```

API: http://localhost:3000/api/health. Lokalda LibreOffice/ffmpeg bo'lmasa PPTX konvertatsiya va demo videolar ishlamaydi — qolgan hammasi ishlaydi.

## Demo akkauntlar (`DEMO_SEED=1`)

| Rol | Telefon | Parol |
|---|---|---|
| Admin | `ADMIN_PHONE` (standart 998900000000) | `ADMIN_PASSWORD` |
| Xodim, jarayonda (Dilnoza) | 998901110001 | `DEMO_PASSWORD` (demo123) |
| Xodim, toza (Jasur) | 998901110002 | demo123 |

## Muhit o'zgaruvchilari

| Nomi | Standart | Izoh |
|---|---|---|
| `PORT` | 3000 | |
| `DATA_DIR` | `./data` (Docker: `/data`) | SQLite baza, fayllar, kamera suratlari |
| `STATIC_DIR` | `./public` | Frontend fayllari. Yo'q bo'lsa — faqat API |
| `APP_NAME`, `COMPANY_NAME` | O‘quv markazi | Platforma va kompaniya nomi (sidebar, sertifikat) |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot (bo‘sh — o‘chiq) |
| `PUBLIC_URL` | — | Sayt manzili (Telegram tugmalari uchun) |
| `ADMIN_PHONE`, `ADMIN_PASSWORD`, `ADMIN_NAME` | | Birinchi admin (baza bo'sh bo'lsa yaratiladi) |
| `DEMO_SEED`, `DEMO_PASSWORD` | | Demo ma'lumotlar |
| `SESSION_SECRET` | avtomatik | Cookie imzosi |

## Tuzilma

```
src/server.js   — butun API (auth, admin, xodim, tayinlash, proktoring, Excel)
src/telegram.js — Telegram bot: ulash, eslatmalar, muddat bildirishnomalari
src/seed.js     — demo ma'lumotlar: xodimlar, kurslar, ffmpeg bilan slayd-videolar, PDF'lar, natijalar tarixi
API.md          — endpointlar hujjati
```

API hujjati: [API.md](API.md)

## Avtomatik deploy (GitHub Actions)

`main` branch'ga push yoki PR merge → `.github/workflows/deploy.yml`:
sintaksis tekshiruvi → kod serverga yuboriladi → Docker qayta build → health-check. Yangi versiya ishga tushmasa, server avtomatik oldingi versiyaga qaytadi.

Kerakli repository secret'lar: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_KNOWN_HOSTS`.
SSH kalit serverda cheklangan (`restrict,command=ci-deploy.sh`) — u faqat deploy skriptini ishga tushira oladi.
