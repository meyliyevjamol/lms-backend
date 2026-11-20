'use strict';
/* Demo ma'lumotlar: farmatsevtika distribyutori — 4 bo'lim, ~45 xodim, 5 trening + 1 qoralama, generatsiya qilingan videolar va PDF'lar, 12 haftalik natijalar tarixi */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');

const DAY = 864e5;
const iso = (t) => new Date(t).toISOString();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Toshkent vaqti bilan N kun keyin soat 18:00
const deadlineIn = (days) => { const d = new Date(Date.now() + days * DAY); d.setUTCHours(13, 0, 0, 0); return d.toISOString(); };

// ------------------------------------------------------------------ xodimlar
const D_SALES = "Sotuv bo'limi", D_STOCK = 'Ombor', D_PHARM = 'Dorixona filiallari', D_OFFICE = 'Ofis';
const EMPLOYEES = [
  ['Dilnoza Karimova', '998901110001', D_PHARM, 'Farmatsevt'],
  ['Jasur Normatov', '998901110002', D_STOCK, 'Logist'],
  ['Sardor Rahimov', '998912345678', D_SALES, 'Medical representative'],
  ['Aziza Qodirova', '998933456789', D_SALES, 'Menejer'],
  ['Otabek Ergashev', '998944567890', D_STOCK, 'Omborchi'],
  ['Malika Toshpo\'latova', '998955678901', D_PHARM, 'Farmatsevt'],
  ['Nodira Yusupova', '998997890123', D_OFFICE, 'Buxgalter'],
  ['Bekzod Olimov', '998908901234', D_SALES, 'Medical representative'],
  ['Kamola Saidova', '998901230011', D_SALES, 'Medical representative'],
  ['Shahzod Murodov', '998901230012', D_SALES, 'Medical representative'],
  ['Javohir Rustamov', '998901230013', D_SALES, 'Menejer'],
  ['Madina Xolmatova', '998901230014', D_SALES, 'Medical representative'],
  ['Ulug\'bek Sobirov', '998901230015', D_SALES, "Bo'lim rahbari"],
  ['Feruza Abdullayeva', '998901230016', D_SALES, 'Medical representative'],
  ['Akmal Hamidov', '998901230017', D_SALES, 'Medical representative'],
  ['Zarina Tursunova', '998901230018', D_SALES, 'Menejer'],
  ['Sherzod Qosimov', '998901230019', D_STOCK, 'Omborchi'],
  ['Anvar Xudoyberdiyev', '998901230020', D_STOCK, 'Omborchi'],
  ['Rustam Ismoilov', '998901230021', D_STOCK, 'Logist'],
  ['Laziz Bobojonov', '998901230022', D_STOCK, 'Haydovchi-ekspeditor'],
  ['Elyor Nurmatov', '998901230023', D_STOCK, 'Ombor mudiri'],
  ['Sanjar Aliqulov', '998901230024', D_STOCK, 'Omborchi'],
  ['Behruz Karimov', '998901230025', D_STOCK, 'Logist'],
  ['Gulnora Islomova', '998901230026', D_PHARM, 'Filial mudiri'],
  ['Nilufar Qodirova', '998901230027', D_PHARM, 'Farmatsevt'],
  ['Mohira Sattorova', '998901230028', D_PHARM, 'Farmatsevt'],
  ['Shoira Mirzayeva', '998901230029', D_PHARM, 'Farmatsevt'],
  ['Dildora Hasanova', '998901230030', D_PHARM, 'Farmatsevt'],
  ['Sevara Jo\'rayeva', '998901230031', D_PHARM, 'Kassir-farmatsevt'],
  ['Munisa Abdurahmonova', '998901230032', D_PHARM, 'Farmatsevt'],
  ['Barno Yo\'ldosheva', '998901230033', D_PHARM, 'Filial mudiri'],
  ['Kamila Rasulova', '998901230034', D_PHARM, 'Farmatsevt'],
  ['Iroda Mamatqulova', '998901230035', D_PHARM, 'Farmatsevt'],
  ['Zilola Ahmedova', '998901230036', D_PHARM, 'Farmatsevt'],
  ['Hulkar Nazarova', '998901230037', D_PHARM, 'Kassir-farmatsevt'],
  ['Doniyor Ahmedov', '998901230038', D_OFFICE, 'IT mutaxassisi'],
  ['Ozoda Eshmatova', '998901230039', D_OFFICE, 'HR mutaxassisi'],
  ['Farrux Toshmatov', '998901230040', D_OFFICE, 'Yurist'],
  ['Yulduz Rahmonova', '998901230041', D_OFFICE, 'Bosh buxgalter'],
  ['Asror Valiyev', '998901230042', D_OFFICE, 'Marketolog'],
  ['Lola Sharipova', '998901230043', D_OFFICE, 'Ofis menejeri'],
  ['Timur G\'aniyev', '998901230044', D_SALES, 'Medical representative'],
  ['Nargiza Usmonova', '998901230045', D_PHARM, 'Farmatsevt'],
];

