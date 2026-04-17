# Desktop Core Hardening Plan

Tarih: 2026-04-16  
Kapsam: Masaustu / yerel cekirdek POS. Online mimari, mobil istemci ve yeni ozellik kapsam disidir.  
Hedef urun: Internet olmasa bile tek isletme bilgisayarinda, ayni yerel agda masa, siparis, mutfak, odeme ve yazdirma akislarini guvenilir yurutmek.

## Uygulama durumu

2026-04-16 ilk hardening uygulama turunda tamamlananlar:

- WAL modunda guvenli yedek icin Electron backup akisi SQLite backup API + `PRAGMA integrity_check` kullanacak sekilde degistirildi ve daha once hic cagrilmayan otomatik backup schedule'i uygulama acilisina baglandi.
- Paket etiketi yazici karari receipt yazici yerine mutfak yazici rolune hizalandi; manuel UI ve backend ayni hedef role bakiyor.
- Masa acma akisi, dolu/aktif adisyonlu masaya ikinci aktif siparis acilmasini backend guard ile engelliyor; migration tarafina aktif dine-in masa tekilligi icin repair + partial unique index girisi eklendi.
- Operasyon ekranlari icin staff erisimli print-health ve failed print retry endpointleri eklendi; masalar ekraninda yazdirma sorunu banner'i ve "Tekrar Dene" aksiyonu gosteriliyor.
- Regression kaniti eklendi: paket etiketinin kitchen printer'a gitmesi ve print-health/retry endpointleri testleniyor.
- Dogrulama: `npm test` 22 dosya / 295 test yesil, `npm run build --prefix client` yesil, `npm run lint:ci --prefix client` mevcut 27 warning baseline'i ile yesil, `npm run desktop:preflight` yesil.

## 1. Masaustu cekirdegin mevcut olgunluk seviyesi

Genel degerlendirme: **release adayi olmaya yakin, fakat sahada kendi kendini toparlayan yerel urun seviyesinde henuz tamam degil.**

Backend cekirdegi dusunulenden daha olgun: siparis ve odeme akislarinda transaction kullanimi, idempotency anahtarlari, masa kapatma guard'lari, business scope, Zod validasyonlari, print job lease/claim modeli ve socket ile anlik UI guncellemesi var. Bu, "demo POS" seviyesinin ustunde bir temel sagliyor.

Eksik kalan kisimlar daha cok saha gercekligiyle ilgili: ilk kurulumda isletme/yazici/bridge ayarlari, WAL guvenli yedekleme, yazici arizasi sonrasi operatorun ne yapacagini net gormesi, Electron/StoreBridge/CallerID sureclerinin kullaniciya anlasilir saglik durumu vermesi, gercek Windows paketinde tekrarlanabilir smoke test ve kritik ekranlar icin frontend regresyon guvencesi.

Calistirilan dogrulama: `npm test` basarili. Sonuc: **22 test dosyasi, 294 test gecti.** Testler backend agirlikli; Electron paket, gercek yazici ve kritik UI akislari otomatik olarak kanitlanmiyor.

## 2. Guclu yonler

- **Siparis yaratma ve urun ekleme transaction icinde.** `server/routes/orders.js` siparis basligi, satirlar, masa doluluk durumu, paket etiketi ve mutfak job olusturmayi transaction sinirinda topluyor.
- **Odeme tarafinda kalan bakiye ve fazla odeme guard'i var.** `server/routes/payments.js` siparise odeme eklerken kapali/iptal siparis, kalan bakiye, nakit alinan tutar ve idempotency kontrolu yapiyor.
- **Print queue mimarisi urunlesmeye yakin.** `print_jobs` tablosunda idempotency, claim lease, attempt count, last error code ve claim ownership guard'i var. StoreBridge pending job'lari claim ederek basiyor.
- **Turkce karakter baskisi icin gercek kod sayfasi calismasi yapilmis.** `store-bridge/printers/encoding.js` win1254 ve PC857 destekli; test baskisinda kod sayfasi taramasi var.
- **Electron userData ayrimi dogru yonde.** Paketli uygulamada SQLite `userData` altina tasiniyor; server, bridge ve CallerID helper ayri surecler olarak baslatiliyor.
- **Socket + fallback polling var.** Masa, siparis ve paket akislari socket ile anlik guncelleniyor; socket koparsa masalar ekrani 30 saniyelik fallback ile veri cekiyor.
- **Backend test kapsami cekirdek riskleri yakaliyor.** Siparis transaction, odeme, print job idempotency, bridge print jobs, migrations, Turkish encoding ve table lifecycle testleri mevcut.

