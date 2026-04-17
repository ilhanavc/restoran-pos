# Repo Cleanup Audit — Restoran POS v3

**Tarih:** 2026-04-17  
**Analist:** Staff Engineer / Release Hardening Lead  
**Kural:** Bu turda hiçbir şey silinmez. Bu sadece analiz + sınıflandırma turu.

---

## 1. Genel Özet

| Metrik | Değer |
|--------|-------|
| Toplam kaynak dosyası (node_modules hariç) | ~220 dosya |
| Ölü/kullanılmayan kaynak kodu | **0** (tüm .jsx/.js/.cjs aktif) |
| Silinebilir artifact/tmp (disk) | **~760 MB** |
| Git'te takip edilmemesi gereken büyük dosya | 1 PDF (~432 KB, kök dizinde) |
| Duplicate script | 3 alan |
| Orphaned npm script | 3 adet |
| Gitignore'da eksik kayıt | 2 aday |

> **Genel Sağlık:** Frontend ve backend kaynak kodu çok temiz. Hiçbir ölü bileşen, dead route ya da import edilmeyen util yok.  
> Problem tamamen **artifacts, geçici dosyalar, duplicate script'ler ve build çıktıları** üzerinde yoğunlaşıyor.

---

## 2. Kesin Gereksiz — Silinebilir

> Kanıtlanmış olarak kullanılmıyor, gitignore kapsamında ya da yenisiyle tamamen yerini almış.

### 2.1 `.tmp/` Dizini (2.6 MB)
```
.tmp/
  docx-unpacked/          ← generate-roadmap.cjs çalıştırılınca oluşan Word unpack çıktısı
  print-rollback-20260413-151229/
    pos.db                ← 1.5 MB geliştirme rollback DB yedek (Apr 13)
    printJobs.js          ← eski kod yedek kopyası
    renderers.js          ← eski kod yedek kopyası
```
**Kanıt:** `.gitignore` → `.tmp/` zaten gitignore'da. Tüm içerik, geliştirme sırasında oluşmuş geçici debug/rollback dosyaları.  
**Risk:** Düşük — runtime'da hiçbiri kullanılmıyor. Yeni `pos.db` `server/data/pos.db`'de.

---

### 2.2 `dist-electron/` Eski Build Zip'leri (~400 MB)
```
dist-electron/
  Restoran-POS-1.0.7-win.zip   ← 127 MB, 2 sürüm öncesi
  Restoran-POS-1.0.8-win.zip   ← 127 MB, 1 sürüm öncesi
  Restoran-POS-1.0.9-win.zip   ← 144 MB, GÜNCEL — SAKLA
  win-unpacked/                ← 194 MB, dist:prepare çıktısı (yeniden üretilir)
  builder-debug.yml            ← electron-builder debug log
  latest.yml                   ← electron-updater meta (gen-update-meta.cjs çıktısı)
```
**Kanıt:** `.gitignore` → `dist-electron/` kapsanıyor. 1.0.7 ve 1.0.8 zip'leri artık aktif release değil.  
`win-unpacked/` her `dist:prepare` çalıştırmasında sıfırdan yeniden üretilir.  
**Risk:** Düşük — tümü yeniden üretilebilir. Sadece 1.0.9.zip korunabilir (son release kanıtı).

---

### 2.3 `release/` Dizini (içerik ~0 KB)
```
release/
  restoran-pos-1.0.0-x64.nsis.7z  ← 32 byte (!), bozuk/placeholder
  win-unpacked/                     ← boş dizin
```
**Kanıt:** `.gitignore` → `release/` kapsanıyor. `.7z` dosyası 32 byte — ya yanlışlıkla oluşturulmuş placeholder ya da bozuk.  
**Risk:** Düşük — içerik tamamen boş ya da bozuk.

---

### 2.4 `tools/callerid-sdk-helper/obj/` (.NET Build Artifacts, 245 KB)
```
tools/callerid-sdk-helper/obj/
  *.cache, *.cs, *.dll, *.props, *.targets, ...
```
**Kanıt:** `.gitignore` → `tools/**/obj/` kapsanıyor. `dotnet publish` her çalıştırıldığında sıfırdan oluşur.  
**Risk:** Düşük — tamamen yeniden üretilir.

