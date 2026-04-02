# 🍽️ Restoran POS Sistemi

Modern, dokunmatik uyumlu, Türkçe arayüzlü restoran adisyon ve satış noktası sistemi.

## Özellikler

- **Masa Yönetimi** — Salon/alan bazlı masa grid, durum takibi, masa transferi
- **Sipariş Ekranı** — Kategori → ürün akışı, modifier desteği, ürün notu, adisyon paneli
- **Paket Sipariş** — Müşteri arama/oluşturma, adres yönetimi, ayrı sipariş akışı
- **Caller ID** — Gelen arama eşleştirme, müşteri popup, tek tıkla sipariş başlatma
- **Ödeme** — Nakit/kart/karışık, indirim, para üstü hesaplama, otomatik adisyon kapama
- **Muıtfak Ekranı** — Aktif siparişler, ürün bazlı hazırlık takibi
- **Müşteri Yönetimi** — Çoklu telefon/adres, sipariş geçmişi
- **Raporlar** — Günlük satış, ödeme dağılımı, en çok satanlar, kategori/kullanıcı bazlı
- **Yazıcı Entegrasyonu** — Mock servis (ESC/POS hazır mimari)
- **Rol Bazlı Yetkilendirme** — Yönetici, Kasiyer, Garson, Muıtfak
- **Multi-tenant Hazır** — business_id izolasyonu tüm tablolarda

## Teknoloji

| Katman | Teknoloji |
|--------|-----------|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Veritabanı | SQLite (production'da PostgreSQL'e geçişe uygun) |
| Auth | JWT + bcrypt |
| UI | Custom CSS design system (dark theme) |

## Kurulum

### Gereksinimler
- Node.js 18+
- npm 9+

### Adımlar

```bash
# 1. Projeyi çıkart
tar -xzf restoran-pos.tar.gz
cd restoran-pos

# 2. Root bağımlılıkları kur
npm install

# 3. Server bağımlılıkları kur
cd server && npm install && cd ..

# 4. Client bağımlılıkları kur
cd client && npm install && cd ..

# 5. Veritabanını oluştur ve demo verileri yükle (migration bu adımda çalışır)
npm run db:seed

# 6. Uygulamayı başlat
npm run dev
```

### Erişim

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3001

### Windows: tek tık / kolay başlatma

Kısa kullanıcı özeti: [BASLATMA.md](BASLATMA.md)

Dükkan bilgisayarında az komut kullanmak için `scripts` klasöründeki `.bat` dosyaları kullanılabilir. Ortak ayarlar için `scripts/local-env.example.bat` dosyasını `scripts/local-env.bat` olarak kopyalayın; `BRIDGE_TOKEN`, `BRIDGE_BUSINESS_ID` ve gerekirse diğer değişkenleri doldurun (`local-env.bat` git’e eklenmez).

| Dosya | Ne yapar |
|--------|-----------|
| `scripts/start-all.bat` | **Tek tıkla tüm sistem:** ayrı pencerelerde POS (frontend+backend), Store Bridge ve (varsayılan olarak) Caller ID SDK helper’ı sırayla başlatır (~8 sn backend bekleme, bridge/caller id için kısa gecikme). Caller ID’yi bu akışta açmak istemezseniz `local-env.bat` içinde `START_ALL_CALLERID=0` kullanın. |
| `scripts/start-pos-dev.bat` | Sadece `npm run dev` (Vite + API), `load-env` ile ortam. |
| `scripts/start-bridge.bat` | `npm run bridge`; `BRIDGE_TOKEN` ve `BRIDGE_BUSINESS_ID` zorunlu. |
| `scripts/start-callerid-helper.bat` | .NET Caller ID helper; varsayılan POST açık (`CALLERID_HELPER_POST_ENABLED` ile kapatılabilir). `BRIDGE_TOKEN` POST açıkken zorunlu. |
| `scripts/start-callerid-sdk-helper.bat` | `start-callerid-helper.bat` ile aynı (eski kısayollar için). |

**npm (kök dizinde):** `npm run app:start`, `npm run bridge:start`, `npm run callerid:start`, `npm run all:start` — mevcut script isimleri değişmedi; bunlar ek kolaylık komutlarıdır. `callerid:start` için `BRIDGE_TOKEN` ve `API_BASE` ortamda tanımlı olmalıdır. `all:start` Windows’ta `start-all.bat` çağırır.

**Manuel fallback (değişmedi):**

- POS: `npm run dev`
- Bridge: `npm run bridge` (gerekli env ile)
- Caller ID helper: `dotnet run --project .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -- --api-base http://127.0.0.1:3001/api --post-enabled true --bridge-token <token>` (veya `tools/callerid-sdk-helper/README.md`)

**`BRIDGE_BUSINESS_ID`:** `npm run db:seed` her çalıştığında yeni bir işletme UUID’si üretir; bridge ile eşleşmesi için veritabanındaki `businesses.id` ile aynı değeri `local-env.bat` içinde kullanın (ör. SQLite’ta `SELECT id FROM businesses LIMIT 1;`).

