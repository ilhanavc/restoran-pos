# Yazıcı Redesign Planı (Analiz)

Bu dokuman yalnızca analiz ve uygulama planıdır. Bu turda kod, UI, print davranısı ve testler degistirilmemistir.

## 1. Mevcut yazıcı mimarisi özeti

### 1.1 Frontend yazıcı modulu (yonetim ekranları)
- Ana giris: `client/src/App.jsx` (`settings/printers` altındaki route grubu)
- Ekranlar:
  - `client/src/components/settings/PrinterListPage.jsx`
  - `client/src/components/settings/PrinterDetailPage.jsx`
  - `client/src/components/settings/PrinterRoutingPage.jsx`
  - `client/src/components/settings/PrinterDeleteModal.jsx`
  - `client/src/components/settings/printerDefaults.js`
- Hizmet katmanı:
  - `client/src/services/api.js` (`/admin/printers`, `/admin/printer-routing`, `/admin/printers/test`, `/admin/printers/preview`)

### 1.2 Backend yazdırma mimarisi
- Yazıcı secim politikası: `server/services/printRouting.js`
  - `resolvePrinterForKitchenLine(...)`: kategori yonlendirme -> product/category target -> type fallback -> ilk aktif
  - `resolveReceiptPrinter(...)`: `settings.printer.config.defaultPrinterId` -> `type=receipt` fallback
- Job uretimi: `server/services/printJobs.js`
  - `enqueueKitchenJobsForSentItems(...)`
  - `enqueueKitchenAdjustmentJobs(...)`
  - `enqueueReceiptJobForClosedOrder(...)`
  - `enqueueTakeawayLabelJob(...)`
- Route katmanı:
  - `server/routes/orders.js` (siparis aksiyonları)
  - `server/routes/payments.js` (odeme uzerinden fis tetikleri)
  - `server/routes/admin.js` (printer CRUD, preview, test, queue, retry, routing)
  - `server/routes/bridge.js` (bridge claim/update/discovery API)
  - `server/routes/printer.js` (legacy/mock print endpointleri, halen kullanılıyor)
- Veri modeli:
  - `server/migrations/run.js` (`printers`, `printer_routing`, `print_jobs`, `idempotency_key`, `claimed_until`, `last_error_code`)

### 1.3 StoreBridge / rendering / delivery zinciri
- Poller: `store-bridge/jobs/poller.js`
  - pending job cek -> claim -> printer cek -> render -> usb/network gonder -> status update
- Renderer: `store-bridge/printers/renderers.js`
  - `payloadToEscPosBuffer(job, printerOptions)` ana byte uretim noktası
- Encoding: `store-bridge/printers/encoding.js`
  - `encodePC857`, `encodeWin1254`, `resolveEscT`, `resolveWin1254EscT`, `resolveEncodingMode`
- Fiziksel yazıcı kesfi: `store-bridge/printers/windowsDiscovery.js`
  - Windows PowerShell/WMI uzerinden cihaz listesi + baglantı tipi tahmini

## 2. Türkçe karakter ve print referansı

Kırmızı cizgi referansı mevcutta su dosyalarda yasar:
- `store-bridge/printers/encoding.js`
  - `PC857_MAP`: Turkce karakter byte map'i
  - `encodePC857`: manuel map + bilinmeyen karakter fallback
  - `encodeWin1254`: `iconv-lite` ile Win1254
  - `₺` karakteri her iki encoder tarafında da `TL` olarak normalize edilir
- `store-bridge/printers/renderers.js`
  - `payloadToEscPosBuffer`: encoding modu + `ESC t` secimi + line builder cagrıları
  - Win1254 modunda `skipPhoenixCmd` guvenli davranısı korunuyor

### Referans test guvenceleri
- `server/tests/encodePC857.test.js`
  - Turkce karakterlerin beklenen byte degerleri
  - Win1254 yolu
  - `₺ -> TL`
  - `ESC t` komut secimleri
