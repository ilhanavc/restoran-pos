# 🍽️ Restoran POS Sistemi

Modern, dokunmatik uyumlu, Türkçe arayüzlü restoran adisyon ve satış noktası sistemi.

## Özellikler

- **Masa Yönetimi** — Salon/alan bazlı masa grid, durum takibi, masa transferi
- **Sipariş Ekranı** — Kategori → ürün akışı, modifier desteği, ürün notu, adisyon paneli
- **Paket Sipariş** — Müşteri arama/oluşturma, adres yönetimi, ayrı sipariş akışı
- **Caller ID** — Gelen arama eşleştirme, müşteri popup, tek tıkla sipariş başlatma
- **Ödeme** — Nakit/kart/karışık, indirim, para üstü hesaplama, otomatik adisyon kapama
- **Mutfak Ekranı** — Aktif siparişler, ürün bazlı hazırlık takibi
- **Müşteri Yönetimi** — Çoklu telefon/adres, sipariş geçmişi
- **Raporlar** — Günlük satış, ödeme dağılımı, en çok satanlar, kategori/kullanıcı bazlı
- **Yazıcı Entegrasyonu** — Mock servis (ESC/POS hazır mimari)
- **Rol Bazlı Yetkilendirme** — Yönetici, Kasiyer, Garson, Mutfak
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

### Demo Giriş Bilgileri

| Rol | E-posta | Şifre |
|-----|---------|-------|
| Yönetici | admin@demo.com | 123456 |
| Kasiyer | kasiyer@demo.com | 123456 |
| Garson | garson@demo.com | 123456 |
| Mutfak | mutfak@demo.com | 123456 |

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
│       │   ├── kitchen/       # Mutfak ekranı
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
- `GET /api/orders/active` — Mutfak aktif siparişler
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

### Raporlar
- `GET /api/reports/daily` — Günlük rapor
- `GET /api/reports/range` — Tarih aralığı raporu

### Yazıcı
- `POST /api/print/receipt` — Müşteri fişi
- `POST /api/print/kitchen` — Mutfak fişi

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