---

### 2.5 `scripts/generate-latest-yml.cjs` (1.2 KB) — Superseded
```js
// Generates latest.yml for electron-updater (zip-based update)
// Usage: node scripts/generate-latest-yml.cjs
```
**Kanıt:** `scripts/gen-update-meta.cjs` (2.6 KB) ile işlevsel olarak aynı amaca hizmet ediyor. `gen-update-meta.cjs`, `dist:gen-update-meta` npm script'ine bağlı ve aktif olarak kullanılıyor. `generate-latest-yml.cjs` ise hiçbir npm script'inde yok. İki script de `latest.yml` üretiyor.  
**Risk:** Düşük — aktif pipeline'da kullanılmıyor.

---

### 2.6 `scripts/caller-id/clipboard-watcher.ps1` — Self-Declared Deprecated
```powershell
# Deprecated compatibility shim.
# Yeni script: .\scripts\callerid-clipboard-listener.ps1
```
**Kanıt:** Scriptin kendisi "deprecated" olduğunu beyan ediyor. Gerçek implementasyon `scripts/callerid-clipboard-listener.ps1`'de.  
**Klasör:** `scripts/caller-id/` tek dosyalı ve bu shim dışında içeriği yok.  
**Risk:** Düşük — deprecated shim + boş klasör.

---

### 2.7 `scripts/start-callerid-sdk-helper.bat` (48 byte) — Wrapper Stub
```bat
@echo off
call "%~dp0start-callerid-helper.bat"
```
**Kanıt:** Sadece `start-callerid-helper.bat`'ı çağıran 2 satırlık wrapper. Hiçbir npm script'inde referans yok; `start-callerid-helper.bat` doğrudan kullanılabilir.  
**Risk:** Düşük — gereksiz indirection katmanı.

---

### 2.8 `test-results/.last-run.json` (45 byte) — Playwright Run Cache
**Kanıt:** Playwright test engine'inin otomatik oluşturduğu son çalıştırma meta dosyası. Geliştirici makinesi özgü, runtime'da kullanılmıyor.  
**Risk:** Düşük.

---

### 2.9 `data/pos.db` Kök Dizinde (312 KB) — Stale Dev DB
```
/data/pos.db  (312 KB, Apr 4 — 2 hafta önce)
vs.
/server/data/pos.db  (1.9 MB, aktif ve güncel)
```
**Kanıt:** `.gitignore` → `/data/` kapsanıyor. Kök `data/pos.db` eski bir geliştirme kopyası. Aktif veritabanı `server/data/pos.db`'de. İkisi çok farklı boyutta (312 KB vs 1.9 MB) — eski versiyon.  
**Risk:** Düşük — runtime sadece `server/data/pos.db` kullanıyor.

---

## 3. Yüksek İhtimalle Gereksiz — Doğrulama Gerekli

### 3.1 `scripts/generate-roadmap.cjs` (49.4 KB!) — Orphaned Generator
**Kanıt:** Hiçbir npm script'inde referans yok. Çalıştırıldığında `.tmp/docx-unpacked/` üretiyor (bkz. 2.1). Son çalıştırma Apr 6, `Restoran-POS-v3-Yol-Haritasi-Raporu-temiz-kopya.pdf` ile örtüşüyor.  
**Soru:** Bu script aktif olarak kullanılacak mı? Eğer hayır → silinebilir. Eğer evet → `package.json`'a script eklenip dokümante edilmeli.  
**Risk:** Orta — 50 KB kaynak kod, kendisi zararsız ama `.tmp` kirliliği üretiyor.

---

### 3.2 `scripts/render-audit-reports.cjs` (10.6 KB) — Orphaned Renderer
**Kanıt:** `docs/audit/html/` ve `docs/audit/pdf/` dizinleri mevcut değil — hiç çalıştırılmamış ya da çıktı silinmiş. Hiçbir npm script'inde referans yok.  
**Soru:** Audit raporlarının HTML/PDF versiyonu aktif bir iş akışının parçası mı?  
**Risk:** Orta — zararsız ama ölü kod.