// ------------------------------------------------------------------ treninglar
const COURSES = [
  {
    key: 'storage', title: 'Dori vositalarini saqlash qoidalari', category: 'Farmatsevtika', testTitle: 'Saqlash qoidalari: yakuniy test',
    description: "Harorat rejimi, namlik, yorug'lik va muddati o'tgan preparatlar bilan ishlash tartibi.",
    assign: { departments: [D_SALES, D_STOCK, D_PHARM] }, deadlineDays: 10, createdDaysAgo: 84,
    pass: 70, time: 30, attempts: 1, qcount: 0, camera: 0, screen: 1, maxViol: 5, allowDownload: 1, showCorrect: 0,
    lessons: [
      { type: 'pdf', title: 'Saqlash qoidalari', doc: 'storage' },
      { type: 'video', title: '1-dars: Harorat rejimi', kicker: '1-DARS · SAQLASH QOIDALARI', palette: ['0x0b1f4d', '0x1d4ed8'],
        slides: [
          { h: 'Harorat rejimlari', b: ['Xona harorati: +15 °C dan +25 °C gacha', 'Sovuq joy: +8 °C dan +15 °C gacha', 'Sovutgich: +2 °C dan +8 °C gacha', 'Muzlatish: 0 °C dan past — faqat yo\'riqnomada ko\'rsatilsa'] },
          { h: 'Sovuq zanjir', b: ['Insulin, vaksinalar va ayrim antibiotiklar sovutgichda saqlanadi', 'Tashishda termokonteyner va sovuq elementlardan foydalaning', 'Zanjir uzilsa — preparat karantin zonasiga o\'tkaziladi'] },
          { h: 'Nazorat va jurnal', b: ['Harorat kuniga 2 marta tekshirilib, jurnalga yoziladi', "Termometr va gigrometr har yili kalibrlanadi", 'Og\'ish bo\'lsa — darhol mas\'ul shaxsga xabar bering'] },
          { h: 'Namlik va yorug\'lik', b: ['Nisbiy namlik 60% dan oshmasligi kerak', "To'g'ridan-to'g'ri quyosh nuri tushmasin", 'Polda emas, tokcha yoki poddonlarda saqlang'] },
        ] },
      { type: 'video', title: "2-dars: Muddati o'tgan preparatlar", kicker: '2-DARS · SAQLASH QOIDALARI', palette: ['0x062a2a', '0x0e9488'],
        slides: [
          { h: 'FEFO tamoyili', b: ['First Expired — First Out', 'Muddati yaqin preparat birinchi sotiladi', 'Javonda muddati yaqinlari oldinga qo\'yiladi'] },
          { h: "Muddati o'tgan aniqlansa", b: ['Sotuvdan darhol olinadi', 'Alohida karantin zonasiga o\'tkaziladi', 'Hisobdan chiqarish dalolatnomasi tuziladi'] },
          { h: 'Taqiqlanadi', b: ['Muddati o\'tgan preparatni chegirma bilan sotish', 'Qadoqni yoki yorliqni almashtirish', 'Oddiy chiqindiga tashlash — faqat litsenziyali utilizatsiya'] },
        ] },
    ],
    questions: [
      ['Insulin preparatlari qaysi haroratda saqlanishi kerak?', ['+15 °C dan +25 °C gacha', '+2 °C dan +8 °C gacha, sovutgichda', '0 °C dan past, muzlatgichda', 'Xona haroratida, istalgan joyda'], [1]],
      ['Muddati o\'tgan preparat aniqlansa, birinchi navbatda nima qilinadi?', ['Sotuvga chegirma bilan chiqariladi', 'Alohida karantin zonasiga o\'tkaziladi va hisobdan chiqariladi', 'Yetkazib beruvchiga qaytariladi', 'Javonda qoldiriladi'], [1]],
      ['Xona harorati deganda qaysi oraliq tushuniladi?', ['+2 °C dan +8 °C gacha', '+8 °C dan +15 °C gacha', '+15 °C dan +25 °C gacha', '+25 °C dan +30 °C gacha'], [2]],
      ['FEFO tamoyili nimani anglatadi?', ['Birinchi kelgan — birinchi sotiladi', 'Muddati yaqin — birinchi sotiladi', 'Eng arzon — birinchi sotiladi', 'Eng ko\'p so\'raladigan — birinchi sotiladi'], [1]],
      ['Qaysi preparatlar sovuq zanjirni talab qiladi? (bir nechta javob)', ['Insulin', 'Vaksinalar', 'Paratsetamol tabletkalari', 'Vitamin C'], [0, 1]],
      ['Omborda nisbiy namlik necha foizdan oshmasligi kerak?', ['40%', '60%', '80%', '95%'], [1]],
      ['Harorat necha marta tekshirilib, jurnalga yoziladi?', ['Haftada 1 marta', 'Kuniga 2 marta', 'Oyiga 1 marta', 'Faqat tekshiruv paytida'], [1]],
      ['Sovuq zanjir uzilsa, preparat bilan nima qilinadi?', ['Sotuvga chiqariladi', 'Karantin zonasiga o\'tkaziladi', 'Muzlatgichga qo\'yiladi', 'Tashlab yuboriladi'], [1]],
      ['Preparatlarni saqlashda qaysilari taqiqlanadi? (bir nechta javob)', ['Polda saqlash', "To'g'ridan-to'g'ri quyosh nuri ostida saqlash", 'Poddonlarda saqlash', 'Tokchalarda saqlash'], [0, 1]],
      ['Termometr va gigrometr qancha muddatda kalibrlanadi?', ['Har oy', 'Har yili', 'Har 5 yilda', 'Kalibrlanmaydi'], [1]],
      ['Muddati o\'tgan preparatlar qanday utilizatsiya qilinadi?', ['Oddiy chiqindiga tashlanadi', 'Litsenziyali tashkilot orqali', 'Kanalizatsiyaga', 'Yoqib yuboriladi'], [1]],
      ['Termokonteyner nima uchun ishlatiladi?', ['Preparatlarni chiroyli qadoqlash uchun', 'Tashishda sovuq zanjirni saqlash uchun', 'Omborda joy tejash uchun', 'Hujjatlarni saqlash uchun'], [1]],
    ],
  },
  {
    key: 'safety', title: 'Mehnat xavfsizligi', category: 'Majburiy', testTitle: 'Mehnat xavfsizligi: yillik test',
    description: "Ish joyida xavfsizlik, yong'in va birinchi yordam qoidalari. Barcha xodimlar uchun majburiy. Yillik test kamera nazorati ostida topshiriladi.",
    assign: { all: true }, deadlineDays: 2, createdDaysAgo: 40,
    pass: 70, time: 20, attempts: 1, qcount: 0, camera: 1, screen: 1, maxViol: 5, allowDownload: 1, showCorrect: 1,
    lessons: [
      { type: 'pdf', title: 'Xavfsizlik qoidalari', doc: 'safety' },
      { type: 'video', title: "Yong'in xavfsizligi", kicker: 'MEHNAT XAVFSIZLIGI', palette: ['0x3a0d0d', '0xdc2626'],
        slides: [
          { h: 'Yong\'in chiqsa', b: ['Vahimaga tushmang, 101 ga qo\'ng\'iroq qiling', 'Liftdan foydalanmang — faqat zinapoya', 'Yashil belgilar bo\'yicha eng yaqin chiqishga yo\'naling'] },
          { h: "O't o'chirgichlar", b: ['Har qavatda kamida 2 ta o\'t o\'chirgich bor', 'Elektr jihozini suv bilan o\'chirmang', 'Plombani torting, shlangni olovga qarating, dastakni bosing'] },
          { h: "Yig'ilish nuqtasi", b: ['Bino oldidagi avtoturargoh', "Bo'lim rahbari xodimlarni ro'yxat bo'yicha tekshiradi", 'Binoga faqat ruxsat berilgandan keyin qayting'] },
        ] },
      { type: 'pdf', title: 'Birinchi yordam (taqdimot)', doc: 'firstaid' },
    ],
    questions: [
      ['Yong\'in signalida qaysi yo\'ldan foydalaniladi?', ['Lift', 'Zinapoya', 'Deraza', 'Farqi yo\'q'], [1]],
      ['Evakuatsiya yo\'li qaysi rangdagi belgilar bilan ko\'rsatiladi?', ['Qizil', 'Sariq', 'Yashil', "Ko'k"], [2]],
      ['Yong\'in xizmati raqami qaysi?', ['101', '102', '103', '104'], [0]],
      ["Elektr jihozidagi yong'inni nima bilan o'chirish mumkin emas?", ['Karbonat o\'t o\'chirgich', 'Suv', 'Kukunli o\'t o\'chirgich', 'Qum'], [1]],
      ["Xodimlarni yig'ilish nuqtasida kim tekshiradi?", ['Qo\'riqchi', "Bo'lim rahbari", 'HR', 'Hech kim'], [1]],
      ['Birinchi yordam qutisi qayerda joylashgan?', ['Qabulxonada', 'Omborda', 'Avtoturargohda', 'Rahbar xonasida'], [0]],
      ['Kuyishda birinchi yordam? (bir nechta javob)', ['Joyni 10–15 daqiqa sovuq suv ostida ushlash', 'Yog\' surtish', 'Toza bint bilan yopish', 'Pufakchalarni yorish'], [0, 2]],
      ['Tez tibbiy yordam raqami qaysi?', ['101', '102', '103', '104'], [2]],
    ],
  },
  {
    key: 'onboarding', title: 'Yangi xodimlar uchun onboarding', category: 'Onboarding', testTitle: 'Onboarding: kirish testi',
    description: "Kompaniya tarixi, qadriyatlari, ichki tartib va birinchi oydagi vazifalaringiz.",
    assign: { all: true }, deadlineDays: 20, createdDaysAgo: 88,
    pass: 70, time: 15, attempts: 2, qcount: 0, camera: 0, screen: 1, maxViol: 5, allowDownload: 0, showCorrect: 1,
    lessons: [
      { type: 'video', title: 'Kompaniya tarixi va missiyasi', kicker: 'ONBOARDING', palette: ['0x0b1230', '0x2563eb'],
        slides: [
          { h: 'Biz kimmiz?', b: ['2009-yildan beri dori vositalari distribyutori', '3 ta ombor, 18 ta dorixona filiali', "O'zbekiston bo'ylab 1 200+ hamkor dorixona"] },
          { h: 'Missiyamiz', b: ['Sifatli dori vositalarini o\'z vaqtida yetkazish', 'Har bir bosqichda saqlash standartlariga rioya qilish', 'Xodimlarning doimiy o\'sishiga sharoit yaratish'] },
          { h: 'Qadriyatlarimiz', b: ["Bemor salomatligi birinchi o'rinda", 'Halollik va ochiqlik', 'Jamoaviy natija', "Doimiy o'rganish"] },
        ] },
      { type: 'pdf', title: "Xodim qo'llanmasi", doc: 'handbook' },
      { type: 'text', title: 'Ichki tartib qoidalari', content: "Ish vaqti: dushanba–juma, 09:00 dan 18:00 gacha. Dorixona filiallarida — smena jadvali bo'yicha.\n\nKechikish yoki ishga kela olmaslik haqida rahbaringizga kamida 30 daqiqa oldin xabar bering.\n\nTa'til uchun ariza kamida 2 hafta oldin HR bo'limiga topshiriladi. Kasallik varaqasi 3 ish kuni ichida taqdim etiladi.\n\nKorporativ ma'lumotlarni shaxsiy messenjerlar orqali yuborish taqiqlanadi." },
    ],
    questions: [
      ['Kompaniya qachondan beri faoliyat yuritadi?', ['2001', '2009', '2015', '2020'], [1]],
      ['Ofisda ish kuni soat nechada boshlanadi?', ['08:00', '08:30', '09:00', '10:00'], [2]],
      ["Ta'til uchun ariza qancha oldin topshiriladi?", ['3 kun', '1 hafta', '2 hafta', '1 oy'], [2]],
      ['Kompaniya qadriyatlari qaysilar? (bir nechta javob)', ["Bemor salomatligi birinchi o'rinda", 'Halollik va ochiqlik', 'Har kim faqat o\'zi uchun', 'Jamoaviy natija'], [0, 1, 3]],
      ['Kasallik varaqasi necha kun ichida taqdim etiladi?', ['1 ish kuni', '3 ish kuni', '5 ish kuni', '10 ish kuni'], [1]],
      ['Ishga kechikish haqida qancha oldin xabar berish kerak?', ['5 daqiqa', '30 daqiqa', '2 soat', 'Shart emas'], [1]],
      ['Kompaniyaning nechta dorixona filiali bor?', ['5', '10', '18', '30'], [2]],
      ["Korporativ ma'lumotlarni qayerga yuborish taqiqlanadi?", ['Korporativ pochtaga', 'Shaxsiy messenjerlarga', "Bo'lim rahbariga", 'Ichki tizimga'], [1]],
    ],
  },
  {
    key: 'sales', title: "Sotuv texnikasi: SPIN va e'tirozlar", category: 'Sotuv', testTitle: 'Sotuv texnikasi: attestatsiya',
    description: "Shifokor va dorixona bilan suhbat: SPIN savollari va eng ko'p uchraydigan e'tirozlarga javob. Test kamera nazorati ostida topshiriladi.",
    assign: { departments: [D_SALES] }, deadlineDays: 7, createdDaysAgo: 30,
    pass: 75, time: 15, attempts: 2, qcount: 8, camera: 1, screen: 1, maxViol: 3, allowDownload: 1, showCorrect: 0,
    lessons: [
      { type: 'video', title: 'SPIN metodikasi: 4 turdagi savol', kicker: '1-DARS · SOTUV', palette: ['0x0b2a4a', '0x2f7cf6'],
        slides: [
          { h: 'SPIN nima?', b: ['Situation — vaziyat haqidagi savollar', 'Problem — muammoni aniqlovchi savollar', 'Implication — oqibat haqidagi savollar', 'Need-payoff — foyda haqidagi savollar'] },
          { h: 'Vaziyat va muammo', b: ['«Hozir qaysi preparatni tavsiya qilyapsiz?»', '«Bemorlar qaysi nojo\'ya ta\'sirdan shikoyat qiladi?»', "Vaziyat savollari 2–3 tadan oshmasin"] },
          { h: 'Oqibat va foyda', b: ['«Bu davolanish muddatiga qanday ta\'sir qiladi?»', '«Agar kuniga 1 marta qabul qilinsa, nima o\'zgaradi?»', 'Yechimni shifokorning o\'zi aytishiga yordam bering'] },
        ] },
      { type: 'video', title: "E'tirozlar bilan ishlash: 5 qadam", kicker: '2-DARS · SOTUV', palette: ['0x2a1206', '0xe8641c'],
        slides: [
          { h: "E'tiroz — qiziqish belgisi", b: ["Befarq mijoz e'tiroz bildirmaydi", '«Qimmat» degani — «qiymatini tushunmadim»', 'Bahslashmang, aniqlashtiring'] },
          { h: '5 qadamli algoritm', b: ['1. Tinglang', '2. Qo\'shiling: «Tushunaman»', '3. Aniqlashtiring', '4. Argument keltiring', '5. Keyingi qadamni taklif qiling'] },
        ] },
      { type: 'pdf', title: "Sotuv skriptlari to'plami", doc: 'scripts' },
    ],
    questions: [
      ['SPIN qisqartmasidagi «I» harfi nimani anglatadi?', ['Information', 'Implication', 'Interest', 'Idea'], [1]],
      ['Vaziyat savollari nechta bo\'lgani maqbul?', ['1 ta', '2–3 ta', '7–8 ta', 'Cheklanmagan'], [1]],
      ['Qaysi savol muammo savoliga misol bo\'ladi?', ['«Necha bemor qabul qilasiz?»', '«Bemorlar qaysi nojo\'ya ta\'sirdan shikoyat qiladi?»', '«Shartnoma imzolaymizmi?»', '«Qaysi shahardasiz?»'], [1]],
      ["«Qimmat» e'tirozi ko'pincha nimani bildiradi?", ['Pul yo\'q', 'Qiymati tushunilmagan', 'Sotib olmaydi', 'Raqobatchi arzon'], [1]],
      ["E'tiroz bilan ishlashning birinchi qadami?", ['Argument keltirish', 'Chegirma berish', 'Tinglash', 'Rahbarni chaqirish'], [2]],
      ['Preparatni qachon taklif qilish kerak?', ['Suhbat boshida', 'Foyda savollaridan keyin', 'Umuman taklif qilmaslik', 'Vaziyat savollaridan oldin'], [1]],
      ['«Tushunaman» iborasi qaysi qadamga tegishli?', ["Qo'shilish", 'Aniqlashtirish', 'Yopish', 'Taqdimot'], [0]],
      ['Need-payoff savollarining maqsadi?', ['Chalg\'itish', 'Yechim foydasini mijozning o\'zi aytishi', 'Narxni bilish', 'Suhbatni tugatish'], [1]],
      ['SPIN savollari turlari qaysilar? (bir nechta javob)', ['Vaziyat', 'Muammo', 'Narx', 'Oqibat'], [0, 1, 3]],
      ['Befarq mijoz odatda qanday yo\'l tutadi?', ["Ko'p e'tiroz bildiradi", "E'tiroz bildirmaydi", 'Chegirma so\'raydi', 'Shartnoma so\'raydi'], [1]],
    ],
  },
  {
    key: 'infosec', title: 'Axborot xavfsizligi asoslari', category: 'Xavfsizlik', testTitle: 'Axborot xavfsizligi: test',
    description: "Fishing xatlarni aniqlash, parol siyosati va korporativ ma'lumotlarni himoya qilish.",
    assign: { departments: [D_OFFICE], users: ['998901230021', '998901230026'] }, deadlineDays: -3, createdDaysAgo: 25,
    pass: 70, time: 10, attempts: 2, qcount: 0, camera: 0, screen: 1, maxViol: 5, allowDownload: 0, showCorrect: 1,
    lessons: [
      { type: 'video', title: 'Fishing hujumlarini aniqlash', kicker: 'AXBOROT XAVFSIZLIGI', palette: ['0x140d38', '0x5b45d6'],
        slides: [
          { h: 'Fishing nima?', b: ["Ishonchli tashkilot nomidan soxta xat", "Maqsad: parol yoki ma'lumotlarni o'g'irlash", 'Hujumlarning 90% pochtadan boshlanadi'] },
          { h: 'Xavfli belgilar', b: ['Shoshiltiruvchi matn: «24 soat ichida...»', "Jo'natuvchi manzili biroz boshqacha", 'Parol yoki SMS-kod so\'rash'] },
        ] },
      { type: 'pdf', title: 'Parol siyosati', doc: 'passwords' },
    ],
    questions: [
      ['Kiberhujumlarning qancha qismi pochtadan boshlanadi?', ['10%', '40%', '90%', '100%'], [2]],
      ['Shubhali xatni olganda nima qilish kerak?', ['Havolani tekshirib ko\'rish', 'IT bo\'limiga yuborish', 'Javob yozish', "Hamkasblarga jo'natish"], [1]],
      ['IT bo\'limi parolingizni so\'rashi mumkinmi?', ['Ha', 'Faqat telefonda', "Yo'q, hech qachon", 'Rahbar ruxsati bilan'], [2]],
      ['Kuchli parol kamida necha belgi?', ['6', '8', '12', '4'], [2]],
      ['Parol qancha muddatda almashtiriladi?', ['Har hafta', 'Har 90 kunda', 'Har 5 yilda', 'Hech qachon'], [1]],
      ['Qaysi parol eng kuchli?', ['123456', 'Dilnoza1990', 'Kofe!Toshkent#Yomg1r', 'qwerty'], [2]],
      ['Fishing belgilari qaysilar? (bir nechta javob)', ['Shoshiltiruvchi matn', 'SMS-kod so\'rash', 'Tanish hamkasbdan kutilgan xat', "Jo'natuvchi manzili biroz boshqacha"], [0, 1, 3]],
      ['Ikki bosqichli autentifikatsiya nima beradi?', ['Tezroq kirish', "Qo'shimcha himoya", 'Parolsiz kirish', 'Hech narsa'], [1]],
    ],
  },
  {
    key: 'excel', title: "Excel'da hisobot tayyorlash", category: "Ko'nikmalar", testTitle: '', draft: true,
    description: 'Pivot jadvallar va VLOOKUP yordamida haftalik hisobotni 15 daqiqada tayyorlash.',
    assign: {}, deadlineDays: null, createdDaysAgo: 3, pass: 70, time: 0, attempts: 1, qcount: 0, camera: 0, screen: 1, maxViol: 5, allowDownload: 0, showCorrect: 0,
    lessons: [{ type: 'text', title: 'Pivot jadvalga kirish', content: "Pivot jadval katta jadvaldagi ma'lumotlarni bir necha soniyada guruhlash va jamlash imkonini beradi.\n\nInsert → PivotTable menyusini tanlang, diapazonni belgilang va maydonlarni Rows, Columns, Values bo'limlariga sudrang." }],
    questions: [],
  },
];

