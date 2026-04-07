/**
 * Restoran POS v3 — Yol Haritası Raporu (DOCX)
 * node scripts/generate-roadmap.cjs
 */
const fs = require('fs');
const path = require('path');

// Global docx modülü
const NODE_PATH = 'C:\\Users\\ilhan\\AppData\\Roaming\\npm\\node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, Header, Footer,
  LevelFormat, TableOfContents, ExternalHyperlink,
} = require(path.join(NODE_PATH, 'docx'));

// ─── Renk Paleti ───────────────────────────────────────────────────────────
const CLR = {
  primary:    '1E3A5F',   // lacivert
  accent:     '2E86AB',   // mavi
  success:    '27AE60',   // yeşil
  warning:    'E67E22',   // turuncu
  danger:     'C0392B',   // kırmızı
  purple:     '6C3483',   // mor
  gray:       '6B7280',
  lightGray:  'F3F4F6',
  midGray:    'D1D5DB',
  white:      'FFFFFF',
  black:      '111111',
  headBg:     '1E3A5F',
  rowAlt:     'EBF3FB',
};

// ─── Yardımcı: metin çalıştırma ─────────────────────────────────────────────
function run(text, opts = {}) {
  return new TextRun({
    text,
    font: 'Arial',
    size: opts.size || 22,            // pt × 2
    bold: opts.bold || false,
    italics: opts.italic || false,
    color: opts.color || CLR.black,
    break: opts.break || undefined,
  });
}

// ─── Yardımcı: paragraf ─────────────────────────────────────────────────────
function para(children, opts = {}) {
  return new Paragraph({
    alignment: opts.align || AlignmentType.LEFT,
    spacing: { before: opts.spaceBefore ?? 80, after: opts.spaceAfter ?? 80 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: Array.isArray(children) ? children : [children],
  });
}

// ─── Yardımcı: başlık ───────────────────────────────────────────────────────
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text, font: 'Arial', size: 40, bold: true, color: CLR.white })],
    shading: { fill: CLR.primary, type: ShadingType.CLEAR },
    indent: { left: 200, right: 200 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 100 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: CLR.accent, space: 4 } },
    children: [new TextRun({ text, font: 'Arial', size: 30, bold: true, color: CLR.primary })],
  });
}

function h3(text, color) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: color || CLR.accent })],
  });
}

// ─── Yardımcı: madde işaretli liste ─────────────────────────────────────────
function bullet(text, indent = 360, bold = false, color) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { before: 40, after: 40 },
    indent: { left: indent + 360, hanging: 360 },
    children: [new TextRun({ text, font: 'Arial', size: 21, bold, color: color || CLR.black })],
  });
}

function bullet2(text) {
  return new Paragraph({
    numbering: { reference: 'bullets2', level: 0 },
    spacing: { before: 30, after: 30 },
    indent: { left: 1080, hanging: 360 },
    children: [new TextRun({ text, font: 'Arial', size: 20, color: CLR.gray })],
  });
}

