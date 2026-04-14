# 07 - Desktop Release Audit

Tarih: 2026-04-14  
Rol: Desktop release engineer + installer/distribution specialist

## 1. Desktop Paketleme Ozeti

Uygulama Electron kabugu ile calisiyor. React build `client/dist` icinden servis ediliyor, Express backend ayri child process olarak baslatiliyor. Paketli modda backend ve StoreBridge `extraResources` ile `resources/server` ve `resources/store-bridge` altina kopyalaniyor. Backend, kurulu bilgisayarda sistem Node gerektirmeden Electron ikilisi `ELECTRON_RUN_AS_NODE=1` ile calistiriliyor.

Bu mimari masaustu POS icin dogru yonde: UI, API, SQLite, yazici bridge ve Caller ID helper tek uygulama yasam dongusu altinda toparlanmis.

## 2. Build / Package Akisi

Ana komut:

```powershell
npm run dist:win
```

Zincir:

1. Client build.
2. Server production dependency install.
3. StoreBridge production dependency install.
4. Caller ID helper Release build.
5. `better-sqlite3` Electron ABI rebuild.
6. Electron SQLite smoke test.
7. Desktop preflight.
8. Electron builder unpacked, NSIS ve portable paket.

Eklenen preflight:

```powershell
npm run desktop:preflight
```

Bu kontrol paket icin kritik girdileri erken yakalar: client build, server entry, native sqlite modul, store-bridge dependencies, Caller ID helper exe ve vendor dll.

## 3. Temiz Bilgisayarda Kurulabilirlik

Guculu taraflar:

- Sistem Node kurulumu gerektirmeden backend Electron runtime ile calisiyor.
- SQLite verisi kurulum klasorune degil userData yoluna yaziliyor.
- `better-sqlite3` icin Electron ABI smoke test var.
- StoreBridge runtime pakete dahil ediliyor.
- Gunluk DB yedegi var.

Riskler:

- Kod imzasi kapali; Windows SmartScreen uyarisi beklenir.
- Otomatik update GitHub Releases uzerinden hazir fakat release pipeline ve imzalama politikasina bagli.
- Caller ID helper .NET 8 framework-dependent build ile uretiliyor; hedef bilgisayarda .NET runtime gereksinimi olabilir. Sonraki fazda self-contained publish degerlendirilmeli.

## 4. Bagimlilik Paketleme Denetimi

P1 olarak bulunan sorun:

Paketli Electron kodu `tools/callerid-sdk-helper/bin/Release/net8.0/CallerIdSdkHelper.exe` dosyasini bekliyordu, ancak builder config `tools/**/bin` klasorunu paketten disliyordu. Bu temiz kurulumda Caller ID helper'in bulunamamasina yol acabilirdi.

Uygulanan duzeltme:

- `build:callerid-helper` script'i eklendi.
- `dist:prepare` bu helper'i paketleme oncesi derliyor.
- `extraResources` icine helper Release output'u ayrica eklendi.
- `desktop:preflight` helper exe ve `cid.dll` varligini kontrol ediyor.

## 5. Runtime Paths ve Veri Kaliciligi

Runtime veri politikasini dogru buldum:

- `pos.db`: Electron userData altinda.
- `uploads`: userData altinda.
- `backups`: userData altinda.
- `pos-config.json`: paketli modda userData altinda.

Bu kurulum klasoru degisse bile restoran verisinin korunmasini saglar. Ilk calistirmada legacy `server/data/pos.db` varsa sadece userData bosken kopyalaniyor; uzerine yazma yok.

## 6. Loglama ve Teshis

Eksik bulunan alan:

Paketli uygulamada console ciktilari kalici bir dosyaya yazilmadigi icin sahada hata teshisi zordu.

Uygulanan duzeltme:

- Electron main process artik userData altinda `logs/electron-main.log` dosyasina yazar.
- API, StoreBridge ve Caller ID helper stdout/stderr akislari bu log zincirine girer.
- `uncaughtException` ve `unhandledRejection` yakalanip loglanir.

Bu, kurulum sonrasi destek icin cok yuksek degerli bir iyilestirmedir.

## 7. First-run Deneyimi

Guculu taraflar:

- Eksik client build varsa acik hata mesaji veriliyor.
- Port cakismasinda kullaniciya anlamli hata mesaji uretiliyor.
- JWT secret ilk calistirmada uretilip `pos-config.json` icine kalici yaziliyor.
- StoreBridge config eksikse POS acilmaya devam ediyor, sadece bridge atlanıyor.

