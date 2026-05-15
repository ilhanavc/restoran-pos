# Restoran POS v1.1.0 — Bitirme Projesi

> Modern restoran yönetimi için tasarlanmış, Windows masaüstü tabanlı çok modüllü Point-of-Sale (POS) sistemi.

**Versiyon:** 1.1.0
**Geliştirme süresi:** ~12 ay (12 sprint + sertleştirme fazları)
**Test sayısı:** 452 otomatik test (430 backend + 22 frontend)
**Kod kalitesi:** ESLint `--max-warnings 0` (sıfır uyarı)
**Genel puan:** 9.3 / 10

---

## 📋 İçindekiler
1. [Projenin Amacı](#1-projenin-amacı)
2. [Hızlı Başlangıç](#2-hızlı-başlangıç)
3. [Mimari](#3-mimari)
4. [Teknoloji Yığını](#4-teknoloji-yığını)
5. [Özellikler](#5-özellikler)
6. [Kurulum](#6-kurulum)
7. [Demo Senaryoları](#7-demo-senaryoları)
8. [Güvenlik](#8-güvenlik)
9. [Test ve Kalite Güvencesi](#9-test-ve-kalite-güvencesi)
10. [Sınırlamalar ve Gelecek Çalışmalar](#10-sınırlamalar-ve-gelecek-çalışmalar)

---

## 1. Projenin Amacı

Türk restoran sektöründe yaygın kullanılan ticari POS sistemlerinin (SambaPOS, Adisyo) bazı sınırlamaları vardır:
- Yüksek aylık abonelik ücretleri
- Kapalı kaynak — kuruma özel özelleştirme zorluğu
- Tek bilgisayar / tek şube odaklı temel sürümler
- Türkçe karakter sorunlarıyla bilinen yazıcı entegrasyonları

Bu projenin amacı, **açık mimari** ile geliştirilebilen, **çok katmanlı güvenlik** uygulanmış, **çoklu yazıcı ve müşteri tanıma** entegrasyonlarıyla zenginleştirilmiş, **çevrimdışı çalışabilen** bir POS sistemi sunmaktır.

### Çözülen Problemler
- ESC/POS yazıcılarda **PC857 Türkçe karakter** kodlaması
- Garson çağrı, kasa ödemesi ve mutfak ekranları için **gerçek zamanlı** durum senkronizasyonu (Socket.io)
- **Telefonla gelen müşterilerin otomatik tanınması** (CallerID HID + SDK)
- **Yedek alma + geri yükleme** otomasyonu (gece 03:00 robocopy + Windows Task Scheduler)
- **Çoklu rol** tabanlı erişim kontrolü (Admin/Kasiyer/Garson/Mutfak)

---

## 2. Hızlı Başlangıç

### En kolay yol (önerilir)
1. `dist-electron/Restoran-POS-v1.1.0-demo.zip` arşivini açın
2. `Restoran POS.exe` üzerine **çift tıklayın**
3. Giriş ekranında demo kimlik bilgileriyle giriş yapın

### Demo Giriş Bilgileri

| Rol      | E-posta            | Şifre  |
|----------|--------------------|--------|
| Yönetici | `admin@demo.com`   | `123456` |
| Kasiyer  | `kasiyer@demo.com` | `123456` |
| Garson   | `garson@demo.com`  | `123456` |
| Mutfak   | `mutfak@demo.com`  | `123456` |

---

## 3. Mimari

Sistem, 3 katmanlı mimaride kurulmuştur:

```
┌────────────────────────────────────────────────────────────────┐
│  ELECTRON DESKTOP CONTAINER                                    │
│                                                                │
│  ┌─────────────────────┐    HTTP/JSON    ┌──────────────────┐ │
│  │  React + Vite       │  ─────────────▶ │  Express API     │ │
│  │  (sunum katmanı)    │  ◀───────────── │  (iş kuralları)  │ │
│  │                     │     Socket.io   │                  │ │
│  └─────────────────────┘                 └────────┬─────────┘ │
│                                                   │            │
│                                                   ▼            │
│                                          ┌────────────────┐    │
│                                          │  SQLite (WAL)  │    │
│                                          │  + Migrasyon   │    │
│                                          └────────────────┘    │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  Store Bridge (yerel donanım katmanı)                   │  │
│  │   - ESC/POS yazıcılar (PC857 Türkçe encoding)           │  │
│  │   - CallerID HID + .NET 8 SDK helper                    │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Süreçler (Process Topolojisi)

| Süreç | Görev |
|-------|-------|
| `electron-main` | Pencere yönetimi, IPC, logging, güncelleme |
| `node` (server) | Express API + Socket.io + SQLite migrasyonları |
| `node` (store-bridge) | Yazıcı kuyruğu + ESC/POS render + CallerID |
| `CallerIdSdkHelper.exe` | C# .NET 8 self-contained, HID dinleyici |

---

## 4. Teknoloji Yığını

### Frontend
- **React 18** + Hooks tabanlı bileşen mimarisi
- **Vite 5** (build aracı, HMR)
- **React Router 6** (HashRouter — Electron uyumluluğu)
- **Recharts** (grafikler)
- **Tailwind benzeri yardımcı CSS sistemi**

### Backend
- **Node.js 20.19+ / 22+**
- **Express 4** (REST API)
- **better-sqlite3** (senkron, yüksek performanslı SQLite sürücüsü)
- **Socket.io 4** (mutfak/masa/paket gerçek zamanlı bildirimler)
- **jsonwebtoken** + **bcryptjs** (kimlik doğrulama)
- **Zod** (girdi doğrulama)
- **Pino** (yapılandırılmış JSON loglama — NDJSON)
- **@sentry/node** + **@sentry/react** (hata izleme)

### Masaüstü Paketleme
- **Electron 34**
- **electron-builder 24** (NSIS Setup + Portable)
- **electron-updater** (GitHub Releases üzerinden otomatik güncelleme)

### Donanım Entegrasyonu
- **ESC/POS** protokolü, PC857 (Türkçe) karakter kodlaması
- **CallerID** — C# .NET 8 self-contained binary (no .NET dependency on target)
- **node-thermal-printer** (TCP/network printers)

### Test ve Kalite
- **Vitest** (birim + entegrasyon testleri)
- **Supertest** (HTTP entegrasyon testleri)
- **Playwright** (E2E senaryolar)
- **ESLint 10 flat config** (`--max-warnings 0`)
- **GitHub Actions CI** (lint + test + e2e)

---

## 5. Özellikler

### 5.1 Operasyonel Modüller

| Modül | Açıklama |
|-------|----------|
| 🪑 **Masa Yönetimi** | Alan tabanlı grid, doluluk renk skalası, masa transferi |
| 🧾 **Sipariş Akışı** | Kategori→Ürün, modifier, kalem notu, sepet |
| 🥡 **Paket Sipariş** | Müşteri arama/kayıt, çoklu adres, ödeme tipi seçimi |
| 💳 **Ödeme** | Nakit/kart/karışık, indirim, para üstü, otomatik kapatma |
| 👨‍🍳 **Mutfak Ekranı** | Aktif siparişler, kalem bazlı hazırlık, yaş uyarıları (10dk sarı / 20dk kırmızı) |
| 🧾 **Yazıcı / Fiş** | ESC/POS PC857, kelime kaydırma, başlık/altlık, 4 şablon |
| 🗓️ **Rezervasyon** | Takvim görünümü, masa oturtma bağlantısı, no-show guard |
| 📦 **Stok Takibi** | Kalemler, hareketler, düşük stok uyarıları |
| 👥 **Müşteri Yönetimi** | Çoklu telefon/adres, sipariş geçmişi, Excel/CSV import-export |
| 📊 **Raporlar** | Günlük satış, ödeme dökümü, en çok satanlar, 4 interaktif grafik, X/Z period close |
| 💰 **İade / Bahşiş** | Sipariş + ödeme bağlı iadeler, payment-level bahşiş yakalama |
| 📜 **Sipariş Geçmişi** | Tarih, müşteri, tutar filtreleri |
| ☎️ **CallerID** | C812A V8 HID cihaz desteği, real-time `Gelen Arama` modali |
| ⚡ **Gerçek Zamanlı** | Socket.io ile mutfak/masa/paket ekranı bildirimleri |
| 💾 **Yedek/Geri Yükle** | Otomatik gece 02:00 + manuel, SHA-256 doğrulamalı, uploads dahil |

### 5.2 Yönetim ve Güvenlik

| Özellik | Açıklama |
|---------|----------|
| 🔐 **Rol Bazlı Yetki** | Admin / Kasiyer / Garson / Mutfak |
| 🔑 **JWT + Refresh Token** | Mobil akış için 15 dk access + 30 gün refresh |
| 🛡️ **Rate Limiting** | Auth/admin/bridge/printer için ayrı limitler |
| 🔍 **Audit Trail** | `entity_mutations` tablosunda tüm mutasyonların before/after snapshot'ı |
| 📝 **Audit Log Viewer** | `/settings/audit-log` — before/after JSON diff görünümü |
| 🚪 **Setup Wizard** | İlk açılışta 4 adımlı yapılandırma |
| 🔔 **Otomatik Güncelleme** | electron-updater + GitHub Releases |

### 5.3 Operasyonel Görünürlük

| Bileşen | Açıklama |
|---------|----------|
| 📋 **Structured Logging** | Pino + NDJSON, `electron-main.log` her satır geçerli JSON |
| 🎯 **Sentry Entegrasyonu** | Backend + Frontend, hassas verileri redact eden simetrik filtre |
| 📊 **Support Bundle** | `GET /admin/support-bundle` — sistem, DB, bridge, kuyruk, log özeti |
| 🆔 **X-Request-Id** | UUID format doğrulamalı, 500 error response'a dahil (log correlation) |
| 💥 **Crash Reporter** | `crashes.log` (JSON-line) — beklenmeyen sonlanma kayıtları |

---

## 6. Kurulum

### Yöntem A — Hazır Paket (önerilir)
1. `Restoran-POS-v1.1.0-demo.zip` arşivini çıkarın
2. Klasörden `Restoran POS.exe` üzerine çift tıklayın
3. İlk açılışta Setup Wizard görünebilir — atlayabilirsiniz, demo seed yüklenmiştir

### Yöntem B — Kaynaktan Çalıştırma (geliştirici)
```bash
# Bağımlılıklar
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Veritabanını seed et (demo verisi yükler)
npm run db:seed

# Dev modunda başlat (port 3001 + 5173)
npm run dev
```
Tarayıcıdan `http://localhost:5173` adresine gidin.

### Yöntem C — Production Build (Electron paketi)
```bash
npm run dist:prepare        # ~10 dakika
# Çıktı: dist-electron/win-unpacked/Restoran POS.exe
```
⚠️ `dist:nsis` ve `dist:win` komutlarını **kullanmayın** — bilinen 7.9 GB+ büyüyen `.nsis.7z` hatası vardır. Yalnızca `dist:prepare` + manuel ZIP yeterlidir.

---

## 7. Demo Senaryoları

### Senaryo 1 — Masa Siparişi (Kasiyer / Garson)
1. `Yönetici` ile giriş yap
2. Masalar ekranında **M1** masasına tıkla
3. **Pideler** kategorisinden `Kaşarlı Pide` seç → sepete eklenir
4. **Ana Yemekler**'den `Adana Kebap` seç
5. **Mutfağa Gönder**'e tıkla — Socket.io ile mutfak ekranı anında güncellenir
6. Ödeme → Nakit → Sipariş kapatılır, masa boşa düşer

### Senaryo 2 — Paket Sipariş (Müşteri Çağrısı)
1. **Paket** sekmesine geç
2. Telefon ile `0532 123 45 67` ara (test: Ahmet Yıldız müşterisi)
3. CallerID modalı **otomatik** açılır
4. Müşterinin kayıtlı adresi yüklenir, ürün ekle, ödeme tipi seç
5. Sipariş paket kuyruğuna düşer

### Senaryo 3 — Menü Yönetimi (Yönetici)
1. **Tanımlamalar** menüsünden Menü Tanımları'na git
2. Sol panel: 5 kategori (Smoke Menü + 4 demo)
3. **Ekle** ile yeni kategori oluştur — renk, ikon, yazıcı hedefi seç
4. Mevcut bir ürünü sil — sipariş geçmişi varsa **soft-delete**, yoksa **hard-delete**

### Senaryo 4 — Rapor Görüntüleme (Yönetici)
1. **Raporlar** ekranı
2. Tarih aralığı seç
3. 4 grafik: Saatlik satış, kategori dağılımı, ödeme tipi, en çok satanlar
4. **Excel Dışa Aktar** veya **PDF Yazdır**

### Senaryo 5 — Yedek / Geri Yükle
1. **Ayarlar → Bakım ve Yedekleme**
2. **Manuel Yedek Al** → SHA-256 hashli `.zip` + `meta.json` üretir
3. Geri yükle: dosya seç → iki adımlı modal → onay → DB değiştirilir
4. Geri yükleme sonrası bütünlük kontrolü; başarısızsa otomatik safety revert

---

## 8. Güvenlik

### 8.1 Uygulanmış Önlemler (FAZ 0 Sertleştirmesi)

| Katman | Önlem |
|--------|-------|
| **Kimlik Doğrulama** | bcrypt hash (cost 10), JWT (1 saat access), refresh token (30 gün) rotate edilir |
| **Şifre Politikası** | Min 8 karakter + büyük harf + rakam zorunlu (yeni hesap / reset) |
| **Forced Password Change** | Admin tarafından oluşturulan/sıfırlanan hesap ilk girişte değiştirmeli |
| **CORS** | Prod'da yalnızca whitelist; dev'de localhost/LAN regex |
| **Rate Limiting** | Auth (5/15dk), admin (20/dk), global (100/dk) — env-driven |
| **Input Validation** | Tüm endpoint'ler Zod şemasıyla |
| **SQL Injection** | better-sqlite3 prepared statements — string concat yok |
| **JWT Secret** | Prod'da min 32 karakter, fail-fast guard |
| **Secret Yönetimi** | `.gitignore` savunma derinliği; `.env.*` ve `pos.db` tüm yollardan dışlanır |
| **Sensitive Redaction** | Sentry + Pino loglarda `password`, `token`, `cookie` filtrelenir |
| **Trust Proxy** | `TRUST_PROXY_HOPS` env (0/1/2), geçersiz değer fallback 0 |
| **Header Injection** | `X-Request-Id` UUID format regex doğrulaması |

### 8.2 GDPR / KVKK Uyumu
- Sentry session replay: `maskAllText:true`, `maskAllInputs:true`, `blockAllMedia:true` — POS verileri ekran kaydında **maskelenir**
- Hassas alanlar (şifre, JWT secret, bridge token, refresh token) Sentry'ye **gönderilmez**

---

## 9. Test ve Kalite Güvencesi

### 9.1 Test Sayıları
| Tip | Sayı |
|-----|------|
| Backend (Vitest + Supertest) | 430 test, 39 dosya |
| Frontend (Vitest + RTL) | 22 test, 2 dosya |
| Integration (Supertest) | 17 entegrasyon dosyası |
| E2E (Playwright) | 2 senaryo (table-order + takeaway) |
| **Toplam** | **452 otomatik test** |

### 9.2 CI Pipeline
GitHub Actions:
1. `lint:ci` — 0 uyarı zorunlu
2. `test` — backend + frontend
3. `test:e2e` — Playwright Chromium
4. `build` — client Vite build doğrulaması (concurrency + 15-25 dk timeout)

### 9.3 Kapsam Alanları
- ✅ Türkçe karakter encoding (PC857)
- ✅ Yazıcı kuyruğu idempotency
- ✅ DB migration safety
- ✅ Order transaction integrity (commit/rollback)
- ✅ Refresh token rotation
- ✅ CORS whitelist
- ✅ Password policy
- ✅ Sentry redaction
- ✅ Request ID middleware

---

## 10. Sınırlamalar ve Gelecek Çalışmalar

### 10.1 Bilinçli Olarak Kapsam Dışı (v2)
| Özellik | Sebep |
|---------|-------|
| Ödeme terminal SDK | Sağlayıcı/donanım seçimi bekleniyor |
| E-belge / fiscal | Vergi mevzuatı ve sağlayıcı kararı bekleniyor |
| Push notification (FCM/APNs) | Firebase setup dış bağımlılık |
| Mobil garson uygulaması | Ayrı bir proje (M-1.3+) |
| Tenant / billing | 4+ ay sonrasına planlanmıştır |
| Code signing sertifikası | 1500+ TL maliyet, SmartScreen uyarısı kalıyor |
| Yemeksepeti / Getir entegrasyonu | Üçüncü taraf API onayı bekleniyor |

### 10.2 Mimari Borç (Düşük Risk)
- `TablesScreen.jsx` modüler ayrıştırma
- `_cents` kolonlarının primary read source'a taşınması (REAL alanları deprecated)
- Audit log viewer'a CSV export

### 10.3 Devam Eden Bakım
- Yazıcı sürücü uyumluluğu (her marka ESC/POS varyantı için test gerekli)
- Pilot işletme geri bildirimleri

---

## 📜 Lisans ve Bilgilendirme

Bu proje, ... Üniversitesi ... Mühendisliği Bölümü Bitirme Projesi olarak ... yılı bahar döneminde **... ...**  tarafından **Prof./Dr./Öğr.Gör. ... ...** danışmanlığında geliştirilmiştir.

Açık kaynak kütüphaneler için ilgili lisanslar geçerlidir (MIT/Apache/BSD).

---

## 📞 İletişim
- **GitHub repo:** (link)
- **Geliştirici:** İlhan Avcı — ilhanavci499@gmail.com
- **Demo videosu:** (YouTube link)

---

## 📂 Klasör Yapısı

```
restoran-pos-v3/
├── client/                  # React 18 + Vite frontend
├── server/                  # Express backend
│   ├── config/              # DB, env, sentry, logger
│   ├── middleware/          # auth, validate, requestId, bridgeAuth
│   ├── routes/              # 20+ REST endpoint dosyası
│   ├── services/            # printJobs, callerIdService, refundService
│   ├── migrations/          # 13 numaralı migrasyon (0000-0012)
│   ├── seeds/               # Demo veri seed scripti
│   └── tests/               # 39 test dosyası
├── electron/                # Electron main + preload + modüller
├── store-bridge/            # Yerel donanım: yazıcı + CallerID
├── tools/callerid-sdk-helper/  # C# .NET 8 self-contained binary
├── e2e/                     # Playwright senaryo testleri
├── docs/
│   ├── runbooks/            # 5 operasyonel runbook
│   ├── testing/             # regression checklist
│   └── audit/               # 10+ audit raporu + arşiv
└── dist-electron/
    └── win-unpacked/        # Hazır paketli Windows binary
        └── Restoran POS.exe (190 MB)
```
