'use strict';
/* Demo ma'lumotlar: xodimlar, kurslar, generatsiya qilingan video darslar va PDF qo'llanmalar, natijalar tarixi */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ------------------------------------------------------------------ content
const EMPLOYEES = [
  ['Aziza Karimova', '998901110001', 'Sotuv', 'Sotuv menejeri'],
  ['Jasur Toshmatov', '998901110002', 'Sotuv', 'Katta sotuv menejeri'],
  ['Sardor Yusupov', '998901110005', 'Sotuv', 'Sotuv menejeri'],
  ['Malika Ergasheva', '998901110006', 'Sotuv', 'Hisob menejeri'],
  ['Otabek Nazarov', '998901110007', 'Sotuv', "Bo'lim rahbari"],
  ['Kamola Saidova', '998901110008', 'Sotuv', 'Sotuv menejeri'],
  ['Dilnoza Rahimova', '998901110003', 'Mijozlarga xizmat', 'Operator'],
  ['Bekzod Aliyev', '998901110004', 'Mijozlarga xizmat', 'Operator'],
  ['Nilufar Qodirova', '998901110009', 'Mijozlarga xizmat', 'Katta operator'],
  ['Shahzod Murodov', '998901110010', 'Mijozlarga xizmat', 'Operator'],
  ['Gulnora Islomova', '998901110011', 'Mijozlarga xizmat', 'Smena rahbari'],
  ['Javohir Rustamov', '998901110012', 'Marketing', 'SMM mutaxassisi'],
  ['Madina Xolmatova', '998901110013', 'Marketing', 'Marketolog'],
  ['Ulugbek Sobirov', '998901110014', 'Marketing', 'Dizayner'],
  ['Feruza Abdullayeva', '998901110015', 'Moliya', 'Bosh hisobchi'],
  ['Akmal Hamidov', '998901110016', 'Moliya', 'Hisobchi'],
  ['Zarina Tursunova', '998901110017', 'Moliya', 'Iqtisodchi'],
  ['Shoira Mirzayeva', '998901110018', 'HR', 'HR menejer'],
  ['Doniyor Ahmedov', '998901110019', 'IT', 'Tizim administratori'],
  ['Behruz Karimov', '998901110020', 'IT', 'Dasturchi'],
];

