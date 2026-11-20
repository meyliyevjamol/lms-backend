# lms-backend

**Malaka** — xodimlarni o'qitish va bilimini tekshirish platformasi (korporativ LMS) uchun backend API.

Frontend: [lms-ui](../../../lms-ui) repozitoriysi.

## Imkoniyatlar

- Kurslar: video, PDF, PowerPoint/Word (serverda PDF ga aylantiriladi) va matnli darslar
- Darslar ketma-ket ochiladi; video oxirigacha ko'rilmaguncha keyingisi yopiq — **tekshiruv serverda**
- Testlar: savollar banki, aralashtirish, vaqt, urinishlar, o'tish bali, matndan import
- Proktoring: to'liq ekran, boshqa oynaga o'tish/skrinshot urinishlarini qayd etish, kamera suratlari
- Natijalar, bo'limlar reytingi, eng qiyin savollar, sertifikat, xodimlarni ro'yxatdan import

## Stack

Node.js 22.13+ (tavsiya 24) · Express 5 · SQLite (`node:sqlite`, tashqi DB kerak emas) · Multer · LibreOffice (PPTX→PDF) · ffmpeg (video davomiyligi, demo videolar)

## Tez ishga tushirish (Docker — tavsiya etiladi)

```bash
git clone <lms-backend url>
git clone <lms-ui url>          # yonma-yon: ../lms-ui/public frontend sifatida ulanadi
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
| Xodim, jarayonda | 998901110001 | `DEMO_PASSWORD` (demo123) |
| Xodim, toza | 998901110002 | demo123 |

## Muhit o'zgaruvchilari

| Nomi | Standart | Izoh |
|---|---|---|
| `PORT` | 3000 | |
| `DATA_DIR` | `./data` (Docker: `/data`) | SQLite baza, fayllar, kamera suratlari |
| `STATIC_DIR` | `./public` | Frontend fayllari. Yo'q bo'lsa — faqat API |
| `APP_NAME` | Korporativ LMS | Platforma nomi (sertifikat, videolar) |
| `ADMIN_PHONE`, `ADMIN_PASSWORD`, `ADMIN_NAME` | | Birinchi admin (baza bo'sh bo'lsa yaratiladi) |
| `DEMO_SEED`, `DEMO_PASSWORD` | | Demo ma'lumotlar |
| `SESSION_SECRET` | avtomatik | Cookie imzosi |

## Tuzilma

```
src/server.js   — butun API (auth, admin, xodim, proktoring)
src/seed.js     — demo ma'lumotlar: xodimlar, kurslar, ffmpeg bilan slayd-videolar, PDF'lar, natijalar tarixi
API.md          — endpointlar hujjati
```

API hujjati: [API.md](API.md)
