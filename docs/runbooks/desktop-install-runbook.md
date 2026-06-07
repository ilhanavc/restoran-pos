# Desktop Install Runbook

Bu runbook, Restoran POS'un temiz bir Windows bilgisayara kurulumu ve ilk kontrolu icindir.

## 1. Paket Uretimi

Release bilgisayarinda:

```powershell
npm install
npm run dist:win
```

Bu zincir sunlari yapar:

- Client build alir.
- Server production dependency'lerini kurar.
- StoreBridge production dependency'lerini kurar.
- Caller ID SDK helper'i Release modda derler.
- `better-sqlite3` native modulunu Electron ABI icin rebuild eder.
- Electron runtime altinda SQLite smoke test calistirir.
- Desktop preflight ile paket girdilerini kontrol eder.
- NSIS installer ve portable paket uretir.

Hizli paket oncesi kontrol:

```powershell
npm run desktop:preflight
```

## 2. Temiz Bilgisayara Kurulum

1. `dist-electron` altindaki NSIS `Setup.exe` dosyasini calistirin.
2. Kurulum klasoru secin.
3. Uygulamayi baslatin.
4. Ilk acilista uygulama kendi userData klasorunu olusturur.
5. Veritabani `server/data` icinde degil, kullanici profilinde saklanir.

Tipik Windows veri konumlari:

- Veritabani: `%APPDATA%\Restoran POS\pos.db`
- Loglar: `%APPDATA%\Restoran POS\logs\electron-main.log`
- Yedekler: `%APPDATA%\Restoran POS\backups\pos-YYYY-MM-DD.db`
- Config: `%APPDATA%\Restoran POS\pos-config.json`

## 3. Ilk Calistirma Kontrol Listesi

- Uygulama penceresi aciliyor mu?
- Login ekrani geliyor mu?
- `electron-main.log` dosyasi olusuyor mu?
- `%APPDATA%\Restoran POS\pos.db` olusuyor mu?
- `backups` klasorunde gunluk yedek olusuyor mu?
- Ayarlar > Yazicilar ekraninda StoreBridge tarama durumu gorunuyor mu?
- Fiziksel test baskisi kuyruga dusuyor ve yaziciya gidiyor mu?
- Caller ID kullanilacaksa cihaz baglandiginda helper log uretip backend'e olay gonderiyor mu?

## 4. pos-config.json

Paketli uygulamada config yolu:

```text
%APPDATA%\Restoran POS\pos-config.json
```

Ornek icin repo kokundeki `pos-config.example.json` kullanilir.

Zorunlu veya kritik alanlar:

- `port`: Varsayilan `3001`.
- `jwtSecret`: Ilk calistirmada otomatik uretilir; elle sabitlenirse oturumlar restart sonrasi korunur.
- `bridge.token`: StoreBridge ve backend arasinda ayni olmalidir.
- `bridge.businessId`: POS veritabanindaki isletme id'si ile ayni olmalidir.
- `bridge.dryRun`: Canli isletmede `false` olmalidir.
- `callerid.enabled`: Caller ID kullanilmiyorsa `false` yapilabilir.

## 5. Yazici ve Caller ID Ilk Tanim

Yazici:

1. Uygulamayi acin.
2. Ayarlar > Yazicilar ekranina gidin.
3. Windows yazicilarini tara.
4. Fiziksel yaziciyi secin.
5. Baglanti turunu ve rolunu kaydedin.
6. Test ciktisi alin.

Caller ID:

1. Cihazin Windows tarafinda gorundugunu dogrulayin.
2. Gerekirse `scripts/scan-hid-devices.js` ile VID/PID/serial bulun.
3. `pos-config.json` icinde `callerid.hid` alanlarini guncelleyin.
4. Uygulamayi yeniden baslatin.
5. Log dosyasinda `[callerid-helper]` veya `[cid812]` kayitlarini kontrol edin.

## 6. Hata Teshisi

Ilk bakilacak dosya:

```text
%APPDATA%\Restoran POS\logs\electron-main.log
```

Sik sinyaller:

- `EADDRINUSE`: Port baska bir uygulama tarafindan kullaniliyor.
- `better-sqlite3`: Native modul Electron ABI ile uyumsuz; release build yeniden alinmali.
- `Store Bridge bulunamadi`: Paket icinde `resources/store-bridge` eksik.
- `CallerIdSdkHelper bulunamadi`: Release helper derlenmemis veya paket girdisi eksik.
- `Bridge API yapilandirilmadi`: `bridge.token` veya `bridge.businessId` eksik.

## 7. Yedekleme ve Geri Yukleme

Otomatik yedek:

- Uygulama acilista bugunun yedegini kontrol eder.
- Gece 02:00'de gunluk yedek alir.
- 30 gunden eski yedekleri temizler.

Geri yukleme:

1. Uygulamayi kapatin.
2. `%APPDATA%\Restoran POS\pos.db` dosyasinin mevcut halini ayri yere kopyalayin.
3. Istenen `backups\pos-YYYY-MM-DD.db` dosyasini `pos.db` olarak kopyalayin.
4. Uygulamayi acin.

## 8. Update Stratejisi

Uygulamada `electron-updater` baglantisi var ve paketli modda GitHub Releases uzerinden calisir. Release pipeline netlestirilmeden once manuel update yolu:

1. Yeni installer'i yayinlayin.
2. Kullanici uygulamayi kapatsin.
3. Yeni installer'i calistirsin.
4. Veri userData'da kaldigi icin kurulum klasoru degisse bile `pos.db` korunur.

Kod imzasi henuz kapali oldugu icin Windows SmartScreen uyarisi beklenebilir. Profesyonel dagitim icin sonraki fazda code signing sertifikasi eklenmelidir.