const COURSES = [
  {
    key: 'onboarding', title: 'Kompaniyaga xush kelibsiz: yangi xodim kursi', category: 'Onboarding', departments: [],
    description: "Kompaniya tarixi, missiyasi, ichki tartib va birinchi oydagi vazifalaringiz. Har bir yangi xodim ishning birinchi haftasida shu kursni tugatadi.",
    deadlineDays: 10, pass: 70, time: 10, attempts: 3, qcount: 0, camera: 0, screen: 1, maxViol: 5,
    lessons: [
      { type: 'video', title: 'Kompaniya tarixi va missiyasi', kicker: '1-DARS · ONBOARDING', palette: ['0x1a1446', '0x5b4cf5'],
        slides: [
          { h: 'Biz kimmiz?', b: ["2014-yilda 5 kishilik jamoa bilan boshlaganmiz", "Bugun 3 shaharda 180 dan ortiq xodim", "40 000+ doimiy mijoz bizga ishonadi"] },
          { h: 'Missiyamiz', b: ["Mijozning vaqtini tejash va hayotini osonlashtirish", "Har bir xizmatni sifat standarti asosida ko'rsatish", "Xodimlarning doimiy o'sishiga sharoit yaratish"] },
          { h: 'Qadriyatlarimiz', b: ['Mijoz birinchi o\'rinda', 'Halollik va ochiqlik', 'Jamoaviy natija', "Doimiy o'rganish"] },
          { h: 'Birinchi oyingiz', b: ["1-hafta: onboarding kursi va ustoz bilan tanishuv", "2-3-hafta: lavozim bo'yicha amaliy o'qitish", "4-hafta: rahbar bilan natijalar suhbati"] },
        ] },
      { type: 'pdf', title: "Xodim qo'llanmasi (PDF)", doc: 'handbook' },
      { type: 'text', title: 'Ichki tartib qoidalari', content: "Ish vaqti: dushanba–juma, 09:00 dan 18:00 gacha. Tushlik: 13:00–14:00.\n\nKechikish yoki ishga kela olmaslik haqida rahbaringizga kamida 30 daqiqa oldin xabar bering.\n\nTa'til uchun ariza kamida 2 hafta oldin HR bo'limiga topshiriladi. Kasallik varaqasi 3 ish kuni ichida taqdim etiladi.\n\nKorporativ ma'lumotlarni shaxsiy messenjerlar orqali yuborish va ish kompyuterida begona dasturlar o'rnatish taqiqlanadi.\n\nKiyinish uslubi: biznes-kezhual. Mijozlar bilan uchrashuv kunlari — rasmiy kiyim." },
    ],
    questions: [
      ['Kompaniya qachon tashkil etilgan?', ['2010', '2014', '2018', '2020'], 1],
      ['Ish kuni soat nechada boshlanadi?', ['08:00', '08:30', '09:00', '10:00'], 2],
      ["Ta'til uchun ariza qancha oldin topshiriladi?", ['3 kun', '1 hafta', '2 hafta', '1 oy'], 2],
      ['Qaysi biri kompaniya qadriyatlariga kirmaydi?', ['Halollik va ochiqlik', 'Jamoaviy natija', "Doimiy o'rganish", 'Har kim faqat o\'zi uchun'], 3],
      ['Kasallik varaqasi necha kun ichida taqdim etiladi?', ['1 ish kuni', '3 ish kuni', '5 ish kuni', '10 ish kuni'], 1],
      ['Ishga kechikish haqida qancha oldin xabar berish kerak?', ['5 daqiqa', '30 daqiqa', '2 soat', 'Xabar berish shart emas'], 1],
      ['Birinchi oyning 4-haftasida nima bo\'ladi?', ['Onboarding kursi', 'Amaliy o\'qitish', 'Rahbar bilan natijalar suhbati', "Ta'til"], 2],
      ['Korporativ ma\'lumotlarni qayerga yuborish taqiqlanadi?', ['Korporativ pochtaga', 'Shaxsiy messenjerlarga', "Bo'lim rahbariga", 'Ichki tizimga'], 1],
    ],
  },
  {
    key: 'sales', title: "Sotuv texnikasi: SPIN va e'tirozlar bilan ishlash", category: 'Sotuv', departments: ['Sotuv'],
    description: "SPIN savollar metodikasi, mijoz ehtiyojini aniqlash va eng ko'p uchraydigan e'tirozlarga javob berish. Yakuniy test kamera nazorati ostida topshiriladi.",
    deadlineDays: 7, pass: 75, time: 15, attempts: 2, qcount: 8, camera: 1, screen: 1, maxViol: 3,
    lessons: [
      { type: 'video', title: 'SPIN metodikasi: 4 turdagi savol', kicker: '1-DARS · SOTUV', palette: ['0x0b2a4a', '0x2f7cf6'],
        slides: [
          { h: 'SPIN nima?', b: ['Situation — vaziyat haqidagi savollar', 'Problem — muammoni aniqlovchi savollar', 'Implication — oqibat haqidagi savollar', 'Need-payoff — foyda haqidagi savollar'] },
          { h: 'Vaziyat savollari', b: ['«Hozir bu ishni qanday tashkil qilgansiz?»', "Qisqa bo'lsin: 2-3 tadan oshmasin", 'Maqsad: mijoz kontekstini tushunish'] },
          { h: 'Muammo va oqibat', b: ['«Bu jarayonda nima ko\'proq vaqt oladi?»', '«Bu muammo oyiga qancha zarar keltiradi?»', 'Mijoz muammoning hajmini o\'zi his qilsin'] },
          { h: 'Foyda savollari', b: ['«Agar bu 2 baravar tezlashsa, nima o\'zgaradi?»', 'Yechimni mijozning o\'zi aytishiga yordam bering', 'Shundan keyingina mahsulotni taklif qiling'] },
        ] },
      { type: 'video', title: "E'tirozlar bilan ishlash: 5 qadam", kicker: '2-DARS · SOTUV', palette: ['0x3b0a2a', '0xe3489b'],
        slides: [
          { h: "E'tiroz — bu qiziqish belgisi", b: ["Befarq mijoz e'tiroz bildirmaydi", "«Qimmat» degani — «qiymatini tushunmadim»", 'Bahslashmang, aniqlashtiring'] },
          { h: '5 qadamli algoritm', b: ['1. Tinglang va gapni bo\'lmang', '2. Qo\'shiling: «Tushunaman sizni»', '3. Aniqlashtiring: «Nima bilan solishtiryapsiz?»', '4. Argument keltiring', '5. Keyingi qadamni taklif qiling'] },
          { h: '«Qimmat» e\'tirozi', b: ['Narxni oylik yoki kunlik qiymatga bo\'ling', "Tejaladigan vaqt va pulni raqamda ko'rsating", 'Muqobil paket taklif qiling'] },
        ] },
      { type: 'pdf', title: "Sotuv skriptlari to'plami (PDF)", doc: 'scripts' },
    ],
    questions: [
      ['SPIN qisqartmasidagi «I» harfi nimani anglatadi?', ['Information', 'Implication', 'Interest', 'Idea'], 1],
      ['Vaziyat savollari nechta bo\'lgani maqbul?', ['1 ta', '2-3 ta', '7-8 ta', 'Cheklanmagan'], 1],
      ['Qaysi savol muammo savoliga misol bo\'ladi?', ['«Kompaniyangizda necha xodim bor?»', '«Bu jarayonda nima ko\'proq vaqt oladi?»', '«Shartnoma imzolaymizmi?»', '«Qaysi shahardasiz?»'], 1],
      ["Mijozning «qimmat» degan e'tirozi ko'pincha nimani bildiradi?", ['Mijozda pul yo\'q', 'Mijoz qiymatini tushunmagan', 'Mijoz sotib olmaydi', 'Raqobatchi arzonroq'], 1],
      ["E'tiroz bilan ishlashning birinchi qadami qaysi?", ['Argument keltirish', 'Chegirma berish', 'Tinglash', 'Rahbarni chaqirish'], 2],
      ['Mahsulotni qachon taklif qilish kerak?', ['Suhbat boshida', 'Foyda savollaridan keyin', 'Mijoz so\'ramasa — umuman yo\'q', 'Vaziyat savollaridan oldin'], 1],
      ['«Tushunaman sizni» iborasi qaysi qadamga tegishli?', ['Qo\'shilish', 'Aniqlashtirish', 'Yopish', 'Taqdimot'], 0],
      ['Narx e\'tirozida qaysi usul tavsiya etiladi?', ['Narxni darhol tushirish', 'Narxni kunlik qiymatga bo\'lib ko\'rsatish', 'Mavzuni o\'zgartirish', "Raqobatchini yomonlash"], 1],
      ['Need-payoff savollarining maqsadi nima?', ['Mijozni chalg\'itish', 'Yechim foydasini mijozning o\'zi aytishi', 'Narxni bilish', 'Suhbatni tugatish'], 1],
      ['Befarq mijoz odatda qanday yo\'l tutadi?', ["Ko'p e'tiroz bildiradi", "E'tiroz bildirmaydi", 'Chegirma so\'raydi', 'Shartnoma so\'raydi'], 1],
    ],
  },
  {
    key: 'service', title: "Mijozlarga xizmat ko'rsatish standarti", category: 'Servis', departments: ['Mijozlarga xizmat'],
    description: "Qo'ng'iroqlarni qabul qilish standarti, nutq madaniyati va norozi mijoz bilan ishlash. Call-markaz xodimlari uchun majburiy kurs.",
    deadlineDays: 5, pass: 80, time: 8, attempts: 3, qcount: 0, camera: 0, screen: 1, maxViol: 5,
    lessons: [
      { type: 'video', title: "Qo'ng'iroq qabul qilish standarti", kicker: '1-DARS · SERVIS', palette: ['0x053b2f', '0x10a56f'],
        slides: [
          { h: '3 signal qoidasi', b: ["Qo'ng'iroqqa 3 signaldan kechikmay javob bering", 'Kutish vaqti 30 soniyadan oshmasin', 'Har bir qo\'ng\'iroq CRM\'ga yoziladi'] },
          { h: 'Salomlashish skripti', b: ['«Assalomu alaykum, [kompaniya], ismim [ism].»', '«Sizga qanday yordam bera olaman?»', 'Tabassum bilan gapiring — bu ovozda seziladi'] },
          { h: 'Suhbatni yakunlash', b: ['Kelishilgan narsalarni qisqacha takrorlang', '«Yana savollaringiz bormi?» deb so\'rang', 'Mijozdan oldin go\'shakni qo\'ymang'] },
        ] },
      { type: 'text', title: 'Norozi mijoz bilan ishlash', content: "Norozi mijoz — bu kompaniyaga ikkinchi imkoniyat. Muammoni yaxshi hal qilsangiz, u eng sodiq mijozga aylanadi.\n\n1. Tinglang. Mijoz gapini oxirigacha aytib olsin, gapini bo'lmang.\n\n2. Hamdardlik bildiring: «Noqulaylik uchun uzr so'raymiz, sizni tushunaman».\n\n3. Muammoni takrorlab tasdiqlang: «To'g'ri tushundimmi: buyurtmangiz 2 kun kechikdi?»\n\n4. Aniq yechim va muddat ayting. Va'da qilgan muddatda albatta qayta bog'laning.\n\n5. Hech qachon mijoz bilan bahslashmang va javobgarlikni boshqa bo'limga to'nkamang." },
    ],
    questions: [
      ["Qo'ng'iroqqa nechta signaldan kechikmay javob berish kerak?", ['1', '3', '5', '10'], 1],
      ['Mijozning kutish vaqti qancha vaqtdan oshmasligi kerak?', ['10 soniya', '30 soniya', '2 daqiqa', '5 daqiqa'], 1],
      ['Norozi mijoz bilan ishlashda birinchi qadam?', ['Bahslashish', 'Tinglash', 'Rahbarni chaqirish', "Qo'ng'iroqni tugatish"], 1],
      ['Suhbat oxirida kim birinchi go\'shakni qo\'yadi?', ['Operator', 'Mijoz', 'Farqi yo\'q', 'Rahbar'], 1],
      ['Har bir qo\'ng\'iroq qayerga yoziladi?', ['Daftarga', 'CRM tizimiga', 'Telegramga', 'Yozilmaydi'], 1],
      ['Qaysi ibora hamdardlik bildiradi?', ['«Bu bizning aybimiz emas»', '«Sizni tushunaman, uzr so\'raymiz»', '«Boshqa bo\'limga qo\'ng\'iroq qiling»', '«Qoidalarni o\'qing»'], 1],
      ['Va\'da qilingan muddatda nima qilish kerak?', ['Kutish', 'Mijozga qayta bog\'lanish', 'Muammoni yopish', 'Rahbarga yozish'], 1],
      ["Norozi mijoz to'g'ri ishlansa kim bo'lib qoladi?", ['Raqobatchi mijozi', 'Sodiq mijoz', 'Befarq mijoz', 'Sobiq mijoz'], 1],
    ],
  },
  {
    key: 'security', title: 'Axborot xavfsizligi asoslari', category: 'Xavfsizlik', departments: [],
    description: "Fishing xatlarni aniqlash, kuchli parol siyosati va korporativ ma'lumotlarni himoya qilish. Barcha xodimlar uchun majburiy.",
    deadlineDays: -2, pass: 70, time: 10, attempts: 3, qcount: 0, camera: 0, screen: 1, maxViol: 5,
    lessons: [
      { type: 'video', title: 'Fishing hujumlarini qanday aniqlash mumkin', kicker: '1-DARS · XAVFSIZLIK', palette: ['0x2a0f0f', '0xe5484d'],
        slides: [
          { h: 'Fishing nima?', b: ["Ishonchli tashkilot nomidan yuborilgan soxta xat", 'Maqsad: parol, karta yoki ma\'lumotlarni o\'g\'irlash', 'Hujumlarning 90% elektron pochtadan boshlanadi'] },
          { h: '5 ta xavfli belgi', b: ['Shoshiltiruvchi matn: «24 soat ichida...»', "Jo'natuvchi manzili biroz boshqacha", 'Kutilmagan ilova yoki havola', 'Parol yoki SMS-kod so\'rash', 'Imlo xatolari va g\'alati dizayn'] },
          { h: 'Nima qilish kerak?', b: ['Havolani bosmang, ilovani ochmang', 'Xatni IT bo\'limiga yuboring', 'Parolni hech kimga aytmang — IT ham so\'ramaydi'] },
        ] },
      { type: 'pdf', title: 'Parol siyosati (PDF)', doc: 'passwords' },
    ],
    questions: [
      ['Kiberhujumlarning qancha qismi elektron pochtadan boshlanadi?', ['10%', '40%', '90%', '100%'], 2],
      ['Qaysi biri fishing belgisi?', ['Tanish hamkasbdan kutilgan xat', 'Shoshiltiruvchi «24 soat ichida» matni', 'Korporativ yangiliklar', 'Rahbarning yig\'ilish haqidagi xati'], 1],
      ['Shubhali xatni olganda nima qilish kerak?', ['Havolani tekshirib ko\'rish', 'IT bo\'limiga yuborish', 'Javob yozish', "Hamkasblarga jo'natish"], 1],
      ['IT bo\'limi parolingizni so\'rashi mumkinmi?', ['Ha, har doim', 'Faqat telefon orqali', "Yo'q, hech qachon", 'Faqat rahbar ruxsati bilan'], 2],
      ['Kuchli parol kamida necha belgidan iborat bo\'lishi kerak?', ['6', '8', '12', '4'], 2],
      ['Parolni qancha muddatda almashtirish tavsiya etiladi?', ['Har hafta', 'Har 90 kunda', 'Har 5 yilda', 'Hech qachon'], 1],
      ['Qaysi parol eng kuchli?', ['123456', 'Aziza1990', 'Kofe!Toshkent#Yomg1r', 'qwerty'], 2],
      ['Ikki bosqichli autentifikatsiya nima beradi?', ['Tezroq kirish', "Qo'shimcha himoya qatlami", 'Parolsiz kirish', 'Hech narsa'], 1],
    ],
  },
  {
    key: 'safety', title: "Mehnat muhofazasi va yong'in xavfsizligi", category: 'Majburiy', departments: [],
    description: "Ofisdagi xavfsizlik qoidalari, favqulodda vaziyatda harakatlanish tartibi va birinchi yordam asoslari.",
    deadlineDays: null, pass: 70, time: 0, attempts: 0, qcount: 0, camera: 0, screen: 0, maxViol: 0,
    lessons: [
      { type: 'pdf', title: "Yong'in xavfsizligi yo'riqnomasi (PDF)", doc: 'fire' },
      { type: 'text', title: 'Favqulodda vaziyatda harakatlanish', content: "Signal eshitilganda vahimaga tushmang va ishni darhol to'xtating.\n\nLiftdan foydalanmang — faqat zinapoyadan pastga tushing.\n\nEvakuatsiya xaritasidagi yashil belgilar bo'yicha eng yaqin chiqishga yo'naling.\n\nYig'ilish nuqtasi: bino oldidagi avtoturargoh. U yerda bo'lim rahbari xodimlarni ro'yxat bo'yicha tekshiradi.\n\nBinoga faqat ruxsat berilgandan keyin qayting." },
    ],
    questions: [
      ['Yong\'in signalida qaysi yo\'ldan foydalaniladi?', ['Lift', 'Zinapoya', 'Deraza', 'Farqi yo\'q'], 1],
      ['Evakuatsiya yo\'li qaysi rangdagi belgilar bilan ko\'rsatiladi?', ['Qizil', 'Sariq', 'Yashil', "Ko'k"], 2],
      ['Yig\'ilish nuqtasi qayerda?', ['Oshxonada', 'Bino oldidagi avtoturargohda', 'Rahbar xonasida', 'Uyda'], 1],
      ['Binoga qachon qaytish mumkin?', ['5 daqiqadan keyin', 'Signal to\'xtagach', 'Ruxsat berilgandan keyin', 'Xohlagan vaqtda'], 2],
      ["Elektr jihozidagi yong'inni nima bilan o'chirish mumkin emas?", ['Karbonat o\'t o\'chirgich', 'Suv', 'Kukunli o\'t o\'chirgich', 'Qum'], 1],
      ['Xodimlarni ro\'yxat bo\'yicha kim tekshiradi?', ['Qo\'riqchi', "Bo'lim rahbari", 'HR', 'Hech kim'], 1],
    ],
  },
  {
    key: 'excel', title: "Excel'da hisobot tayyorlash", category: "Ko'nikmalar", departments: ['Moliya', 'Sotuv'], draft: true,
    description: "Pivot jadvallar, VLOOKUP va diagrammalar yordamida haftalik hisobotni 15 daqiqada tayyorlash.",
    deadlineDays: null, pass: 70, time: 0, attempts: 3, qcount: 0, camera: 0, screen: 1, maxViol: 5,
    lessons: [{ type: 'text', title: 'Pivot jadvalga kirish', content: "Pivot jadval katta jadvaldagi ma'lumotlarni bir necha soniyada guruhlash va jamlash imkonini beradi.\n\nInsert → PivotTable menyusini tanlang, ma'lumotlar diapazonini belgilang va maydonlarni Rows, Columns, Values bo'limlariga sudrang." }],
    questions: [],
  },
];

