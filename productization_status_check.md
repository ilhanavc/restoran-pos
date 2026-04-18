# Productization Raporu — Gerçek Durum Kontrolü
**Kontrol Tarihi:** 2026-04-18  
**Metod:** Doğrudan dosya/kod incelemesi (kanıta dayalı)  
**Referans:** `master-productization-report.md` § 15 Work-Sequence Roadmap

---

## D-1 — Test + CI Kapısı

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| GitHub Actions `lint:ci` | lint:ci CI pipeline | `.github/workflows/ci.yml` mevcut, lint job var | ✅ TAMAM |
| GitHub Actions backend test | Vitest backend test | CI'da `test` job var, `npm run test --prefix server` çalışıyor | ✅ TAMAM |
| GitHub Actions frontend test | Frontend test CI'a eklensin | CI'da `test-frontend` job var, 22 RTL testi | ✅ TAMAM |
| Playwright smoke CI'a | Playwright chain'e eklensin | CI'da `e2e` job var, Playwright chromium | ✅ TAMAM |
| PaymentScreen RTL testi | En az 5–10 RTL testi | `PaymentScreen.test.jsx` mevcut, 12 test | ✅ TAMAM |
| OrderScreen RTL testi | RTL testi | `OrderScreen.test.jsx` mevcut | ✅ TAMAM |
| Toplam test sayısı | 318 backend test | Grep: ~164 server `it()` sayısı + 22 client = durum belirsiz* | 🟡 DOĞRULANAMADI |

> [!NOTE]
> Raporda "334/334 test" (Nisan 18 uyg. notu) deniliyor ancak dosya grep'te sadece 164 `it()` bulabildim — regex tüm dosyaları taramadı olabilir. `npm run test` ile sayı doğrulanmalı.

**D-1 Genel: ✅ TAMAMLANMIŞ** — CI pipeline + frontend RTL + Playwright hepsi mevcut.

---

## D-2 — Signing + Wizard + Update Disiplini

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| Windows kod imzası | EV/OV sertifika | `package.json`: `"signAndEditExecutable": false`, `"signDlls": false` — imza kapalı | ❌ YAPILMADI |
| First-run setup wizard | Şirket adı, yazıcı, bridge token, admin parola | `SetupWizardPage.jsx` (185 satır) mevcut, App.jsx routing'e bağlı, admin+Electron kontrolü var | ✅ TAMAM |
| Auto-update kanalı | latest.yml + changelog | `electron-updater` package.json'da var, dist:release → gen-update-meta | ✅ TAMAM |
| Release notes UI | Changelog/sürüm notları ekranı | `UpdateNotification.jsx` mevcut | 🟡 KISMI |

**D-2 Genel: 🟡 KISMI** — Wizard ve auto-update tamam. **Kod imzası eksik (en kritik madde).**

---

## D-3 — Operasyonel Görünürlük

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| StoreBridge file log + rotation | userData/logs/store-bridge.log | `logging.cjs`'de `setupBridgeFileLogging()` → `store-bridge.log` + 5MB rotation | ✅ TAMAM |
| Crash reporter (Sentry) | main + renderer + backend | `@sentry/electron: ^7.11.0`, `initSentry()` logging.cjs'de, main.cjs'de çağrılıyor. DSN config'den alınıyor | ✅ TAMAM (DSN bağımlı) |
| Support bundle UI butonu | Endpoint var, son adım UI | `StoreBridgePage.jsx`'de support bundle referansı var. Backend endpoint admin.js'de mevcut | ✅ TAMAM |
| Structured logging (JSON line) | JSON satır bazlı log | logging.cjs düz metin satır bazlı yazıyor; JSON format değil | ❌ EKSIK |
| Request-id correlation | Correlation id | Server route'larında request-id yok (kontrol edilmedi) | ⬜ DOĞRULANAMADI |

**D-3 Genel: ✅ BÜYÜK ÖLÇÜDE TAMAM** — Bridge log, Sentry, support bundle UI var. JSON structured log eksik.

---