## 3. Kritik eksikler

### Kritik stabilite

| Sorun | Etkisi | Kok neden | Cozum onerisi | Oncelik |
|---|---|---|---|---|
| Ilk kurulum wizard'i yok; `pos-config.json`, bridge token, business id, yazici ve CallerID ayarlari manuel. | Dukkan kurulumunda POS acilir ama yazdirma/CallerID sessizce devre disi kalabilir; destek yukunu artirir. | Electron acilista eksik bridge config'i sadece logluyor ve bridge'i atliyor. UI'da zorunlu ilk kurulum kapisi yok. | Ilk acilista isletme adi, admin sifresi, bridge token, business id, varsayilan yazici, test baskisi ve backup konumunu tamamlatan local setup akisi eklenmeli. Yeni ozellik degil, release guard'i olarak ele alinmali. | P0 |
| Otomatik yedekleme SQLite dosyasini `copyFileSync` ile kopyaliyor; WAL aktif. | Yogun servis sirasinda alinan yedek eksik veya tutarsiz olabilir; geri yukleme aninda veri kaybi ortaya cikar. | `journal_mode=WAL` aktif, fakat Electron backup kodu `pos.db` dosyasini duz kopyaliyor; `-wal/-shm` veya SQLite backup API/VACUUM INTO yok. | `better-sqlite3.backup()` veya `VACUUM INTO` temelli snapshot kullanilmali; yedekten geri donme proseduru otomatik dogrulama ile eklenmeli. | P0 |
| Electron ana sureci tek dosyada cok buyuk ve surec yasam donguleri birbirine bagli. | Startup, server health, bridge restart, CallerID, update ve backup hatalarinda regresyon riski yuksek. | `electron/main.cjs` server, bridge, CallerID, config, backup, updater ve UI baslatmayi tek dosyada tasiyor. | Davranisi degistirmeden modul sinirlari cikarilmali: config, processSupervisor, sqliteMigration, backup, updater. Ardindan her modul icin smoke test yazilmali. | P1 |
| Port cakismasi uygulamayi kapatiyor. | Dukkan bilgisayarinda eski POS sureci arkada kalirsa operator uygulamayi acamaz. | `startServerAndWaitForHealth` EADDRINUSE durumunda hata kutusu gosterip cikiyor; otomatik sahiplik/onceki sureci tanima yok. | Sadece ayni uygulamanin yetim sureciyse guvenli kapatma; degilse port secim/diagnostic ekrani. Logda net aksiyon: "onceki POS'u kapat". | P1 |

### Veri guvenligi

| Sorun | Etkisi | Kok neden | Cozum onerisi | Oncelik |
|---|---|---|---|---|
| Masa/siparis esitligi DB seviyesinde tam korunmuyor. | Ayni masaya iki aktif siparis veya dolu masa ustune yeni siparis gibi veri bozulmalari teorik olarak mumkun. | Guard'lar route seviyesinde; `tables.current_order_id` ve aktif `orders.table_id` icin partial unique constraint yok. | SQLite partial index: aktif dine-in siparislerde `business_id, table_id` benzersiz; masa status/current_order_id tutarliligi icin migration ve repair script. | P0 |
| Foreign key delete/update davranislari tutarsiz. | Urun, musteri, masa veya yazici silme islemlerinde eski kayitlar beklenmedik sekilde orphan kalabilir ya da silme bloklanabilir. | Bazi iliskiler `ON DELETE CASCADE`, bazilari yalniz `REFERENCES`; domain bazli silme politikasi dokumanlasmamis. | "Soft delete vs hard delete" matrisi cikarilmali. Siparis gecmisi snapshot'a bagli kalmali, master data silmeleri safe guard ile UI'da engellenmeli. | P1 |
| Migration stratejisi idempotent ama versiyonlu degil. | Sahadaki farkli DB durumlarinda migration yan etkilerini izlemek zorlasir. | Migration listesi `CREATE IF NOT EXISTS` + manuel `ensureColumnMigrations`; sadece KDV migrasyonu `user_version` kullaniyor. | `schema_migrations` tablosu, migration id'leri, once/sonra integrity check, startup'ta migration raporu. | P1 |
| Paket teslim edildi aksiyonu otomatik `other` odeme yaziyor. | Tahsilat tipi raporlarda kirlenebilir; gercek nakit/kart ayrimi kaybolur. | `recordTakeawayDeliveryPaymentIfNeeded` teslimatta kalan bakiyeyi sistem odemesi olarak kapatiyor. | Teslimat tamamlama icin "odendi varsay" davranisi ayar/guard ile netlestirilmeli; raporlarda `system_takeaway_delivery` ayrica gorunmeli. | P1 |

