# 🗺️ RESTORAN POS v3 — ONLINE & MOBİL GEÇİŞ YOL HARİTASI

> **📌 Bu doküman kime:** Claude Code (agentic coding asistanı)
> **📌 Amacı:** Adım adım, bağımlılık sırasına göre, kod düzeyinde uygulanabilir görev listesi
> **📌 Üretim tarihi:** 19 Nisan 2026
> **📌 Hedef:** Masaüstü Electron → Online SaaS → React Native iOS/Android
> **📌 Kullanım senaryosu (Faz 1):** 1 restoran · 1 ana bilgisayar · ~10 mobil kullanıcı

---

## 🔄 CLAUDE.md ile Senkron Notu (2026-04-19)

Aşağıdaki yol haritası maddeleri **CLAUDE.md'de tamamlanmış** olarak görünüyor; faz başlamadan önce **durum haritası** ile doğrulanmalı:

- **C-1 Railway deploy tamam** → Bu roadmap Hetzner VPS'i seçiyor. Railway → Hetzner bilinçli bir pivot olarak kabul ediliyor; C-1 çıktıları (env-driven `HOST`/`PORT`/`USER_DATA_PATH`, `CORS_ORIGINS` split, `apiBaseUrl` öncelik sırası) FAZ 2'de yeniden kullanılacak.
- **C-2 Refresh Token tamam** → FAZ 0/1'in "JWT access 15dk + refresh 30gün ekle" adımı **mobil login için zaten uygulanmış** (`0004_refresh_tokens` migration, `POST /api/auth/refresh`, `POST /api/auth/logout`, `POST /api/auth/logout-all`). Desktop akışı değişmedi — roadmap buna göre okunmalı.
- **DB-3 dual-write (`_cents`) tamam** → FAZ 1 PostgreSQL migration SQL'leri `orders/order_items/payments/refunds/products/product_portions` tablolarındaki `_cents` kolonlarını ve dual-write disiplinini **korumalı**; REAL kolonlar hâlâ geriye dönük okunuyor.
- **DB-1 migration runner, DB-2 audit trail, DB-4 snapshot** tamam → FAZ 1'in migration script'i numbered migration runner'a uyumlu olmalı (`server/migrations/versions/`), `entity_mutations` ve `orders.pricing_policy_version`, `order_items.vat_rate_snapshot` kolonları PG şemasına taşınmalı.
- **D-1 CI (GitHub Actions), D-3 NDJSON logging + request-id** tamam → FAZ 0 Görev 0.6 (Pino) ve Görev 0.9 (CI/CD) kısmen veya tamamen karşılanmış olabilir; durum haritasında netleştirilecek.

> ⚠️ Her faza başlarken **önce durum haritası** üretilecek (tamam / kısmi / yapılacak), ardından gerçek iş kalemlerine inilecek. Bu doküman kararların kaynağıdır; CLAUDE.md ilerleme kaydıdır.

---

## 📑 İÇİNDEKİLER

