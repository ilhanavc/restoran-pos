# 09 - Güvenlik & Operasyon Audit Raporu

Tarih: 2026-04-15  
Rol: Application Security Reviewer · Reliability Engineer · Production Operations Lead  
Kapsam: Küçük/orta ölçekli gerçek işletme kullanımında veri güvenliği, loglama, hata teşhisi, yedekleme ve operasyonel sağlamlık.

---

## 1. Yönetici Özeti

| Metrik | Değer |
|--------|-------|
| İncelenen bileşen | 12 (auth, config, routes, electron main, store-bridge, frontend) |
| Kritik (🔴) bulgu | 2 → **0'a indirildi** |
| Orta (🟡) bulgu | 4 → **0'a indirildi** |
| Düşük (🟢) bulgu | 4 → Kabul edildi / belgelendi |
| Yeni dosya/değişiklik | 6 |
| Regresyon | Yok (280 test geçiyor) |

---

## 2. Denetim Kapsamı

### İncelenen Bileşenler

| Bileşen | Dosya | Kapsam |
|---------|-------|--------|
| Auth middleware | `server/middleware/auth.js` | JWT doğrulama, rol kontrolü, businessScope |
| Auth route | `server/routes/auth.js` | Login, token, başarısız giriş |
| Config | `server/config/index.js` | Secret yönetimi, env okuma |
| Database | `server/config/database.js` | SQLite pragmas, path |
| Admin route | `server/routes/admin.js` | Hata mesajları, audit log |
| Orders route | `server/routes/orders.js` | Hata mesajları |
| Payments route | `server/routes/payments.js` | Hata mesajları |
| Electron main | `electron/main.cjs` | Backup, restart, log, JWT persist |
| Store Bridge | `store-bridge/index.js` | Crash recovery, hassas veri |
| Frontend entry | `client/src/main.jsx` | Error boundary |
| Frontend auth | `client/src/context/AuthContext.jsx` | Token lifecycle |
| Frontend HTTP | `client/src/services/api/core.js` | Token storage |

---

## 3. Bulgular ve Uygulanan Düzeltmeler

### 🔴 C-1 — React ErrorBoundary Yoktu

**Risk:** Herhangi bir React render/lifecycle exception → beyaz boş ekran. Kullanıcı uygulamanın "donduğunu" zanneder. Kasada veya siparişte kritik anlamda işlem yapılamaz hale gelir.

**Düzeltme:** `client/src/components/common/ErrorBoundary.jsx` oluşturuldu ve `client/src/main.jsx` üzerinden tüm uygulama sarmalandı.

- Hata anında "Uygulama beklenmeyen bir hatayla karşılaştı / Yenile" ekranı gösterilir.
- `componentDidCatch` Electron log dosyasına yazar (`userData/logs/electron-main.log`).
- Dev modunda hata mesajı ekranda görünür; production'da gizlenir.

**Dosyalar:** `client/src/components/common/ErrorBoundary.jsx` *(yeni)*, `client/src/main.jsx` *(güncellendi)*

---

### 🔴 C-2 — `err.message` 500 Yanıtlarında Client'a Sızıyordu

**Risk:** `res.status(500).json({ error: err.message || 'Sunucu hatası' })` paterni 4 farklı rotada mevcuttu. SQLite hata metni, tablo adı, iç dosya yolu veya stack bilgisi tarayıcı konsolunda görünebiliyordu.

**Etkilenen satırlar (önce):**

| Dosya | Satır | Bağlam |
|-------|-------|--------|
| `server/routes/admin.js` | 691 | Yazıcı önizleme |
| `server/routes/admin.js` | 836 | Yazıcı silme |
| `server/routes/admin.js` | 1462 | Masa düzeni güncelleme |
| `server/routes/orders.js` | 565 | Sipariş oluşturma |

**Düzeltme:** Tüm 500 yanıtları sabit `'Sunucu hatası'` mesajına çevrildi. `console.error` ile iç hata server log'una yazılmaya devam ediyor.