- `server/tests/printerPreview.test.js`
  - preview line uretimi kontratı
- `server/tests/integration/bridgePrintJobs.integration.test.js`
  - claim lease, claim ownership, failed job error code kontratları
- `server/tests/integration/orderLifecycle.integration.test.js`
  - kitchen/receipt job olusumu
- `server/tests/printJobs.idempotency.test.js`
  - duplicate job engeli (`idempotency_key`)

### Yeni tasarımda dokunması riskli alanlar
- Cok yuksek risk:
  - `store-bridge/printers/encoding.js`
  - `store-bridge/printers/renderers.js`
  - `store-bridge/jobs/poller.js`
  - `server/services/printJobs.js`
- Orta risk:
  - `server/services/printRouting.js`
  - `server/routes/admin.js` (preview/test/routing/queue endpointleri)

## 3. Mevcut ekranların sorunları

### 3.1 Printer listesi ve bilgi yogunlugu
- `PrinterListPage` ekrani teknik olmayan kullanıcı icin fazla operasyon yuku tasıyor:
  - test, pasiflestirme, silme, varsayılan, adjustment policy gibi farklı kavramlar bir arada
- Sistemin ana kullanım sorusu ("Mutfak yazıcım calısıyor mu?", "Musteri fisi yazıcım hazır mı?") ilk bakısta net degil.

### 3.2 Printer detay ekranı asırı teknik
- `PrinterDetailPage` icinde aynı anda:
  - baglantı tipi/IP/port
  - line width
  - `escT`, `skipInit`, `skipPhoenixCmd`, `encodingMode`
  - layout/font secimleri
  - print tetik tercihleri
  - fiziksel cihaz eslestirme
- Teknik ayarlar dogrudan gorunur oldugu icin yanlıs ayar riski yuksek.

### 3.3 Routing ekranı kesfedilebilirlik sorunu
- `PrinterRoutingPage` mevcut ama ana yazıcı yonetiminden ayrık zihinsel model istiyor.
- Kategori yonlendirme, default receipt ve product/category target birlikte dusunulmesi gereken dagınık bir modele donusuyor.

### 3.4 Islem anında manuel yazıcı secimi eksik
- Kullanicı "Yazdır" bastıgında hedef yazıcıyı secemiyor.
- Hatalı cıktı/yanlıs hedef durumunda ayarlara geri gitmek gerekiyor.

## 4. Uygulamadaki yazdırma tetikleri ve manuel yazdırma ihtiyaçları

## 4.1 Tetik envanteri

| Ekran | Tetik | Ne yazdırıyor | Simdiki hedef yazıcı mantıgı | Manuel secim |
|---|---|---|---|---|
| `client/src/components/tables/TablesScreen.jsx` | Masa menu `Yazdır` (`api.printReceipt`) | Masa adisyon/receipt | `/api/print/receipt` backend secimi | Yok |
| `client/src/components/tables/TablesScreen.jsx` | Paket menu `Yazdır` (`api.printTakeawayLabel`) | Paket etiketi | `print_jobs` + routing/payload secimi | Yok |
| `client/src/components/payments/PaymentScreen.jsx` | `Öde ve Yazdır` / `Yazdır` | Odeme fişi | `print_receipt` bayragı + `/api/print/receipt` | Yok |
| `client/src/components/payments/QuickPaymentModal.jsx` | `Öde & Yazdır`, `Öde, Yazdır ve Kapat` | Odeme fişi | payment endpoint + print tetigi | Yok |
| `client/src/components/reports/ReportsScreen.jsx` | `Yazdır` | Rapor/PDF | Tarayıcı/OS print dialog | Var (OS seviyesinde) |
| `client/src/components/settings/PrinterListPage.jsx` | `Test` | Test cıktısı | Secili printer id ile queue job | Kısmi (yalnız testte hangi kayıt) |
| `client/src/components/settings/PrinterDetailPage.jsx` | `Test yazdır` | Test cıktısı | Mevcut printer kaydı | Kısmi (yalnız testte) |