**Caller ID helper gereksinimleri:** [.NET SDK](https://dotnet.microsoft.com/download), vendor `cid.dll` dosyasının `tools/callerid-sdk-helper/cidshow_x64/` veya `cidshow_x86/` altında olması (veya `CID_DLL_X64_PATH` / `CID_DLL_X86_PATH`). Ayrıntılar: `tools/callerid-sdk-helper/README.md`.

### Demo Giriş Bilgileri

| Rol | E-posta | Şifre |
|-----|---------|-------|
| Yönetici | admin@demo.com | 123456 |
| Kasiyer | kasiyer@demo.com | 123456 |
| Garson | garson@demo.com | 123456 |
| Muıtfak | mutfak@demo.com | 123456 |

## Proje Yapısı

```
restoran-pos/
├── server/                    # Backend
│   ├── config/                # Konfigürasyon, DB bağlantısı
│   ├── middleware/             # Auth, yetkilendirme
│   ├── routes/                # API endpoint'leri
│   │   ├── auth.js            # Giriş, oturum
│   │   ├── tables.js          # Masa işlemleri
│   │   ├── products.js        # Ürün ve kategori
│   │   ├── orders.js          # Sipariş CRUD
│   │   ├── payments.js        # Ödeme işlemleri
│   │   ├── customers.js       # Müşteri yönetimi
│   │   ├── callerid.js        # Gelen arama
│   │   ├── reports.js         # Raporlama
│   │   └── printer.js         # Yazıcı servisi
│   ├── migrations/            # Tablo oluşturma
│   ├── seeds/                 # Demo veri
│   ├── utils/                 # Yardımcı fonksiyonlar
│   └── index.js               # Sunucu giriş noktası
│
├── client/                    # Frontend
│   └── src/
│       ├── components/
│       │   ├── auth/          # Giriş ekranı
│       │   ├── layout/        # Sidebar
│       │   ├── tables/        # Masa ekranı
│       │   ├── orders/        # Sipariş ekranı
│       │   ├── payments/      # Ödeme ekranı
│       │   ├── kitchen/       # Muıtfak ekranı
│       │   ├── takeaway/      # Paket sipariş
│       │   ├── callerid/      # Caller ID
│       │   ├── customers/     # Müşteri yönetimi
│       │   ├── reports/       # Raporlar
│       │   └── settings/      # Ayarlar
│       ├── context/           # Auth + Toast context
│       ├── services/          # API servis katmanı
│       ├── constants/         # Sabitler, formatlar
│       └── styles/            # Global CSS
```

## API Endpoint'leri

### Auth
- `POST /api/auth/login` — Giriş (aynı e-posta birden fazla işletmede kayıtlıysa `business_id` gerekir)
- `GET /api/auth/me` — Oturum bilgisi

### Masalar
- `GET /api/tables` — Tüm masalar (alan bazlı)
- `PATCH /api/tables/:id/status` — Masa durumu güncelle
- `POST /api/tables/:id/transfer` — Masa taşı

### Ürünler
- `GET /api/categories` — Kategoriler
- `POST /api/categories` — Kategori ekle
- `GET /api/products` — Ürünler (filtreleme destekli)
- `GET /api/products/:id/modifiers` — Ürün modifier'ları
- `POST /api/products` — Ürün ekle
- `PATCH /api/products/:id` — Ürün güncelle

### Siparişler
- `GET /api/orders` — Sipariş listesi
- `GET /api/orders/active` — Muıtfak aktif siparişler
- `GET /api/orders/:id` — Sipariş detayı
- `POST /api/orders` — Sipariş oluştur
- `POST /api/orders/:id/items` — Ürün ekle
- `PATCH /api/orders/:id/status` — Durum güncelle
- `PATCH /api/orders/:id/discount` — İndirim uygula
- `PATCH /api/orders/:orderId/items/:itemId` — Ürün güncelle

### Ödemeler
- `POST /api/payments` — Ödeme al
- `GET /api/payments/summary` — Ödeme özeti

### Müşteriler
- `GET /api/customers` — Müşteri listesi/arama
- `GET /api/customers/:id` — Müşteri detayı
- `POST /api/customers` — Müşteri oluştur
- `PATCH /api/customers/:id` — Müşteri güncelle

### Caller ID
- `POST /api/callerid/incoming` — Gelen arama simülasyonu
- `GET /api/callerid/history` — Arama geçmişi
- `POST /api/bridge/caller-id/incoming` — StoreBridge/harici dinleyici ile gelen arama (X-Bridge-Token gerekir)

### Raporlar
- `GET /api/reports/daily` — Günlük rapor
- `GET /api/reports/range` — Tarih aralığı raporu

### Yazıcı
- `POST /api/print/receipt` — Müşteri fişi
- `POST /api/print/kitchen` — Muıtfak fişi

## Caller ID (Clipboard Akışı - Önerilen)

CID 812 için repo içindeki aktif ve düşük riskli akış clipboard dinleme yaklaşımıdır:

- CIDSHOW benzeri uygulama cihazdan numarayı alır ve clipboard'a yazar.
- PowerShell izleyici scripti clipboard'daki yeni 10-11 haneli numarayı yakalar.
- Script numarayı `POST /api/bridge/caller-id/incoming` endpoint'ine `X-Bridge-Token` ile gönderir.
- Backend `processIncomingCall` zinciri ile `call_logs` kaydı üretir; frontend popup/polling otomatik çalışır.

### Hızlı Kurulum

```powershell
# 1) Gerekli env'ler
$env:BRIDGE_TOKEN="YOUR_BRIDGE_TOKEN"
$env:API_BASE="http://127.0.0.1:3001/api"

# 2) Dinleyiciyi çalıştır (önerilen yeni script)
powershell -ExecutionPolicy Bypass -File .\scripts\callerid-clipboard-listener.ps1
```

### StoreBridge Notu

- `store-bridge` içinde `CID812_MODE=clipboard` varsayılandır.
- `CID812_MODE=hid-experimental` yalnızca legacy analiz amaçlıdır (önerilmez).

### Çalıştırma Sırası (Önerilen)

1. POS backend ve frontend'i başlat (`npm run dev`).
2. StoreBridge'i başlat (print polling aktif, CID HID yolu varsayılan pasif).
3. CIDSHOW TEST içinde cihaz okuma + panoya kopyala özelliğini aktif et.
4. Clipboard listener scriptini başlat.
5. Test araması yap; popup ve paket sipariş yönlendirme akışını doğrula.

### Listener Parametreleri

`scripts/callerid-clipboard-listener.ps1` şu parametre/env değerlerini destekler:

- `ApiBase` veya `API_BASE` (default: `http://127.0.0.1:3001/api`)
- `BridgeToken` veya `BRIDGE_TOKEN` (zorunlu)
- `SourceType` veya `CALLERID_SOURCE_TYPE` (default: `callerid_clipboard`)
- `PollMs` veya `CALLERID_POLL_MS` (default: `300`)
- `DebounceMs` veya `CALLERID_DEBOUNCE_MS` (default: `4000`)

Script yalnızca 10-11 haneli numaraları gönderir, aynı numarada debounce uygular ve hata durumunda döngüyü kapatmaz.

### Opsiyonel Windows Kısayolu

`.\\scripts\\start-callerid-clipboard.bat` dosyası listener'ı hızlı başlatmak için eklenmiştir.

## Caller ID (SDK Helper - Primary Aday)

Vendor `cid.dll` örnekleri baz alınarak izole bir C# helper eklendi:

- Proje: `tools/callerid-sdk-helper`
- Model: `SetEvents` callback (vendor örneklerine sadık)
- Varsayılan mod: log-only (POST kapalı)
- Opsiyonel mod: backend bridge endpoint'ine POST

### Neden izole helper?

- Node tarafına native ffi/callback riski sokmadan SDK denenebilir.
- x86/x64 DLL yükleme sorunları ayrı süreçte izole edilir.
- Mevcut backend/frontend/store-bridge akışları değişmeden kalır.

### Build ve Çalıştırma

```powershell
dotnet build .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -c Release

# İlk test: log-only
dotnet run --project .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -- --api-base http://127.0.0.1:3001/api

# POST modu (bridge token gerekli)
$env:BRIDGE_TOKEN="YOUR_BRIDGE_TOKEN"
dotnet run --project .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -- --api-base http://127.0.0.1:3001/api --post-enabled true --source-type callerid_sdk_helper --bridge-token $env:BRIDGE_TOKEN
```

### Primary / Fallback

- Primary aday: SDK helper (`callerid_sdk_helper`)
- Fallback: clipboard listener (`scripts/callerid-clipboard-listener.ps1`)
- Bridge endpoint ve `processIncomingCall` zinciri ortaktır: `POST /api/bridge/caller-id/incoming`

## Sonraki Geliştirmeler (Roadmap)

### Kısa Vadeli
- [ ] Ürün yönetimi admin paneli (CRUD form'ları)
- [ ] Kullanıcı yönetimi ekranı
- [ ] İşletme ayarları düzenleme formu
- [ ] Yazıcı konfigürasyon arayüzü
- [ ] Masa birleştirme ve hesap ayırma
- [ ] Sipariş geçmişi ekranı
- [ ] Tarih aralıklı raporlar

### Orta Vadeli
- [ ] PostgreSQL migration
- [ ] WebSocket ile gerçek zamanlı mutfak güncellemeleri
- [ ] Gerçek ESC/POS yazıcı entegrasyonu
- [ ] VoIP/SIP caller id entegrasyonu
- [ ] Barkod okuyucu desteği
- [ ] Stok takibi modülü

### Uzun Vadeli
- [ ] Multi-tenant SaaS yapısı
- [ ] Online sipariş entegrasyonu (Yemeksepeti, Getir, Trendyol)
- [ ] Mobil garson uygulaması
- [ ] Sadakat programı
- [ ] QR menü entegrasyonu
- [ ] Çoklu şube yönetimi
- [ ] Detaylı analitik dashboard

## Lisans

Bu proje özel kullanım amaçlıdır.