const DOCS = {
  storage: { title: 'Dori vositalarini saqlash qoidalari', subtitle: 'Ombor, dorixona va tashish uchun yagona standart', sections: [
    ['1. Harorat rejimlari', ["Xona harorati: +15 °C dan +25 °C gacha. Sovuq joy: +8 °C dan +15 °C gacha. Sovutgich: +2 °C dan +8 °C gacha.", "Har bir preparat yo'riqnomasidagi saqlash shartiga qat'iy rioya qilinadi."]],
    ['2. Sovuq zanjir', ["Insulin, vaksinalar va immunobiologik preparatlar faqat sovutgichda saqlanadi va termokonteynerda tashiladi.", "Zanjir uzilsa — preparat karantin zonasiga o'tkaziladi, mas'ul shaxs xabardor qilinadi."]],
    ['3. Namlik va yorug\'lik', ["Nisbiy namlik 60% dan oshmasligi kerak. To'g'ridan-to'g'ri quyosh nuri tushmasligi shart.", 'Preparatlar polda emas, tokcha yoki poddonlarda saqlanadi.']],
    ['4. Nazorat jurnali', ['Harorat va namlik kuniga 2 marta (09:00 va 17:00) tekshirilib, jurnalga yoziladi.', "Termometr va gigrometrlar har yili kalibrlanadi."]],
    ["5. Muddati o'tgan preparatlar", ['FEFO tamoyili: muddati yaqin preparat birinchi sotiladi.', "Muddati o'tgan preparat karantin zonasiga o'tkaziladi va litsenziyali tashkilot orqali utilizatsiya qilinadi."]],
  ] },
  safety: { title: 'Mehnat xavfsizligi qoidalari', subtitle: 'Barcha xodimlar uchun majburiy yo\'riqnoma', sections: [
    ['1. Umumiy qoidalar', ['Ish joyi toza va tartibli saqlanadi, o\'tish yo\'llari bo\'sh bo\'lishi shart.', "Og'ir yuklarni ko'tarishda belni emas, oyoqlarni bukib ko'taring."]],
    ['2. Elektr xavfsizligi', ['Shikastlangan uzatgich va vilkalardan foydalanmang.', 'Bitta rozetkaga bir nechta kuchli jihoz ulamang.']],
    ["3. Yong'in xavfsizligi", ["Har qavatda kamida 2 ta o't o'chirgich bor. Evakuatsiya — faqat zinapoya orqali.", "Yig'ilish nuqtasi: bino oldidagi avtoturargoh."]],
    ['4. Favqulodda raqamlar', ["101 — yong'in xizmati, 102 — militsiya, 103 — tez yordam, 104 — gaz xizmati."]],
  ] },
  firstaid: { title: 'Birinchi yordam', subtitle: 'Qisqa taqdimot: 4 ta asosiy holat', sections: [
    ['Kuyish', ['Joyni 10–15 daqiqa sovuq suv ostida ushlang, toza bint bilan yoping. Yog\' surtmang, pufakchalarni yormang.']],
    ['Qon ketishi', ['Yaraga toza mato bilan bosim bering, oyoq-qo\'lni yuqoriga ko\'taring. Kuchli qon ketishida — 103.']],
    ['Hushdan ketish', ['Odamni chalqancha yotqizib, oyoqlarini ko\'taring, havo kirishini ta\'minlang.']],
    ['Birinchi yordam qutisi', ['Qabulxonada joylashgan. Tarkibi har chorakda tekshiriladi.']],
  ] },
  handbook: { title: "Xodim qo'llanmasi", subtitle: "Yangi xodimlar uchun asosiy ma'lumotlar", sections: [
    ['1. Kompaniya haqida', ["Kompaniya 2009-yildan beri dori vositalari distribyutsiyasi bilan shug'ullanadi: 3 ta ombor, 18 ta dorixona filiali."]],
    ['2. Ish tartibi', ['Ofis: dushanba–juma, 09:00–18:00. Dorixona filiallari: smena jadvali bo\'yicha.']],
    ['3. Ish haqi va imtiyozlar', ["Ish haqi oyiga ikki marta to'lanadi. Tibbiy sug'urta, bepul tushlik, o'qish xarajatlarining 50% qoplanishi."]],
    ['4. Muloqot', ['Korporativ pochta va Telegram ishchi guruhi. HR bo\'limi: 2-qavat, 204-xona.']],
  ] },
  scripts: { title: "Sotuv skriptlari to'plami", subtitle: 'Shifokor va dorixona bilan suhbat uchun tayyor iboralar', sections: [
    ['Kirish', ['«Assalomu alaykum, [ism]! Men [kompaniya]dan [ism]man. Sizga 3 daqiqa vaqtingiz bormi?»']],
    ['Ehtiyojni aniqlash', ['«Hozir qaysi preparatni tavsiya qilyapsiz?»', '«Bemorlar nimadan ko\'proq shikoyat qiladi?»']],
    ["«Qimmat» e'tirozi", ['«Tushunaman. Davolash kursiga hisoblasak, farq kuniga 2 000 so\'m — va bemor 3 kun tezroq tuzaladi.»']],
    ['Yopish', ['«Keyingi hafta namunalarni olib kelaymi yoki dorixonaga buyurtma beraymi?»']],
  ] },
  passwords: { title: 'Parol siyosati', subtitle: "Axborot xavfsizligi bo'yicha majburiy talablar", sections: [
    ['1. Talablar', ['Kamida 12 belgi: katta va kichik harflar, raqam va maxsus belgi.']],
    ['2. Almashtirish', ['Parol har 90 kunda almashtiriladi. Oxirgi 5 ta paroldan qayta foydalanilmaydi.']],
    ['3. Ikki bosqichli autentifikatsiya', ['Pochta va 1C uchun 2FA majburiy. SMS-kodni hech kimga aytmang.']],
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
  f.push(dt({ font: bold, file: tf(lesson.kicker), size: 26, x: 80, y: 250, color: '0x93c5fd', s: 0.2, e: TITLE }));
  f.push(dt({ font: bold, file: tf(wrap(lesson.title, 26).join('\n')), size: 72, x: 80, y: 300, ls: 18, s: 0.4, e: TITLE }));
  f.push(dt({ font: reg, file: tf(`${lesson.slides.length} bo'lim  ·  ~${Math.round(D / 6) / 10} daqiqa`), size: 28, x: 80, y: 520, color: 'white@0.7', s: 0.9, e: TITLE }));
  lesson.slides.forEach((sl, i) => {
    const s = TITLE + i * SLIDE, e = s + SLIDE;
    f.push(`drawbox=x=80:y=170:w=10:h=64:color=0x60a5fa:t=fill:enable='between(t,${s},${e})'`);
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
    body{font-family:'Inter','DejaVu Sans',sans-serif;color:#1f2937;font-size:12pt;line-height:1.6}
    .brand{color:#1d4ed8;font-weight:bold;letter-spacing:2pt;font-size:9pt}
    h1{font-size:28pt;color:#0f1b33;margin:8pt 0 4pt}
    .sub{color:#6b6f8e;font-size:13pt;margin-bottom:18pt}
    h2{font-size:15pt;color:#1d4ed8;margin:20pt 0 6pt;border-bottom:1px solid #dbe4ff;padding-bottom:4pt}
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

async function seedDemo({ q, tx, hashPassword, insertQuestion, readQuestion, FILES_DIR, convertToPdf, probeDuration, pdfPages, shuffle }) {
  const appName = process.env.APP_NAME || "O'quv markazi";
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
        media.set(l, { fileName, size: fs.statSync(out).size, duration: l.type === 'video' ? await probeDuration(out) : null, pages: l.type === 'pdf' ? pdfPages(out) : null });
        console.log('seed media:', l.title);
      } catch (e) { console.error('seed media xatosi:', l.title, e.message); }
    }
  }

  tx(() => {
    // 2) xodimlar: ~85% so'nggi 14 kunda kirgan
    const users = EMPLOYEES.map(([name, phone, dep, pos], i) => {
      const lastLogin = i < 2 ? now - rnd(1, 20) * 3600e3 : Math.random() < 0.86 ? now - rnd(0.1, 13) * DAY : now - rnd(16, 45) * DAY;
      q('INSERT OR IGNORE INTO users (name, phone, password_hash, role, department, position, last_login_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(name, phone, demoPw, 'employee', dep, pos, iso(lastLogin), iso(now - rnd(95, 200) * DAY));
      return q('SELECT * FROM users WHERE phone = ?').get(phone);
    });
    const byPhone = new Map(users.map((u) => [u.phone, u]));

    for (const c of COURSES) {
      const created = now - c.createdDaysAgo * DAY;
      const assignUsers = (c.assign.users || []).map((p) => byPhone.get(p)?.id).filter(Boolean);
      const r = q(`INSERT INTO courses (title, description, category, test_title, assign_all, departments, assigned_users, deadline, pass_score, time_limit_min, max_attempts,
        question_count, shuffle, show_result, show_correct, require_materials, allow_download, proctor_camera, proctor_screen, max_violations, published, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 1, ?, ?, ?, ?, ?, ?)`)
        .run(c.title, c.description, c.category, c.testTitle, c.assign.all ? 1 : 0, JSON.stringify(c.assign.departments || []), JSON.stringify(assignUsers),
          c.deadlineDays === null ? null : deadlineIn(c.deadlineDays), c.pass, c.time, c.attempts, c.qcount, c.showCorrect, c.allowDownload,
          c.camera, c.screen, c.maxViol, c.draft ? 0 : 1, iso(created));
      const cid = Number(r.lastInsertRowid);
      const lessonRows = [];
      c.lessons.forEach((l, i) => {
        const m = media.get(l);
        if (l.type !== 'text' && !m) return;
        const lr = q(`INSERT INTO lessons (course_id, position, title, type, file_name, original_name, size, pages, duration, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(cid, i + 1, l.title, l.type, m?.fileName || null, m ? `${l.title}.${l.type === 'video' ? 'mp4' : 'pdf'}` : null, m?.size || null, m?.pages || null, m?.duration || null, l.content || '', iso(created));
        lessonRows.push({ id: Number(lr.lastInsertRowid), type: l.type, duration: m?.duration || null });
      });
      const qs = c.questions.map(([t, o, cor]) => ({ id: insertQuestion(cid, readQuestion({ text: t, options: o, correct: cor })), n: o.length, correct: cor }));
      if (c.draft || !qs.length) continue;

      // 3) natijalar tarixi — vaqt o'tishi bilan ballar biroz o'sadi (dinamika grafigi uchun)
      const course = q('SELECT * FROM courses WHERE id = ?').get(cid);
      const assigned = users.filter((u) => course.assign_all || JSON.parse(course.departments).includes(u.department) || JSON.parse(course.assigned_users).includes(u.id));
      const start = created + 2 * DAY;
      for (const u of assigned) {
        let plan;
        if (u.phone === '998901110002') plan = 'none';
        else if (u.phone === '998901110001') plan = { storage: 'pass', onboarding: 'pass', safety: 'partial' }[c.key] || 'none';
        else {
          const x = Math.random();
          const passP = c.key === 'safety' ? 0.38 : c.key === 'infosec' ? 0.35 : 0.56;
          plan = x < passP ? 'pass' : x < passP + 0.14 ? 'fail' : x < passP + 0.26 ? 'partial' : 'none';
        }
        if (plan === 'none') continue;
        let t = start + Math.random() * Math.max(DAY, now - 6 * 3600e3 - start) * 0.9;
        const todo = plan === 'partial' ? lessonRows.slice(0, Math.max(1, Math.floor(lessonRows.length / 2))) : lessonRows;
        for (const l of todo) {
          t += rnd(0.02, 0.4) * DAY;
          if (t > now - 3600e3) t = now - rnd(1, 30) * 3600e3;
          q('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id, completed_at) VALUES (?, ?, ?)').run(u.id, l.id, iso(t));
          if (l.type === 'video' && l.duration) q('INSERT OR IGNORE INTO video_progress (user_id, lesson_id, max_pos, updated_at) VALUES (?, ?, ?, ?)').run(u.id, l.id, l.duration, iso(t));
        }
        if (plan === 'partial') continue;
        const limit = c.attempts || 2;
        const tries = plan === 'fail' ? 1 : limit > 1 && Math.random() < 0.25 ? 2 : 1;
        for (let k = 0; k < tries; k++) {
          const passNow = plan === 'pass' && k === tries - 1;
          t += rnd(0.05, 1.5) * DAY;
          if (t > now - 1800e3) t = now - rnd(1, 20) * 3600e3;
          const trend = (t - start) / Math.max(1, now - start); // 0..1
          let set = shuffle([...qs]);
          if (c.qcount > 0) set = set.slice(0, c.qcount);
          const n = set.length;
          let target;
          if (u.phone === '998901110001') target = c.key === 'storage' ? 0.85 : 0.9;
          else if (passNow) target = Math.min(1, rnd(c.pass / 100, 0.97) + trend * 0.05);
          else target = rnd(0.35, c.pass / 100 - 0.05) + trend * 0.04;
          const nCorrect = Math.max(0, Math.min(n, passNow ? Math.max(Math.ceil((c.pass / 100) * n), Math.round(target * n)) : Math.min(Math.ceil((c.pass / 100) * n) - 1, Math.round(target * n))));
          const good = new Set(shuffle(set.map((x) => x.id)).slice(0, nCorrect));
          const layout = set.map((x) => ({ q: x.id, o: shuffle([...Array(x.n).keys()]) }));
          const answers = {};
          for (const x of set) {
            if (good.has(x.id)) answers[x.id] = [...x.correct];
            else { const wrong = [...Array(x.n).keys()].filter((i) => !x.correct.includes(i)); answers[x.id] = [pick(wrong)]; }
          }
          const score = Math.round((nCorrect / n) * 100);
          const dur = rnd(4, Math.max(5, (c.time || 20) - 1)) * 60e3;
          const viol = [];
          if (c.screen && Math.random() < 0.22) {
            for (let v = 0, nv = 1 + Math.floor(Math.random() * 2); v < nv; v++) viol.push({ type: pick(['tab_hidden', 'blur', 'fullscreen_exit', 'printscreen']), at: iso(t + rnd(0.2, 0.9) * dur), detail: '' });
          }
          q(`INSERT INTO attempts (user_id, course_id, started_at, deadline_at, finished_at, score, correct_count, total, passed, layout, answers, violations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(u.id, cid, iso(t), c.time ? iso(t + c.time * 60e3) : null, iso(t + dur), score, nCorrect, n, score >= c.pass ? 1 : 0,
              JSON.stringify(layout), JSON.stringify(answers), JSON.stringify(viol));
          t += dur;
        }
        if (plan === 'fail' && Math.random() < 0.3) q('INSERT OR IGNORE INTO attempt_grants (user_id, course_id, extra) VALUES (?, ?, 1)').run(u.id, cid);
      }
      // bildirishnomalar
      const note = q('INSERT INTO notifications (user_id, course_id, kind, text, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const u of assigned) note.run(u.id, cid, 'assigned', `Sizga yangi trening tayinlandi: «${c.title}»`, iso(created + DAY), iso(created + 2 * DAY));
      if (c.key === 'safety') for (const u of assigned) note.run(u.id, cid, 'reminder', `Eslatma: «${c.testTitle}» muddati 2 kundan keyin tugaydi`, iso(now - 5 * 3600e3), null);
    }
  });
}

module.exports = { seedDemo, makePdf, makeVideo, COURSES, DOCS };