## 4.2 Manuel yazdırma akısı mevcut mu?
- Is operasyon ekranlarında (masa, odeme, paket) runtime manuel printer secimi **yok**.
- Mevcut manuel secim benzeri davranıs yalnız admin test akısında var (`/admin/printers/test`).

## 4.3 Nerelerde eklenmeli?
- Birincil:
  - `TablesScreen` masa yazdırma
  - `PaymentScreen` ve `QuickPaymentModal` fis yazdırma
  - Paket etiket yazdırma
- Ikinci faz:
  - Siparis gecmisi/reprint noktaları
- Kural:
  - Yeni manuel secim, mevcut `print_jobs` zincirini bypass etmeden, sadece hedef `printer_id` secimi katmanı olarak eklenmeli.

## 5. Otomatik yazdırma tercihleri için önerilen model

## 5.1 Model hedefi
- Teknik degil, davranıs odaklı toggle modeli
- Printer basına tek rol: `kitchen` veya `receipt`
- Rol bazlı anlamlı tercih seti

## 5.2 Onerilen preference alanları
- Ortak:
  - `autoPrint.enabled`
  - `autoPrint.onManualReprintAllowed`
- Mutfak yazıcısı:
  - `autoPrint.onTableOrderCreate`
  - `autoPrint.onTakeawayOrderCreate`
  - `autoPrint.onOrderItemAdjustment`
  - `autoPrint.onKitchenTransferEvents` (opsiyonel)
- Musteri fisi yazıcısı:
  - `autoPrint.onPaymentComplete`
  - `autoPrint.onTableClose`
  - `autoPrint.onTakeawayFinalize`
  - `autoPrint.onCustomerCopyRequest` (opsiyonel)

## 5.3 Simdiki model ile esleme notu
- Mevcut `printOnSave`, `printOnIntegrationApprove`, `kitchenAdjustmentIncludeNew`, `defaultPrinterId` gibi alanlar migration katmanında yeni sade modele map edilerek korunmalı.
- Kullanıcıya migration detayı gosterilmemeli.

## 6. Yeni bilgi mimarisi önerisi

## 6.1 Yazıcılar ana ekranı
- 2 ana kart:
  - `Mutfak Yazıcısı`
  - `Musteri Fisi Yazıcısı`
- Kart icinde:
  - baglı cihaz adı
  - son test sonucu
  - son hata kodu/uyarı ozeti
  - otomatik yazdırma ozet ac/kapa sayısı
- Alt bolum:
  - `Diger yazıcılar` (varsa)
  - `Kategori Yönlendirme` kısa ozeti

## 6.2 Yeni yazıcı ekleme akısı (wizard)
1. Cihaz tara (`windowsDiscovery`)
2. Cihaz sec
3. Rol sec (`kitchen`/`receipt`)
4. Otomatik tercihleri sec
5. Onizleme + test yazdır
6. Kaydet ve aktiflestir

## 6.3 Yazıcı detay ekranı (sade)
- Sekmeler:
  - `Genel`: ad, aktiflik, rol
  - `Tercihler`: otomatik yazdırma toggle'ları
  - `Onizleme ve Test`
  - `Gelismis` (gizli/default kapalı): encoding/esc/network teknik alanlar

## 6.4 Manuel yazdırma yazıcı secim penceresi
- Islem tipine gore filtre:
  - fis yazdırmada yalnız `receipt` rolu
  - mutfak cıktısında yalnız `kitchen` rolu
- Kullanıcı deneyimi:
  - varsayılan secili gelir
  - son secim hatırlanır (kullanıcı bazlı)
  - tek tık onay + "bu secimi hatırla" opsiyonu (opsiyonel)

## 7. Preview/render güvenlik notları

### 7.1 Mevcut durum
- Preview: `getPrinterPreviewPlainLines(...)` (text line cıktısı)
- Gercek baskı: `payloadToEscPosBuffer(...)` (ESC/POS byte cıktısı)
- Olumlu taraf: ikisi de aynı line builder fonksiyonlarını kullanıyor.

