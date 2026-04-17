# Manual Print Selector Pass-1

## 1. Eklenen manuel yazdırma akışı
- Ortak bir `ManualPrintSelectorModal` bileşeni eklendi.
- Kullanıcı yazdırma eyleminde önce "Hangi yazıcıdan yazdırmak istiyorsunuz?" sorusuyla rol filtreli yazıcı listesi görüyor.
- Kullanıcı seçimi yalnızca `printer_id` olarak backend'e gönderiliyor; yazdırma yine mevcut `print_jobs` kuyruğu üzerinden ilerliyor.
- UI seviyesinde rol bazlı son seçim (`manualPrint:last:<role>`) `localStorage` ile hatırlanıyor.
- Varsayılan yazıcı varsa öncelikli seçili geliyor, kullanıcı isterse başka yazıcı seçebiliyor.

## 2. Entegre edilen ekranlar
- `TablesScreen`: masa adisyon yazdırma için `receipt` rol filtreli seçim.
- `TablesScreen`: paket etiketi yazdırma için `kitchen` rol filtreli seçim.
- `PaymentScreen`: "Yazdır" ve yazdırmalı ödeme aksiyonlarında `receipt` rol filtreli seçim.
- `QuickPaymentModal`: yazdırmalı hızlı ödeme aksiyonlarında `receipt` rol filtreli seçim.

## 3. Değişen dosyalar
- `client/src/components/common/ManualPrintSelectorModal.jsx` (yeni)
- `client/src/components/tables/TablesScreen.jsx`
- `client/src/components/payments/PaymentScreen.jsx`
- `client/src/components/payments/QuickPaymentModal.jsx`
- `client/src/services/api.js`
- `server/routes/orders.js`
- `server/routes/payments.js`
- `server/services/printJobs.js`

## 4. Korunan print güvenlik davranışları
- `store-bridge/printers/encoding.js` ve `store-bridge/printers/renderers.js` değiştirilmedi.
- Manuel seçim OS print dialog'una kaçmıyor; mevcut queue/bridge hattı korunuyor.
- Manuel seçim sadece hedef yazıcı kimliği (`printer_id`) override ediyor.
- Mevcut otomatik yazdırma akışlarının default davranışı korunuyor; manual override yalnız açıkça seçim yapılınca devreye giriyor.

## 5. Backend’de yapılan minimum eklemeler
- `POST /api/orders/:id/print-receipt` eklendi (manuel fiş tekrar yazdırma + opsiyonel `printer_id`).
- `POST /api/orders/:id/takeaway/print-label` endpoint'i opsiyonel `printer_id` kabul edecek şekilde genişletildi.
- `POST /api/payments` endpoint'i opsiyonel `print_printer_id` kabul edecek şekilde genişletildi.
- `enqueueReceiptJobForClosedOrder` ve `enqueueTakeawayLabelJob` fonksiyonlarına minimum `forcedPrinterId` desteği eklendi.
- Rol güvenliği eklendi:
  - Fiş için sadece `receipt` yazıcı seçilebilir.
  - Paket etiketi için sadece `kitchen` yazıcı seçilebilir.

## 6. Build/test sonuçları
- Client build: `npm run build` (client) ✅ başarılı.
- Server testleri:
  - `tests/encodePC857.test.js` ✅
  - `tests/printerPreview.test.js` ✅
  - `tests/integration/orders.integration.test.js` ✅
  - `tests/integration/payments.integration.test.js` ✅
- Toplam: 4 dosya, 68 test geçti.

## 7. Sonraki turda otomatik yazdırma tercihleri için hazır alanlar
- `print_printer_id` altyapısı sayesinde ödeme aksiyonlarında tercih bazlı yazıcı yönlendirme genişletilebilir.
- `ManualPrintSelectorModal` yapısı, gelecekte işlem tipine göre önerilen yazıcı/tercih prefill mekanizmasına uygun.
- UI seviyesindeki son seçim hafızası, kullanıcı bazlı kalıcı tercihlere taşınabilecek şekilde izole tutuldu.