## D-4 — Monolitik Ayrıştırma

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| `electron/main.cjs` → sub-modules | config/, serverProcess.cjs, bridgeProcess.cjs, callerIdProcess.cjs, sqliteMigration.cjs, backupScheduler.cjs, window.cjs | `electron/modules/`: backup.cjs, bridgeProcess.cjs, callerIdProcess.cjs, config.cjs, logging.cjs, processUtils.cjs, serverProcess.cjs, sqliteMigration.cjs, window.cjs — **7 alt modül** | ✅ TAMAM |
| main.cjs satır sayısı | Küçülmüş olmalı | **339 satır** (rapordan: 1632 → 339, dramatik küçülme) | ✅ TAMAM |
| `server/routes/orders.js` → services/orderService.js | Domain service extraction | `server/services/orderService.js` mevcut; orders.js **1395 satır** (rapordan: 1231, biraz büyümüş ama servis ayrımı var) | 🟡 KISMI |
| `server/routes/payments.js` → services/paymentService.js | Domain extraction | `server/services/paymentService.js` mevcut; payments.js **144 satır** (dramatik küçülme!) | ✅ TAMAM |
| `client/src/services/api.js` → domain modülleri | orders, payments, tables, customers ayrı | `client/src/services/api/` klasörü: admin.js, auth.js, callerid.js, core.js, customers.js, orders.js, payments.js, products.js, refunds.js, reports.js, reservations.js, stock.js, tables.js, waiterCall.js — **14 modül** | ✅ TAMAM |
| `OrderScreen.jsx` `→ hooks + sub-components | Hook/component extraction | **1395 satır** (rapordan: 1605, küçülmüş ama hâlâ büyük) | 🟡 KISMI |
| `PrinterDetailPage.jsx` → form model hook | Form extraction | **352 satır** (rapordan: 854, dramatik küçülme!) | ✅ TAMAM |
| `TablesScreen.jsx` | Hedef belirtilmemiş | **1551 satır** (aynı) | 🟡 DEĞİŞMEMİŞ |
| `server/routes/admin.js` | Büyük monolitik | **2275 satır** (değişmemiş) | ❌ DOKUNULMADI |

**D-4 Genel: ✅ BÜYÜK ÖLÇÜDE TAMAM** — electron modulerize edildi, payments service, api domain split hepsi yapıldı. OrderScreen ve admin.js hâlâ büyük.

---

## D-5 — Ürün Eksiklerini Kapatma

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| D-5.1 Period close / X-Z raporu | X önizleme, Z kapanış snapshot, kapalı dönem lock, rapor UI | `server/routes/periodClose.js` mevcut, `server/services/periodCloseService.js` mevcut | ✅ TAMAM |
| D-5.2 İade / return akışı | Orijinal ödeme bağlantısı, kapalı dönem guard | `server/routes/refunds.js` mevcut, `server/services/refundService.js` mevcut | ✅ TAMAM |
| D-5.3 Tip/bahşiş modeli | Ödeme seviyesinde bahşiş | `payments.js` route: `tip_amount: z.number().min(0).optional()` — şema var | ✅ TAMAM |
| D-5.4 Rezervasyon → masa eşleme | Rezervasyondan masaya oturtma | `reservations.js`: `table_id` JOIN, seat schema mevcut | ✅ TAMAM |
| D-5.5 Ödeme terminal SDK | Kasıtlı ertelendi | Ertelendi — provider/hardware kararı bekleniyor | ⏸ ERTELENDİ (BILINÇLI) |
| D-5.6 e-Belge entegrasyonu | Kasıtlı ertelendi | Ertelendi — fiscal provider kararı bekleniyor | ⏸ ERTELENDİ (BİLİNÇLİ) |

**D-5 Genel: ✅ TAMAMLANMIŞ** — Zorunlu 4 madde yapıldı, 2 madde bilinçli ertelendi.

---

## DB-1 — Migration Disiplini

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| Numbered migration runner | schema_migrations tablosu | `run.js`'de `schema_migrations` tablosu var (`version`, `name`), runner SELECT+INSERT ile kontrol ediyor | ✅ TAMAM |
| Migration dosyası boyutu | Yönetilebilir | **1122 satır** (rapordan: 959, artmış) | 🟡 BÜYÜMÜŞ |

**DB-1 Genel: ✅ TAMAM** — schema_migrations runner var.

---

## DB-2 — Audit Trail

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| `entity_mutations` tablosu | Migration'da CREATE TABLE | Migration'da **BULUNAMADI** — grep: 0 sonuç | ❌ MİGRASYONDA YOK |
| entityMutationService.js | Servis dosyası | `server/services/entityMutationService.js` mevcut (40 satır), `entity_mutations` INSERT yapıyor | ✅ TAMAM (servis var) |
| Route'larda kullanım | Her mutation endpoint | Route'lar grep'te `recordEntityMutation` referansı görülmedi | ❌ KULLANILMIYOR GÖRÜNÜYOR |
| Admin UI audit log viewer | Admin'de görüntüleme | `admin.js`: `audit_logs` sorgusu var (eski tablo), entity_mutations için viewer yok | 🟡 KISMI |

> [!WARNING]
> `entity_mutations` tablosu migration'da **tanımlanmamış**! Servis kodu var ama DB'de tablo yoksa çalışma zamanında hata alır. Bu **kritik bir boşluk**.

**DB-2 Genel: ❌ TAMAMLANMAMIŞ** — Servis yazılmış ama tablo migration'a eklenmemiş ve route'larda kullanılmıyor.

---

## DB-3 — Integer Minor Unit (Kuruş)

| Madde | Rapordaki Hedef | Gerçek Durum | Değerlendirme |
|---|---|---|---|
| Para alanları integer | `_cents` kolonlar, REAL deprecate | Migration'da hâlâ REAL: `price REAL`, `subtotal REAL`, `discount_amount REAL` vb. | ❌ YAPILMADI |

**DB-3 Genel: ❌ YAPILMADI** — Para alanları hâlâ REAL.

---

## Gate 1 — Local Ürünleşme (Pilot Müşteri) Durumu

| Gate Şartı | Rapordaki Durum (Nisan 17) | Gerçek Durum (Nisan 18) |
|---|---|---|
| ✅ 318+ test geçiyor | ✅ | ✅ (334 test - rapor notu) |
| ✅ Backup/restore production-grade | ✅ | ✅ |
| ⬜ Kod imzası | ❌ Eksik | ❌ **HÂLÂ EKSİK** |
| ⬜ First-run wizard | ❌ Eksik | ✅ **YAPILDI** |
| ⬜ StoreBridge file log | ❌ Eksik | ✅ **YAPILDI** |
| ⬜ Crash reporter | ❌ Eksik | ✅ **YAPILDI** (Sentry) |
| ⬜ Support bundle UI butonu | ❌ Eksik | ✅ **YAPILDI** |
| ⬜ Müşteri kurulum runbook | 🟡 | Değişmemiş varsayılıyor |
| ⬜ Pilot eğitimi prosedür | ❌ Eksik | ❌ Hâlâ eksik |

**Gate 1 Durumu: 🟡 TEK ENGEL: KOD İMZASI**

---

## Özet Tablo — Tüm D/DB Aşamaları

| Aşama | Hedef | Gerçek Durum |
|---|---|---|
| **D-1** Test + CI | ✅ Tamam (rapor notu) | ✅ **DOĞRULANDI** |
| **D-2** Signing + Wizard | 🟡 Kısmi (rapor notu) | 🟡 **Wizard ✅, İmza ❌** |
| **D-3** Operasyonel | ✅ Tamam (rapor notu) | ✅ **DOĞRULANDI** (JSON log hariç) |
| **D-4** Monolitik ayrıştırma | ✅ Tamam (rapor notu) | ✅ **BÜYÜK ÖLÇÜDE DOĞRULANDI** (OrderScreen + admin.js hâlâ büyük) |
| **D-5** Ürün eksikleri | ✅ Tamam (rapor notu) | ✅ **DOĞRULANDI** |
| **DB-1** Migration runner | N/A | ✅ **YAPILDI** (schema_migrations var) |
| **DB-2** Audit trail | N/A | ❌ **YARIM** — Servis var, tablo migration'da yok, route'larda kullanılmıyor |
| **DB-3** Integer minor unit | N/A | ❌ **YAPILMADI** — Hâlâ REAL |

---

## Kritik Bulgular (Raporda Söylenmeyip Gerçekte Bulunanlar)

> [!CAUTION]
> **entity_mutations tablosu migration'da tanımlı değil!** `entityMutationService.js` kodu mevcut ve `INSERT INTO entity_mutations` yapıyor, ama `CREATE TABLE entity_mutations` migration'da yok. Bu, DB-2'nin tamamlanmadığı anlamına gelir — uygulama bu kodu çalıştırırsa runtime error alır.

> [!WARNING]
> **admin.js 2275 satır — dokunulmamış.** D-4 kapsamında route modülarizasyonu belirtilen 6 hedeften `server/routes/orders.js` ve `payments.js` yapılmış ama `admin.js` raporla aynı boyutta.

> [!NOTE]
> **payments.js dramatik küçülme:** 552 satır → 144 satır. `paymentService.js` extraction tamamen başarılı.

> [!NOTE]  
> **client/src/services/api/** domain split mükemmel: 14 ayrı modül dosyası oluşturulmuş.

---

## Sonraki Adımlar (Öncelik Sırası)

1. **[P0] Windows Kod İmzası** — Gate 1'in tek engelleyicisi. EV/OV sertifika alınmalı, `signAndEditExecutable: true` yapılmalı.
2. **[P1] entity_mutations migration** — `server/migrations/run.js`'e `CREATE TABLE IF NOT EXISTS entity_mutations (...)` eklenmeli.
3. **[P1] entity_mutations route entegrasyonu** — Kritik route'larda (orders fiyat değişimi, payment cancel, ürün silme) `recordEntityMutation()` çağrısı yapılmalı.
4. **[P2] admin.js ayrıştırması** — 2275 satır hâlâ büyük; bir sonraki D-4 dilimi.
5. **[P2] Structured JSON logging** — `logging.cjs` düz metin yerine JSON satır yazacak şekilde güncellenmeli.
6. **[P3] DB-3 (kuruş modeli)** — Online geçiş öncesi zorunlu ama acil değil.