### Cihaz / yazdirma

| Sorun | Etkisi | Kok neden | Cozum onerisi | Oncelik |
|---|---|---|---|---|
| Paket etiketi varsayilan olarak receipt printer resolver kullanip manuel secimde kitchen printer bekliyor. | Paket etiketi yanlis yaziciya gidebilir veya "aktif yazici yok" mesaji yaniltici olabilir. | `enqueueTakeawayLabelJob` varsayilanda `resolveReceiptPrinter`, manuel override'da `type === kitchen` kontrolu yapiyor. | Paket etiketi icin ayri printer role/routing karari: `takeaway_label` hedefi net olsun; default resolver ve UI ayni role'u kullansin. | P0 |
| Basarisiz print job operator akisi eksik. | Mutfak fisi basilmadiginda personel sorunu gec fark eder; tekrar basma/yonlendirme manuel ve daginik kalir. | Failed job'lar admin listede var, fakat masa/mutfak ekraninda kritik uyarilar ve aksiyon metinleri yeterince gorunur degil. | Ana ekranda "Yazdirma sorunu" banner'i, failed job sayisi, hata koduna gore cozum, tek tik retry veya yazici secerek tekrar basma. | P0 |
| StoreBridge log dosyasi Electron loguna akiyor; ayri bridge support log'u yok. | Sahada "yazici basmiyor" vakasinda neden network/USB/render/API mi hizli ayrilamaz. | Bridge stdout/stderr Electron main log'a prefiksli yaziliyor; bridge kendi kalici logunu ve job trace dosyasini tutmuyor. | `userData/logs/store-bridge.log` ve job id bazli kisa trace; token maskeli. Admin UI'dan son hata kopyalama. | P1 |
| Gercek yazici sertifikasyonu test matrisi yok. | JP80H/ESC-POS klonlari, USB spooler, network timeout ve Turkce karakter farklari release sonrasi patlar. | Encoding kodu guclu ama cihaz bazli kabul kriteri dokuman/test haline gelmemis. | En az 3 profil: network ESC/POS, USB Windows spooler, problemli Turkce firmware. Her biri icin test baskisi, mutfak fisi, kasa fisi, paket etiketi, iptal/azaltma fisi. | P1 |

### Kurulum / operasyon

| Sorun | Etkisi | Kok neden | Cozum onerisi | Oncelik |
|---|---|---|---|---|
| Signed installer yok. | Windows SmartScreen ve antivirus guven sorunu yaratir; kurulum destek maliyeti artar. | `package.json` imzalamayi kapatmis: `signAndEditExecutable=false`, `signDlls=false`. | Kod imzalama sertifikasi ve imzali NSIS release pipeline'i release oncesi zorunlu yapilmali. | P1 |
| CallerID helper hedef makinede .NET runtime'a bagimli olabilir. | CallerID "bazı makinelerde calismiyor" sorununa doner. | Dokumanda self-contained publish borcu acik; helper exe paketleniyor ama runtime gereksinimi riskli. | `win-x64 self-contained` publish, preflight ve temiz Windows VM testi. | P1 |
| Backup restore UI yok; runbook var. | Veri geri yukleme kriz aninda teknik kisi gerektirir. | Yedek dosyalar userData altina yaziliyor, uygulama icinden restore/verify yok. | Bakim ekraninda son yedek, manuel yedek al, yedek dogrula, uygulama kapaliyken restore akisi. | P1 |
| `latest.yml`/auto-update release zinciri net degil. | Paket guncelleme mekanizmasi kodda var ama release dosyasi uretilmezse calismaz. | `electron-updater` entegre, fakat dokumanda `latest.yml generation` borcu var. | `dist:win` zincirinde update metadata dogrulama ve staging release kontrolu. | P2 |

### UI/UX kalite