Eksik kalan alanlar:

- Ilk calistirmada grafiksel kurulum sihirbazi yok.
- Yazici ve Caller ID tanitimi ayarlar ekranina birakilmis.
- `businessId` kullanici icin teknik bir kavram; ilk kurulum sihirbazinda otomatik secilmesi daha profesyonel olur.

## 8. Backup / Restore

Mevcut otomatik yedekleme iyi bir temel:

- Acilista gunluk yedek kontrolu.
- Gece 02:00 otomatik backup.
- 30 gun retention.

Eksik:

- UI uzerinden geri yukleme yok.
- Backup basarisizligi kullaniciya operasyon uyarisi olarak gorunmuyor.
- WAL aktifken sadece ana `.db` kopyasinin her senaryoda en guvenli snapshot oldugu garanti degil. Sonraki fazda SQLite `VACUUM INTO` veya backup API kullanimi degerlendirilmeli.

## 9. Update Stratejisi

`electron-updater` entegre edilmis. Paketli modda otomatik kontrol var, renderer'a update event'leri aciliyor.

Kalan urunlesme riski:

- Kod imzasi yok.
- Release notlari, rollback ve staged rollout politikasi dokumante degil.
- `latest.yml` uretim script'i var ama ana `dist:win` zincirine bagli degil.

## 10. Urunlesme Acisindan Amator Kalan Alanlar

| Oncelik | Alan | Etki | Oneri |
|---|---|---|---|
| P1 | Code signing yok | SmartScreen ve guven algisi zayif | Sertifika + signed installer pipeline |
| P1 | Caller ID runtime .NET bagimliligi net degil | Temiz bilgisayarda helper calismayabilir | Self-contained publish veya installer prerequisite |
| P2 | First-run wizard yok | Teknik kurulum yuku kullaniciya kalir | Ilk acilista isletme/yazici/bridge sihirbazi |
| P2 | Restore UI yok | Felaket kurtarma teknik destek ister | Backup/restore ekranı |
| P2 | Update release proseduru eksik | Sahada versiyon karmasasi | Release checklist + latest.yml pipeline |

## 11. Uygulanan Guvenli Iyilestirmeler

- `scripts/build-callerid-helper.cjs` eklendi.
- `scripts/check-desktop-release.cjs` eklendi.
- `package.json` release zincirine `build:callerid-helper` ve `desktop:preflight` eklendi.
- Caller ID helper Release output'u `extraResources` ile pakete dahil edildi.
- Electron main process kalici log dosyasi yazacak sekilde guclendirildi.
- `pos-config.example.json` bridge timeout ve Caller ID post retry ayarlarini kapsayacak sekilde guncellendi.
- Kurulum/runbook dokumani olusturuldu: `docs/runbooks/desktop-install-runbook.md`.

## 12. Sonraki Onerilen Adimlar

1. Code signing sertifikasi ve signed NSIS pipeline.
2. Caller ID helper icin self-contained `win-x64` publish karari.
3. Backup icin SQLite backup API veya `VACUUM INTO` tabanli tutarli snapshot.
4. First-run setup wizard.
5. UI icinden log klasorunu acma ve support bundle export.

## 13. Dogrulama Bulgulari

Calistirilan kontroller:

- `node --check electron/main.cjs`
- `node --check scripts/build-callerid-helper.cjs`
- `node --check scripts/check-desktop-release.cjs`
- `npm run desktop:preflight`
- `npm run build:callerid-helper`
- `npm test --prefix server`
- `npm run build`
- `npm run smoke:electron-sqlite`

Sonuc:

- Server testleri basarili: 16 dosya, 129 test.
- Client build basarili.
- Desktop preflight basarili.
- Caller ID helper build komutu bu makinede .NET/NuGet fallback klasoru hatasi verdi; mevcut Release exe bulundugu icin paket girdisi korunuyor. Release makinesinde .NET/NuGet ortami duzeltilmeli.
- `smoke:electron-sqlite` mevcut native binary'nin Electron ABI ile uyumsuz oldugunu yakaladi. `rebuild:server-native` denenince dosya kilidi nedeniyle `better_sqlite3.node` silinemedi. Calisan Node/POS/API surecleri kapatildiktan sonra rebuild tekrar calistirilmali.