1. [Yönetici Özeti ve Kritik Kararlar](#1-yönetici-özeti)
2. [Mevcut Durum Analizi (Baseline)](#2-mevcut-durum-analizi)
3. [KRİTİK BLOKLAYICILAR — Online Geçiş Öncesi ZORUNLU](#3-krİtİk-bloklayıcılar)
4. [Online Mimari Kararı (VPS + PostgreSQL)](#4-online-mimari-kararı)
5. [FAZ 0 — Güvenlik & Kararlılık Sertleştirmesi](#faz-0)
6. [FAZ 1 — PostgreSQL Migration](#faz-1)
7. [FAZ 2 — VPS Deploy & SSL](#faz-2)
8. [FAZ 3 — Hibrit Bridge (Restoran → Cloud)](#faz-3)
9. [FAZ 4 — Multi-Device Sertleştirme & Güvenlik](#faz-4)
10. [FAZ 5 — PWA Optimizasyonu (Mobil Browser Hazır)](#faz-5)
11. [FAZ 6 — API Olgunlaştırma (React Native için)](#faz-6)
12. [FAZ 7 — React Native Uygulaması](#faz-7)
13. [FAZ 8 — App Store & Play Store Yayını](#faz-8)
14. [İzleme, Gözlemlenebilirlik ve Olay Müdahalesi](#izleme)
15. [Regresyon Koruma Checklist'i](#regresyon)
16. [Acil Durum Rollback Planı](#rollback)

---

<a id="1-yönetici-özeti"></a>
## 1. YÖNETİCİ ÖZETİ ve KRİTİK KARARLAR

### 1.1 Karar Özeti

| Karar | Seçim | Gerekçe |
|-------|-------|---------|
| **Hosting** | Hetzner CX22 VPS (€4.51/ay, Frankfurt) | Düşük maliyet, tam kontrol, KVKK bölgesi, vendor lock-in yok |
| **Veritabanı** | PostgreSQL 16 | SQLite multi-user/multi-device için yetersiz (WAL dosya kilidi, dosya tabanlı) |
| **Process Manager** | pm2 + pm2-logrotate | Systemd ile reboot'a dayanıklı, zero-downtime reload, log rotate |
| **Reverse Proxy** | Nginx + Let's Encrypt | WebSocket upgrade desteği, gzip, static cache |
| **CDN/DDoS** | Cloudflare (ücretsiz plan) | DDoS koruma, TLS termination fallback, DNS |
| **Yazıcı & CallerID** | Restoranda kalır, cloud'a outbound bağlanır | Windows API bağımlılığı; zaten `store-bridge` bu yapıya uygun |
| **Mobil Faz 1** | PWA (mevcut React'i optimize et) | Hızlı; React Native öncesi validasyon |
| **Mobil Faz 2** | React Native + Expo | iOS + Android tek kod tabanı; zaten plan |
| **Kimlik Doğrulama** | JWT access (15dk) + refresh token (30gün) | Mevcut JWT stateless; refresh ekleyerek oturum süreleri uzar |
| **DB Bağlantı** | `postgres` (porsager) + async/await refactor | `better-sqlite3` senkron; pg zorunlu async → tüm route'ları async'leştir |

### 1.2 Toplam Süre Tahmini

| Faz | Süre (takvim günü) | Kritik mi? |
|-----|--------------------:|:----------:|
| FAZ 0 — Güvenlik sertleştirme | **2-3 gün** | 🔴 ZORUNLU |
| FAZ 1 — PostgreSQL migration | **5-7 gün** | 🔴 ZORUNLU |
| FAZ 2 — VPS deploy | **2 gün** | 🔴 ZORUNLU |
| FAZ 3 — Hibrit bridge | **3-4 gün** | 🟡 Yazıcı kullanılacaksa |
| FAZ 4 — Multi-device sertleştirme | **3 gün** | 🔴 ZORUNLU |
| FAZ 5 — PWA optimizasyon | **3-4 gün** | 🟡 Mobil öncesi faydalı |
| FAZ 6 — API olgunlaştırma | **4-5 gün** | 🔴 RN öncesi zorunlu |
| FAZ 7 — React Native | **20-30 gün** | 🟢 Bağımsız iş |
| FAZ 8 — Store yayını | **7-14 gün** | 🟢 Onay süreleri dahil |
| **TOPLAM (Online'a kadar)** | **~18-23 gün** | |
| **TOPLAM (Mobil dahil)** | **~60-80 gün** | |

### 1.3 En Kritik Uyarı

> **⚠️ ŞU ANDA ONLINE'A GEÇİLEMEZ.** Mevcut proje masaüstü tek kullanıcı senaryosu için production-ready (8.8/10), ancak aşağıdaki **11 kritik madde** çözülmeden 10 eşzamanlı mobil kullanıcıya hizmet veremez. Bunları atlayıp deploy edersen:
> - SQLite dosya kilidi nedeniyle 3+ eşzamanlı yazmada **"database is locked"** hataları başlar
> - JWT secret per-launch üretilirse **her sunucu restart'ta tüm oturumlar kopar**
> - CORS yalnızca localhost ise **farklı cihazlardan erişim engellenir**
> - HTTPS yoksa tarayıcılar Service Worker/Socket.io'ya izin vermez
>
> Detaylar [§3](#3-krİtİk-bloklayıcılar)'te.

### 1.4 Strateji Özeti (Tek Satır)

**Önce güvenliği sertleştir → PostgreSQL'e geç → VPS'ye deploy et → bridge'i restoranda bırak → çoklu cihazı test et → PWA ile mobili yakala → API'yi olgunlaştır → React Native ile native'e geç.**

---

<a id="2-mevcut-durum-analizi"></a>
## 2. MEVCUT DURUM ANALİZİ (BASELINE)

### 2.1 Güçlü Yönler (Korunacak Altyapı)

| Alan | Detay | Neden Kritik |
|------|-------|--------------|
| **Multi-tenant hazır** | Tüm tablolarda `business_id`, `businessScope` middleware | SaaS'a geçiş için temel hazır |
| **JWT + RBAC** | `authenticate`, `authorize(...roles)` katmanı; admin/cashier/waiter/kitchen rolleri | Auth yeniden yazılmayacak |
| **Socket.io gerçek zamanlı** | JWT doğrulamalı, `business:${id}` odaları, `emitToRoom()` | Real-time sertleştirilmiş, ölçeklenebilir |
| **104 otomatik test** | Vitest + Supertest integration | Refactor sırasında regresyon yakalama |
| **Zod validation** | Tüm route'larda input validation | Güvenlik temeli mevcut |
| **Rate limiting** | auth, admin, bridge, printer, waiter-call | DDoS/brute force temel koruması |
| **Audit log** | Tüm kritik işlemler `audit_logs` tablosunda | Denetim gereksinimi karşılıyor |
| **Migration idempotency** | IF NOT EXISTS, fresh + mevcut DB güvenli | PG'ye geçiş için iyi temel |
| **Print job queue** | `print_jobs` tablosu, claim/printed/failed akışı, idempotency_key UNIQUE | Bridge zaten polling/pull mimarisinde → cloud'da sorunsuz |
| **Store Bridge mimarisi** | `X-Bridge-Token` ile `API_BASE` üzerinden bağlanır | **Kritik:** Hibrit moda sıfır kod değişikliği (sadece env) |
| **Daily DB backup** | 02:00, 30 gün retention | Cloud'da pg_dump'a kolayca adapte edilir |

### 2.2 Mevcut Zayıf Yönler (Çözülmesi Gereken)

| Alan | Sorun | Şiddet | Etki Alanı |
|------|-------|:------:|------------|
| **SQLite** | Tek dosya, WAL file lock, multi-writer sınırlı | 🔴 KRİTİK | Çoklu cihaz mümkün değil |
| **JWT secret (Electron)** | `electron/main.cjs` her başlatmada random üretir, `pos-config.json`'a yazar ama sunucu bu logic'e sahip değil | 🔴 KRİTİK | Sunucu restart → tüm oturumlar koparsa UX çöker |
| **CORS** | `config.corsOrigins` env'den okuyor ama default sadece localhost | 🟠 YÜKSEK | LAN/mobil cihazdan erişim engellenir |
| **HTTPS zorunluluğu** | Şu an HTTP, Service Worker/WebSocket tarayıcılar HTTPS ister | 🔴 KRİTİK | PWA, webcam, konum vb. tüm modern API'lar çalışmaz |
| **Refresh token yok** | JWT tek token, 24h expiresIn; mobilde "login her gün" UX kötü | 🟠 YÜKSEK | Mobil kullanıcı deneyimi |
| **Versioning yok** | API'de `/v1/` prefix yok → breaking change riski | 🟡 ORTA | React Native eski client'lar kırılır |
| **API dokümantasyonu yok** | OpenAPI/Swagger yok | 🟡 ORTA | Mobil ekip (veya gelecekte sen) entegrasyonda zorlanır |
| **Structured logging yok** | `console.log` kullanılıyor; cloud'da log aggregator için yetersiz | 🟠 YÜKSEK | Üretim sorun tespiti zor |
| **Error monitoring yok** | Sentry/Rollbar bağlı değil | 🟠 YÜKSEK | Kullanıcı hataları görünmez |
| **Frontend test yok** | CLAUDE.md'de "Frontend test coverage" "v2 roadmap" olarak listelenmiş | 🟡 ORTA | React component değişiklikleri test edilmeden gider |
| **CI/CD yok** | "GitHub Actions — **high priority, prevents packaging bugs**" olarak v2 roadmap'te | 🟠 YÜKSEK | Her deploy manuel + insan hatası |
| **LAN IP uploads** | `uploads/` dizini USER_DATA_PATH'e bağlı; VPS'de farklı olmalı | 🟡 ORTA | Ürün görselleri deploy sırasında kaybolur |
| **WebSocket sticky session** | pm2 cluster mode'da Socket.io sticky session + Redis adapter gerekir; şu an single instance | 🟡 ORTA | Şimdilik single-instance yeterli; scaling sonrası |
| **Şifre politikası** | Seed demo şifreleri `123456`; şifre karmaşıklık kuralı yok | 🟠 YÜKSEK | Üretimde zayıf şifreler |
| **2FA yok** | Admin hesabı sadece şifre | 🟡 ORTA | Yönetici hesabı ele geçirilebilir |
| **Secret management** | `.env` dosyası, vault yok | 🟡 ORTA | VPS'de yeterli, ileride vault gerekebilir |
| **Auto-update (Electron)** | `electron-updater` GitHub Releases'e bağlı ama SaaS'a geçişte update modeli değişir | 🟢 DÜŞÜK | Cloud-first UI olunca önemi azalır |

### 2.3 Proje Dosya Envanteri (Dokunma Sıcaklığı)

```
restoran-pos-v3/
├── client/                    🟢 DOKUNMA — PWA optimizasyonu hariç (FAZ 5)
├── server/
│   ├── config/
│   │   ├── database.js        🔴 DEĞİŞECEK — PG adapter (FAZ 1)
│   │   └── index.js           🟡 env genişleyecek
│   ├── middleware/auth.js     🟡 Refresh token eklenecek (FAZ 6)
│   ├── routes/*.js            🔴 Hepsi async'e dönüştürülecek (FAZ 1)
│   ├── migrations/run.js      🔴 SQL PG uyumluluğu (FAZ 1)
│   ├── socket.js              🟢 DOKUNMA (ileride Redis adapter eklenir)
│   └── index.js               🟡 CORS, trust proxy, /v1 prefix (FAZ 4, 6)
├── electron/main.cjs          🟢 DOKUNMA — masaüstü hâlâ SQLite ile çalışır
├── store-bridge/              🟡 config.js'e API_BASE HTTPS desteği (FAZ 3)
├── tools/callerid-sdk-helper/ 🟡 API_BASE HTTPS (FAZ 3)
├── scripts/                   🟡 pg-backup, deploy, migrate eklenecek
└── package.json               🟡 Yeni bağımlılıklar (pg, pino, sentry...)
```

### 2.4 Veri Akışı (Mevcut)

```
Garson Tarayıcı ──HTTP+WS──► Ana PC (Electron)
                              ├──► Express (3001)
                              │    ├── SQLite (userData/pos.db)
                              │    └── Socket.io
                              └──► Store Bridge (polling)
                                   └──► ESC/POS yazıcı (LAN)
                              └──► CallerID Helper (C# + DLL)

Caller geldi ──► CID donanım ──► CID Helper ──► POST /bridge/caller-id/incoming
```

### 2.5 Hedef Veri Akışı (Online Faz 2 sonrası)

```
Garson Mobil ──HTTPS+WSS──► Cloudflare ──► VPS Nginx ──► Node/Express
                                                         ├── PostgreSQL
                                                         └── Socket.io
                                                              ▲
Ana PC                                                        │
├── Store Bridge ──poll──HTTPS──► /api/bridge/print-jobs ─────┤
└── CallerID Helper ──POST──HTTPS──► /api/bridge/caller-id ───┘
```

---

<a id="3-krİtİk-bloklayıcılar"></a>
## 3. 🔴 KRİTİK BLOKLAYICILAR — Online Geçiş Öncesi ZORUNLU

Bu 11 madde çözülmeden online'a geçmek **veri kaybı, oturum kaybı ve güvenlik açığı** üretir.

### 3.1 🔴 BLOKLAYICI #1 — SQLite → PostgreSQL Migration

**Problem:** SQLite dosya tabanlı, WAL modunda bile tek yazıcı işlem anlık. 10 garson eşzamanlı sipariş kaydederse `SQLITE_BUSY` veya `database is locked` hataları başlar.

**Neden online öncesi:** Mobil garsonların eşzamanlılığı SQLite'ın sınırını zorlar. İlk hafta bile sorun çıkarır.

**Çözüm:** FAZ 1 (detay aşağıda)

**Test kriteri:** Artillery ile 50 concurrent user, 5 dakika, hata oranı < %0.1

---

### 3.2 🔴 BLOKLAYICI #2 — JWT_SECRET Kalıcılığı (Sunucu)

**Problem:** `electron/main.cjs` `pos-config.json`'a secret yazıyor ama `server/config/index.js`'de `.env` olmazsa fallback random üretiyor. VPS deploy'da pm2 restart → yeni random secret → tüm kullanıcılar ve mobil tokenlar geçersiz.

**Neden online öncesi:** Sunucu her deploy veya restart'ta kullanıcıları atma sorunu yaratır, mobilde "oturum süresi doldu" alert'i sürekli gelir.

**Çözüm:**
```bash
# VPS /etc/restoran-pos/.env dosyasına
JWT_SECRET=<openssl rand -hex 64>
```
`server/config/index.js`'de production mode'da `JWT_SECRET` yoksa **uygulamanın başlamamasını** zorla (fail-fast).

**Test kriteri:** `pm2 restart pos-api` sonrası mevcut token hâlâ geçerli (401 dönmüyor).

---

### 3.3 🔴 BLOKLAYICI #3 — HTTPS / SSL

**Problem:** HTTP altında çalışan bir uygulamada:
- Modern tarayıcılar Service Worker'a izin vermez → PWA çalışmaz
- WebSocket bazı corporate ağlarda HTTP'de engellenir
- Login bilgileri düz metin gider (sniffable)
- App Store / Play Store HTTPS olmayan API'yi reddeder (ATS / Network Security Config)

**Neden online öncesi:** Mobil ekip baştan HTTPS bekler, sonra dönüşü zor.

**Çözüm:** Let's Encrypt + Nginx (FAZ 2'de)

**Test kriteri:** SSL Labs skoru **A+** (minimum A)

---

### 3.4 🔴 BLOKLAYICI #4 — CORS Production Ayarı

**Problem:** `config.corsOrigins` env'den okunuyor; boş bırakılırsa varsayılan sadece localhost. Üretimde `https://pos.alanadin.com` gibi origin'lerin eklenmesi gerek.

**Neden online öncesi:** Farklı cihazlardan erişimde CORS hatası → beyaz ekran.

**Çözüm:**
```bash
# .env
CORS_ORIGINS=https://pos.alanadin.com,https://app.alanadin.com
```

**Test kriteri:** Farklı bir origin'den (Postman/curl değil) yapılan `OPTIONS` istek CORS header'larını dönüyor.

---

### 3.5 🔴 BLOKLAYICI #5 — Default Şifrelerin Sıfırlanması

**Problem:** Seed demo şifreleri `123456`. Üretimde bu hesaplar hâlâ aktif. Brute force ile saniyeler içinde kırılır.

**Neden online öncesi:** İnternete açılan bir endpoint'e zayıf şifreli admin ne kadar dayanır?

**Çözüm:**
1. Production seed'i ayrı tut: `server/seeds/production.js` — sadece admin kullanıcı, rastgele 16 karakter şifre terminalde göster
2. İlk login'de zorunlu şifre değiştirme ekranı
3. Şifre politikası: minimum 8 karakter, 1 büyük, 1 rakam
4. `bcrypt` rounds'u 10 → 12'ye çıkar (production'da CPU gücü var)

**Test kriteri:** `123456` ile login başarısız, şifre policy violated hatası.

---

### 3.6 🔴 BLOKLAYICI #6 — Rate Limiting Sertleştirme

**Problem:** Mevcut rate limiter'lar IP bazlı ve görece liberal:
- `/api/auth` limiter var (iyi)
- Ama `/api/orders`, `/api/products` vb. ana endpoint'lerde yok
- Anonim /api/health gibi endpoint'ler korumasız → DDoS amplify

**Neden online öncesi:** Internet'e açık her servis hedef olur.

**Çözüm:** FAZ 0'da detaylı, özet:
```js
// Global limiter: 300 req/dk/IP
// Per-endpoint heavy limiter: /auth (10/dk), /payments (20/dk)
// Trust proxy: Cloudflare/Nginx arkasında doğru IP okuması
app.set('trust proxy', 1);
```

**Test kriteri:** `ab -n 1000 -c 50` ile saldırı simulate, 429 dönüyor.

---

### 3.7 🔴 BLOKLAYICI #7 — `trust proxy` Ayarı

**Problem:** Nginx/Cloudflare arkasında `req.ip` hep `127.0.0.1` veya Cloudflare IP'si çıkar. Rate limit ve audit log yanlış IP kaydeder.

**Neden online öncesi:** Güvenlik denetimi ve ban listeleri bozulur.

**Çözüm:**
```js
// server/index.js
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1); // Cloudflare için: 'cloudflare' veya özel liste
}
```

**Test kriteri:** Mobil cihazdan istek → audit_log'da gerçek IP görünüyor.

---

### 3.8 🔴 BLOKLAYICI #8 — Secret Management ve .env Güvenliği

**Problem:** `.env` dosyası git'te olmamalı; yanlışlıkla commit edilirse JWT secret ifşa olur. `BRIDGE_TOKEN` log'larda maskelenmeli.

**Neden online öncesi:** Git geçmişinden secret sızması çok yaygın saldırı vektörü.

**Çözüm:**
1. `.gitignore` doğrulama: `.env`, `.env.*`, `pos-config.json` → dahil
2. `git log --all --full-history -- .env` → hiç commit olmadığını doğrula
3. VPS'de `.env` izinleri `chmod 600`
4. Log sanitizer: tüm `BRIDGE_TOKEN`, `JWT_SECRET`, `password` alanları `***` olarak yazılsın
5. Secret rotation prosedürü dokümante et

**Test kriteri:** `grep -r "sk-\|secret\|token" logs/` → sadece `***` görülür.

---

### 3.9 🔴 BLOKLAYICI #9 — Structured Logging + Error Monitoring

**Problem:** `console.log` kullanılıyor. Production'da "neden patladı" sorusuna cevap vermek imkansız.

**Neden online öncesi:** Uzaktaki bir sorunu olduğunu bile fark edemezsin.

**Çözüm:**
1. **Pino** (veya Winston) structured JSON log
2. **Sentry** (ücretsiz plan 5k event/ay yeterli) frontend + backend error tracking
3. **UptimeRobot** (ücretsiz, 5dk aralık) `/api/health` ping
4. pm2 log rotate + günlük arşiv

**Test kriteri:** Bilerek bir hata üret → Sentry'de 30 sn içinde görünüyor.

---

### 3.10 🔴 BLOKLAYICI #10 — Backup Stratejisi

**Problem:** Mevcut günlük backup Electron userData'daki dosyaya. Cloud'da `pg_dump` + offsite kopya gerekir.

**Neden online öncesi:** Sunucu disk arızası, ransomware, silme hatası → tüm veri gider.

**Çözüm:**
1. Cron: Her gün 02:00'de `pg_dump` → `/var/backups/pos/`
2. `rclone` ile Backblaze B2 veya Wasabi'ye sync (bir tık S3-uyumlu, $5/TB/ay)
3. Haftada bir restore testi (farklı veritabanına)
4. 30 gün retention + 12 ay haftalık snapshot

**Test kriteri:** Canlı DB'yi sil (staging'de), son backup'tan 15 dk içinde restore.

---

### 3.11 🔴 BLOKLAYICI #11 — Dosya Yüklemeleri Kalıcılığı

**Problem:** Ürün görselleri `server/uploads/products/` veya `userData/uploads/`. VPS deploy'da code overwrite → `uploads/` silinebilir.

**Neden online öncesi:** Her deploy'da ürün görselleri kaybolur.

**Çözüm:**
1. Uploads dizinini `/var/restoran-pos/uploads` gibi **kod dışı** path'e taşı
2. Nginx'ten doğrudan serve (Express'ten geçmeden hızlı)
3. Backup stratejisine uploads dizini dahil
4. İleride (SaaS olursa) S3/Backblaze + CDN (Cloudflare) düşün

**Test kriteri:** Deploy sonrası `/uploads/products/<id>.jpg` URL'i hâlâ çalışıyor.

---

### 3.12 Ekstra Uyarılar (Bloklayıcı değil ama dikkat)

| # | Konu | Aksiyon | Yapılmazsa |
|---|------|---------|------------|
| 12 | **Socket.io sticky session** | pm2 cluster mode kullanılırsa Redis adapter zorunlu | Tek instance'ta sorun yok; scaling'de WebSocket drop |
| 13 | **Timezone** | `config.storeTimezone = 'Europe/Istanbul'` doğrula; sunucu UTC olmalı | Günlük rapor tarihleri kayabilir |
| 14 | **DB connection pool** | pg pool size: min 2, max 20 | Peak saatte "too many connections" |
| 15 | **Node.js sürüm sabitleme** | `.nvmrc` + `engines` field + pm2 restart protokolü | Ubuntu paket güncellemesi sürpriz breaking |
| 16 | **better-sqlite3 masaüstü geri uyum** | `DB_DRIVER=sqlite` modu korunsun, Electron pkg bozulmasın | Masaüstü müşteri kullanıcıları etkilenir |

---

<a id="4-online-mimari-kararı"></a>
## 4. ONLINE MİMARİ KARARI

### 4.1 Önerilen Mimari Diyagramı

```
                    [Garson Mobil x10]      [Admin Laptop]
                           │                      │
                           ▼                      ▼
                    ┌─────────────────────────────────┐
                    │   Cloudflare (DNS, DDoS, TLS)   │
                    └──────────────┬──────────────────┘
                                   │ HTTPS/WSS
                    ┌──────────────▼──────────────────┐
                    │   Hetzner CX22 VPS              │
                    │   Frankfurt (€4.51/ay)           │
                    │                                 │
                    │   ┌───────────────────────┐     │
                    │   │ Nginx (80/443)         │     │
                    │   │ - SSL termination      │     │
                    │   │ - WebSocket upgrade    │     │
                    │   │ - Static: /uploads, UI │     │
                    │   └──────────┬────────────┘     │
                    │              │                  │
                    │   ┌──────────▼────────────┐     │
                    │   │ pm2: pos-api          │     │
                    │   │ Node 20 + Express     │     │
                    │   │ Socket.io             │     │
                    │   └──────────┬────────────┘     │
                    │              │                  │
                    │   ┌──────────▼────────────┐     │
                    │   │ PostgreSQL 16         │     │
                    │   │ + pg_dump → B2        │     │
                    │   └───────────────────────┘     │
                    └─────────────▲───────────────────┘
                                  │ HTTPS poll + POST
                ┌─────────────────┴──────────────┐
                │   Restoran Ana PC (Windows)    │
                │   - Store Bridge (outbound)    │
                │   - CallerID Helper (C#)       │
                │   - Yazıcılar (LAN)            │
                └────────────────────────────────┘
```

### 4.2 VPS Spec Gerekçesi

**Hetzner CX22** (€4.51/ay + KDV):
- 2 vCPU, 4 GB RAM, 40 GB SSD, 20 TB traffic
- 1 restoran + 10 kullanıcı + Node + Postgres + Nginx → yeterli, CPU rahat
- **Frankfurt bölgesi** Türkiye'ye en yakın düşük latans (~40-60 ms)
- Alternatif: DigitalOcean Basic Droplet $6/ay (benzer spec, benzer konum)

**Neden Hetzner > DigitalOcean:**
- ~%30 daha ucuz
- Trafik limiti 20 TB (DO: 1 TB)
- Frankfurt TR latansı daha iyi

**Neden BaaS (Supabase/Firebase) değil:**
- Mevcut Express + JWT auth yeniden yazılacak → 2-3 hafta ek iş
- Supabase Postgres limiti ücretsiz tier'da 500 MB, pro $25/ay
- WebSocket limiti ücretsiz tier'da 200 concurrent → 10 kullanıcı için aşırı ama vendor lock
- Multi-tenant yapını parçalamak yerine tek tenant'ta kalıp sonra tarzı bağımsız scale'le

**Neden AWS/GCP değil:**
- Bu senaryoya overkill
- Hidden cost'lar (data egress, load balancer, NAT gateway) $30+/ay
- Öğrenme eğrisi ve yönetim karmaşıklığı

### 4.3 Maliyet Tablosu (Aylık)

| Kalem | Maliyet |
|-------|---------|
| Hetzner CX22 | €4.51 (~$5) |
| Domain (.com) | $12/yıl = ~$1 |
| Cloudflare | $0 (free plan yeterli) |
| Backblaze B2 backup | ~$0.50 (100 GB) |
| UptimeRobot | $0 (free 50 monitor) |
| Sentry | $0 (free 5k event/ay) |
| Let's Encrypt SSL | $0 |
| **TOPLAM** | **~$7/ay** |

Mobil store maliyetleri ayrı (FAZ 8):
- Apple Developer: $99/yıl
- Google Play: $25 tek seferlik

---

<a id="faz-0"></a>
## 5. FAZ 0 — GÜVENLİK & KARARLILIK SERTLEŞTİRMESİ

> **🎯 Hedef:** Mevcut kodu online'a hazır hale getir. Hiçbir feature ekleme, sadece sertleştir.
> **⏱️ Süre:** 2-3 iş günü
> **🔗 Bağımlılık:** Yok (başlangıç noktası)
> **🚫 Bloklar:** Sonraki tüm fazlar

### 5.1 Görev 0.1 — JWT_SECRET Fail-Fast

**Dosya:** `server/config/index.js`

**Şu an:**
```js
jwt: {
  secret: process.env.JWT_SECRET || 'DEFAULT_DEV_SECRET',
  expiresIn: '24h',
}
```

**Olması gereken:**
```js
// Production'da JWT_SECRET zorunlu; yoksa başlama
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('[FATAL] JWT_SECRET environment variable is required in production');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET must be at least 32 characters');
  process.exit(1);
}

jwt: {
  secret: process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex'),
  expiresIn: process.env.JWT_EXPIRES_IN || '24h',
}
```

**Test:** `NODE_ENV=production node server/index.js` → exit code 1, JWT_SECRET olmadan.

### 5.2 Görev 0.2 — CORS Production Whitelist

**Dosya:** `server/index.js`, `server/socket.js`

**Şu an:** `config.corsOrigins` var ama env'den gelmezse localhost default.

**Olması gereken:**
```js
// server/config/index.js
corsOrigins: (process.env.CORS_ORIGINS || '').split(',').filter(Boolean),

// server/index.js
const allowedOrigins = config.nodeEnv === 'production'
  ? config.corsOrigins  // sadece explicit whitelist
  : [...config.corsOrigins, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^http:\/\/192\.168\.\d+\.\d+:\d+$/];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // mobile app, curl
    const allowed = allowedOrigins.some(o => typeof o === 'string' ? o === origin : o.test(origin));
    cb(allowed ? null : new Error('CORS: origin not allowed'), allowed);
  },
  credentials: true,
}));
```

**Test:** `curl -H "Origin: https://evil.com" ...` → CORS hatası.

### 5.3 Görev 0.3 — Trust Proxy + Real IP

**Dosya:** `server/index.js`

**Ekle:**
```js
if (config.nodeEnv === 'production') {
  // 1 = reverse proxy önünde tek hop (Nginx)
  // Cloudflare + Nginx için sayı 2 veya trust list
  app.set('trust proxy', 1);
}
```

**Test:** Production'da `req.ip` gerçek client IP'yi gösteriyor.

### 5.4 Görev 0.4 — Global Rate Limit + helmet + compression

**Dosya:** `server/index.js`

```js
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

// Güvenlik header'ları
app.use(helmet({
  contentSecurityPolicy: false, // SPA için custom CSP
  crossOriginEmbedderPolicy: false,
}));

// Gzip
app.use(compression());

// Global rate limiter — 300 req/dk/IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
});
app.use('/api', globalLimiter);

// Mevcut daha sıkı limiter'lar (auth, admin) değişmeden kalır
```

Bağımlılık ekle:
```bash
npm install --prefix server helmet compression
```

**Test:** 301 eşzamanlı istek → 429.

### 5.5 Görev 0.5 — Şifre Politikası + İlk Login Zorunlu Değiştirme

**Dosyalar:** `server/routes/auth.js`, `server/routes/admin.js`, yeni `server/utils/password.js`

```js
// server/utils/password.js
export function validatePassword(pw) {
  if (!pw || pw.length < 8) return 'Şifre en az 8 karakter olmalı';
  if (!/[A-Z]/.test(pw)) return 'Büyük harf içermeli';
  if (!/[0-9]/.test(pw)) return 'Rakam içermeli';
  return null;
}
```

Users tablosuna:
```sql
ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;
```

Login akışı: `must_change_password = 1` ise 403 + özel response ile frontend'i yönlendir.

**Test:** `123456` ile yeni user oluşturma → 400.

### 5.6 Görev 0.6 — Pino Structured Logging

**Bağımlılık:**
```bash
npm install --prefix server pino pino-http pino-pretty
```

**Dosya:** `server/index.js`

```js
import pino from 'pino';
import pinoHttp from 'pino-http';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['req.headers.authorization', 'req.headers["x-bridge-token"]', '*.password', '*.token'],
  transport: config.nodeEnv === 'development' 
    ? { target: 'pino-pretty', options: { colorize: true } } 
    : undefined,
});

app.use(pinoHttp({ logger }));

// Artık: req.log.info('...')
// Tüm console.log'ları logger.info / logger.error'e çevir (kademeli)
```

**Test:** Log dosyasında `authorization: "***"` görüyor musun?

### 5.7 Görev 0.7 — Sentry (Backend + Frontend)

**Bağımlılıklar:**
```bash
npm install --prefix server @sentry/node
npm install --prefix client @sentry/react
```

**Backend:** `server/index.js` başına
```js
import * as Sentry from '@sentry/node';
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 });
  app.use(Sentry.Handlers.requestHandler());
  // ... routes ...
  app.use(Sentry.Handlers.errorHandler());
}
```

**Frontend:** `client/src/main.jsx`
```js
import * as Sentry from '@sentry/react';
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN });
}
```

**Test:** Bilerek `throw new Error('test-sentry')` → Sentry dashboard'da görünüyor.

### 5.8 Görev 0.8 — Secrets ve .gitignore Audit

```bash
# Zorunlu kontroller
git log --all --full-history -- .env
git log --all --full-history -- pos-config.json
git log --all --full-history -- server/.env
# Hiçbiri bir şey döndürmemeli

# .gitignore'a ekle (zaten var ama teyit)
echo ".env
.env.*
!.env.example
pos-config.json
pos-config.local.json
server/.env
scripts/local-env.bat
/logs
/data
/uploads" >> .gitignore
```

Hassas verilerin git geçmişinde olmadığını doğrula. Varsa `git filter-repo` ile temizle.

### 5.9 Görev 0.9 — CI/CD (GitHub Actions)

**Dosya:** `.github/workflows/ci.yml`

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: test
        options: --health-cmd pg_isready --health-interval 10s
        ports: [5432:5432]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm ci --prefix server
      - run: npm ci --prefix client
      - run: npm test --prefix server
      - run: npm run build --prefix client
```

**Test:** Push → Actions yeşil.

### 5.10 FAZ 0 Kabul Kriterleri

- [ ] Production modda JWT_SECRET yoksa process exit 1
- [ ] CORS whitelist çalışıyor, unknown origin 403
- [ ] `trust proxy` aktif; audit_log'da gerçek IP
- [ ] Helmet + compression aktif, global rate limit çalışıyor
- [ ] Pino structured log, token/password otomatik redact
- [ ] Sentry backend + frontend bağlı, test error görünüyor
- [ ] Hassas dosyalar git'te yok (`.env`, `pos-config.json`)
- [ ] Şifre policy validator mevcut, demo `123456` yeni kullanıcıda reddediliyor
- [ ] GitHub Actions CI yeşil (test + build)
- [ ] **Tüm 104 test hâlâ geçiyor**

---

<a id="faz-1"></a>
## 6. FAZ 1 — POSTGRESQL MIGRATION

> **🎯 Hedef:** SQLite → PostgreSQL. Masaüstü Electron SQLite'la çalışmaya devam etsin (geri uyum), cloud PostgreSQL kullansın.
> **⏱️ Süre:** 5-7 iş günü
> **🔗 Bağımlılık:** FAZ 0
> **🚫 Bloklar:** FAZ 2, 3, 4 (VPS deploy PG gerektirir)

### 6.1 Stratejik Karar: Dual-DB Adapter

İki seçenek var, Seçenek B önerilir:

**Seçenek A:** Tüm `better-sqlite3`'ü PostgreSQL'e değiştir. Electron de PG kullanır.
- ❌ Mevcut müşterilerin masaüstü setup'ı zorlaşır (PG kurulum)
- ❌ Electron'un "tek exe, tek tık" avantajı kaybolur
- ✅ Kod tabanı tek

**Seçenek B (ÖNERİLEN):** `DB_DRIVER` env switch. Masaüstü SQLite, cloud PostgreSQL.
- ✅ Masaüstü müşteriler etkilenmez
- ✅ Geriye dönük uyum
- ⚠️ İki adapter'ı paralel tutmak ek iş
- **Kritik:** `better-sqlite3` senkron, `pg` async → tüm route'lar async olmalı

### 6.2 Görev 1.1 — Async Route Refactor (ÖNCE!)

> **⚠️ UYARI:** Bu FAZ 1'in en büyük ve en kritik kısmı. Sıralama önemli — ASYNC REFACTOR ÖNCE, sonra PG adapter.

Mevcut kod:
```js
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  res.json(row);
});
```

Hedef:
```js
router.get('/:id', async (req, res, next) => {
  try {
    const row = await db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    res.json(row);
  } catch (err) { next(err); }
});
```

**Adım sırası:**
1. **Tüm route handler'ları async + try/catch'e dönüştür** (handler başına uzun iş, ~30 dosya)
2. Global error handler ekle:
   ```js
   app.use((err, req, res, next) => {
     req.log?.error({ err }, 'Unhandled route error');
     res.status(500).json({ error: 'Sunucu hatası' });
   });
   ```
3. Mevcut `db.prepare().run/get/all` çağrıları — adapter tarafı adapte olacak

### 6.3 Görev 1.2 — DB Adapter

**Yeni dosya:** `server/config/db-adapter.js`

```js
// İki adapter — aynı arayüz, sync-benzeri Promise döner
// Hedef: routes dosyaları minimum değişikle çalışsın

export function createSqliteAdapter(dbPath) {
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run: async (...args) => stmt.run(...args),
        get: async (...args) => stmt.get(...args),
        all: async (...args) => stmt.all(...args),
      };
    },
    exec: async (sql) => db.exec(sql),
    transaction(fn) {
      const tx = db.transaction(fn);
      return async (...args) => tx(...args);
    },
    close: async () => db.close(),
  };
}

export function createPgAdapter(connString) {
  const postgres = require('postgres');
  const sql = postgres(connString, { max: 20, idle_timeout: 20 });

  return {
    prepare(query) {
      // SQLite '?' placeholder → PostgreSQL $1, $2, ...
      const pgQuery = query.replace(/\?/g, (_, i) => `$${++i}`);
      // Not: stateful increment için closure kullan
      let idx = 0;
      const pq = query.replace(/\?/g, () => `$${++idx}`);
      return {
        run: async (...args) => {
          const result = await sql.unsafe(pq, args);
          return { changes: result.count, lastInsertRowid: null };
        },
        get: async (...args) => {
          const rows = await sql.unsafe(pq, args);
          return rows[0] || null;
        },
        all: async (...args) => sql.unsafe(pq, args),
      };
    },
    exec: async (query) => sql.unsafe(query),
    transaction(fn) {
      return async (...args) => sql.begin(async (tx) => fn(tx, ...args));
    },
    close: async () => sql.end(),
  };
}
```

**Değişecek:** `server/config/database.js`
```js
import { createSqliteAdapter, createPgAdapter } from './db-adapter.js';
import config from './index.js';

const driver = process.env.DB_DRIVER || 'sqlite';
const db = driver === 'postgres' 
  ? createPgAdapter(process.env.DATABASE_URL)
  : createSqliteAdapter(config.dbPath);

export default db;
```

### 6.4 Görev 1.3 — SQL Uyumluluk Taraması

Farklı SQL dialect elemanları (grep ile bul, tek tek düzelt):

| SQLite | PostgreSQL | Kaç yerde? |
|--------|------------|------------|
| `datetime('now')` | `NOW()` veya `CURRENT_TIMESTAMP` | ~50+ yer |
| `INTEGER DEFAULT 1` (bool) | `BOOLEAN DEFAULT true` | ~20 yer |
| `AUTOINCREMENT` | `SERIAL` | Kullanılmıyor (UUID kullanılıyor) iyi |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` | ~5 yer |
| `INSERT OR REPLACE` | `INSERT ... ON CONFLICT ... DO UPDATE` | ~3 yer |
| `REAL` | `DOUBLE PRECISION` veya `NUMERIC(10,2)` | ~30 yer (para için NUMERIC) |
| `TEXT` | `TEXT` (uyumlu) | OK |
| `PRAGMA foreign_keys = ON` | Default açık | Kaldır |
| `PRAGMA journal_mode = WAL` | N/A | Kaldır |
| `json_extract(...)` | `->` ve `->>` operatörleri | Az yer |
| `LIKE` (case-sensitive) | `ILIKE` (case-insensitive) | Arama sorgularında |
| `strftime()` | `TO_CHAR()` | Raporlarda kullanılabilir |

**Otomatik tarama script'i:**
```bash
# server/ içinde
grep -rn "datetime('now')" --include="*.js"
grep -rn "INSERT OR IGNORE" --include="*.js"
grep -rn "INSERT OR REPLACE" --include="*.js"
grep -rn "json_extract" --include="*.js"
```

**Yaklaşım:** Migration ve route'ları ayrı ayrı temizle. Utility helper yaz:
```js
// server/utils/sqlDialect.js
export const NOW = () => process.env.DB_DRIVER === 'postgres' ? 'NOW()' : "datetime('now')";
```

### 6.5 Görev 1.4 — PostgreSQL Migration SQL'leri

`server/migrations/run.js`'i hem SQLite hem PG'ye uyumlu hale getir. Kritik noktalar:

```sql
-- Her iki DB'de çalışan güvenli sürüm
CREATE TABLE IF NOT EXISTS businesses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- ...
  is_active INTEGER DEFAULT 1,  -- SQLite uyumlu; PG'de de çalışır
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- Her iki DB'de çalışır
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- İndex syntax'ı her iki DB'de de IF NOT EXISTS ile aynı
CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id);
```

**Dikkat:** PG'de `TIMESTAMP` ≠ `TIMESTAMPTZ`. Timezone-aware olmak için `TIMESTAMPTZ` kullan. Bu bir SQL değişikliği gerektirir — tüm `TIMESTAMP` kolonlarını PG için `TIMESTAMPTZ`'e çevir.

### 6.6 Görev 1.5 — Veri Migration Script'i

**Yeni dosya:** `scripts/migrate-sqlite-to-pg.js`

```js
/**
 * Kullanım:
 *   node scripts/migrate-sqlite-to-pg.js \
 *     --sqlite /path/to/pos.db \
 *     --postgres "postgresql://user:pass@host/db"
 */
import Database from 'better-sqlite3';
import postgres from 'postgres';

const TABLES_IN_ORDER = [
  'businesses', 'branches', 'roles', 'users',
  'dining_areas', 'tables', 'categories', 'products',
  'product_portions', 'product_modifiers', 'product_combos',
  'customers', 'customer_phones', 'customer_addresses',
  'orders', 'order_items', 'payments', 'payment_allocations',
  'printers', 'print_jobs', 'printer_routing',
  'audit_logs', 'call_logs', 'incoming_calls', 'settings',
  'reservations', 'stock_items', 'stock_movements',
  'waiter_calls',
];

const src = new Database(args.sqlite, { readonly: true });
const dst = postgres(args.postgres);

for (const table of TABLES_IN_ORDER) {
  const rows = src.prepare(`SELECT * FROM ${table}`).all();
  if (!rows.length) continue;
  
  const cols = Object.keys(rows[0]);
  await dst`INSERT INTO ${dst(table)} ${dst(rows, cols)}`;
  console.log(`✓ ${table}: ${rows.length} satır`);
}

src.close();
await dst.end();
```

**Kritik:** Foreign key sırasına dikkat; parent önce, child sonra.

### 6.7 Görev 1.6 — Test Sürümü PostgreSQL

Supertest testleri:
```js
// server/tests/integration/helpers.js
// Mevcut: createTestDb() → SQLite in-memory
// Ekle: DB_DRIVER=postgres ise testcontainers veya pg-mem
import { newDb } from 'pg-mem';

export function createTestDb() {
  if (process.env.TEST_DB === 'postgres') {
    const db = newDb();
    const pg = db.adapters.createPg();
    // ... migration uygula ...
    return pg;
  }
  // ... mevcut SQLite kodu
}
```

CI'da **hem SQLite hem PG** modunda test çalıştır.

### 6.8 Görev 1.7 — Transaction Wrapper

Mevcut sipariş/ödeme route'ları:
```js
// Öncesi (SQLite, senkron)
const tx = db.transaction(() => {
  db.prepare('INSERT INTO orders ...').run(...);
  db.prepare('INSERT INTO order_items ...').run(...);
});
tx();
```

Sonrası (adapter üzerinden):
```js
await db.transaction(async (tx) => {
  await tx.prepare('INSERT INTO orders ...').run(...);
  await tx.prepare('INSERT INTO order_items ...').run(...);
})();
```

**Etkilenen dosyalar:**
- `routes/orders.js` — create, addItems, update
- `routes/payments.js` — split payment
- `routes/customers.js` — import (batch insert)
- `routes/stock.js` — movement
- `routes/printer.js` (veya wherever print_jobs yazılıyor)

### 6.9 FAZ 1 Kabul Kriterleri

- [ ] `DB_DRIVER=sqlite npm run dev` çalışıyor (masaüstü geri uyum)
- [ ] `DB_DRIVER=postgres DATABASE_URL=... npm run dev` çalışıyor
- [ ] Migration script mevcut SQLite veritabanını kayıpsız PG'ye taşıyor
- [ ] 104 test hem SQLite hem PG modunda geçiyor
- [ ] Sipariş → ödeme akışı her iki modda da atomik
- [ ] CI'da PostgreSQL service'i var, testler yeşil
- [ ] Masaüstü Electron build çalışıyor (regresyon yok)
- [ ] Load test: 50 concurrent user, 5 dk → hata oranı < %0.1 (PG modunda)

---

<a id="faz-2"></a>
## 7. FAZ 2 — VPS DEPLOY & SSL

> **🎯 Hedef:** Browser üzerinden online erişilebilir POS.
> **⏱️ Süre:** 2 iş günü
> **🔗 Bağımlılık:** FAZ 1 (PG çalışıyor)
> **🚫 Bloklar:** FAZ 3 (Bridge deploy sonrası bağlanır)

### 7.1 Görev 2.1 — VPS Satın Alma + Temel Sertleştirme

```bash
# Hetzner Cloud Console'da CX22 oluştur
# Ubuntu 22.04 LTS, Frankfurt
# SSH key ekle (yeni ed25519 oluştur: ssh-keygen -t ed25519)
```

**İlk bağlantı:**
```bash
ssh root@<ip>

# Yeni user
adduser pos
usermod -aG sudo pos
rsync --archive --chown=pos:pos ~/.ssh /home/pos

# SSH sertleştirme
nano /etc/ssh/sshd_config
# PermitRootLogin no
# PasswordAuthentication no
# PubkeyAuthentication yes
systemctl restart sshd

# Firewall
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# fail2ban
apt install fail2ban
systemctl enable --now fail2ban

# Unattended upgrades
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### 7.2 Görev 2.2 — Node 20 + PostgreSQL + Nginx

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# PostgreSQL 16
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
apt update && apt install -y postgresql-16

# PG user + DB
sudo -u postgres psql
CREATE USER posapp WITH ENCRYPTED PASSWORD 'GÜÇLÜ_ŞİFRE_BURAYA';
CREATE DATABASE restoran_pos OWNER posapp;
\q

# Güvenlik: sadece localhost'tan
nano /etc/postgresql/16/main/pg_hba.conf
# local   all   posapp   scram-sha-256
systemctl restart postgresql

# Nginx
apt install -y nginx
systemctl enable --now nginx
```

### 7.3 Görev 2.3 — Proje Deploy

```bash
# Kod
cd /var/www
git clone https://github.com/<kullanıcı>/restoran-pos.git
chown -R pos:pos restoran-pos
cd restoran-pos

# Bağımlılıklar
npm ci
npm ci --prefix server
npm ci --prefix client
npm run build --prefix client

# Uploads dizini - persistent
mkdir -p /var/restoran-pos/uploads/products
chown -R pos:pos /var/restoran-pos
ln -s /var/restoran-pos/uploads server/uploads

# .env production
cat > /etc/restoran-pos/.env << 'EOF'
NODE_ENV=production
PORT=3001
DB_DRIVER=postgres
DATABASE_URL=postgresql://posapp:ŞİFRE@localhost:5432/restoran_pos
JWT_SECRET=$(openssl rand -hex 64)
CORS_ORIGINS=https://pos.alanadin.com
STORE_TIMEZONE=Europe/Istanbul
LOG_LEVEL=info
SENTRY_DSN=<opsiyonel>
CLIENT_DIST_PATH=/var/www/restoran-pos/client/dist
UPLOADS_PATH=/var/restoran-pos/uploads
BRIDGE_TOKEN=$(openssl rand -hex 48)
EOF
chmod 600 /etc/restoran-pos/.env
chown pos:pos /etc/restoran-pos/.env

# Migration
cd /var/www/restoran-pos
sudo -u pos -E bash -c 'set -a; source /etc/restoran-pos/.env; set +a; npm run db:migrate'

# Seed (sadece minimum: bir admin kullanıcı)
# production-seed.js: rastgele şifre üretip ekrana yazar
```

### 7.4 Görev 2.4 — pm2 Setup

```bash
npm install -g pm2

# ecosystem.config.cjs (proje kökünde)
cat > /var/www/restoran-pos/ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'pos-api',
    script: 'server/index.js',
    instances: 1,  // Socket.io için şimdilik single; ileride cluster + Redis adapter
    exec_mode: 'fork',
    env_file: '/etc/restoran-pos/.env',
    max_memory_restart: '500M',
    error_file: '/var/log/pos/error.log',
    out_file: '/var/log/pos/out.log',
    merge_logs: true,
    time: true,
  }]
};
EOF

mkdir -p /var/log/pos
chown pos:pos /var/log/pos

# Başlat
sudo -u pos pm2 start ecosystem.config.cjs
sudo -u pos pm2 save
pm2 startup  # systemd entegrasyonu, çıktıdaki komutu çalıştır

# Log rotate
sudo -u pos pm2 install pm2-logrotate
sudo -u pos pm2 set pm2-logrotate:max_size 50M
sudo -u pos pm2 set pm2-logrotate:retain 14
```

### 7.5 Görev 2.5 — Nginx Config

```nginx
# /etc/nginx/sites-available/pos
server {
    listen 80;
    server_name pos.alanadin.com;
    # Let's Encrypt için ACME challenge
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name pos.alanadin.com;

    ssl_certificate /etc/letsencrypt/live/pos.alanadin.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pos.alanadin.com/privkey.pem;

    # SSL sertleştirme
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    # Gzip
    gzip on;
    gzip_types text/css application/javascript application/json;
    gzip_min_length 1024;

    # Upload limit (ürün görseli)
    client_max_body_size 10M;

    # Static uploads
    location /uploads/ {
        alias /var/restoran-pos/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # WebSocket + API (Socket.io same origin)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;  # WebSocket uzun bağlantı
    }
}
```

```bash
ln -s /etc/nginx/sites-available/pos /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 7.6 Görev 2.6 — SSL (Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d pos.alanadin.com --email senin@mailin.com --agree-tos --redirect

# Otomatik yenileme testi
certbot renew --dry-run
# cron zaten default kurulumla aktif
```

### 7.7 Görev 2.7 — DB Backup Scripti

```bash
# /opt/pos-backup.sh
cat > /opt/pos-backup.sh << 'EOF'
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d_%H%M%S)
DIR=/var/backups/pos
mkdir -p $DIR
source /etc/restoran-pos/.env
pg_dump "$DATABASE_URL" | gzip > "$DIR/pos_$TS.sql.gz"

# Uploads tar
tar -czf "$DIR/uploads_$TS.tar.gz" -C /var/restoran-pos uploads

# 30 günden eski sil
find $DIR -type f -mtime +30 -delete

# Backblaze B2 (rclone önce konfigüre edilmeli)
rclone copy "$DIR/pos_$TS.sql.gz" b2:pos-backups/
rclone copy "$DIR/uploads_$TS.tar.gz" b2:pos-backups/
EOF
chmod +x /opt/pos-backup.sh

# Cron: her gün 02:00
(crontab -l; echo "0 2 * * * /opt/pos-backup.sh >> /var/log/pos/backup.log 2>&1") | crontab -
```

### 7.8 Görev 2.8 — Monitoring

```bash
# UptimeRobot'a kaydol (ücretsiz), HTTPS monitor ekle:
# URL: https://pos.alanadin.com/api/health
# Interval: 5 dakika
# Alert: e-mail + (opsiyonel) Telegram

# Cloudflare kurulumu (önerilen):
# 1. alanadin.com DNS'i Cloudflare'e taşı
# 2. A record: pos → VPS IP (proxy DNS: gri bulut = sadece DNS, önerilen başlangıçta)
# 3. SSL/TLS: Full (strict) — Nginx'teki Let's Encrypt sertifikası kullanılıyor
```

### 7.9 FAZ 2 Kabul Kriterleri

- [ ] `https://pos.alanadin.com` çalışıyor
- [ ] SSL Labs A veya A+
- [ ] Login çalışıyor, admin'e giriş yapılabiliyor
- [ ] Sipariş oluşturma → Socket.io event → başka browser tab'de anlık güncelleme
- [ ] pm2 `systemctl reboot` sonrası otomatik başlıyor
- [ ] Günlük backup script çalışıyor, B2'de dosya görülüyor
- [ ] UptimeRobot 200 dönüyor
- [ ] `pg_stat_activity` ile DB bağlantıları makul (< 20)
- [ ] Load test: 50 concurrent / 5 dk → hata oranı < %0.1

---

<a id="faz-3"></a>
## 8. FAZ 3 — HİBRİT BRİDGE (RESTORAN → CLOUD)

> **🎯 Hedef:** Yazıcı ve CallerID restoran bilgisayarında, cloud API'ye outbound bağlanır.
> **⏱️ Süre:** 3-4 iş günü
> **🔗 Bağımlılık:** FAZ 2 (cloud API HTTPS hazır)
> **📝 Not:** `store-bridge` ve `callerid-helper` **ZATEN** `API_BASE + X-Bridge-Token` mimarisiyle yazılmış. Çok az kod değişikliği yeterli.

### 8.1 Mimari

```
┌─────────── Restoran Bilgisayarı (Windows) ──────────┐
│                                                      │
│  [Kullanıcı tarayıcı] ──HTTPS──► cloud.alanadin.com │
│  (veya doğrudan cloud'a bağlanır — Electron gereksiz)│
│                                                      │
│  ┌───────────────────────────────────────────┐      │
│  │ Store Bridge (npm run bridge)              │      │
│  │ - API_BASE=https://pos.alanadin.com/api   │      │
│  │ - BRIDGE_TOKEN=<cloud'dan alınmış>         │      │
│  │ - POLLS: /api/bridge/print-jobs           │      │
│  │ - PUSHES: yazıcıya ESC/POS               │      │
│  └───────────────────────────────────────────┘      │
│                                                      │
│  ┌───────────────────────────────────────────┐      │
│  │ CallerID Helper (.NET)                     │      │
│  │ - API_BASE=https://pos.alanadin.com/api   │      │
│  │ - BRIDGE_TOKEN=<same>                      │      │
│  │ - POSTS: /api/bridge/caller-id/incoming   │      │
│  └───────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────┘
```

**Kritik Avantaj:** `store-bridge/config.js` zaten `API_BASE` env'ini okuyor; yapılacak tek şey cloud URL'ini vermek.

### 8.2 Görev 3.1 — Cloud'da Bridge Endpoint'lerini Açık Tut

Mevcut `server/routes/bridge.js` zaten `X-Bridge-Token` header ile çalışıyor. Ek güvenlik:

```js
// server/middleware/bridge-auth.js
export function bridgeAuth(req, res, next) {
  const token = req.headers['x-bridge-token'];
  if (!token) return res.status(401).json({ error: 'Bridge token required' });
  
  // Token -> business lookup (tek token bir business'a bağlı)
  const setting = db.prepare(`
    SELECT business_id FROM settings WHERE key = 'bridge_token' AND value = ?
  `).get(token);
  
  if (!setting) return res.status(403).json({ error: 'Invalid bridge token' });
  
  req.businessId = setting.business_id;
  next();
}
```

**Admin panelinden token oluşturma:**
```
Settings → Integrations → Bridge Token → [Generate]
```

### 8.3 Görev 3.2 — Store Bridge Windows'a Kurulum

Restoran bilgisayarı setup:

```bash
# 1. Git clone veya ZIP indir
git clone https://github.com/.../restoran-pos.git c:\restoran-pos
cd c:\restoran-pos
npm ci --prefix store-bridge

# 2. Env ayarla
# c:\restoran-pos\scripts\local-env.bat
set API_BASE=https://pos.alanadin.com/api
set BRIDGE_TOKEN=<cloud admin panelden alınan>
set BRIDGE_BUSINESS_ID=<cloud DB'deki business_id>

# 3. Windows Service olarak kur (veya Task Scheduler)
# npm install -g node-windows
# veya nssm (Non-Sucking Service Manager)
nssm install "Restoran POS Bridge" "C:\Program Files\nodejs\node.exe" "c:\restoran-pos\store-bridge\index.js"
nssm set "Restoran POS Bridge" AppEnvironmentExtra "API_BASE=... BRIDGE_TOKEN=..."
```

### 8.4 Görev 3.3 — CallerID Helper Cloud'a Yönlendir

`tools/callerid-sdk-helper` zaten `--api-base` parametresiyle çalışıyor:

```powershell
# Restoran PC
dotnet run --project tools\callerid-sdk-helper\CallerIdSdkHelper.csproj `
  -- --api-base https://pos.alanadin.com/api `
  --post-enabled true `
  --bridge-token <TOKEN>
```

**Windows Service olarak:** NSSM ile aynı yöntem.

### 8.5 Görev 3.4 — Yazıcı LAN Erişimi Testi

Yazıcılar restoranda, Store Bridge aynı LAN'da, cloud sadece `print_jobs` kuyruğunu tutar:

```
Cloud: print_jobs INSERT (pending)
  ↓ poll her 3 sn
Bridge: GET /api/bridge/print-jobs?status=pending
  ↓ claim
Bridge: POST /api/bridge/print-jobs/:id/claim
  ↓ LAN TCP 9100 veya USB
Yazıcı: ESC/POS buffer
  ↓
Bridge: PATCH /api/bridge/print-jobs/:id {status: printed}
```

### 8.6 Görev 3.5 — Bridge Offline İzleme

Bridge cloud'a erişim kaybederse:
- Lokal queue'da biriktirme (SQLite dosyası restoranda)
- Network gelince retry
- Admin panelde "Bridge 5 dk offline" uyarısı (poll_last_seen heartbeat)

```js
// Yeni endpoint: POST /api/bridge/heartbeat
// Bridge her 30 sn'de bir vurur
// Dashboard'da "son görülme" gösterir
```

### 8.7 FAZ 3 Kabul Kriterleri

- [ ] Store Bridge restoran PC'de Windows Service olarak 7/24 çalışıyor
- [ ] CallerID helper aynı şekilde servis olarak çalışıyor
- [ ] Cloud'dan sipariş oluşturulunca yazıcıdan fiş çıkıyor (3-5 sn içinde)
- [ ] Caller geldiğinde tüm garsonların mobillerinde popup (Socket.io)
- [ ] Bridge kapatılınca admin paneldeki "bridge status" kırmızıya dönüyor
- [ ] Restoran internet kesilse bile tekrar gelince queue işleniyor
- [ ] BRIDGE_TOKEN loglarda `***` olarak görünüyor

---


<a id="faz-4"></a>
## 9. FAZ 4 — MULTI-DEVICE SERTLEŞTİRME & GÜVENLİK

> **🎯 Hedef:** 10 eşzamanlı cihazla stabil çalış, güvenlik skoru 9→10.
> **⏱️ Süre:** 3 iş günü
> **🔗 Bağımlılık:** FAZ 2
> **🚫 Bloklar:** FAZ 5, 6 (mobil öncesi son güvenlik sertleştirmesi)

### 9.1 Görev 4.1 — Refresh Token Sistemi

**Problem:** Şu an JWT 24h. Mobilde kullanıcı her gün login olmamalı.

**Çözüm:** Access token (15dk) + Refresh token (30gün), httpOnly cookie.

```sql
-- Yeni tablo
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,  -- sha256(token), plaintext tutma
  device_info TEXT,           -- user-agent
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
```

**Endpoint'ler:**
- `POST /api/auth/login` → access (15dk) + refresh (30gün), ikisi de body'de döner
- `POST /api/auth/refresh` → yeni access token (+ opsiyonel refresh rotation)
- `POST /api/auth/logout` → refresh token'ı revoke eder
- `POST /api/auth/logout-all` → kullanıcının tüm oturumlarını kapatır

**Frontend:** Interceptor 401 gelince otomatik `/refresh` çağırır, yeni token'la retry.

**Mobil için kritik:** Refresh token'ı `expo-secure-store` veya `react-native-keychain`'de sakla.

### 9.2 Görev 4.2 — CSRF Koruma (Cookie-based auth için)

JWT localStorage'da tutulursa CSRF yok, XSS var. HttpOnly cookie'de tutarsan CSRF var, XSS yok.

**Karar:** Web'de httpOnly cookie + CSRF token (double submit). Mobilde Authorization header.

```js
// server/middleware/csrf.js
import { doubleCsrf } from 'csrf-csrf';
export const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => config.csrfSecret,
  cookieName: 'x-csrf',
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});
```

Mobil app (React Native) farklı middleware'den geçsin (Bearer token).

### 9.3 Görev 4.3 — Concurrency & Race Condition Audit

10 garson aynı anda çalışırken:

**Test senaryoları:**
1. 2 garson aynı masaya aynı anda sipariş ekleyebilir mi? → `current_order_id` UNIQUE değil, dikkat
2. 2 cihaz aynı anda ödeme alırsa? → Payment allocation transaction'ı doğru mu
3. Mutfak siparişi "hazır" işaretlerken garson "iptal" derse? → state machine eksik
4. İki bridge aynı anda `print_job`'u claim ederse? → `claim` UPDATE WHERE claimed_at IS NULL ✓ (mevcut)

**Optimistic locking ekle:**
```sql
ALTER TABLE orders ADD COLUMN version INTEGER DEFAULT 0;

-- Update
UPDATE orders 
SET status = 'paid', version = version + 1 
WHERE id = ? AND version = ?

-- changes = 0 ise conflict → 409 Conflict
```

### 9.4 Görev 4.4 — Socket.io Authorization per-Event

Mevcut: Connection'da JWT doğrulaması ✓.
Eksik: Her event'te businessId cross-check.

Örnek saldırı: Business A'nın token'ını ele geçiren bir user, Business B'nin room'una `join` eder.

**Çözüm:** Socket event'lerinde server-side `room === businessId` doğrulaması.

### 9.5 Görev 4.5 — API Versioning

```js
// server/index.js
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/orders', ordersRoutes);
// ...

// Geri uyum:
app.use('/api/auth', authRoutes); // deprecated, v1 de aynı yere
```

Frontend ve Bridge tüm istekleri `/api/v1/*`'e çevir. React Native baştan v1 kullansın.

### 9.6 Görev 4.6 — Load Testing

```bash
# Artillery
npm install -g artillery

# scenarios/load.yml
config:
  target: https://pos.alanadin.com
  phases:
    - duration: 300  # 5 dakika
      arrivalRate: 5
      rampTo: 50
  defaults:
    headers:
      Authorization: "Bearer {{ token }}"
scenarios:
  - flow:
      - post:
          url: /api/v1/auth/login
          json:
            email: waiter@demo.com
            password: TestPass123
          capture:
            - json: $.token
              as: token
      - loop:
          - get: { url: /api/v1/tables }
          - post:
              url: /api/v1/orders
              json: { table_id: "...", order_type: "dine_in" }
          - think: 3
        count: 10

artillery run scenarios/load.yml
```

**Başarı kriterleri:**
- p95 < 500ms
- p99 < 2000ms
- Error rate < 0.1%
- CPU < 70%

### 9.7 Görev 4.7 — Penetrasyon Check-list

- [ ] OWASP ZAP otomatik tarama → kritik bulgu yok
- [ ] SQL injection: Her Zod'lu endpoint + prepared statement ✓
- [ ] XSS: React auto-escape ✓; `dangerouslySetInnerHTML` kullanımı yok
- [ ] IDOR: `businessScope` her route'ta ✓ (audit gerek)
- [ ] CSRF: cookie auth'da çift submit token ✓
- [ ] Rate limit bypass (IP rotation): Cloudflare + user-based rate limit
- [ ] JWT algorithm confusion: Signing algoritması sabit (`HS256`)
- [ ] Directory traversal: `uploads/` serve'inde path normalize ✓
- [ ] Open redirect: Login sonrası redirect whitelist
- [ ] Error leak: 500'lerde stack trace'i frontend'e gönderme (Sentry'ye git)

### 9.8 FAZ 4 Kabul Kriterleri

- [ ] Refresh token sistemi çalışıyor, 15 dk access / 30 gün refresh
- [ ] Artillery load test başarılı
- [ ] OWASP ZAP rapor temiz
- [ ] Optimistic locking sipariş çakışması durumunda 409 döner
- [ ] Socket.io business isolation testi (A'dan B'ye yayın başarısız)
- [ ] API `/v1/` prefix'i mevcut, geri uyum için eski path'ler de çalışıyor
- [ ] pm2 zero-downtime reload test edildi (`pm2 reload pos-api`)

---

<a id="faz-5"></a>
## 10. FAZ 5 — PWA OPTİMİZASYONU

> **🎯 Hedef:** Browser üzerinden mobil garsonlar native'e yakın deneyim. React Native hazır olana kadar kullanılabilir.
> **⏱️ Süre:** 3-4 iş günü
> **🔗 Bağımlılık:** FAZ 4
> **📝 Not:** Mevcut React app'i touch-friendly ama PWA şeklinde paketlenmemiş. Hızlı kazanım.

### 10.1 Görev 5.1 — Web App Manifest

**Yeni dosya:** `client/public/manifest.webmanifest`

```json
{
  "name": "Restoran POS",
  "short_name": "POS",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f172a",
  "theme_color": "#6366f1",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`client/index.html`:
```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#6366f1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
```

### 10.2 Görev 5.2 — Service Worker (Workbox)

```bash
npm install --prefix client workbox-window vite-plugin-pwa
```

**client/vite.config.js:**
```js
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/pos\.alanadin\.com\/api\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 },
            },
          },
          {
            urlPattern: /\/uploads\/.*\.(jpg|jpeg|png|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'image-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 86400 * 7 },
            },
          },
        ],
      },
    }),
  ],
});
```

### 10.3 Görev 5.3 — Offline Fallback (Sınırlı)

POS tam offline çalışamaz (real-time + DB yazma zorunlu). Ama:

- ✅ **Menü cache**: Kategori + ürün listesi offline görüntülenir
- ✅ **Geçmiş siparişler**: Son çekilen liste cache
- ❌ **Sipariş oluşturma**: Online olmadan mümkün değil (backend zorunlu)
- ✅ **Offline banner**: Üstte "bağlantı yok, tekrar bağlanmaya çalışılıyor..."

```js
// client/src/components/layout/OfflineBanner.jsx
export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { /* remove */ };
  }, []);
  if (online) return null;
  return <div className="offline-banner">📶 Bağlantı yok — tekrar bağlanmaya çalışılıyor...</div>;
}
```

### 10.4 Görev 5.4 — Touch UX İyileştirmeleri

- Tap target minimum 44x44px (Apple HIG)
- Swipe gestures (masa geçişi?)
- Pull-to-refresh (kitchen ekranı)
- `input[type=tel]` mobil klavye için
- `autoComplete`, `inputMode` attribute'ları
- Sayfa geçiş animasyonları (framer-motion)

### 10.5 Görev 5.5 — iOS/Android Test Matrisi

| Cihaz | Tarayıcı | Test |
|-------|----------|------|
| iPhone 13+ Safari | Login, sipariş, Socket.io, PWA install | |
| iPad | Masa grid layout, landscape | |
| Samsung Galaxy Chrome | Login, sipariş, SW cache | |
| Android tablet | Touch, sayfa geçişleri | |

### 10.6 Görev 5.6 — Lighthouse Skorları

```bash
npm install -g lighthouse
lighthouse https://pos.alanadin.com --view
```

**Hedef skorlar:**
- Performance: ≥ 85
- Accessibility: ≥ 90
- Best Practices: ≥ 95
- SEO: yüksek değil (login ardı)
- PWA: ✓ (installable)

### 10.7 FAZ 5 Kabul Kriterleri

- [ ] iPhone Safari'de "Ana Ekrana Ekle" çalışıyor, icon görünüyor
- [ ] Android Chrome'da "Uygulamayı Yükle" banner çıkıyor
- [ ] Offline banner görünüyor, online dönüşte otomatik kayboluyor
- [ ] Lighthouse PWA ✓
- [ ] Lighthouse Performance ≥ 85
- [ ] 5 gerçek cihazda test (2 iOS + 3 Android) geçti

---

<a id="faz-6"></a>
## 11. FAZ 6 — API OLGUNLAŞTIRMA (React Native Öncesi)

> **🎯 Hedef:** React Native ekibine (veya senin RN kodunu yazarken) temiz, dokümante, versiyonlu bir API sun.
> **⏱️ Süre:** 4-5 iş günü
> **🔗 Bağımlılık:** FAZ 4
> **🚫 Bloklar:** FAZ 7 (RN direkt API tüketir)

### 11.1 Görev 6.1 — OpenAPI 3.1 Spec

Zod şemalarından otomatik OpenAPI üretimi:

```bash
npm install --prefix server zod-to-openapi @asteasolutions/zod-to-openapi
```

```js
// server/openapi/generate.js
import { extendZodWithOpenApi, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
registry.registerPath({
  method: 'post',
  path: '/auth/login',
  request: { body: { content: { 'application/json': { schema: LoginSchema } } } },
  responses: {
    200: { description: 'OK', content: { 'application/json': { schema: LoginResponseSchema } } },
    401: { description: 'Invalid credentials' },
  },
});
// ... tüm endpoint'ler

const generator = new OpenApiGeneratorV31(registry.definitions);
const doc = generator.generateDocument({
  openapi: '3.1.0',
  info: { title: 'Restoran POS API', version: '1.0.0' },
  servers: [{ url: 'https://pos.alanadin.com/api/v1' }],
});

fs.writeFileSync('docs/openapi.yaml', YAML.stringify(doc));
```

### 11.2 Görev 6.2 — Swagger UI / Scalar

```js
import { apiReference } from '@scalar/express-api-reference';
app.get('/api/docs', apiReference({ spec: { url: '/api/openapi.json' } }));
```

`https://pos.alanadin.com/api/docs` → interaktif API explorer.

### 11.3 Görev 6.3 — Cursor-Based Pagination

Mobilde offset pagination (LIMIT/OFFSET) kötü (deep page yavaş, yeni kayıt araya girebilir). Cursor tercih et:

```
GET /api/v1/orders?limit=20&cursor=<opaque>
Response: { items: [...], nextCursor: '...' or null }
```

Etkilenecek endpoint'ler: `/orders`, `/customers`, `/reports/closed-orders`, `/callerid/history`.

### 11.4 Görev 6.4 — FCM / APNs Push Notification

**Neden:** Garson uygulaması kapalıyken de "yeni sipariş" veya "mutfak hazır" bildirimi.

**Backend:**
```bash
npm install --prefix server firebase-admin
```

```js
// server/services/push.js
import admin from 'firebase-admin';
admin.initializeApp({ credential: admin.credential.cert(SERVICE_ACCOUNT) });

export async function sendPush(deviceTokens, { title, body, data }) {
  return admin.messaging().sendEachForMulticast({
    tokens: deviceTokens,
    notification: { title, body },
    data,
  });
}
```

**Yeni tablo:**
```sql
CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  platform TEXT CHECK (platform IN ('ios', 'android')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Endpoint:**
- `POST /api/v1/devices/register` — mobil app kayıt
- `DELETE /api/v1/devices/:token` — logout'ta temizlik

### 11.5 Görev 6.5 — WebSocket vs Push Stratejisi

- **Uygulama açıkken:** Socket.io (instant, mevcut)
- **Arka plan / kapalı:** FCM/APNs push

Backend event olduğunda her iki kanala da yayın yap (deduplication client tarafında).

### 11.6 Görev 6.6 — Error Response Standardizasyonu

Mevcut: `{ error: 'Metin' }`. Yeterli ama mobilde yapısal bilgi eksik.

Yeni:
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "E-posta veya şifre hatalı",
    "details": null,
    "request_id": "abc123"
  }
}
```

### 11.7 Görev 6.7 — API Change Log

`docs/API_CHANGELOG.md` her deploy'da güncelle:

```
## v1.1.0 - 2026-05-15
### Added
- POST /api/v1/devices/register (push notifications)
### Changed
- GET /orders now returns cursor-based pagination
### Deprecated
- `offset`/`limit` params (use cursor instead)
```

### 11.8 FAZ 6 Kabul Kriterleri

- [ ] `/api/docs` Scalar UI açılıyor, tüm endpoint'ler görünüyor
- [ ] OpenAPI YAML git'te
- [ ] Cursor pagination `/orders`, `/customers`, `/reports` için çalışıyor
- [ ] Push notification test: backend'den event → Android/iOS cihazda bildirim (10 sn içinde)
- [ ] Error response format tüm endpoint'lerde tutarlı
- [ ] API_CHANGELOG.md mevcut

---

<a id="faz-7"></a>
## 12. FAZ 7 — REACT NATIVE UYGULAMASI

> **🎯 Hedef:** iOS + Android native garson uygulaması (Expo).
> **⏱️ Süre:** 20-30 iş günü (tek kişi)
> **🔗 Bağımlılık:** FAZ 6 (API olgun ve dokümante)

### 12.1 Teknoloji Kararı

**Seçim: Expo (managed workflow) + React Native 0.74+**

**Neden Expo:**
- Native build (Xcode/Android Studio) zahmeti minimum (EAS Build)
- OTA updates (Expo Updates) → App Store review beklemeden bugfix
- `expo-secure-store`, `expo-notifications` hazır
- EAS Submit ile store upload kolay

**Alternatif:** Bare React Native (daha fazla kontrol ama setup zor). Başlangıç için Expo öneriyoruz.

### 12.2 Proje İskeleti

```
restoran-pos-mobile/
├── app.json                    # Expo config
├── eas.json                    # Build config
├── app/                        # Expo Router (file-based routing)
│   ├── _layout.tsx
│   ├── (auth)/
│   │   └── login.tsx
│   ├── (tabs)/
│   │   ├── tables.tsx
│   │   ├── orders.tsx
│   │   └── kitchen.tsx
│   └── order/[id].tsx
├── components/
├── hooks/
│   ├── useAuth.ts
│   └── useSocket.ts
├── services/
│   └── api.ts
├── stores/
│   └── authStore.ts            # Zustand
└── utils/
```

### 12.3 Kritik Kütüphaneler

```bash
npx create-expo-app restoran-pos-mobile -t default
cd restoran-pos-mobile

# Core
npx expo install expo-router expo-secure-store expo-notifications
npm install zustand @tanstack/react-query axios socket.io-client

# UI
npx expo install react-native-gesture-handler react-native-reanimated
npm install @shopify/flash-list  # performant list
npm install nativewind  # Tailwind for RN (opsiyonel)

# Auth
npm install jwt-decode

# Offline
npm install @tanstack/react-query-persist-client
```

### 12.4 Ekran Bazlı Görev Listesi

| Öncelik | Ekran | Süre | Bağımlılık |
|---------|-------|------|------------|
| P1 | Login + Refresh Token | 2 gün | FAZ 4 |
| P1 | Masa Grid (area seçici) | 2 gün | `/tables` |
| P1 | Sipariş oluşturma/ekleme | 4 gün | `/orders` + modifier UI |
| P1 | Ödeme ekranı | 2 gün | `/payments` + quick amounts |
| P2 | Mutfak ekranı | 2 gün | Socket `order:*` |
| P2 | Paket sipariş | 3 gün | customers + addresses |
| P2 | CallerID popup | 1 gün | Socket `caller:incoming` |
| P2 | Rezervasyon | 2 gün | `/reservations` |
| P3 | Raporlar (read-only) | 2 gün | `/reports` |
| P3 | Ayarlar (profil, tema) | 1 gün | - |
| P3 | Push notification handler | 2 gün | FAZ 6.4 |
| P3 | Stok | 2 gün | `/stock` |

**Toplam:** ~25 gün

### 12.5 Kritik RN-spesifik Noktalar

**Token saklama:**
```ts
import * as SecureStore from 'expo-secure-store';
// AsyncStorage kullanma! Plain text.
await SecureStore.setItemAsync('refreshToken', token);
```

**Socket.io:**
```ts
import { io } from 'socket.io-client';
const socket = io('https://pos.alanadin.com', {
  auth: { token: accessToken },
  transports: ['websocket'],  // polling yok (battery)
});
```

**Background mode:**
- iOS: Background modes sınırlı, Socket.io arka planda kopar → FCM push fallback şart
- Android: foreground service (garson çağırma gibi kritik event için)

**Offline queue:**
```ts
// Mutations React Query ile retry + offline queue
import { onlineManager } from '@tanstack/react-query';
// Network gelince otomatik retry
```

**Sesli bildirim (yeni sipariş):**
```ts
import * as Notifications from 'expo-notifications';
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});
```

### 12.6 EAS Build Pipeline

```json
// eas.json
{
  "build": {
    "preview": { "distribution": "internal", "ios": { "simulator": true } },
    "production": {
      "autoIncrement": true,
      "ios": { "resourceClass": "m-medium" }
    }
  },
  "submit": {
    "production": {
      "ios": { "ascAppId": "..." },
      "android": { "serviceAccountKeyPath": "./play-service.json" }
    }
  }
}
```

```bash
eas build --platform ios --profile preview
eas build --platform android --profile preview
```

### 12.7 FAZ 7 Kabul Kriterleri

- [ ] Login → sipariş oluştur → ödeme al akışı iOS + Android'de çalışıyor
- [ ] Mutfak ekranı Socket.io ile anlık güncelleniyor
- [ ] Push notification gelince cihaz titriyor/ses çıkarıyor
- [ ] Ağ kopukken uygulama crash etmiyor, offline banner çıkıyor
- [ ] EAS Preview build APK/IPA hazır, internal test ekibine dağıtılabilir
- [ ] Baseline performans: cold start < 3 sn, sipariş ekle < 500 ms

---

<a id="faz-8"></a>
## 13. FAZ 8 — APP STORE & PLAY STORE YAYINI

> **🎯 Hedef:** Public store'larda yayında.
> **⏱️ Süre:** 7-14 iş günü (onay süreleri dahil)
> **🔗 Bağımlılık:** FAZ 7

### 13.1 Ön Hazırlık

| # | Görev | Süre |
|---|-------|------|
| 8.1 | Apple Developer hesabı ($99/yıl) | 1-2 gün (onay) |
| 8.2 | Google Play Developer hesabı ($25) | 1 gün |
| 8.3 | App icon set (1024x1024, maskable) | 0.5 gün |
| 8.4 | Screenshot'lar (iPhone + iPad + Android tüm boyutlar) | 1 gün |
| 8.5 | Privacy Policy URL (KVKK uyumlu, Türkçe + İngilizce) | 0.5 gün |
| 8.6 | Terms of Service | 0.5 gün |
| 8.7 | App Store / Play Store açıklama metinleri | 1 gün |
| 8.8 | App Store Connect listing (Türkçe yerelleştirme) | 0.5 gün |

### 13.2 Apple App Store Review Check-list

- [ ] Güvenilir test hesabı sağla (review team login yapabilsin)
- [ ] Network Security: ATS (App Transport Security) — HTTPS zorunlu ✓
- [ ] IDFA kullanımı yok (opsiyonel; Expo default kapalı)
- [ ] Sensitive permissions (kamera vb.) için kullanım gerekçesi Info.plist'te
- [ ] "İş kullanımına yönelik, B2B" kategorisi
- [ ] In-app purchase yoksa açıkla (ücretsiz mi, dış ödeme mi)

**Red flag'ler (reddedilme sebebi):**
- Ücretsiz app + arkada ödeme paywall (İşletme hesabı için abonelik düşünüyorsan dikkat)
- Referans: https://developer.apple.com/app-store/review/guidelines/

### 13.3 Google Play Review Check-list

- [ ] Target API level güncel (2026'da muhtemelen API 34)
- [ ] Data safety form (hangi veriler toplanıyor, 3rd party paylaşım)
- [ ] Privacy Policy link
- [ ] Internal testing track → closed testing → open testing → production (kademeli)

### 13.4 Release Süreci

```bash
# iOS
eas build --platform ios --profile production
eas submit --platform ios

# Android
eas build --platform android --profile production
eas submit --platform android
```

### 13.5 Post-launch

- [ ] Crash reporting (Sentry RN SDK)
- [ ] Analytics (opsiyonel: PostHog, Mixpanel)
- [ ] OTA update yayınla (Expo Updates ile küçük bugfix'ler review olmadan)
- [ ] Sürüm bazlı rollback planı

---

<a id="izleme"></a>
## 14. İZLEME, GÖZLEMLENEBİLİRLİK ve OLAY MÜDAHALESİ

### 14.1 Katmanlar

| Katman | Araç | Amaç | Aylık maliyet |
|--------|------|------|---------------|
| **Uptime** | UptimeRobot | `/api/health` 5dk ping | $0 |
| **Error tracking** | Sentry | Frontend + backend exception | $0 (free 5k event/ay) |
| **Metrics** | pm2-plus veya Prometheus+Grafana | CPU, RAM, req/sn | $0 (self-host) |
| **Logs** | pino + pm2 logrotate | Structured JSON, 14 gün | $0 |
| **DB** | `pg_stat_activity`, `pg_stat_user_tables` | Slow query, bloat | $0 |
| **Synthetic** | Uptime check + kritik akış (login→order) | E2E uptime | $0 (UptimeRobot keyword) |

### 14.2 Alarm Eşikleri

| Metrik | Uyarı | Aksiyon |
|--------|-------|---------|
| `/api/health` 5 dk erişilemez | E-mail + SMS | pm2 status, nginx status kontrol |
| Error rate > 5/dk (Sentry) | E-mail | Sentry detay → bug fix |
| DB bağlantı > 18 (max 20) | E-mail | Query pool leak araştır |
| Disk > %80 | E-mail | Log temizle, eski backup rotate |
| CPU > %90 5 dk | E-mail | Load artışı mı, saldırı mı analiz |

### 14.3 On-Call Runbook

Her alarm için basit adım adım yanıt dokümanı:
- `runbook/api-down.md`
- `runbook/db-connection-leak.md`
- `runbook/disk-full.md`
- `runbook/ssl-expiring.md`

---

<a id="regresyon"></a>
## 15. REGRESYON KORUMA CHECKLIST

### 15.1 Her Release Öncesi

- [ ] Tüm 104 test + yeni testler yeşil
- [ ] Manuel smoke test (aşağıda)
- [ ] Lighthouse > 85
- [ ] Lighthouse PWA ✓
- [ ] SSL Labs A+
- [ ] Staging'de 1 gün bekleme (canary)
- [ ] DB backup taze

### 15.2 Manuel Smoke Test (15 dk)

1. Admin login
2. Yeni masa aç, sipariş oluştur (2 ürün + modifier + not)
3. Mutfak ekranından ürünü "hazır" işaretle
4. Ödeme (nakit + kart split)
5. Fiş yazdır (bridge çalışıyor mu)
6. CallerID simulate → popup geliyor mu
7. Paket sipariş — müşteri ara/oluştur, adres seç, sipariş
8. Rapor → bugün 1 sipariş görünüyor, tutar doğru
9. Kullanıcı yönetimi → yeni garson ekle, şifre ile login
10. Logout + re-login → sorunsuz

### 15.3 Otomatik Regresyon (CI)

```yaml
# .github/workflows/e2e.yml
- Playwright E2E testleri
  - Login akışı
  - Sipariş oluşturma
  - Ödeme
  - Kitchen event
```

### 15.4 Masaüstü Electron Regresyon (Unutmayalım)

SaaS'a geçiş sırasında masaüstü müşterilerin etkilenmemesi kritik:
- [ ] `DB_DRIVER=sqlite` modu hâlâ çalışıyor
- [ ] `npm run electron:prod` başlatıyor
- [ ] `npm run dist:win` NSIS + portable üretiyor
- [ ] Store Bridge local API_BASE ile çalışıyor

---

<a id="rollback"></a>
## 16. ACİL DURUM ROLLBACK PLANI

### 16.1 Deploy Rollback (VPS)

```bash
# pm2 ile önceki sürüme
cd /var/www/restoran-pos
git log --oneline -10
git checkout <önceki-sha>
npm ci && npm ci --prefix server && npm ci --prefix client
npm run build --prefix client
pm2 reload pos-api
```

### 16.2 DB Migration Rollback

**Önemli:** Migration scriptleri IF NOT EXISTS ile yazıldığı için büyük risk yok, ama yeni tablo eklediysen:

```bash
# Önceki backup'tan restore
pg_restore -d restoran_pos /var/backups/pos/pos_YYYYMMDD.sql.gz
```

**Best practice:** Destructive migration yapma (DROP TABLE, DROP COLUMN). Yeni kolon ekle, eskiyi deprecated işaretle, 2 release sonra kaldır.

### 16.3 PostgreSQL → SQLite Geri Dönüş (acil)

Beklenmedik büyük sorunda:
1. `.env`'de `DB_DRIVER=sqlite`
2. Son SQLite backup'ı yükle
3. `DATA LOSS WARNING`: PG'de yapılan yeni işlemler kaybolur

### 16.4 App Store Rollback

Expo Updates ile:
```bash
eas update --branch production --message "Revert to previous"
```

Store'dan çekme (emergency):
- Apple: App Store Connect → Availability → "Remove from Sale"
- Google: Play Console → App content → Temporarily suspend

---

## 17. GENEL TEST MATRİSİ (TÜM FAZLARIN TOPLAMI)

| Test tipi | Kapsam | Faz |
|-----------|--------|-----|
| Unit (Vitest) | Helpers, validators, encoders | Mevcut + FAZ 0 |
| Integration (Supertest) | Route handler'lar | Mevcut |
| E2E (Playwright) | Kritik user flow'lar | FAZ 5 |
| Load (Artillery) | 50 concurrent / 5 dk | FAZ 4 |
| Security (OWASP ZAP) | Top 10 zafiyet | FAZ 4 |
| Manual smoke | 15 dk check-list | Her release |
| Compatibility | iOS, Android, Safari, Chrome | FAZ 5, 7 |
| Regression | Önceki release'lerin testleri | Her PR |

---

## 18. DEPO ORGANİZASYONU (MULTI-REPO vs MONOREPO)

**Öneri:** İlk başta **monorepo** koru (mevcut yapı).

```
restoran-pos-v3/  (mevcut)
├── client/       # Web POS (React)
├── server/       # Backend
├── electron/     # Desktop
├── store-bridge/ # Local printer
├── tools/        # CallerID helper
└── mobile/       # YENİ — React Native app
```

React Native `mobile/` olarak eklenirse paylaşılan paketler (types, api client) kolay.

**Sonra (projeyi büyütürsen):** Nx veya Turborepo ile proper monorepo. Ya da mobile'ı ayır.

---

## 19. SONUÇ VE ÖNERİLEN SIRALAMA (ÖZET)

### 19.1 Eğer Bugün Başlıyorsan

**Hafta 1:** FAZ 0 (güvenlik sertleştirme) + FAZ 1 başlangıç (async refactor)
**Hafta 2:** FAZ 1 bitir (PG migration)
**Hafta 3:** FAZ 2 (VPS deploy) + FAZ 3 (bridge)
**Hafta 4:** FAZ 4 (multi-device test + güvenlik) + FAZ 5 (PWA)
**Hafta 5-6:** FAZ 6 (API doc + push) + restoranda 2 hafta canlı test
**Hafta 7-11:** FAZ 7 (React Native)
**Hafta 12:** FAZ 8 (store yayını)

### 19.2 Risk Öncelik Sırası

🔴 **En yüksek risk:** FAZ 1 PostgreSQL migration (5-7 gün, full async refactor, 104 testin yeşil kalması zorunlu). Bu fazda sakın acele etme.

🟠 **Orta risk:** FAZ 3 bridge hibrit mod — restoranın internet kesintisi senaryosunu iyi test et.

🟡 **Düşük risk:** FAZ 5 PWA, FAZ 6 dokümantasyon — ileri kademede zaman alıcı değil.

### 19.3 SON NOT

Bu yol haritasındaki hiçbir fazı atlama. Özellikle **FAZ 0 ve 1** kritik — online öncesi sağlam temel kurmadan FAZ 2'ye geçme, ileride üstüne bina edilen her şey yıkılır.

Her faz kabul kriterlerini bir checklist olarak al, her maddeyi işaretlemeden sonraki faza geçme.

**Başarılar! 🚀**

---

**Doküman versiyonu:** 1.0
**Son güncelleme:** 19 Nisan 2026
**Hazırlayan:** Claude (Anthropic) - Restoran POS v3 Analizi