---

### 3.3 `scripts/scan-hid-devices.js` (5.1 KB) + `scripts/cid812-raw-monitor.js` (6.2 KB)
**Kanıt:** Hiçbir npm script'inde yok. CallerID HID donanım geliştirmesi sırasında yazılmış debug araçları.  
**Soru:** Aktif donanım debugi için tutulacak mı? Eğer CallerID SDK helper yeterli ise → gerekmiyor.  
**Risk:** Düşük — sadece geliştirici araçları, production'ı etkilemez.

---

### 3.4 `server/test-login.js` — Manual Debug Script
**Kanıt:** Otomatik test değil, JWT token üretmek için manuel CLI tool. Aktif test suite'e dahil değil. `vitest.config.js`'de exclude listesinde değil ama `*.test.js` pattern'ı dışında olduğu için otomatik çalışmıyor.  
**Soru:** Geliştirici bu scripti aktif olarak kullanıyor mu?  
**Risk:** Düşük — production'ı etkilemiyor.

---

### 3.5 `Restoran-POS-v3-Yol-Haritasi-Raporu-temiz-kopya.pdf` (432 KB) — Root-Level PDF
**Kanıt:** Kök dizinde, `.gitignore`'da listelenmiyor. Apr 6 tarihli. `generate-roadmap.cjs` ile üretilmiş roadmap "temiz kopyası". Git history'de izlenebilir — bu durumda repository boyutunu şişiriyor.  
**Soru:** Bu dosya git'te takip ediliyor mu? (`git ls-files | grep .pdf`)  
**Risk:** Orta — eğer git'te ise `.gitignore`'a eklenmeli ve history'den temizlenmeli (`git filter-repo`).

---

### 3.6 `pos-config.json` (282 byte) — Kök Dizinde Config
**Kanıt:** JWT secret ve diğer config değerlerini içeriyor. `.gitignore`'da açıkça listelenmemiş. `pos-config.example.json` commit edilmiş, ama gerçek `pos-config.json` güvenli olmalı.  
**Soru:** Bu dosya git'te takip ediliyor mu? Eğer evet → derhal `.gitignore`'a eklenip history'den temizlenmeli.  
**Risk:** **Yüksek** — JWT secret içeren config dosyası git'te olmamalı.

---

### 3.7 `docs/audit/` İçindeki Printer Sprint Pass Dosyaları (7 dosya)
```
docs/audit/auto-print-preferences-pass-1.md
docs/audit/manual-print-selector-pass-1.md
docs/audit/printer-detail-screen-pass-1.md
docs/audit/printer-discovery-ux-pass-1.md
docs/audit/printer-layout-contract-80mm.md
docs/audit/printer-main-screen-pass-1.md
docs/audit/printer-redesign-plan.md
docs/audit/printer-release-hardening-pass-1.md
docs/audit/desktop-core-hardening-plan.md
```
**Kanıt:** Sprint bazlı geçici çalışma dokümanları. Kararlar ve uygulamalar zaten `CLAUDE.md` ve ana audit raporlarına (00-11) entegre edildi. `desktop-core-hardening-plan.md` bu oturumda tamamlandı.  
**Soru:** Bu geçici pass dosyaları arşivlenmeli mi, yoksa `docs/audit/archive/` altına taşınmalı mı?  
**Risk:** Düşük — sadece dokümantasyon, runtime'ı etkilemiyor.

---

## 4. Korunmalı — Kritik Alanlar

> Bu alanlara dokunma. Yanlış silme → uygulama kırılır.