const DOCS = {
  handbook: { title: "Xodim qo'llanmasi", subtitle: 'Yangi xodimlar uchun asosiy maʼlumotlar', sections: [
    ['1. Kompaniya haqida', ["Kompaniya 2014-yilda tashkil etilgan. Bugun Toshkent, Samarqand va Farg'onada filiallarimiz faoliyat yuritadi.", "Missiyamiz — mijozning vaqtini tejash va hayotini osonlashtirish."]],
    ['2. Ish tartibi', ['Ish vaqti: dushanba–juma, 09:00–18:00. Tushlik: 13:00–14:00.', "Masofaviy ish rahbar bilan kelishilgan holda haftasiga 1 kungacha ruxsat etiladi."]],
    ['3. Ish haqi va imtiyozlar', ["Ish haqi har oyning 5- va 20-sanalarida ikki qismda to'lanadi.", "Imtiyozlar: tibbiy sug'urta, bepul tushlik, o'qish xarajatlarining 50% qoplanishi."]],
    ['4. Muloqot kanallari', ["Ichki muloqot: korporativ pochta va Telegram ishchi guruhi.", "HR bo'limi: 2-qavat, 204-xona. Ichki raqam: 1204."]],
    ['5. Rivojlanish', ["Har bir xodim yiliga kamida 3 ta ichki kursni tugatadi.", "Eng yaxshi natija ko'rsatgan xodimlar chorak yakunida taqdirlanadi."]],
  ] },
  scripts: { title: "Sotuv skriptlari to'plami", subtitle: 'Telefon va uchrashuv uchun tayyor iboralar', sections: [
    ['Kirish', ["«Assalomu alaykum, [ism]! Men [kompaniya]dan [ism]man. Sizga 2 daqiqa vaqtingiz bormi?»"]],
    ['Ehtiyojni aniqlash', ["«Hozir bu masalani qanday hal qilyapsiz?»", "«Eng ko'p vaqtingizni nima oladi?»", "«Agar bu muammo hal bo'lsa, nima o'zgaradi?»"]],
    ["«Qimmat» e'tirozi", ["«Tushunaman. Nima bilan solishtiryapsiz?»", "«Kuniga hisoblasak, bu bir chashka kofe narxi — va siz har kuni 1 soat tejaysiz.»"]],
    ["«O'ylab ko'raman» e'tirozi", ["«Albatta. Qaysi jihati sizni ikkilantiryapti?»", "«Keling, payshanba kuni soat 11:00 da qisqa qo'ng'iroq belgilaymiz.»"]],
    ['Yopish', ["«Shartnomani bugun yuboraymi yoki ertaga ertalab?»", "«Qaysi paket sizga ko'proq mos keladi: Standart yoki Biznes?»"]],
  ] },
  passwords: { title: 'Parol siyosati', subtitle: "Axborot xavfsizligi bo'yicha majburiy talablar", sections: [
    ['1. Parolga talablar', ["Kamida 12 belgi: katta va kichik harflar, raqam va maxsus belgi.", "Ism, tug'ilgan sana va telefon raqamdan foydalanmang."]],
    ['2. Almashtirish', ['Parol har 90 kunda almashtiriladi.', "Oxirgi 5 ta paroldan qayta foydalanish taqiqlanadi."]],
    ['3. Saqlash', ["Parolni qog'ozga yozib, monitorga yopishtirmang.", "Korporativ parol menejeridan foydalaning."]],
    ['4. Ikki bosqichli autentifikatsiya', ["Pochta va CRM uchun 2FA majburiy.", "SMS-kodni hech kimga aytmang — IT bo'limi ham uni so'ramaydi."]],
  ] },
  fire: { title: "Yong'in xavfsizligi yo'riqnomasi", subtitle: 'Barcha xodimlar uchun majburiy', sections: [
    ['1. Umumiy qoidalar', ["Ofisda chekish faqat maxsus ajratilgan joyda ruxsat etiladi.", "Elektr uzatgichlarga bir nechta kuchli jihozni ulamang."]],
    ["2. O't o'chirgichlar", ["Har bir qavatda kamida 2 ta o't o'chirgich mavjud: zinapoya yonida va oshxonada.", "Elektr jihozlaridagi yong'inni suv bilan o'chirish qat'iyan man etiladi."]],
    ['3. Evakuatsiya', ['Lift ishlatilmaydi — faqat zinapoya.', "Yig'ilish nuqtasi: bino oldidagi avtoturargoh."]],
    ['4. Birinchi yordam', ["Birinchi yordam qutisi qabulxonada joylashgan.", "Favqulodda raqamlar: 101 — yong'in, 103 — tez yordam."]],
  ] },
};

