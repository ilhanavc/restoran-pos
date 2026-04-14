# 06 - Entegrasyon Dayanikliligi Audit Raporu

Tarih: 2026-04-14  
Kapsam: StoreBridge, yazici kuyrugu, printer discovery/mapping, kategori-yazici routing, Caller ID bridge/helper, cihaz hata davranislari.

## 1. Entegrasyon Mimarisi Ozeti

Uygulamada yazdirma dogrudan POS ekranindan cihaza gitmiyor. Backend once `print_jobs` tablosuna outbox kaydi olusturuyor, StoreBridge bu kayitlari `/api/bridge/print-jobs` uzerinden alip fiziksel yaziciya gonderiyor. Bu iyi bir temel mimari: POS siparis/odeme akisi cihaz surucusune dogrudan bagli degil.

Caller ID tarafinda StoreBridge veya harici helper, gelen telefon olayini `/api/bridge/caller-id/incoming` endpointine gonderiyor. Backend musteri eslestirme ve call log kaydini kendi domain katmaninda yapiyor.

## 2. Kritik Akislar

### Yazici Discovery / Mapping

1. Admin UI yazici taramasi ister.
2. Backend refresh request durumunu settings icine yazar.
3. StoreBridge periyodik olarak refresh request'i okur.
4. Windows yazicilari PowerShell ile taranir.
5. Sonuc backend'e `bridge.discovered_printers` setting'i olarak kaydedilir.
6. Admin UI son tarama durumu, hata kodu ve yazici listesini gorur.

### Print Queue Lifecycle

1. Siparis veya test islemi `print_jobs` kaydi olusturur.
2. Job `pending` durumunda bekler.
3. StoreBridge sadece claim lease'i bos veya suresi gecmis pending job'lari listeler.
4. Bridge job'i claim eder; `claimed_by`, `claimed_until`, `attempt_count`, `last_attempt_at` guncellenir.
5. Yazdirma basariliysa job `printed` olur.
6. Yazdirma basarisizsa job `failed` olur, `error_message` ve `last_error_code` yazilir.
7. Failed job otomatik tekrar basilmiyor. Admin manuel retry ile tekrar `pending` yapar.

### Category to Printer Routing

Routing sirasiyla kategori mapping, urun/kategori hedefi ve aktif yazici fallback'i uzerinden cozulur. Mutfak job'larinda order item snapshot alanlari varsa oncelikli kullanilir; boylece kategori/urun degisikligi gecmis siparis fişlerini daha az etkiler.

### Caller ID Event Flow

1. CID812 HID provider cihazdan raw frame okur.
2. Regex parse aktifse numara cikarilir.
3. Bridge kisa sureli bounded retry kuyruguyla backend'e post eder.
4. Backend normalize telefon ile musteri eslestirir.
5. Kisa zaman penceresinde ayni kaynak/numara icin duplicate ringing kaydi engellenir.

## 3. Uygulanan Dayaniklilik Iyilestirmeleri

### P1 - Claim Lease

Eski risk: Bridge job'i claim ettikten sonra kapanirsa `claimed_at` dolu kaldigi icin job sonsuza kadar bekleyebiliyordu.  
Yeni davranis: `claimed_until` eklendi. Lease suresi gecen pending job yeniden claim edilebilir.

### P1 - Claim Sahipligi

Eski risk: Farkli bridge instance'lari ayni job icin durum update edebilirdi.  
Yeni davranis: Status update, aktif claim sahibiyle uyumlu olmak zorunda. Claim mismatch durumunda `409` doner.

### P1 - Manuel Retry

Eski risk: Failed job'lar icin standart retry semantigi yoktu.  
Yeni davranis: Admin failed job'i bilincli olarak yeniden kuyruğa alabilir. Otomatik retry yok; duplicate fiziksel baski riski bilincli olarak dusuk tutuldu.

### P1 - Hata Kodlari

Eski risk: Hatalar cogunlukla serbest metindi.  
Yeni davranis: Bridge `printer_missing`, `printer_inactive`, `network_timeout`, `usb_print_failed`, `unsupported_connection`, `printer_config_missing`, `render_failed`, `api_error`, `unknown_error` kodlariyla backend'e daha teshis edilebilir bilgi gonderir.