| Sorun | Etkisi | Kok neden | Cozum onerisi | Oncelik |
|---|---|---|---|---|
| Kritik operator ekranlarinda cihaz sagligi yeterince one cikmiyor. | Garson/kasiyer siparisi alir ama mutfak basilmadigini anlamaz. | Print queue teknik olarak var; UI'da is akisi seviyesinde "basildi/bekliyor/basarisiz" durumu zayif. | Masa ve siparis ekraninda son print durumu, failed job uyarisi, manuel tekrar yazdirma aksiyonu. | P0 |
| Siparis ekrani cok buyuk ve cok sorumluluk tasiyor. | Modifier, musteri, paket, masa tasima, odeme, satir duzenleme degisikliklerinde regresyon riski yuksek. | `OrderScreen.jsx` tek komponentte katalog, sepet, musteri modal, satir editoru, kaydetme ve odeme navigasyonu tasiyor. | Davranis degistirmeden hook/component ayrimi; once testlenebilir pure policy fonksiyonlari, sonra UI parcalama. | P1 |
| Hata mesajlari teknik ve operasyonel seviye arasinda karisik. | Operator "ne yapacagim?" sorusuna cevap alamaz. | Backend hata kodlari mevcut, frontend cogu yerde `err.message` toast ediyor. | Hata kodu -> Turkce aksiyon sozlugu: yazici pasif, bridge yok, lease expired, backend timeout, oturum bitti. | P1 |
| Frontend otomatik regresyon yok. | Masa ac, urun ekle, odeme al gibi temel akislar CSS/JS degisikliginde bozulabilir. | Testler server agirlikli; Playwright smoke yok. | Windows/Electron'a yakin tarayici smoke: login, masa ac, attribute sec, kaydet, mutfak guncelle, odeme, masa kapat, paket siparis. | P0 |

### Test eksikleri

| Sorun | Etkisi | Kok neden | Cozum onerisi | Oncelik |
|---|---|---|---|---|
| Electron paketli calisma otomatik testlenmiyor. | Paket build basarili gorunur ama temiz makinede server/bridge/helper baslamayabilir. | `desktop:preflight` dosya varligini kontrol ediyor; paketli runtime smoke sinirli. | Temiz userData ile `dist:win:dir` sonrasi Electron smoke: app acilir, `/api/health`, DB migration, bridge health, log dosyasi. | P0 |
| Gercek yazdirma simule ediliyor ama cihaz seviyesi yok. | USB spooler/network timeout/Turkce kod sayfasi regresyonlari testte yakalanmaz. | StoreBridge testleri API ve rendering agirlikli. | Fake TCP printer server + Windows spooler mock + render byte snapshot testleri; sahada manuel cihaz checklist. | P1 |
| Backup/restore testleri yok. | En kritik veri kurtarma akisi varsayim olarak kalir. | Backup Electron tarafinda ve test disinda. | WAL aktifken yazma sirasinda backup al, restore et, `PRAGMA integrity_check`, order/payment totals karsilastir. | P0 |
| Frontend lint toleransi var. | Yeni warning'ler birikmeye devam edebilir. | `client/package.json` `lint:ci` icin `--max-warnings 27` kullaniyor. | Mevcut warning baseline'i sifirlamak icin kademeli azaltma; release oncesi `--max-warnings 0`. | P2 |

## 4. Operasyonel riskler

- **Servis sirasinda print kaybi:** Print queue failed olarak isaretlenebilir ama operator bunu ana is akisi uzerinde gormezse mutfak siparisi kacirir.
- **Kurulumda eksik bridge token/business id:** Electron bridge'i atlar; POS calisir gorunur ama yazdirma yoktur.
- **WAL yedekten geri donememe:** Gunluk yedek var gibi gorunur, fakat restore aninda son islemler eksik olabilir.
- **Yetim process / port cakismasi:** Uygulama acilmadiginda destek ekibi Windows surec/port ayiklamak zorunda kalir.
- **Gercek yazici firmware farklari:** Turkce karakter, kesme komutu, ESC init ve code page secimi modelden modele degisir.
- **Manual operasyon proseduru eksikligi:** "Yazici degisti", "IP degisti", "yedekten don", "POS acilmiyor", "CallerID calismiyor" gibi durumlar runbook/UI olarak tam urunlesmemis.

## 5. Test ve kalite bosluklari

Mevcut durum:

- Backend unit/integration testleri basarili: 294 test.
- Siparis, odeme, print job, migration, encoding, auth ve reports icin anlamli testler var.
- Frontend kritik POS akislari icin otomatik E2E yok.
- Electron paketli runtime, StoreBridge gercek cihaz davranisi, CallerID helper, backup/restore ve installer/update zinciri otomatik kanitlanmiyor.
- Mevcut testler masaustu yerel urun icin iyi bir temel, fakat release confidence daha cok backend dogrulugu seviyesinde kaliyor.

Minimum test kapisi:

1. Backend `npm test` yesil.
2. Client `npm run lint:ci --prefix client` ve `npm run build` yesil.
3. Electron packaged smoke: temiz userData, server health, login, masa acma, siparis kaydetme.
4. Print smoke: fake TCP printer'a mutfak fisi, kasa fisi, paket etiketi, iptal/azaltma fisi.
5. Backup smoke: backup al, kopyadan restore et, integrity check.
6. Manuel cihaz checklist: en az bir USB ve bir network yazici ile Turkce karakter dahil test.