// ------------------------------------------------------------------ media
function fontFile(spec, fallback) {
  try { const f = execFileSync('fc-match', ['-f', '%{file}', spec]).toString().trim(); if (f && fs.existsSync(f)) return f; } catch { /* ignore */ }
  return fallback;
}
function wrap(text, max) {
  const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}
function run(cmd, args, timeout = 300000) {
  return new Promise((resolve, reject) => execFile(cmd, args, { timeout, maxBuffer: 1 << 24 }, (e, so, se) => (e ? reject(new Error(String(se).slice(-800))) : resolve())));
}

async function makeVideo(out, lesson, appName) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vid-'));
  const bold = fontFile('Inter:bold', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');
  const reg = fontFile('Inter', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
  let n = 0;
  const tf = (text) => { const f = path.join(work, `t${n++}.txt`); fs.writeFileSync(f, text); return f; };
  const TITLE = 6, SLIDE = 9;
  const D = TITLE + lesson.slides.length * SLIDE;
  const f = [];
  const dt = (o) => `drawtext=fontfile=${o.font}:textfile=${o.file}:fontcolor=${o.color || 'white'}:fontsize=${o.size}:x=${o.x}:y=${o.y}:line_spacing=${o.ls || 14}`
    + (o.s !== undefined ? `:enable='between(t,${o.s},${o.e})':alpha='if(lt(t,${o.s + 0.6}),(t-${o.s})/0.6,if(gt(t,${o.e - 0.4}),(${o.e}-t)/0.4,1))'` : '');
  // doimiy elementlar
  f.push(dt({ font: bold, file: tf(appName.toUpperCase()), size: 22, x: 80, y: 52, color: 'white@0.85' }));
  f.push(dt({ font: reg, file: tf(lesson.title), size: 22, x: 'w-tw-80', y: 52, color: 'white@0.6' }));
  f.push(`drawbox=x=80:y=96:w=1120:h=1:color=white@0.18:t=fill`);
  // sarlavha slaydi
  f.push(dt({ font: bold, file: tf(lesson.kicker), size: 26, x: 80, y: 250, color: '0xc4b5fd', s: 0.2, e: TITLE }));
  f.push(dt({ font: bold, file: tf(wrap(lesson.title, 26).join('\n')), size: 72, x: 80, y: 300, ls: 18, s: 0.4, e: TITLE }));
  f.push(dt({ font: reg, file: tf(`${lesson.slides.length} bo'lim  ·  ~${Math.round(D / 6) / 10} daqiqa`), size: 28, x: 80, y: 520, color: 'white@0.7', s: 0.9, e: TITLE }));
  lesson.slides.forEach((sl, i) => {
    const s = TITLE + i * SLIDE, e = s + SLIDE;
    f.push(`drawbox=x=80:y=170:w=10:h=64:color=0xa78bfa:t=fill:enable='between(t,${s},${e})'`);
    f.push(dt({ font: bold, file: tf(sl.h), size: 54, x: 112, y: 172, s, e }));
    f.push(dt({ font: reg, file: tf(`${i + 1} / ${lesson.slides.length}`), size: 24, x: 'w-tw-80', y: 'h-70', color: 'white@0.6', s, e }));
    let y = 290;
    sl.b.forEach((b, j) => {
      const lines = wrap(b, 52);
      const bs = s + 0.8 + j * 0.9;
      f.push(`drawbox=x=112:y=${y + 14}:w=12:h=12:color=0x34d399:t=fill:enable='between(t,${bs},${e})'`);
      f.push(dt({ font: reg, file: tf(lines.join('\n')), size: 34, x: 146, y, ls: 12, s: bs, e }));
      y += lines.length * 46 + 26;
    });
  });
  const filter = `[0:v]${f.join(',')}[bg];[2:v]format=rgba[bar];[bg][bar]overlay=x='-w+W*t/${D}':y=H-8:shortest=1[v]`;
  const [c0, c1] = lesson.palette;
  const args = ['-y',
    '-f', 'lavfi', '-i', `gradients=s=1280x720:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=1280:y1=720:speed=0.004:d=${D}:r=25`,
    '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo`,
    '-f', 'lavfi', '-i', `color=c=0xffffff:s=1280x8:d=${D}:r=25`,
    '-filter_complex', filter, '-map', '[v]', '-map', '1:a', '-t', String(D),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', out];
  try {
    await run('ffmpeg', args);
  } catch (e) {
    // gradients mavjud bo'lmasa — oddiy rangli fon
    args[4] = `color=c=${c0}:s=1280x720:d=${D}:r=25`;
    await run('ffmpeg', args);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

async function makePdf(out, docKey, appName, convertToPdf) {
  const d = DOCS[docKey];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Inter','DejaVu Sans',sans-serif;color:#1d1b3a;font-size:12pt;line-height:1.6}
    .brand{color:#5b4cf5;font-weight:bold;letter-spacing:2pt;font-size:9pt}
    h1{font-size:28pt;color:#1d1752;margin:8pt 0 4pt}
    .sub{color:#6b6f8e;font-size:13pt;margin-bottom:18pt}
    h2{font-size:15pt;color:#5b4cf5;margin:20pt 0 6pt;border-bottom:1px solid #e2deff;padding-bottom:4pt}
    p{margin:0 0 6pt}
  </style></head><body>
  <p class="brand">${esc(appName.toUpperCase())}</p><h1>${esc(d.title)}</h1><p class="sub">${esc(d.subtitle)}</p>
  ${d.sections.map(([h, ps]) => `<h2>${esc(h)}</h2>${ps.map((p) => `<p>${esc(p)}</p>`).join('')}`).join('')}
  </body></html>`;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  try {
    fs.writeFileSync(path.join(work, 'source.html'), html);
    // Writer/Web emas, oddiy Writer filtri — aks holda boshida bo'sh sahifa paydo bo'ladi
    const profile = path.join(os.tmpdir(), 'lo-' + crypto.randomBytes(6).toString('hex'));
    try {
      await run('soffice', ['--headless', '--norestore', `-env:UserInstallation=file://${profile}`, '--infilter=HTML (StarWriter)',
        '--convert-to', 'pdf:writer_pdf_Export', '--outdir', work, path.join(work, 'source.html')], 180000);
    } catch { await convertToPdf(path.join(work, 'source.html'), work); }
    finally { fs.rmSync(profile, { recursive: true, force: true }); }
    fs.copyFileSync(path.join(work, 'source.pdf'), out);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ seed
async function seedDemo({ q, tx, hashPassword, insertQuestion, FILES_DIR, convertToPdf, probeDuration, shuffle }) {
  const appName = process.env.APP_NAME || 'Korporativ LMS';
  const demoPw = hashPassword(process.env.DEMO_PASSWORD || 'demo123');
  const now = Date.now();

  // 1) media fayllar (tranzaksiyadan oldin)
  const media = new Map();
  for (const c of COURSES) {
    for (const l of c.lessons) {
      if (l.type === 'text') continue;
      const id = crypto.randomBytes(12).toString('hex');
      const fileName = `${id}.${l.type === 'video' ? 'mp4' : 'pdf'}`;
      const out = path.join(FILES_DIR, fileName);
      try {
        if (l.type === 'video') await makeVideo(out, l, appName);
        else await makePdf(out, l.doc, appName, convertToPdf);
        media.set(l, { fileName, size: fs.statSync(out).size, duration: l.type === 'video' ? await probeDuration(out) : null });
        console.log('seed media:', l.title);
      } catch (e) { console.error('seed media xatosi:', l.title, e.message); }
    }
  }

  tx(() => {
    const users = EMPLOYEES.map(([name, phone, dep, pos], i) => {
      const created = iso(now - rnd(20, 60) * DAY);
      q('INSERT OR IGNORE INTO users (name, phone, password_hash, role, department, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(name, phone, demoPw, 'employee', dep, pos, created);
      return { ...q('SELECT * FROM users WHERE phone = ?').get(phone), idx: i };
    });

    for (const c of COURSES) {
      const created = iso(now - rnd(14, 25) * DAY);
      const deadline = c.deadlineDays === null ? null : new Date(now + c.deadlineDays * DAY).toISOString().slice(0, 10);
      const r = q(`INSERT INTO courses (title, description, departments, deadline, pass_score, time_limit_min, max_attempts, question_count, published,
        proctor_camera, proctor_screen, max_violations, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(c.title, c.description, JSON.stringify(c.departments), deadline, c.pass, c.time, c.attempts, c.qcount, c.draft ? 0 : 1,
          c.camera, c.screen, c.maxViol, c.category, created);
      const cid = Number(r.lastInsertRowid);
      const lessonRows = [];
      c.lessons.forEach((l, i) => {
        const m = media.get(l);
        if (l.type !== 'text' && !m) return;
        const lr = q('INSERT INTO lessons (course_id, position, title, type, file_name, original_name, size, content, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(cid, i + 1, l.title, l.type, m?.fileName || null, m ? `${l.title}.${l.type === 'video' ? 'mp4' : 'pdf'}` : null, m?.size || null, l.content || '', m?.duration || null, created);
        lessonRows.push({ id: Number(lr.lastInsertRowid), type: l.type, duration: m?.duration || null });
      });
      const qids = c.questions.map(([t, o, cor]) => ({ id: insertQuestion(cid, { text: t, options: JSON.stringify(o), correct: cor }), n: o.length, correct: cor }));
      if (c.draft) continue;

      // 2) natijalar tarixi
      const assigned = users.filter((u) => c.departments.length === 0 || c.departments.includes(u.department));
      for (const u of assigned) {
        let plan;
        if (u.phone === '998901110002') plan = 'none'; // toza demo akkaunt
        else if (u.phone === '998901110001') plan = c.key === 'onboarding' ? 'pass' : c.key === 'sales' ? 'partial' : 'none';
        else {
          const x = Math.random();
          const passRate = c.key === 'security' ? 0.35 : c.key === 'onboarding' ? 0.7 : 0.5;
          plan = x < passRate ? 'pass' : x < passRate + 0.2 ? 'partial' : x < passRate + 0.27 && qids.length ? 'fail' : 'none';
        }
        if (plan === 'none') continue;
        let t = Date.parse(created) + rnd(1, 4) * DAY;
        const lessonsToDo = plan === 'partial' ? lessonRows.slice(0, Math.max(1, Math.floor(lessonRows.length / 2))) : lessonRows;
        for (const l of lessonsToDo) {
          t += rnd(0.1, 1) * DAY;
          if (t > now - 3600e3) t = now - rnd(2, 20) * 3600e3;
          q('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)').run(u.id, l.id, iso(t));
          if (l.type === 'video' && l.duration) q('INSERT OR IGNORE INTO video_progress (user_id, lesson_id, max_pos, updated_at) VALUES (?, ?, ?, ?)').run(u.id, l.id, l.duration, iso(t));
        }
        if (plan === 'partial' || !qids.length) continue;
        const tries = plan === 'fail' ? Math.max(1, c.attempts || 2) : Math.random() < 0.25 ? 2 : 1;
        for (let k = 0; k < tries; k++) {
          const last = k === tries - 1;
          const passNow = plan === 'pass' && last;
          let qs = shuffle([...qids]);
          if (c.qcount > 0) qs = qs.slice(0, c.qcount);
          const target = passNow ? Math.ceil(qs.length * rnd(c.pass / 100, 1.0001)) : Math.floor(qs.length * rnd(0.3, c.pass / 100 - 0.01));
          const correctSet = new Set(shuffle(qs.map((x) => x.id)).slice(0, Math.min(qs.length, target)));
          const layout = qs.map((x) => ({ q: x.id, o: shuffle([...Array(x.n).keys()]) }));
          const answers = {};
          let correct = 0;
          for (const x of qs) {
            if (correctSet.has(x.id)) { answers[x.id] = x.correct; correct++; }
            else { const wrong = [...Array(x.n).keys()].filter((i) => i !== x.correct); answers[x.id] = pick(wrong); }
          }
          const score = Math.round((correct / qs.length) * 100);
          t += rnd(0.05, 0.8) * DAY;
          if (t > now - 1800e3) t = now - rnd(1, 10) * 3600e3;
          const dur = rnd(3, Math.max(4, (c.time || 10) - 1)) * 60e3;
          const viol = [];
          if (c.screen && Math.random() < 0.3) {
            const nv = 1 + Math.floor(Math.random() * 2);
            for (let v = 0; v < nv; v++) viol.push({ type: pick(['tab_hidden', 'blur', 'fullscreen_exit', 'printscreen']), at: iso(t + rnd(0.2, 0.9) * dur), detail: '' });
          }
          q(`INSERT INTO attempts (user_id, course_id, started_at, deadline_at, finished_at, score, correct_count, total, passed, layout, answers, violations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(u.id, cid, iso(t), c.time ? iso(t + c.time * 60e3) : null, iso(t + dur), score, correct, qs.length, score >= c.pass ? 1 : 0,
              JSON.stringify(layout), JSON.stringify(answers), JSON.stringify(viol));
          t += dur;
        }
      }
    }
  });
}

module.exports = { seedDemo, makePdf, COURSES };
