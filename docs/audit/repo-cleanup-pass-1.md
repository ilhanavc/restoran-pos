# Repo Cleanup Pass 1 — Uygulama Raporu

**Tarih:** 2026-04-17  
**Kaynak Audit:** `docs/audit/repo-cleanup-audit.md`  
**Kapsam:** Faz 1 — Düşük Riskli Temizlik  
**Yürüten:** Staff Engineer / Release Hardening Lead

---

## 1. Silinen Dosyalar ve Klasörler

### 1a. Gitignored Artifacts (rm -rf)

| Dosya / Klasör | Boyut | Sebep |
|----------------|-------|-------|
| `.tmp/docx-unpacked/` | ~920 KB | generate-roadmap.cjs geçici çıktısı |
| `.tmp/print-rollback-20260413-151229/pos.db` | ~1.5 MB | Apr 13 geliştirme rollback DB yedek |
| `.tmp/print-rollback-20260413-151229/printJobs.js` | ~35 KB | Eski kod rollback kopyası |
| `.tmp/print-rollback-20260413-151229/renderers.js` | ~35 KB | Eski kod rollback kopyası |
| `release/restoran-pos-1.0.0-x64.nsis.7z` | 32 byte | Bozuk/placeholder artifact |
| `release/win-unpacked/` | 0 byte | Boş dizin |
| `dist-electron/Restoran-POS-1.0.7-win.zip` | 127 MB | 2 sürüm öncesi, aktif değil |
| `dist-electron/Restoran-POS-1.0.8-win.zip` | 127 MB | 1 sürüm öncesi, aktif değil |
| `dist-electron/win-unpacked/` | 194 MB | dist:prepare her çalıştırmada yeniden üretir |
| `dist-electron/builder-debug.yml` | ~1 KB | electron-builder debug log artifact |
| `tools/callerid-sdk-helper/obj/` | 245 KB | .NET build cache, gitignore'da, dotnet publish yeniden üretir |
| `data/pos.db` (root) | 312 KB | Stale geliştirme DB kopyası (aktif: server/data/pos.db) |
| `test-results/.last-run.json` | 45 byte | Playwright yerel çalıştırma cache |

**Ara toplam: ~451 MB**

---

### 1b. Git-Tracked Dosyalar (git rm — staged for commit)