// ─── Yardımcı: tablo ────────────────────────────────────────────────────────
function buildTable(headers, rows, colWidths) {
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 1, color: CLR.midGray };
  const borders = { top: border, bottom: border, left: border, right: border };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        width: { size: colWidths[i], type: WidthType.DXA },
        shading: { fill: CLR.headBg, type: ShadingType.CLEAR },
        borders,
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        verticalAlign: VerticalAlign.CENTER,
        children: [para(run(h, { bold: true, color: CLR.white, size: 20 }))],
      })
    ),
  });

  const dataRows = rows.map((row, ri) =>
    new TableRow({
      children: row.map((cell, ci) => {
        const isColored = typeof cell === 'object' && cell.color;
        const txt = isColored ? cell.text : String(cell);
        const clr = isColored ? cell.color : CLR.black;
        const bg  = isColored ? cell.bg : (ri % 2 === 1 ? CLR.rowAlt : CLR.white);
        return new TableCell({
          width: { size: colWidths[ci], type: WidthType.DXA },
          shading: { fill: bg, type: ShadingType.CLEAR },
          borders,
          margins: { top: 70, bottom: 70, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
          children: [para(run(txt, { size: 20, color: clr, bold: isColored && cell.bold }))],
        });
      }),
    })
  );

  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

// ─── Renkli etiket yardımcısı ────────────────────────────────────────────────
function tag(text, bg) { return { text, color: CLR.white, bg, bold: true }; }
const KRITIK  = () => tag('KRİTİK',  CLR.danger);
const YUKSEK  = () => tag('YÜKSEK',  CLR.warning);
const ORTA    = () => tag('ORTA',    CLR.accent);
const DUSUK   = () => tag('DÜŞÜK',   CLR.success);

// ─── Kapak Sayfası ──────────────────────────────────────────────────────────
function coverPage() {
  return [
    new Paragraph({ spacing: { before: 2400, after: 0 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 160 },
      children: [new TextRun({ text: 'RESTORAN POS v3', font: 'Arial', size: 72, bold: true, color: CLR.primary })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: 'Kapsamlı Yol Haritası Raporu', font: 'Arial', size: 36, color: CLR.accent })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 600 },
      children: [new TextRun({ text: 'Nisan 2026', font: 'Arial', size: 26, color: CLR.gray, italics: true })],
    }),

    // Bilgi tablosu
    buildTable(
      [],
      [
        ['Proje',        'Restoran POS v3'],
        ['Mimari',       'Electron + Node.js/Express + React 18 + SQLite'],
        ['Hedef Kitle',  'Küçük-Orta Ölçekli Restoranlar (Türkiye)'],
        ['Mevcut Durum', 'MVP — Üretim Öncesi Son Hazırlık'],
        ['Genel Puan',   '7.5 / 10'],
        ['Rapor Tarihi', '6 Nisan 2026'],
      ],
      [2400, 6600]
    ),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ─── İÇİNDEKİLER ────────────────────────────────────────────────────────────
function tocSection() {
  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 0, after: 200 },
      children: [new TextRun({ text: 'İÇİNDEKİLER', font: 'Arial', size: 40, bold: true, color: CLR.primary })],
    }),
    new TableOfContents('İçindekiler', {
      hyperlink: true,
      headingStyleRange: '1-3',
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ─── BÖLÜM 1 — MEVCUT DURUM ─────────────────────────────────────────────────
function section1() {
  return [
    h1('1. MEVCUT DURUM'),

    h2('1.1 Çalışan Özellikler'),

    h3('Temel POS İşlemleri'),
    bullet('Masa yönetimi — alan/masa CRUD, durum makinesi (boş → dolu → rezerve)'),
    bullet('Sipariş yaşam döngüsü — oluşturma, kalem ekleme/çıkarma, mutfağa gönderme, kapatma'),
    bullet('Ödeme işlemleri — nakit, kredi kartı ve karma ödeme; para üstü hesabı'),
    bullet('Paket sipariş akışı — takeaway oluşturma, hazırlama, teslim durumları'),
    bullet('Mutfak ekranı — siparişleri anlık izleme, kalem durumu güncelleme'),
    bullet('İndirim ve servis ücreti yönetimi'),

    h3('Müşteri Yönetimi'),
    bullet('Müşteri veritabanı — CRUD, telefon/adres kayıtları'),
    bullet('Türk telefon numarası normalizasyonu (+90, 0 prefix, 10/11 hane)'),
    bullet('Kara liste ve müşteri notu'),
    bullet('Geçmiş sipariş görüntüleme'),

    h3('Arayan ID (CallerID) Entegrasyonu'),
    bullet('CID812 USB donanım desteği (HID modu)'),
    bullet('.NET 8 yardımcı süreci — cid.dll native wrapper'),
    bullet('Gelen çağrı popup ile müşteri eşleştirme'),
    bullet('Çağrı kaydı ve sipariş bağlama'),

    h3('Yazıcı Sistemi'),
    bullet('Ethernet (TCP socket) ve USB (Windows GDI) yazıcı desteği'),
    bullet('ESC/POS rendering — PC857 Türkçe karakter kodlaması, ESC t 12'),
    bullet('Mutfak yazdırma — kategori bazlı yönlendirme, çoklu yazıcı'),
    bullet('Fiş yazdırma — sipariş kapandığında otomatik tetikleme'),
    bullet('Yazıcı keşfi — Store Bridge PowerShell entegrasyonu'),
    bullet('İdempotent iş kuyruğu — yeniden deneme güvenli, claimed_at kilidi'),

    h3('Raporlama'),
    bullet('Günlük/haftalık/aylık satış özeti'),
    bullet('Kategori ve ürün bazlı analitik'),
    bullet('Ödeme tipi dağılımı (nakit/kart)'),
    bullet('Kullanıcı bazlı satış raporu'),

    h3('Sistem & Altyapı'),
    bullet('Electron masaüstü uygulaması — packaged NSIS installer + portable .exe'),
    bullet('Multi-tenant mimari — business_id izolasyonu'),
    bullet('JWT tabanlı kimlik doğrulama, rol bazlı erişim kontrolü (admin/kasiyer/garson/mutfak)'),
    bullet('Denetim kaydı (audit_log) — her kritik işlem izleniyor'),
    bullet('Store Bridge — bağımsız Windows yazıcı servisi'),
    bullet('better-sqlite3 WAL modu, foreign keys aktif'),
    bullet('Dev/packaged mod ayrımı, userData yol yönetimi'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('1.2 Bilinen Hatalar ve Eksikler'),

    buildTable(
      ['Alan', 'Sorun', 'Şiddet', 'Etki'],
      [
        ['JWT Sırrı',        'Electron her başlatmada farklı secret üretiyor → oturumlar kopuyor', KRITIK(), 'Tüm kullanıcılar'],
        ['DB Transaction',   'Çok adımlı işlemler (sipariş, ödeme) transaction olmadan çalışıyor', YUKSEK(), 'Veri tutarsızlığı'],
        ['Input Validation', 'Route\'larda tip/aralık kontrolü yok; Joi/Zod eksik',               YUKSEK(), 'Veri güvenliği'],
        ['Rate Limiting',    'Sadece auth endpoint\'inde var; bridge/admin korumasız',             ORTA(),   'DoS riski'],
        ['Sayfalama',        'Liste endpoint\'leri tüm sonuçları döndürüyor',                     ORTA(),   'Performans'],
        ['Yazıcı İzleme',   'Store Bridge çökseyse sessiz hata; yeniden başlatma yok',            ORTA(),   'Yazdırma kesilir'],
        ['CallerID Bellek',  'Debounce sözlüğü sınırsız büyüyor',                                 ORTA(),   'Bellek sızıntısı'],
        ['CORS',             'Sadece localhost; LAN kurulumda çalışmıyor',                         ORTA(),   'Ağ erişimi'],
        ['PC857 Haritası',   '40 karakter tanımlı; genişletilmiş Latin eksik',                    DUSUK(),  'Yazıcı çıktısı'],
        ['Satır Kaydırma',   'Uzun metinler fişte taşıyor',                                      DUSUK(),  'Fiş kalitesi'],
        ['legacy tablo',     'incoming_calls tablosu çift yazma devam ediyor',                    DUSUK(),  'DB boyutu'],
      ],
      [2000, 4200, 1400, 1300]
    ),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('1.3 Teknik Borç'),

    h3('Kod Kalitesi'),
    bullet('server/routes/orders.js — 700+ satır; split edilmeli (modifiers, takeaway, status ayrı dosya)'),
    bullet('electron/main.cjs — 730+ satır; process yönetimi, path helper, config okuma karışık'),
    bullet('server/migrations/run.js — 530 satır; tablo migration\'ları ayrı dosyalara taşınmalı'),
    bullet('store-bridge/printers/renderers.js — iyi yazılmış ama birim testi yok'),
    bullet('Tüm route\'larda ortak hata yönetimi yok; try/catch kalıpları tekrarlı'),

    h3('Güvenlik'),
    bullet('server/.env production secret\'i commit\'te — .gitignore\'a alınmalı'),
    bullet('BRIDGE_TOKEN plaintext log\'lara yazılıyor (main.cjs line ~387)'),
    bullet('Permissions JSON corrupt olursa sessiz {} dönüyor; şema doğrulaması yok'),
    bullet('pos-config.json world-readable; dosya izinleri belgelenmeli'),

    h3('Performans'),
    bullet('Her istek için DB\'den kullanıcı/rol sorgusu — in-memory TTL cache eklenmeli'),
    bullet('Yazıcı yönlendirmesi her kalemde çözümleniyor — business başına cache yapılmalı'),
    bullet('audit_log.created_at sütununda index yok — sıralama yavaş'),
    bullet('print_jobs tablosu temizlenmiyor — N gün sonra arşivleme gerekli'),
  ];
}

// ─── BÖLÜM 2 — KRİTİK EKSİKLER ─────────────────────────────────────────────
function section2() {
  return [
    h1('2. KRİTİK EKSİKLER (Hemen Yapılması Gerekenler)'),

    h2('2.1 Güvenlik Açıkları'),

    h3('KRITIK — JWT Secret Kalıcılığı', CLR.danger),
    para([
      run('Sorun: ', { bold: true }),
      run('electron/main.cjs satır ~140\'da, pos-config.json\'da jwtSecret yoksa her Electron başlatmada '),
      run('crypto.randomBytes(64)', { bold: true }),
      run(' çağrılıyor. Bu, her restart\'ta tüm aktif token\'ların geçersiz kalmasına yol açıyor.'),
    ]),
    para([
      run('Çözüm: ', { bold: true }),
      run('pos-config.json\'a jwtSecret alanı zorunlu hale getirilmeli veya userData\'ya otomatik yazılmalı. '),
      run('Kurulum sırasında tek seferlik secret üretilip dosyaya kaydedilmeli.'),
    ]),

    h3('YÜKSEK — Input Validation Eksikliği', CLR.warning),
    bullet('Hiçbir route\'da Zod/Joi gibi şema doğrulama yok'),
    bullet('SQL injection riski düşük (parameterized query kullanılıyor) ama tip/aralık ihlalleri DB\'ye yazılabiliyor'),
    bullet('Uzun string\'ler (notes, name) sınırsız; DB storage şişebilir'),
    bullet('Çözüm: server/middleware/validate.js oluştur; her route\'a schema ekle'),

    h3('YÜKSEK — Rate Limiting Eksikliği', CLR.warning),
    bullet('bridge/* ve admin/* endpoint\'leri korumasız'),
    bullet('Yazıcı test endpoint\'i brute-force ile çağrılabilir → yazıcı kağıt tüketimi'),
    bullet('Çözüm: express-rate-limit global middleware veya route bazlı limit'),

    h3('ORTA — Token Log Sızıntısı', CLR.accent),
    bullet('BRIDGE_TOKEN console.log ile basılıyor (electron/main.cjs ~387)'),
    bullet('Çözüm: log\'larda token\'ı ****** ile maskele'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('2.2 Veri Kaybı Riski'),

    h3('YÜKSEK — Transaction Eksikliği'),
    para([
      run('server/routes/orders.js içinde finalize işlemi birden fazla UPDATE çalıştırıyor. '),
      run('İlk UPDATE başarılı, ikincisi başarısız olursa sipariş yarı mutfakta yarı pending kalıyor. '),
      run('Aynı sorun payments.js\'de de geçerli.'),
    ]),
    bullet('Çözüm: db.transaction(() => { ... })() wrapper tüm çok adımlı işlemlere eklenmeli'),
    bullet('Etkilenen dosyalar: orders.js, payments.js, printJobs.js'),

    h3('ORTA — Yedekleme Mekanizması Yok'),
    bullet('pos.db tek nokta; disk arızasında tüm veri gidiyor'),
    bullet('WAL modu var ama sadece crash recovery için'),
    bullet('Çözüm: Günlük otomatik backup (userData\'ya tarihli kopya); isteğe bağlı bulut sync'),

    h3('DÜŞÜK — Print Job Orphan Riski'),
    bullet('Sipariş item status güncelleme ve print job oluşturma ayrı transaction\'da'),
    bullet('Çözüm: Aynı transaction içine al'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('2.3 Kullanıcıyı Doğrudan Etkileyen Hatalar'),

    buildTable(
      ['#', 'Hata', 'Etki', 'Öncelik'],
      [
        ['1', 'Electron restart → tüm oturumlar kapanıyor (JWT secret yenileniyor)',      'Tüm kullanıcılar yeniden giriş yapmak zorunda', KRITIK()],
        ['2', 'Store Bridge çökmesi → yazıcıya hiçbir şey gitmiyor, UI\'da uyarı yok',  'Sessiz fiş/mutfak yazdırma hatası',             YUKSEK()],
        ['3', 'LAN\'dan erişimde CORS hatası → beyaz ekran',                              'Tablet/ikinci cihaz kullanılamıyor',             YUKSEK()],
        ['4', 'Uzun ürün adları fişte taşıyor → yazıcı anlamsız karakter basıyor',       'Müşteriye hatalı fiş gidiyor',                  ORTA()],
        ['5', 'Sayfa yenilemede auth redirect loop (token expire)',                       'Kullanıcı kilitlenebiliyor',                    ORTA()],
        ['6', 'Büyük müşteri listesi (1K+) yavaş yükleniyor — sayfalama yok',            'Müşteri arama geç cevap veriyor',               ORTA()],
      ],
      [400, 3800, 2800, 1400]
    ),
  ];
}

// ─── BÖLÜM 3 — KISA VADE ────────────────────────────────────────────────────
function section3() {
  return [
    h1('3. KISA VADE (1–2 Hafta)'),

    h2('3.1 Kritik Bug Fix\'ler'),

    h3('Sprint 1 — Güvenlik & Kararlılık (3-5 gün)'),

    buildTable(
      ['Görev', 'Dosya', 'Tahmin'],
      [
        ['JWT secret kalıcılığı — pos-config.json\'a otomatik yazma',       'electron/main.cjs',       '2 sa'],
        ['DB transaction wrapper — orders, payments, printJobs',            'routes/*.js, services/*', '4 sa'],
        ['Input validation middleware (Zod) — auth, orders, payments',      'middleware/validate.js',  '6 sa'],
        ['Rate limit bridge/* ve admin/* endpoint\'leri',                   'server/index.js',         '1 sa'],
        ['BRIDGE_TOKEN log maskeleme',                                       'electron/main.cjs',       '30 dk'],
        ['CORS — LAN IP desteği (env\'den origin listesi)',                 'server/index.js',         '1 sa'],
      ],
      [4400, 2800, 1200]
    ),

    h3('Sprint 2 — Yazıcı & Fiş İyileştirmeleri (3-4 gün)'),
    buildTable(
      ['Görev', 'Dosya', 'Tahmin'],
      [
        ['Satır kaydırma (word-wrap) renderers.js\'e ekle',                'renderers.js',             '3 sa'],
        ['Store Bridge çökme izleme + Electron auto-restart',              'electron/main.cjs',         '2 sa'],
        ['PC857 karakter haritası tamamlama (genişletilmiş Latin)',        'renderers.js',              '2 sa'],
        ['Yazıcı satır genişliğini per-printer config\'den oku',           'renderers.js, admin API',  '2 sa'],
        ['Receipt footer — işletme adı/adresi/telefon config',             'printJobs.js, admin UI',   '3 sa'],
      ],
      [4400, 2800, 1200]
    ),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('3.2 Kullanılabilirlik İyileştirmeleri'),

    h3('UX Hızlı Kazanımlar'),
    bullet('Masa görünümü — doluluk renk skalası (5 renk: boş/az/yoğun/dolu/rezerve)'),
    bullet('Sipariş ekranı — kalem arama/filtreleme (özellikle büyük menüde)'),
    bullet('Mutfak ekranı — sipariş yaşına göre renk uyarısı (sarı 10dk, kırmızı 20dk)'),
    bullet('Bildirim sesi — yeni sipariş geldiğinde ses çalma seçeneği'),
    bullet('Yazıcı test butonu — ayarlar sayfasında anlık test yazdırma'),
    bullet('Store Bridge bağlantı durumu — sidebar\'da ikon (yeşil/sarı/kırmızı)'),

    h3('Admin Panel İyileştirmeleri'),
    bullet('Kullanıcı son giriş zamanı görüntüleme'),
    bullet('Yazıcı durum monitörü — son başarılı yazdırma zamanı'),
    bullet('Sistem sağlık sayfası — SQLite boyutu, print_jobs sayısı, Bridge uptime'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('3.3 UI/UX İyileştirmeleri'),

    buildTable(
      ['Bileşen', 'Mevcut Durum', 'Önerilen İyileştirme'],
      [
        ['Sipariş ekranı',       'Tüm kalemler tek listede',           'Kategoriye göre grupla + hızlı filtre tab'],
        ['Ödeme ekranı',         'Manuel tutar girişi',                'Hızlı tuş takımı (10/20/50/100 TL butonlar)'],
        ['Müşteri seçimi',       'Popup modal',                        'Inline arama — telefon yazarken anlık öneri'],
        ['Mutfak ekranı',        'Tablo görünümü',                     'Kart görünümü seçeneği + sürükleme ile durum'],
        ['Raporlar',             'Tablo çıktısı',                      'Grafik önizleme (recharts zaten bağımlılıkta)'],
        ['Login sayfası',        'Tek işletme',                        'Son giriş yapılan işletme hatırlama'],
        ['Sidebar',              'Her zaman açık',                     'Collapse modu — küçük ekranlar için'],
        ['Hata mesajları',       'Generic "Hata oluştu"',              'İşlem bazlı açıklayıcı mesaj + retry butonu'],
      ],
      [2400, 2800, 3700]
    ),
  ];
}

// ─── BÖLÜM 4 — ORTA VADE ────────────────────────────────────────────────────
function section4() {
  return [
    h1('4. ORTA VADE (1 Ay)'),

    h2('4.1 Yeni Özellikler'),

    h3('Rezervasyon Modülü'),
    bullet('Masa rezervasyonu — tarih/saat, kişi sayısı, not'),
    bullet('Takvim görünümü — günlük/haftalık masa bazlı rezervasyon listesi'),
    bullet('SMS/WhatsApp bildirim entegrasyonu (Twilio veya NetGSM)'),
    bullet('Rezervasyon → sipariş dönüşümü tek tıkla'),

    h3('Garson Çağırma'),
    bullet('QR kod masa bazlı (müşteri tarayıcıdan çağırıyor)'),
    bullet('Garson uygulamasına push benzeri uyarı (polling ile)'),
    bullet('Çağrı geçmişi ve yanıt süre takibi'),

    h3('Ürün Yönetimi Geliştirmeleri'),
    bullet('Ürün görseli yükleme (local storage, max 500KB)'),
    bullet('Menü saatleri — ürün/kategori aktif saat aralığı'),
    bullet('Combo/set menü — birden fazla ürün gruplandırma'),
    bullet('Popüler ürün önerileri (sipariş geçmişine göre)'),
    bullet('Ürün bazlı not/allerjen alanı'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('4.2 Raporlama ve Analitik'),

    h3('Mevcut Raporların Zenginleştirilmesi'),
    bullet('Saatlik yoğunluk haritası — hangi saat en çok sipariş alıyor'),
    bullet('Masa devir hızı raporu — ortalama oturma süresi, masa başına gelir'),
    bullet('Garson performansı — sipariş sayısı, ortalama kalem/sipariş, iptal oranı'),
    bullet('Ürün karlılık raporu (maliyet alanı eklenirse)'),
    bullet('Kalan/iptal kalemler analizi — fire raporu'),

    h3('Grafik Bileşenleri (recharts hazır)'),
    buildTable(
      ['Grafik', 'Veri Kaynağı', 'Tür'],
      [
        ['Günlük ciro trendi',          'orders + payments',    'Line chart'],
        ['Kategori satış dağılımı',     'order_items + categories', 'Pie/Donut chart'],
        ['Saatlik yoğunluk',            'orders.created_at',    'Bar chart (24 sütun)'],
        ['En çok satan 10 ürün',        'order_items',          'Horizontal bar'],
        ['Ödeme tipi trendi',           'payments',             'Stacked bar'],
        ['Haftalık karşılaştırma',      'Bu hafta vs geçen',    'Grouped bar'],
      ],
      [3200, 3200, 2500]
    ),

    h3('Dışa Aktarma'),
    bullet('CSV export — satış verileri, müşteri listesi'),
    bullet('PDF rapor — günlük kapanış fişi (otomatik gece yarısı)'),
    bullet('Excel export (xlsx) — aylık muhasebe özeti'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('4.3 Stok Takibi (Temel)'),

    para([run('Stok modülü, POS sisteminin doğal bir uzantısı. MVP seviyesinde aşağıdaki işlevler yeterli:', { color: CLR.gray, size: 20 })]),

    h3('Veri Modeli'),
    buildTable(
      ['Tablo', 'Alanlar', 'İlişki'],
      [
        ['stock_items',       'id, business_id, name, unit, quantity, min_quantity, cost_price', 'products ile M:N'],
        ['stock_movements',   'id, item_id, movement_type, quantity, notes, created_at',         'stock_items'],
        ['product_ingredients', 'product_id, stock_item_id, quantity_used',                      'recipe linkage'],
      ],
      [2400, 4400, 2100]
    ),

    h3('Özellikler'),
    bullet('Stok kalem girişi ve birim tanımlama (kg/lt/adet)'),
    bullet('Sipariş tamamlandığında otomatik stok düşme (product_ingredients üzerinden)'),
    bullet('Minimum stok uyarısı — ana ekranda kırmızı banner'),
    bullet('Manuel stok hareketi — alım/fire/sayım giriş'),
    bullet('Stok hareketi geçmişi raporu'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('4.4 Sipariş Geçmişi ve Müşteri Profili'),

    h3('Sipariş Geçmişi'),
    bullet('Kapalı siparişler arama — tarih, masa, müşteri, tutar aralığı'),
    bullet('Sipariş detay görüntüleme — kalemler, ödemeler, değişiklik geçmişi'),
    bullet('Sipariş yeniden yazdırma — geçmişten fiş tekrar bas'),
    bullet('İptal edilmiş kalemler dahil tam geçmiş'),

    h3('Müşteri 360 Profili'),
    bullet('Müşteri başına toplam harcama, sipariş sayısı, son ziyaret'),
    bullet('Favori ürünler (sipariş geçmişinden hesaplanan)'),
    bullet('Adres geçmişi ve varsayılan adres belirleme'),
    bullet('Müşteri bazlı indirim tanımı'),
  ];
}

// ─── BÖLÜM 5 — UZUN VADE ────────────────────────────────────────────────────
function section5() {
  return [
    h1('5. UZUN VADE (3+ Ay)'),

    h2('5.1 Büyük Özellikler'),

    h3('WebSocket / Gerçek Zamanlı İletişim'),
    para([run('Mevcut polling mimarisi (Store Bridge 2 sn, UI 5 sn) yetersiz kalacak. socket.io veya ws entegrasyonu:', { color: CLR.gray, size: 20 })]),
    bullet('Mutfak ekranı anlık güncelleme — sipariş geldiğinde sayfa yenilemesiz'),
    bullet('Garson bildirim push — masa çağırma, sipariş hazır'),
    bullet('Çoklu cihaz senkronizasyonu — kasiyerin işlemi tüm ekranlara yansıyor'),
    bullet('Store Bridge push — polling yerine event-driven print job tetikleme'),

    buildTable(
      ['Bileşen', 'Teknoloji', 'Karmaşıklık'],
      [
        ['WS sunucusu',         'socket.io (server/index.js\'e ekle)',    'Orta'],
        ['React client',        'socket.io-client + Context',             'Orta'],
        ['Bridge push',         'WS client (store-bridge/index.js)',      'Düşük'],
        ['Auth entegrasyon',    'JWT over WS handshake',                  'Orta'],
        ['Reconnect mantığı',   'Exponential backoff, business scope',    'Yüksek'],
      ],
      [2800, 3800, 2300]
    ),

    h3('Çoklu Şube Desteği'),
    bullet('branches tablosu zaten var — business → branch hiyerarşisi mevcut'),
    bullet('Şube bazlı raporlama konsolide dashboard'),
    bullet('Merkezi ürün/menü yönetimi — şubelere push'),
    bullet('Şubeler arası stok transferi'),
    bullet('Her şubenin bağımsız pos-config.json ile çalışması'),

    h3('Online Sipariş Entegrasyonu'),
    bullet('Yemeksepeti / Getir webhook alımı → otomatik sipariş oluşturma'),
    bullet('QR kod masa menüsü → müşteri kendi siparişini veriyor'),
    bullet('WhatsApp Bot entegrasyonu (Twilio Sandbox veya yerli alternatif)'),
    bullet('Kendi web sipariş sayfası (basit React SPA)'),

    h3('Müşteri Sadakat Programı'),
    bullet('Puan biriktirme — sipariş tutarına göre puan'),
    bullet('Puan kullanma — indirim kuponuna dönüştürme'),
    bullet('Doğum günü kuponu otomatik SMS'),
    bullet('VIP müşteri kartı (QR ile hızlı tanıma)'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('5.2 Altyapı İyileştirmeleri'),

    h3('Veritabanı'),
    bullet('SQLite → PostgreSQL migration yolu hazırlama (büyük şubeler için)'),
    bullet('Read replica desteği (raporlama DB ayrımı)'),
    bullet('Para birimi için REAL yerine INTEGER (kuruş cinsinden) + migration'),
    bullet('Arşivleme — 1 yıldan eski sipariş/log ayrı DB\'ye taşıma'),

    h3('API ve Servis Katmanı'),
    bullet('OpenAPI/Swagger spec otomatik üretme (zod-to-openapi)'),
    bullet('Versiyonlu API — /api/v1/ prefix'),
    bullet('GraphQL gateway (büyük yapılar için opsiyonel)'),
    bullet('Redis cache — kullanıcı/rol, yazıcı routing için'),

    h3('Güvenlik Sertleştirme'),
    bullet('2FA desteği — admin hesaplar için TOTP'),
    bullet('Session revocation listesi — logout\'ta token kara listeye'),
    bullet('IP bazlı erişim kısıtlama (admin panel)'),
    bullet('Encrypted SQLite (SQLCipher entegrasyonu)'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('5.3 Mobil Uygulama'),

    h3('Strateji'),
    para([run('Mevcut REST API üzerine React Native veya Flutter ile garson uygulaması:', { color: CLR.gray, size: 20 })]),

    buildTable(
      ['Özellik', 'Öncelik', 'Notlar'],
      [
        ['Sipariş alma (garson)',       'P1', 'Masaya git → kalem ekle → mutfağa gönder'],
        ['Masa durumu görüntüleme',     'P1', 'Read-only harita'],
        ['Bildirim push',               'P1', 'FCM ile masa çağırma, sipariş hazır'],
        ['Ödeme alma',                  'P2', 'Kasiyere yönlendirme veya mobil ödeme'],
        ['Mutfak ekranı tablet',        'P2', 'iPad/Android tablet optimize'],
        ['Offline mod',                 'P3', 'Bağlantı kopunca lokal queue'],
      ],
      [3800, 1400, 3700]
    ),
  ];
}

// ─── BÖLÜM 6 — TEKNİK BORÇ ──────────────────────────────────────────────────
function section6() {
  return [
    h1('6. TEKNİK BORÇ'),

    h2('6.1 Refactor Edilmesi Gereken Dosyalar'),

    buildTable(
      ['Dosya', 'Satır', 'Sorun', 'Öneri'],
      [
        ['server/routes/orders.js',     '700+', 'Tek dosyada CRUD, status machine, mutfak, takeaway, ödeme', 'orders-crud.js / orders-kitchen.js / orders-status.js\'e böl'],
        ['electron/main.cjs',           '730+', 'Process yönetimi, path helper, config, health check hepsi bir arada', 'processManager.cjs, pathHelper.cjs, configLoader.cjs\'e böl'],
        ['server/migrations/run.js',    '530+', 'Tüm tablolar ve migrationlar aynı dosyada',                 'migrations/ dizini + her tablo için ayrı dosya'],
        ['server/services/printJobs.js','527',  'Enqueue, renderer, routing, mock hepsi bir arada',          'printQueue.js / receiptRenderer.js / kitchenRenderer.js'],
        ['store-bridge/index.js',       '200+', 'Discovery, poller, CID başlatma karışık',                  'orchestrator.js + ayrı init dosyaları'],
        ['client/src/components/settings/PrinterDetailPage.jsx', '650+', 'Tek sayfada 5 farklı form', 'PrinterConnectionForm / PrinterRoutingForm / PrinterTestPanel'],
      ],
      [2800, 700, 2600, 2800]
    ),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('6.2 Test Eksiklikleri'),

    para([run('Mevcut durum: Sıfır test dosyası.', { bold: true, color: CLR.danger })]),

    h3('Önerilen Test Katmanları'),
    buildTable(
      ['Katman', 'Araç', 'Kapsam', 'Öncelik'],
      [
        ['Birim testler',        'Vitest',        'helpers.js, phoneNormalize.js, renderers.js, printRouting.js', 'P1 — 1. hafta'],
        ['Entegrasyon testleri', 'Supertest+Vitest', 'Auth akışı, sipariş yaşam döngüsü, ödeme, yazdırma', 'P1 — 2. hafta'],
        ['DB testler',           'better-sqlite3 in-memory', 'Migration idempotency, foreign key constraints', 'P1 — 2. hafta'],
        ['E2E testler',          'Playwright',    'Login → sipariş → ödeme → fiş akışı', 'P2 — 1. ay'],
        ['Electron testler',     'Spectron/Playwright Electron', 'Başlatma, child process, window lifecycle', 'P3 — 3. ay'],
      ],
      [2200, 2000, 3200, 1500]
    ),

    h3('Kritik Test Senaryoları (P1)'),
    bullet('phoneNormalize.js — 20+ Türk numara formatı (0212..., +90532..., 05xx, 212...)'),
    bullet('encodePC857() — Türkçe karakterlerin doğru byte\'a dönüştüğünü doğrula'),
    bullet('JWT auth middleware — geçerli/süresi dolmuş/sahte token'),
    bullet('businessScope — çapraz business erişim engeli'),
    bullet('print_jobs idempotency — aynı key ile çift enqueue'),
    bullet('DB migration — fresh DB ve mevcut DB üzerinde idempotent çalışma'),
    bullet('Order transaction — ikinci UPDATE hata fırlatırsa rollback'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('6.3 Dokümantasyon Eksiklikleri'),

    buildTable(
      ['Eksik Doküman', 'Önem', 'Önerilen Format'],
      [
        ['API endpoint referansı',            'Yüksek', 'OpenAPI 3.0 YAML (zod-to-openapi ile otomatik)'],
        ['DB şema diyagramı',                 'Yüksek', 'dbdiagram.io veya Mermaid ERD'],
        ['Store Bridge mimari belgesi',        'Orta',   'README.md — veri akış diyagramı'],
        ['Electron process akış diyagramı',   'Orta',   'Mermaid sequence diagram'],
        ['Kurulum/güncelleme kılavuzu',       'Yüksek', 'Markdown — adım adım Windows kurulum'],
        ['pos-config.json tüm alanlar',       'Orta',   'JSON Schema + açıklama tablosu'],
        ['Klavye kısayolları',                'Düşük',  'UI içi yardım ekranı'],
        ['Hata kodları referansı',            'Orta',   'Markdown tablo — HTTP 4xx/5xx anlamları'],
        ['CHANGELOG',                         'Düşük',  'Sürüm bazlı değişiklik listesi'],
      ],
      [3200, 1400, 4300]
    ),
  ];
}

// ─── BÖLÜM 7 — DEPLOYMENT ───────────────────────────────────────────────────
function section7() {
  return [
    h1('7. DEPLOYMENT'),

    h2('7.1 Mevcut Dağıtım Durumu'),
    para([run('electron-builder ile NSIS kurulum paketi ve portable .exe üretimi yapılandırıldı. Temel akış:', { color: CLR.gray, size: 20 })]),

    buildTable(
      ['Adım', 'Komut', 'Çıktı'],
      [
        ['Native rebuild', 'npm run rebuild:server-native', 'better-sqlite3 Electron uyumlu .node'],
        ['Client build',   'npm run build (client)',         'client/dist/'],
        ['Electron build', 'electron-builder --win --x64',  'dist-electron/'],
        ['NSIS installer', 'dist:nsis',                      'Restoran POS Setup x.x.x.exe'],
        ['Portable',       'dist:portable',                  'Restoran POS x.x.x.exe'],
      ],
      [2200, 3200, 3500]
    ),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('7.2 Güncelleme Süreci İyileştirme'),

    h3('Kısa Vade — Manuel Güncelleme İyileştirme'),
    bullet('Kurulum öncesi DB yedeği otomatik alma (NSIS installer hook)'),
    bullet('Sürüm kontrolü — uygulama başlarken mevcut sürümü logla'),
    bullet('Güncelleme notu popup — yeni kurulum sonrası değişiklik listesi'),
    bullet('pos-config.json ve pos.db mevcut yüklemenin üzerine yazılmaması garantisi'),

    h3('Orta Vade — Yarı Otomatik Güncelleme'),
    buildTable(
      ['Bileşen', 'Teknoloji', 'Açıklama'],
      [
        ['Sürüm kontrol API\'si',  'Express endpoint /api/version', 'Uygulamada "Güncelleme mevcut" banner'],
        ['İndirme yöneticisi',     'Electron dialog + fetch',       'Kullanıcı onayıyla .exe indir'],
        ['Kurulum tetikleme',      'shell.openPath(exePath)',       'İndirim sonra yükleyiciyi başlat'],
        ['Rollback',               'Önceki sürüm ZIP arşivi',       'Kurulum başarısız olursa geri dön'],
      ],
      [2800, 2800, 3300]
    ),

    h3('Uzun Vade — electron-updater ile Otomatik Güncelleme'),
    bullet('electron-builder\'ın electron-updater paketi — otomatik diff update'),
    bullet('Güncelleme sunucusu: GitHub Releases veya kendi S3/CDN'),
    bullet('Delta güncellemeler — sadece değişen dosyaları indir (~%80 küçük)'),
    bullet('Sessiz arka plan indirme + kullanıcı onayıyla uygulama'),
    bullet('Rollback desteği — önceki sürüme tek tıkla dön'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('7.3 Yedekleme Stratejisi'),

    h3('Önerilen Katmanlı Yedekleme'),
    buildTable(
      ['Katman', 'Sıklık', 'Yöntem', 'Saklama'],
      [
        ['Anlık (WAL)',          'Her yazma',    'SQLite WAL — otomatik',                          'Çalışma süresi'],
        ['Günlük lokal',         'Gece 02:00',   'pos.db → userData/backups/YYYY-MM-DD.db',       '30 gün'],
        ['Haftalık lokal',       'Pazar 03:00',  'ZIP ile sıkıştırılmış DB + pos-config.json',    '12 hafta'],
        ['Aylık harici',         'Ayın 1\'i',    'USB disk / paylaşılan ağ klasörü kopyası',      '12 ay'],
        ['Bulut (opsiyonel)',     'Günlük',       'Şifreli .db → OneDrive / Google Drive / S3',   'Sınırsız'],
      ],
      [2000, 1800, 3400, 1700]
    ),

    h3('Uygulama Planı'),
    bullet('Electron main.cjs\'e scheduleBackup() fonksiyonu — setInterval ile gece 02:00'),
    bullet('fs.copyFileSync(dbPath, backupPath) — WAL checkpoint sonrası'),
    bullet('30 günden eski yedekleri temizle — readdir + stat + unlink'),
    bullet('Yedek başarısız olursa admin UI\'da uyarı göster'),
    bullet('Manuel yedek al butonu — admin paneline ekle'),

    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    h2('7.4 Üretim Kontrol Listesi'),

    buildTable(
      ['#', 'Kontrol Maddesi', 'Durum', 'Notlar'],
      [
        ['1',  'JWT_SECRET kalıcı ve güçlü (32+ char)',                  { text: 'EKSİK', color: CLR.white, bg: CLR.danger, bold: true },   'pos-config.json otomasyonu gerekli'],
        ['2',  'DB transaction wrapper tüm kritik işlemlerde',           { text: 'EKSİK', color: CLR.white, bg: CLR.danger, bold: true },   'Sprint 1\'de yapılacak'],
        ['3',  'Input validation (Zod) tüm route\'larda',                { text: 'EKSİK', color: CLR.white, bg: CLR.danger, bold: true },   'Sprint 1\'de yapılacak'],
        ['4',  'Rate limiting tüm endpoint\'lerde',                      { text: 'EKSİK', color: CLR.white, bg: CLR.warning, bold: true },  'Express global middleware'],
        ['5',  'CORS origin listesi env\'den konfigüre ediliyor',        { text: 'EKSİK', color: CLR.white, bg: CLR.warning, bold: true },  'LAN erişimi için kritik'],
        ['6',  'server/.env git\'te değil (.gitignore\'da)',             { text: 'EKSİK', color: CLR.white, bg: CLR.warning, bold: true },  '.env.example ile değiştir'],
        ['7',  'better-sqlite3 Electron için rebuild edildi',            { text: 'TAMAM', color: CLR.white, bg: CLR.success, bold: true },  'rebuild-server-native.cjs'],
        ['8',  'app.setName("Restoran POS") userData yolu doğru',       { text: 'TAMAM', color: CLR.white, bg: CLR.success, bold: true },  'main.cjs güncellendi'],
        ['9',  'print_jobs.order_id nullable',                           { text: 'TAMAM', color: CLR.white, bg: CLR.success, bold: true },  'Migration eklendi'],
        ['10', 'PC857 Turkish encoding ESC t 12',                        { text: 'TAMAM', color: CLR.white, bg: CLR.success, bold: true },  'renderers.js güncellendi'],
        ['11', 'Mock mod varsayılan KAPALI (gerçek yazdırma)',           { text: 'TAMAM', color: CLR.white, bg: CLR.success, bold: true },  'config/index.js'],
        ['12', 'CallerID DLL yolu packaged modda doğru',                 { text: 'TAMAM', color: CLR.white, bg: CLR.success, bold: true },  'main.cjs Release/net8.0'],
        ['13', 'Günlük otomatik DB yedekleme aktif',                    { text: 'EKSİK', color: CLR.white, bg: CLR.warning, bold: true },  'Orta vadede yapılacak'],
        ['14', 'Store Bridge çökme izleme + otomatik restart',           { text: 'EKSİK', color: CLR.white, bg: CLR.warning, bold: true },  'Sprint 2\'de yapılacak'],
        ['15', 'Yazıcı satır kaydırma (word-wrap)',                     { text: 'EKSİK', color: CLR.white, bg: CLR.warning, bold: true },  'Sprint 2\'de yapılacak'],
      ],
      [400, 4400, 1400, 2700]
    ),
  ];
}

// ─── ÖZET PANO ───────────────────────────────────────────────────────────────
function summaryDashboard() {
  return [
    h1('8. ÖZET PANO'),

    h2('Genel Değerlendirme'),
    buildTable(
      ['Boyut', 'Puan', 'Yorum'],
      [
        ['Özellik Tamamlığı',    '8 / 10', 'POS çekirdeği güçlü; stok/rezervasyon eksik'],
        ['Kod Kalitesi',         '7 / 10', 'Temiz yapı; büyük dosyalar bölünmeli'],
        ['Güvenlik',             '6 / 10', 'JWT sorunu ve input validation kritik'],
        ['Performans',           '7 / 10', 'SQLite WAL yeterli; cache ve sayfalama ekle'],
        ['Test Kapsamı',         '1 / 10', 'Sıfır test — en büyük risk'],
        ['Dokümantasyon',        '7 / 10', 'README iyi; API doc ve şema diyagramı eksik'],
        ['Deployment Olgunluğu', '7 / 10', 'electron-builder hazır; auto-update gerekli'],
        ['GENEL ORTALAMA',       '7.5 / 10', 'MVP için uygun; üretim sertleştirmesi gerekli'],
      ],
      [3200, 1600, 4100]
    ),

    new Paragraph({ spacing: { before: 300, after: 0 }, children: [] }),
    h2('Öncelik Matrisi'),
    buildTable(
      ['Zaman Dilimi', 'Görev', 'Etki', 'Çaba'],
      [
        ['1. Hafta',  'JWT secret kalıcılığı',              'Kritik', 'Düşük (2 sa)'],
        ['1. Hafta',  'DB transaction wrapper',             'Yüksek', 'Orta (4 sa)'],
        ['1. Hafta',  'Input validation (Zod)',             'Yüksek', 'Orta (6 sa)'],
        ['1. Hafta',  'Rate limiting genişletme',           'Orta',   'Düşük (1 sa)'],
        ['2. Hafta',  'Word-wrap renderers.js',             'Orta',   'Düşük (3 sa)'],
        ['2. Hafta',  'Store Bridge restart izleme',        'Yüksek', 'Orta (4 sa)'],
        ['2. Hafta',  'CORS LAN desteği',                  'Orta',   'Düşük (1 sa)'],
        ['3-4. Hafta','Birim + entegrasyon test altyapısı', 'Yüksek', 'Yüksek (2 gün)'],
        ['3-4. Hafta','Grafik raporlar (recharts)',         'Orta',   'Orta (3 gün)'],
        ['3-4. Hafta','Otomatik günlük DB yedekleme',       'Yüksek', 'Düşük (4 sa)'],
        ['1. Ay',     'Stok modülü (temel)',                'Yüksek', 'Yüksek (5 gün)'],
        ['1. Ay',     'Rezervasyon modülü',                 'Orta',   'Yüksek (4 gün)'],
        ['3. Ay',     'WebSocket gerçek zamanlı',           'Yüksek', 'Yüksek (1 hafta)'],
        ['3. Ay',     'electron-updater otomatik güncell.', 'Orta',   'Orta (3 gün)'],
        ['6+ Ay',     'Mobil garson uygulaması',            'Orta',   'Çok Yüksek (1 ay)'],
      ],
      [1800, 3600, 1600, 1900]
    ),
  ];
}

// ─── DOCUMENT ASSEMBLY ────────────────────────────────────────────────────────
const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        }],
      },
      {
        reference: 'bullets2',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '\u25E6',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 360 } } },
        }],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 40, bold: true, font: 'Arial', color: CLR.white },
        paragraph: {
          spacing: { before: 0, after: 200 },
          outlineLevel: 0,
          shading: { fill: CLR.primary, type: ShadingType.CLEAR },
          indent: { left: 200 },
        },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: CLR.primary },
        paragraph: {
          spacing: { before: 280, after: 100 },
          outlineLevel: 1,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: CLR.accent, space: 4 } },
        },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: CLR.accent },
        paragraph: {
          spacing: { before: 200, after: 80 },
          outlineLevel: 2,
        },
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // ~2cm
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: CLR.accent } },
            spacing: { before: 0, after: 80 },
            children: [
              new TextRun({ text: 'Restoran POS v3  —  Yol Haritası Raporu', font: 'Arial', size: 18, color: CLR.gray }),
              new TextRun({ text: '\t\tNisan 2026', font: 'Arial', size: 18, color: CLR.gray }),
            ],
            tabStops: [{ type: 'right', position: 8800 }],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: CLR.midGray } },
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 0 },
            children: [
              new TextRun({ text: 'Sayfa ', font: 'Arial', size: 18, color: CLR.gray }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: CLR.gray }),
              new TextRun({ text: ' / ', font: 'Arial', size: 18, color: CLR.gray }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: CLR.gray }),
            ],
          }),
        ],
      }),
    },
    children: [
      ...coverPage(),
      ...tocSection(),
      ...section1(),
      ...section2(),
      ...section3(),
      ...section4(),
      ...section5(),
      ...section6(),
      ...section7(),
      ...summaryDashboard(),
    ],
  }],
});

// ─── ÇIKTI ──────────────────────────────────────────────────────────────────
const outPath = path.join(__dirname, '..', 'Restoran-POS-v3-Yol-Haritasi-Raporu.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(outPath, buffer);
  console.log('Rapor oluşturuldu:', outPath);
  console.log('Boyut:', (buffer.length / 1024).toFixed(1), 'KB');
}).catch((err) => {
  console.error('HATA:', err.message);
  process.exit(1);
});