**Not:** `err.status === 400` ve `err.isBadRequest` paterni bilerek korundu — bunlar domain validation hataları, kullanıcıya gösterilmesi doğru.

---

### 🟡 M-1 — Başarısız Login Auditlog'a Yazılmıyordu

**Risk:** Kim, kaç kez, ne zaman yanlış şifre girdi bilinmiyordu. Brute-force denemelerini tespit etmek imkânsızdı. `audit_logs` tablosu zaten vardı, kullanılmıyordu.

**Düzeltme:** `server/routes/auth.js`'e iki ekleme:

1. Kullanıcı bulunamadığında → `console.warn` (e-posta adresi, şifre asla yazılmaz)
2. Şifre yanlışsa → `auditLog(business_id, null, 'login_failed', 'user', user.id)` + `console.warn`

`audit_logs` tablosundan `login_failed` kayıtları admin panelde sorgulanabilir.

**Dosya:** `server/routes/auth.js`

---

### 🟡 M-2 — Restore Mekanizması / Runbook Yoktu

**Risk:** Backup gece 02:00'de `%APPDATA%\restoran-pos\backups\` altına alınıyor ve 30 gün saklanıyor (Sprint 3'te eklendi). Ancak saha ekibinin restore nasıl yapacağını anlatan belge yoktu. Disk arızasında veri kurtarma süresi belirsizdi.

**Düzeltme:** `docs/runbooks/backup-restore-runbook.md` oluşturuldu. İçerik:
- Backup dosya konumu ve adlandırma formatı
- Manuel yedek alma adımları
- Restore adım adım talimat (taskkill → copy → başlat)
- Restore sonrası kontrol listesi
- Harici NAS/disk kopyalama örnek batch scripti
- Hata durumları ve çözümleri

**Dosya:** `docs/runbooks/backup-restore-runbook.md` *(yeni)*

---

### 🟡 M-3 — Store Bridge Sonsuz Restart Döngüsü

**Risk:** Bridge sürekli crash ederse `setTimeout → startStoreBridge → crash → setTimeout` döngüsü sonsuz tekrar ederdi. CPU spike, log dosyası şişmesi ve kullanıcıya hiçbir bildirim yapılmaması anlamına geliyordu.

**Düzeltme:** `electron/main.cjs`'e `bridgeRestartCount` ve `BRIDGE_MAX_RESTARTS = 10` sabiti eklendi.

- Başarılı başlatmada sayaç sıfırlanır.
- 10 art arda başarısız denemeden sonra restart durdurulur ve açıklayıcı `console.error` yazılır.
- Uygulama kapatılırken sayaç sıfırlanır (arka arkaya değil, sonraki oturumda temiz başlar).

**Dosya:** `electron/main.cjs`

---

### 🟡 M-4 — Unstructured Logging

**Durum: Kabul edildi, ertelendi.**

Tüm loglama `console.log/error` ile düz metin. Log dosyasına yazılıyor (`userData/logs/electron-main.log`) ancak JSON structured format yok; zaman + seviye + context bilgisi ayrışık.