### P1 - StoreBridge API Timeout ve Health Retry

Eski risk: POS API baslangicta kapaliysa bridge process tek seferde dusebiliyordu; API cagrisinda timeout disiplini yoktu.  
Yeni davranis: Bridge POS API hazir olana kadar kontrollu health retry yapar. API cagrilarinda timeout uygulanir.

### P2 - Caller ID Reconnect ve Post Retry

Eski risk: HID cihaz baslangicta bulunamazsa yeniden baglanma planlanmayabiliyordu; backend POST hatasinda olay kaybolabiliyordu.  
Yeni davranis: Cihaz yoksa/filtre eslesmezse reconnect denenir. Backend post hatalari bounded in-memory retry kuyruguna girer.

### P2 - Queue Gozlemlenebilirligi

Admin print jobs cevabina summary eklendi: `pending`, `printed`, `failed`, `cancelled`, `stale_claimed`. Bu bilgi UI tarafinda operasyon paneline donusturulebilir.

## 4. Amator Gorunen Alanlar ve Durum

| Alan | Eski Durum | Yeni Durum | Kalan Risk |
|---|---|---|---|
| Claim mantigi | Sadece `claimed_at IS NULL` | Lease tabanli claim | Lease suresi cok kisa ayarlanirsa ayni job tekrar claim edilebilir |
| Retry | Belirsiz | Manuel retry | UI'da retry aksiyonu net tasarlanmali |
| Hata teshisi | Serbest metin | Standart hata kodu + mesaj | Donanimdan gercek ACK alinmiyor |
| Caller ID | Cihaz yoksa sessiz kalabiliyordu | Reconnect + bounded retry | Bridge kapaliyken olay yine dogal olarak alinmaz |
| Mock print | Yanlis konfig ile printed isaretleyebilirdi | Production guard | Dev ortaminda bilincli acilabilir |

## 5. Duplicate Print Risk Degerlendirmesi

Sistem otomatik retry yapmiyor. Bu bilincli bir urun karari: restoran ortaminda ayni mutfak fişinin ikinci kez cikmasi, gecici cihaz hatasinin manuel cozulmesinden daha maliyetli olabilir.

Halen bilinmesi gereken sinir: Raw TCP veya Windows spooler basarisi, kagidin fiziksel olarak ciktigini garanti etmez. Bu sinif cihaz entegrasyonunda gercek "printed" bilgisi ancak printer status protocol veya vendor SDK ile guclendirilebilir.

## 6. Cihaz Hatasi Ana POS Akisini Bozuyor mu?

Siparis/odeme akisi cihaza dogrudan bagli degil. Yazici hatasi job'u `failed` yapar, ana POS akisini durdurmaz. Ancak kullaniciya anlik operasyon uyarisi UI tarafinda daha belirgin hale getirilmelidir.

Caller ID kapaliysa veya helper kapanirsa POS calismaya devam eder; sadece otomatik musteri acma/siparis baslatma yardimi gelmez.

## 7. Sonraki Dusuk Riskli Iyilestirmeler

1. Admin UI'da print queue summary icin gorunur panel eklenmeli.
2. Failed job satirinda `last_error_code` kullanilarak net cozum mesajlari gosterilmeli.
3. StoreBridge loglari dosyaya yazilabilir hale getirilmeli.
4. Manual retry aksiyonu icin kullanici onay modali eklenmeli.
5. Printer status destekleyen modeller icin opsiyonel status probe katmani planlanmali.

## 8. Degisen Teknik Yuzey

- `print_jobs` tablosuna lease ve teshis kolonlari eklendi.
- Bridge claim endpoint'i lease tabanli hale getirildi.
- Bridge status update endpoint'i claim/state guard ile sertlestirildi.
- Admin print jobs endpoint'i summary donuyor.
- Admin failed job retry endpoint'i eklendi.
- StoreBridge API timeout ve health retry kazandi.
- CID812 provider reconnect ve bounded POST retry kazandi.
- Caller ID backend duplicate ringing kaydini kisa pencerede engelliyor.

## 9. Dogrulama Notu

Odakli testler claim lease, claim mismatch, failed job manuel retry, migration kolonlari ve Caller ID duplicate korumasini kapsayacak sekilde eklendi.