## 6. Onceliklendirilmis hardening plani

### Faz 1 - Hemen yapilacaklar

1. **WAL guvenli backup'i duzelt.** `copyFileSync` yerine SQLite backup API veya `VACUUM INTO`; backup sonrasi `PRAGMA integrity_check`.
2. **Print failed gorunurlugunu operator ekranina tasima.** Ana ekranda failed/pending/stale print job uyarisi, hata kodu ve tekrar dene aksiyonu.
3. **Paket etiketi yazici rolunu netlestirme.** Resolver ve UI ayni hedefi kullansin; `takeaway_label` icin ayri default veya kitchen role karari.
4. **Aktif masa/siparis DB constraint'i ve repair script.** Sahadaki veri icin once audit/repair, sonra partial unique index.
5. **Playwright smoke baslangici.** Login -> masa ac -> urun/attribute sec -> kaydet -> odeme -> kapat; paket siparis icin ikinci smoke.
6. **Temiz Electron runtime smoke.** `dist:win:dir` cikisi ile temiz userData'da app acilma ve `/api/health` dogrulama.

### Faz 2 - Bu ay yapilacaklar

1. **First-run setup wizard.** Isletme, admin, bridge token/business id, yazici secimi, test baskisi ve backup konumu tamamlanmadan "hazir" sayma.
2. **StoreBridge support log ve admin health paneli.** Bridge online/offline, son poll, son job, son hata kodu, discovery durumu.
3. **Backup/restore UI ve runbook uyumu.** Manuel yedek, son yedek tarihi, restore oncesi uygulama kapatma/DB kilidi kontrolu.
4. **Electron main modulerlestirme.** Config, server process, bridge process, CallerID, backup ve updater sinirlarini ayirma.
5. **Gercek yazici test matrisi.** Network, USB, Turkce firmware profilleri; kabul checklist'i release surecine baglama.
6. **Hata kodu -> operator aksiyonu sozlugu.** Backend/bridge error code'lari UI'da cozum metnine donussun.

### Faz 3 - Release oncesi yapilacaklar

1. **Signed installer ve temiz Windows VM testi.**
2. **CallerID helper self-contained publish ve paket dogrulama.**
3. **`latest.yml`/auto-update release zinciri dogrulama.**
4. **Frontend lint warning baseline'ini sifirlama.**
5. **Kritik ekran refactor borcunu azaltma.** `OrderScreen.jsx`, `TablesScreen.jsx`, `PrinterDetailPage.jsx` parcalansin; davranis degismeden test eklensin.
6. **Release kabul checklist'i.** Kurulum, ilk acilis, masa/siparis/mutfak/odeme/yazdirma, backup/restore, log toplama ve cihaz degisim senaryolari.

## 7. Release adayina ulasmak icin gereken minimum işler

Release adayi icin minimum "olmazsa olmaz" liste:

1. WAL guvenli backup ve restore dogrulamasi.
2. Print failed/pending/stale durumlarinin operator tarafindan gorulmesi ve tekrar basma aksiyonu.
3. Paket etiketi yazici rol/route tutarsizliginin giderilmesi.
4. Aktif masa/siparis tutarliligi icin DB seviyesinde guard ve mevcut DB repair kontrolu.
5. First-run setup veya en azindan blocking readiness ekran: bridge token, business id, yazici, test baskisi, backup.
6. Electron packaged smoke testinin release komut zincirine eklenmesi.
7. Playwright ile iki kritik akis: masa siparisi ve paket siparisi.
8. Gercek network + USB yazici manuel kabul checklist'i.
9. Signed installer karari: release public dagitilacaksa imza zorunlu; imzasizsa sadece kontrollu pilot.
10. Support log paketi: Electron, StoreBridge, backend hata ozeti ve DB path bilgisi tek yerden alinabilir olmali.

## Son karar

Bu repo masaustu yerel POS cekirdegi icin guclu bir temel atmis durumda; asil risk yeni ozellik eksigi degil, **saha operasyonunun dayaniksiz kalmasi**. Hemen odaklanilmasi gereken alanlar backup guvenligi, print arizasi gorunurlugu, kurulum readiness ve paketli runtime smoke testleridir. Bunlar tamamlandiginda urun "calisiyor" seviyesinden "dukkan bilgisayarinda guvenle birakilabilir" seviyesine cikar.