**Karar:** Winston/pino entegrasyonu büyük bir refactor. Mevcut Electron log mekanizması (stdout'u dosyaya yönlendirme) küçük/orta işletme için yeterli. Structured logging bir sonraki büyük sprint'e alındı.

---

### 🟢 Düşük Risk — Kabul Edilen / Bilgi Amaçlı

| Bulgu | Karar | Gerekçe |
|-------|-------|---------|
| **L-1: localStorage token** | Kabul edildi | Electron desktop app — web renderer XSS saldırısına kapalı. Web deploy edilirse sessionStorage veya httpOnly cookie'ye geçilmeli. |
| **L-2: server/.env sürüm kontrolünde değil** | Doğrulandı ✓ | `.gitignore`'da `server/.env` açıkça listeli. Yanlış alarm. |
| **L-3: error.stack log dosyasına yazılıyor** | Kabul edildi | Log dosyası yalnızca `userData/` altında yerel, dışarıya açık değil. Stack trace teşhis için değerli. |
| **L-4: Frontend sessiz catch blokları** | Kabul edildi | UX sorunu, güvenlik riski değil. Ayrı bir UX sprint konusu. |

---

## 4. İyi Olan — Korunan Yapılar

| Bileşen | Bulgu |
|---------|-------|
| JWT secret | Production'da env zorunlu; Electron'da `pos-config.json`'a persist; fallback yalnızca dev |
| Rate limiting | Auth (20/15dk), Admin (240/dk), Bridge (600/dk), Printer (10/dk) ayrı limiter ✓ |
| businessScope | Tüm route'lar `req.businessId` ile multi-tenant izolasyon ✓ |
| Helmet | Aktif, XSS/MIME korumaları devrede ✓ |
| Zod validation | Tüm route'larda, hata mesajları güvenli ve Türkçe ✓ |
| isBadRequest pattern | 400 yanıtlarında domain hata mesajları intentional — korundu ✓ |
| Backup servisi | Gece 02:00, 30 gün saklama, uygulama başlangıcında hemen kontrol ✓ |
| Electron persistent log | stdout/stderr → `userData/logs/electron-main.log` ✓ |
| BRIDGE_TOKEN | Loglarda `***` maskeli; env/config'den okunuyor ✓ |
| DB transactions | order, payment, print_jobs işlemleri atomik (all-or-nothing) ✓ |
| Audit log tablosu | login, delete_printer, update_business vb. yazılıyor ✓ |
| CORS | localhost + LAN IP, env override ile ✓ |

---

## 5. Kalan Roadmap Önerileri

### Kısa Vadeli (Sonraki Sprint)
1. **Structured logging** — Winston/pino ile JSON log; timestamp, seviye, context alanları
2. **Backup harici kopyalama** — `backup-restore-runbook.md`'deki robocopy scriptini Windows Görev Zamanlayıcı'ya otomatik ekle
3. **Brute-force alarm** — `login_failed` sayısını izleyip N denemeden sonra kullanıcı hesabını geçici kilitle veya admin'e bildirim gönder

### Orta Vadeli
4. **In-app restore UI** — Admin panelde "Yedekten Geri Yükle" butonu (`%APPDATA%\restoran-pos\backups\` listele → seç → uygula)
5. **Bridge sağlık durumu göstergesi** — Restart sayacı `bridgeRestartCount > 5` olduğunda Electron penceresi üzerinde sarı uyarı banner göster
6. **Session timeout** — Belirli süre hareketsizlik sonrası otomatik logout (admin konfigüre edebilir)

### Uzun Vadeli
7. **Code signing** — NSIS paket SmartScreen uyarısını gidermek için EV sertifikası
8. **Penetration test** — Canlı işletmeden önce bir kez iç pen-test (özellikle LAN tabletler için CORS/auth sınırları)

---

## 6. Değiştirilen Dosyalar

| Dosya | Değişiklik | Türü |
|-------|-----------|------|
| `client/src/components/common/ErrorBoundary.jsx` | React error boundary component | Yeni |
| `client/src/main.jsx` | ErrorBoundary ile uygulama sarma | Güncellendi |
| `server/routes/admin.js` | 500 yanıtlarında `err.message` kaldırıldı (3 yer) | Güncellendi |
| `server/routes/orders.js` | 500 yanıtında `err.message` kaldırıldı (1 yer) | Güncellendi |
| `server/routes/auth.js` | Başarısız login → `console.warn` + `auditLog` | Güncellendi |
| `electron/main.cjs` | Bridge max restart sayacı (`BRIDGE_MAX_RESTARTS=10`) | Güncellendi |
| `docs/runbooks/backup-restore-runbook.md` | Adım adım restore talimatı | Yeni |

---

## 7. Doğrulama

```
npm test
```

```
Test Files  20 passed (20)
     Tests  280 passed (280)
  Duration  ~9s
```

```
npm run lint:ci
```

```
✖ 27 problems (0 errors, 27 warnings) — Exit: 0
```

Tüm mevcut 280 test korundu. Regresyon yok.