| Alan | Neden Kritik |
|------|-------------|
| `client/src/**` (tüm 54 dosya) | Tamamı aktif import zincirinde — 0 ölü dosya |
| `server/routes/**` (16 route) | Tümü `server/index.js`'de kayıtlı |
| `server/services/**` (4 servis) | printJobs, printRouting, printerAutoPrintPolicy, callerIdService |
| `server/middleware/**` | auth, bridgeAuth, validate — tümü aktif |
| `server/migrations/run.js` | Sunucu başlangıcında çalışıyor, şema versiyonu burada |
| `server/constants/orderStatus.js` | `admin.js` import ediyor — silinmez |
| `server/utils/helpers.js` | genId, auditLog, resolveOrderItemPrice — 12+ route tarafından kullanılıyor |
| `server/utils/phoneNormalize.js` | helpers.js ve migrations tarafından kullanılıyor |
| `server/socket.js` | initSocket, emitToRoom — real-time için kritik |
| `store-bridge/printers/encoding.js` | Türkçe karakter encode zincirinin merkezi |
| `store-bridge/printers/renderers.js` | ESC/POS şablonları burada |
| `store-bridge/printers/{ethernet,usb,windows}*.js` | Yazıcı bağlantı katmanı |
| `store-bridge/callerid/Cid812Provider.js` | CallerID donanım driver |
| `store-bridge/jobs/poller.js` | Print job polling döngüsü |
| `electron/main.cjs` | Electron entry point |
| `electron/preload.cjs` | IPC köprüsü |
| `tools/callerid-sdk-helper/` | Production binary + cid.dll (extraResources'a dahil) |
| `resources/elevate.exe` | Windows yetki yükseltme — Electron için gerekli |
| `server/data/pos.db*` | Aktif veritabanı ve WAL |
| `scripts/rebuild-server-native.cjs` | better-sqlite3 ABI rebuild — dist:prepare zincirinde kritik |
| `scripts/smoke-electron-sqlite.cjs` | Electron + SQLite smoke test |
| `scripts/smoke-server-health.cjs` | Server health smoke test |
| `scripts/build-callerid-helper.cjs` | .NET publish scripti |
| `scripts/check-desktop-release.cjs` | Preflight validation |
| `scripts/gen-update-meta.cjs` | latest.yml üretimi |
| `scripts/callerid-clipboard-listener.ps1` | CallerID fallback (PowerShell) |
| `scripts/start-all.bat` ve diğer start-*.bat | Windows başlatma scriptleri |
| `server/seeds/run.js` | Demo veri yükleyici |
| `docs/runbooks/**` | Kurulum, backup, code signing, printer test |
| `e2e/**` | Playwright smoke testler |

---

## 5. Duplicate veya Birleştirilmesi Gereken Alanlar

### 5.1 `generate-latest-yml.cjs` vs `gen-update-meta.cjs`

| Özellik | `generate-latest-yml.cjs` | `gen-update-meta.cjs` |
|---------|--------------------------|----------------------|
| Boyut | 1.2 KB | 2.6 KB |
| npm script | **Yok** | `dist:gen-update-meta` ✓ |
| Yöntem | zip SHA-512 | NSIS `.exe` SHA-512 |
| Durum | **Orphaned** | Aktif |

**Öneri:** `generate-latest-yml.cjs`'yi sil. Eğer zip tabanlı update gerekirse `gen-update-meta.cjs` genişletilmeli.

---

### 5.2 CallerID Clipboard Script Çifti

| Dosya | Durum |
|-------|-------|
| `scripts/callerid-clipboard-listener.ps1` | Aktif — asıl implementasyon |
| `scripts/caller-id/clipboard-watcher.ps1` | **Self-declared deprecated shim** |
| `scripts/caller-id/` dizini | Bu shim dışında içerik yok |

**Öneri:** `scripts/caller-id/` dizinini ve içindeki deprecated shim'i sil.

---

### 5.3 CallerID Başlatma Batch Script Çifti

| Dosya | İçerik | Durum |
|-------|--------|-------|
| `scripts/start-callerid-helper.bat` (1.3 KB) | Gerçek launcher | Aktif |
| `scripts/start-callerid-sdk-helper.bat` (48 byte) | Sadece `call start-callerid-helper.bat` | **Gereksiz wrapper** |

**Öneri:** `start-callerid-sdk-helper.bat`'ı sil.

---

### 5.4 Dual DB Lokasyonu — Gerçek Değil Duplicate, Ama Kafa Karıştırıcı

| Yol | Boyut | Tarih | Durum |
|-----|-------|-------|-------|
| `/data/pos.db` | 312 KB | Apr 4 | Stale geliştirme kopyası |
| `/server/data/pos.db` | 1.9 MB | Aktif | Gerçek çalışan DB |

**Not:** İkisi farklı boyutta — gerçek duplicate değil. Root `/data/pos.db` eski geliştirme döneminden kalmış.

---

### 5.5 `/api/callerid` vs `/api/caller-id` — Intentional, Değiştirilmez

```js
app.use('/api/callerid', calleridRoutes);
app.use('/api/caller-id', calleridRoutes);
```
**Kanıt:** `server/routes/callerid.js` header'ı bu dual-mount'ı dokümante ediyor.  
**Durum:** Geriye dönük uyumluluk için kasıtlı — dokunma.

---

### 5.6 `server/routes/orders.js` İçinde Inline Status Enum

`orders.js:229`'da `const orderStatuses = ['new', 'saved', ...]` şeklinde inline tanımlanmış.  
`server/constants/orderStatus.js` ise bu enum'un bir kısmını `ORDER_STATUSES_CLOSED` olarak export ediyor.  
**Öneri:** Refactor — `orders.js` içindeki inline enum `orderStatus.js`'den import edilmeli. Ama bu düşük öncelikli; sprint sonu değil, bakım penceresi işi.

---

## 6. Runtime Dışı Büyük Yer Kaplayan Dosya/Klasörler

| Konum | Boyut | Git'te mi? | Silinebilir mi? |
|-------|-------|-----------|----------------|
| `dist-electron/win-unpacked/` | ~194 MB | Hayır (gitignore) | Evet (dist:prepare yeniden üretir) |
| `dist-electron/Restoran-POS-1.0.7-win.zip` | 127 MB | Hayır | Evet |
| `dist-electron/Restoran-POS-1.0.8-win.zip` | 127 MB | Hayır | Evet |
| `dist-electron/Restoran-POS-1.0.9-win.zip` | 144 MB | Hayır | İsteğe bağlı (son release) |
| `tools/callerid-sdk-helper/bin/` | 6.6 MB | Hayır (gitignore) | Evet (dotnet publish yeniden üretir) |
| `tools/callerid-sdk-helper/obj/` | 245 KB | Hayır (gitignore) | Evet |
| `store-bridge/node_modules/` | ~4.9 MB | Hayır | Hayır (runtime gerekli) |
| `.tmp/print-rollback-20260413-151229/` | ~1.7 MB | Hayır | Evet |
| `.tmp/docx-unpacked/` | ~920 KB | Hayır | Evet |
| `Restoran-POS-v3-Yol-Haritasi-Raporu-temiz-kopya.pdf` | 432 KB | **Doğrulanmalı** | Evet (gitignore'a da eklenmeli) |
| `scripts/generate-roadmap.cjs` | 49 KB | Evet | Muhtemelen evet |
| `data/pos.db` (root) | 312 KB | Hayır (gitignore) | Evet (stale) |

**Toplam temizlenebilir disk alanı (muhafazakâr tahmin): ~460 MB**  
**Gitignore'da eksik olan kritik aday:** `pos-config.json` (doğrulanmalı)

---

## 7. Kullanılmayan Bağımlılıklar ve Script'ler

### 7.1 Kullanılmayan npm Script'leri (package.json)

| Script | Referans Dosya | Durum |
|--------|---------------|-------|
| `generate-latest-yml.cjs` | Hiç referans yok | Orphaned — npm script'i de yok |
| `render-audit-reports.cjs` | Hiç referans yok | Orphaned |
| `generate-roadmap.cjs` | Hiç referans yok | Orphaned |

**Not:** Bu 3 script `package.json`'da hiç tanımlanmamış. Sadece lokal çalıştırma için var.

---

### 7.2 Bağımlılık Analizi — Genel

`client/package.json`, `server/package.json`, `store-bridge/package.json`, root `package.json` incelendiğinde **açık bir unused dependency** tespit edilmedi. Ancak tam tree-shake analizi için `depcheck` koşturulması önerilir (özellikle `recharts`, `xlsx`, `react-is` client'ta; `zod`, `iconv-lite` server/store-bridge'de). Bu audit scope dışında.

---

### 7.3 `client/package.json` — `react-is` Bağımlılığı

```json
"react-is": "^18.3.1"
```
**Kanıt:** `react-is` doğrudan `client/src/` içinde import edilmiyor. `recharts`'ın peer dependency'si olarak ihtiyaç duyulabilir. Doğrulanmalı.  
**Risk:** Düşük — sadece bundle etkisi.

---

## 8. Temizlik Planı (Faz 1 / Faz 2 / Faz 3)

### Faz 1 — Güvenli Temizlik (Düşük Risk, Hemen Yapılabilir)

> Tümü gitignore kapsamında ya da self-declared dead. Test gerektirmez.

- [ ] `.tmp/` dizinini tamamen sil
- [ ] `release/` dizinini tamamen sil (32-byte bozuk .7z + boş win-unpacked)
- [ ] `dist-electron/Restoran-POS-1.0.7-win.zip` sil
- [ ] `dist-electron/Restoran-POS-1.0.8-win.zip` sil
- [ ] `dist-electron/win-unpacked/` sil (dist:prepare yeniden üretir)
- [ ] `tools/callerid-sdk-helper/obj/` sil (dotnet publish yeniden üretir)
- [ ] `tools/callerid-sdk-helper/bin/` sil — sadece `dist:prepare && npm run build:callerid-helper` yeniden üretir
- [ ] `data/pos.db` (root) sil — stale geliştirme DB
- [ ] `scripts/caller-id/` dizinini tamamen sil (deprecated shim + boş klasör)
- [ ] `scripts/start-callerid-sdk-helper.bat` sil (wrapper stub)
- [ ] `test-results/.last-run.json` sil (Playwright cache)
- [ ] `scripts/generate-latest-yml.cjs` sil (gen-update-meta.cjs ile superseded)

**Tahmini Temizlenen Alan:** ~460 MB

---

### Faz 2 — Onay Sonrası Temizlik (Orta Risk, Sahip Doğrulaması)

- [ ] `Restoran-POS-v3-Yol-Haritasi-Raporu-temiz-kopya.pdf` — `git ls-files | grep pdf` ile takip durumu kontrol et. Takip ediliyorsa → `.gitignore`'a ekle, sonra sil.
- [ ] `pos-config.json` — `git ls-files pos-config.json` ile kontrol et. Git'teyse → derhal remove + history cleanup + `.gitignore`'a ekle.
- [ ] `scripts/generate-roadmap.cjs` — aktif workflow'da kullanılacak mı? Hayır ise sil, evet ise `package.json`'a script ekle.
- [ ] `scripts/render-audit-reports.cjs` — aktif workflow'da kullanılacak mı? Hayır ise sil.
- [ ] `scripts/scan-hid-devices.js` + `scripts/cid812-raw-monitor.js` — donanım debug aracı olarak tutulacak mı?
- [ ] `server/test-login.js` — aktif mi? Hayır ise sil veya `tools/` altına taşı.
- [ ] `docs/audit/` içindeki sprint pass dosyalarını `docs/audit/archive/` altına taşı (7 dosya).
- [ ] `dist-electron/Restoran-POS-1.0.9-win.zip` — son release kanıtı olarak tutmak isteniyor mu? Yoksa `dist:release` pipeline'da bir release arşivi yönetimi kurulacak mı?

---

### Faz 3 — Refactor / Konsolidasyon (Düşük Öncelik, Bakım Penceresi)

- [ ] `server/routes/orders.js` içindeki inline status enum → `server/constants/orderStatus.js`'den import et.
- [ ] `scripts/generate-roadmap.cjs` (50 KB) aktif tutulacaksa → `package.json`'a `"generate:roadmap"` scripti ekle ve `.tmp` temizliği adımı ekle.
- [ ] `.gitignore`'a `pos-config.json` ekle (Faz 2'deki güvenlik düzeltmesinin kalıcı parçası).
- [ ] `docs/audit/` → numbered (00-11) serisi ana audit, pass dosyaları ise `archive/` altında. İsimlendirme tutarlılığı sağla.
- [ ] `store-bridge/node_modules/` zaten `dist:prepare` tarafından yükleniyor ama `.gitignore`'da açıkça yok (root `store-bridge/node_modules/` görünüyor). Kontrol et: `git ls-files store-bridge/node_modules | head`.
- [ ] `client/package.json` → `react-is` peer dependency olarak mı yoksa direct kullanım mı? `depcheck` koştur.

---

## 9. Risk Sınıflandırması — Her Aday

| Aday | Risk | Öneri |
|------|------|-------|
| `.tmp/` tüm içerik | **Düşük** | Sil |
| `release/` tüm içerik | **Düşük** | Sil |
| `dist-electron/` 1.0.7 + 1.0.8 zip | **Düşük** | Sil |
| `dist-electron/win-unpacked/` | **Düşük** | Sil |
| `tools/callerid-sdk-helper/obj/` | **Düşük** | Sil |
| `tools/callerid-sdk-helper/bin/` | **Düşük** | Sil (dotnet publish yeniden üretir) |
| `data/pos.db` (root) | **Düşük** | Sil |
| `scripts/caller-id/clipboard-watcher.ps1` | **Düşük** | Sil (deprecated) |
| `scripts/start-callerid-sdk-helper.bat` | **Düşük** | Sil |
| `test-results/.last-run.json` | **Düşük** | Sil |
| `scripts/generate-latest-yml.cjs` | **Düşük** | Sil (superseded) |
| `scripts/scan-hid-devices.js` | **Düşük** | Sahip kararı |
| `scripts/cid812-raw-monitor.js` | **Düşük** | Sahip kararı |
| `server/test-login.js` | **Düşük** | Sahip kararı |
| `scripts/generate-roadmap.cjs` | **Orta** | Sahip kararı (50 KB kaynak) |
| `scripts/render-audit-reports.cjs` | **Orta** | Sahip kararı |
| `Restoran-POS-v3-...temiz-kopya.pdf` | **Orta** | Git takip durumu doğrula |
| `pos-config.json` git takibi | **Yüksek** | ACİL doğrula + gitignore |
| `docs/audit/` pass dosyaları | **Düşük** | Arşivle veya tut |
| `dist-electron/Restoran-POS-1.0.9-win.zip` | **Orta** | Release kanıtı olarak saklanabilir |

---

## 10. İlk Turda Güvenle Silinebilecek 20 Aday

> Tümü gitignore kapsamında, deprecated ya da stale artifact. Runtime'ı etkilemez.

1. `.tmp/docx-unpacked/` (tüm içerik)
2. `.tmp/print-rollback-20260413-151229/pos.db`
3. `.tmp/print-rollback-20260413-151229/printJobs.js`
4. `.tmp/print-rollback-20260413-151229/renderers.js`
5. `release/restoran-pos-1.0.0-x64.nsis.7z`
6. `release/win-unpacked/` (boş dizin)
7. `dist-electron/Restoran-POS-1.0.7-win.zip`
8. `dist-electron/Restoran-POS-1.0.8-win.zip`
9. `dist-electron/win-unpacked/` (yeniden üretilir)
10. `tools/callerid-sdk-helper/obj/` (tüm içerik)
11. `tools/callerid-sdk-helper/bin/` (tüm içerik, dotnet publish yeniden üretir)
12. `data/pos.db` (root, stale)
13. `scripts/caller-id/clipboard-watcher.ps1`
14. `scripts/caller-id/` (boş dizin kalırsa)
15. `scripts/start-callerid-sdk-helper.bat`
16. `scripts/generate-latest-yml.cjs`
17. `test-results/.last-run.json`
18. `dist-electron/builder-debug.yml`
19. `store-bridge/package-lock.json` — `npm install --prefix store-bridge` yeniden üretir; gereksiz lock karmaşası (⚠ önce doğrula: dist:prepare bu dosyayı kullanıyor mu?)
20. `scripts/local-env.bat` — zaten `.gitignore`'da, gitignore'un orijinal kaydı zaten vardı; bu dosya tracked ise remove et

---

## 11. Silmek Yerine Refactor Edilmesi Gereken 10 Alan

1. **`server/routes/orders.js` inline status enum** → `server/constants/orderStatus.js`'den import et. Mantık zaten merkezi, sadece orders.js bağlanmıyor.

2. **`scripts/generate-roadmap.cjs` (50 KB)** → Eğer tutulacaksa, `package.json`'a `generate:roadmap` scripti ekle ve `.tmp` temizliği adımı dahil et; böylece orphaned olmaktan çıkar.

3. **`dist:prepare` zinciri** → Büyüdü (8 adım). `scripts/dist-prepare.cjs` gibi bir orchestrator script'e çekilebilir; `package.json` temiz kalır.

4. **`server/index.js` route registration bloğu** → 16 route manuel import. Özellikle `/api/callerid` dual mount gibi istisnalar büyüdükçe kafa karıştırıcı. Bir route registry pattern veya en azından yorumlu gruplandırma yapılabilir.

5. **`api.js` (client/src/services/)** → CLAUDE.md'de zaten belgelenmiş: domain modüllerine bölünmeli. `api/core.js` başlatılmış ama `api.js` hâlâ monolitik (tüm endpoints aynı dosyada).

6. **`OrderScreen.jsx` (1428 satır)** → CLAUDE.md architectural debt listesinde. Hook extractions: `useCatalog`, `useCart`, `useOrderActions`. Sprint sonu değil, bağımsız PR.

7. **`TablesScreen.jsx`** → CLAUDE.md architectural debt: `useTablesData`, `TakeawaySidebar`, `TableCard` extract edilmeli.

8. **`PrinterDetailPage.jsx` (972 satır)** → Form model → hook, preview → ayrı component.

9. **`electron/main.cjs` (~860 satır)** → `config`, `serverProcess`, `bridgeProcess`, `callerIdProcess`, `sqliteMigration` alt modüllere bölünmeli.

10. **`docs/audit/` klasör yapısı** → Numbered series (00-11) ile sprint pass dosyaları aynı dizinde. `docs/audit/archive/` alt dizini oluşturup pass dosyalarını oraya taşımak navigasyonu kolaylaştırır.

---

## 12. Build/Test Sonrası Kırılma Riski — Özel Uyarılar

> Bu alanlardaki yanlış bir silme → build veya test süreci kırılır.

⚠️ **`tools/callerid-sdk-helper/bin/` silinirse** → `dist:prepare` → `desktop:preflight` → `check-desktop-release.cjs` CallerID exe'nin varlığını kontrol eder → preflight FAIL.  
→ **Çözüm:** Önce `npm run build:callerid-helper` koş, ardından sil. Veya sıra şöyle: sil → dist:prepare otomatik yeniden üretir.

⚠️ **`dist-electron/win-unpacked/` silinirse** → `dist:nsis` ve `dist:portable` bu dizini `--prepackaged` ile kullanıyor → FAIL olur.  
→ **Çözüm:** Sadece `dist:prepare` sonrasında, `dist:nsis`/`dist:portable` öncesinde silme.

⚠️ **`server/data/pos.db*` yanlışlıkla silinirse** → Sunucu başlangıcında migration yeniden oluşturur ama tüm veriler kaybolur.  
→ Bu dosyalar temizlik kapsamına girmiyor zaten — not olarak eklendi.

⚠️ **`store-bridge/node_modules/` silinirse** → `dist:prepare`'in `npm install --prefix store-bridge --omit=dev` adımı yeniden yükler. Dev ortamında ise StoreBridge çalışmaz.  
→ Faz 1 kapsamına alınmadı.

⚠️ **`pos-config.json` (kök) silinirse** → Electron packaged modda JWT secret bu dosyadan okunuyor → tüm session'lar geçersiz olur.  
→ Silme değil, gitignore'a alma işlemi yapılmalı.

---

*Son güncelleme: 2026-04-17*