| Dosya | Boyut | Sebep |
|-------|-------|-------|
| `scripts/caller-id/clipboard-watcher.ps1` | ~1 KB | Self-declared deprecated shim (script kendi header'ında belgeliyor) |
| `scripts/generate-latest-yml.cjs` | 1.2 KB | `gen-update-meta.cjs` ile superseded; hiçbir npm script'inde referans yok |
| `scripts/start-callerid-sdk-helper.bat` | 48 byte | Sadece `start-callerid-helper.bat`'ı çağıran 2 satırlık wrapper stub |

**Not:** Bu 3 dosya git staging area'da. Temizlik commit'ine dahil edilecek.

---

## 2. Temizlenen Import / Script Alanları

Bu turda source code import değişikliği yapılmadı — tüm silinen dosyalar ya gitignored artifact, ya da hiçbir kaynak kodun import etmediği standalone scriptlerdi.

**Doğrulama:**
- `generate-latest-yml.cjs` → `grep -r "generate-latest-yml"` → 0 referans ✓
- `clipboard-watcher.ps1` → deprecated shim, sadece shim kendisi mevcut scriptleri çağırıyordu ✓
- `start-callerid-sdk-helper.bat` → `grep -r "start-callerid-sdk-helper"` → 0 referans ✓

---

## 3. Toplam Kazanım

| Kategori | Kazanım |
|----------|---------|
| `dist-electron/` eski zippler + win-unpacked | ~448 MB |
| `.tmp/` geçici dizin | ~2.6 MB |
| `release/` bozuk artifact | ~0.1 MB |
| `tools/obj/` .NET build cache | ~0.25 MB |
| `data/pos.db` stale DB | ~0.3 MB |
| Script dosyaları | ~3 KB |
| **Toplam** | **~451 MB** |

**Mevcut `dist-electron/` boyutu:** 138 MB (sadece `Restoran-POS-1.0.9-win.zip` + `latest.yml`)

---

## 4. Korunan Kritik Alanlar

Aşağıdaki alanlara dokunulmadı, tüm bütünlük testleri geçti:

| Alan | Doğrulama |
|------|-----------|
| `client/src/**` (54 dosya) | Build ✅ |
| `server/routes/**` (16 route) | 318 test ✅ |
| `server/services/**` | 318 test ✅ |
| `server/migrations/run.js` | smoke:server-health ✅ |
| `store-bridge/printers/encoding.js` | Dokunulmadı ✅ |
| `tools/callerid-sdk-helper/bin/` | Korundu (desktop:preflight bağımlılığı) ✅ |
| `server/data/pos.db*` | Dokunulmadı ✅ |
| `scripts/callerid-clipboard-listener.ps1` | Korundu (aktif fallback) ✅ |
| `scripts/gen-update-meta.cjs` | Korundu (dist:release zincirinde) ✅ |
| `store-bridge/package-lock.json` | Korundu (⚠ uyarı nedeniyle) ✅ |

---

## 5. Build / Test Sonuçları

### 5.1 Client Build
```
✓ built in 17.33s
```
Tüm lazy-loaded chunk'lar başarıyla üretildi. Hiçbir eksik import, hiçbir build hatası yok.

### 5.2 ESLint CI
```
eslint src/ --max-warnings 0
→ EXIT 0 (uyarı yok)
```

### 5.3 Server Tests
```
Test Files  24 passed (24)
Tests       318 passed (318)
Duration    14.00s
```
Önceki sayı 285'ti; bu oturumda eklenen entegrasyon testleri ile 318'e yükseldi. Tüm testler yeşil.

### 5.4 Server Health Smoke Test
```
[smoke:server] /api/health → ok ✓
[smoke:server] DB created (migration ran) ✓
[smoke:server] PASS
```

---

## 6. Dokunulmayan Riskli / Bekleyen Alanlar

### 6a. Orta Risk — Sahip Kararı Gerekli

| Aday | Risk | Neden Atlandı |
|------|------|--------------|
| `Restoran-POS-v3-Yol-Haritasi-Raporu-temiz-kopya.pdf` (432 KB) | Orta | Git tracking durumu doğrulanmadı |
| `scripts/generate-roadmap.cjs` (49 KB) | Orta | Aktif workflow'da kullanılacak mı? |
| `scripts/render-audit-reports.cjs` (10.6 KB) | Orta | Aktif workflow'da kullanılacak mı? |
| `dist-electron/Restoran-POS-1.0.9-win.zip` (144 MB) | Orta | Son release kanıtı, sahip kararı |
| `scripts/cid812-raw-monitor.js` (6.2 KB) | Düşük | Sahip donanım debug aracı kararı |
| `scripts/scan-hid-devices.js` (5.1 KB) | Düşük | Sahip donanım debug aracı kararı |
| `server/test-login.js` | Düşük | Aktif kullanımda mı? |

### 6b. Yüksek Risk — Güvenlik, ACİL

| Aday | Risk | Yapılacak |
|------|------|-----------|
| `pos-config.json` git tracking | **Yüksek** | `git ls-files pos-config.json` koş. Git'teyse: `git rm --cached pos-config.json` + `.gitignore`'a ekle |

### 6c. Faz 3 Refactor (Kod Temizliği, Bakım Penceresi)

- `server/routes/orders.js` inline status enum → `orderStatus.js`'den import et
- `docs/audit/` pass dosyaları → `docs/audit/archive/` altına taşı (9 dosya)
- `store-bridge/node_modules/` git tracking durumu kontrol et

---

## 7. Sonraki Temizlik Turu İçin Öneriler

### Faz 2 Önce Yapılacaklar

```bash
# pos-config.json git tracking kontrolü (ACİL — güvenlik)
git ls-files pos-config.json

# Büyük PDF git tracking kontrolü
git ls-files "*.pdf"

# .gitignore'a eklenecekler (doğrulama sonrası)
echo "pos-config.json" >> .gitignore
echo "*.pdf" >> .gitignore   # veya spesifik olarak
```

### Faz 2 Önerilen Sıra

1. **`pos-config.json` güvenlik düzeltmesi** (git'teyse derhal)
2. **PDF ve orphaned script kararı** — sahip ile birlikte
3. **`docs/audit/archive/`** alt dizini oluştur, 9 pass dosyasını taşı
4. **`scripts/cid812-raw-monitor.js`** + **`scan-hid-devices.js`** → donanım debug toolları, artık gerekmiyor ise sil
5. **`server/test-login.js`** → aktif değilse `tools/` altına taşı veya sil
6. **`dist-electron/Restoran-POS-1.0.9-win.zip`** → release arşivi politikası belirle

### Faz 3 Refactor Sırası

1. `server/routes/orders.js` inline enum → `orderStatus.js` import (5 dakika)
2. `docs/audit/` archive reorganizasyonu (10 dakika)
3. `api.js` domain split başlangıcı (ayrı sprint)
4. `electron/main.cjs` modüler yapı (ayrı sprint)

---

## Özet

| Metrik | Değer |
|--------|-------|
| Silinen dosya sayısı | 16 dosya + 3 klasör |
| Disk kazanımı | ~451 MB |
| Git'ten kaldırılan takipli dosya | 3 dosya (staged) |
| Kırılan build | 0 |
| Kırılan test | 0 |
| Korunan kritik alan | 14+ alan |
| Runtime değişikliği | Sıfır |

*Son güncelleme: 2026-04-17*