### 7.2 Ayrısma riskleri
- Preview, ESC/POS komutlarını ve fiziksel yazıcı firmware davranısını gostermiyor.
- Encoding kaynaklı bozulmalar preview'de gorulmeyip fiziksel baskıda cıkabilir.
- Template/opsiyonel path farkları preview-print parity'yi bozabilir.

### 7.3 Guvenlik kuralı
- Preview ve print aynı line-builder path'inden uretilmeye devam etmeli.
- "Onizleme geciyorsa baskı da gecer" varsayımı yapılmamalı; fiziksel smoke test zorunlu kalmalı.

## 8. Riskli alanlar

## 8.1 Teknik risk matrisi
- `store-bridge/printers/encoding.js`
  - Risk: Turkce karakter map bozulması, `₺` davranıs kırılması
- `store-bridge/printers/renderers.js`
  - Risk: satır kırılımı/kolon hizası/cut sequence bozulması
- `server/services/printJobs.js`
  - Risk: wrong payload, duplicate suppression, yanlıs job tipi
- `store-bridge/jobs/poller.js`
  - Risk: claim-print-update zinciri ve hata kodu kontratı
- `server/services/printRouting.js`
  - Risk: kategori/role/default precedence degisimi

## 8.2 Davranıssal regresyon riskleri
- Mutfak ve musteri fisi ayrımı karısırsa yanlıs cıktı hedefe gider.
- Kategori bazlı yonlendirme precedence degisirse mutfak operasyonu bozulur.
- Manual secim kotu entegre edilirse duplicate veya bypass baskı olusabilir.

## 9. Güvenli uygulama sırası

1. **Kontrat sabitleme:** mevcut print/encoding/queue testleri "degistirilemez referans" olarak freeze edilir.
2. **Tetik haritası finalize:** tum yazdırma entrypoint'leri ve hedef yazıcı kuralları envanteri onaylanır.
3. **Veri modeli gecis tasarımı:** sade rol modeli ile mevcut alanların mapping tablosu yazılır (geriye uyumlu).
4. **UI IA faz-1:** ana ekran + detay ekran sadeleştirme (davranıs degistirmeden).
5. **Manual secim faz-2:** secili yazıcı ile mevcut queue pipeline'a giren yeni UI akısı.
6. **Otomatik tercih faz-3:** toggle modeli backend policy katmanına kontrollu baglanır.
7. **Preview parity kapısı:** satır kırılımı, kolon hizası, Turkce karakter parity kriterleri release gate olur.
8. **Queue/bridge guvenlik dogrulaması:** lease/claim/idempotency/retry kontratları regresyon testi zorunlu.
9. **Pilot rollout:** sınırlı isletmede canary + fiziksel cihaz smoke + geri donus planı.

---

## Ek A - Kategori yonlendirme ve rol ayrımı (mevcut davranıs)
- Mutfak satırlarında karar sırası (`server/services/printRouting.js`):
  1. `printer_routing` (category_id)
  2. product/category `printer_target` (`kitchen|bar`)
  3. `type=kitchen` veya `type=bar` aktif ilk yazıcı
  4. son care aktif ilk yazıcı
- Fis tarafında:
  1. `settings.printer.config.defaultPrinterId`
  2. `type=receipt` aktif ilk yazıcı

## Ek B - Fiziksel yazıcı tarama/listeleme (mevcut davranıs)
- Bridge tarafı tarama:
  - `store-bridge/printers/windowsDiscovery.js` (`Get-Printer`, `Get-PrinterPort`, WMI fallback)
- Server tarafı cache ve refresh endpointleri:
  - `/api/bridge/printers/discovered*`
  - `/api/admin/printers/discovered*`
- Frontend kullanım:
  - `PrinterDetailPage` icinde `loadDiscoveredPrinters()` ile cihaza baglı yazıcı secimi
