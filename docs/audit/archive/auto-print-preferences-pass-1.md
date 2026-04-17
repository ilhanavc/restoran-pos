# Auto Print Preferences - Pass 1

## 1. Bağlanan otomatik yazdırma tercihleri
- `PrinterDetailPage` içinde yönetilen `print_options.autoPrint.*` alanları backend davranışına bağlandı.
- Mutfak yazıcısı tercihleri:
  - `onTableOrderCreate`
  - `onTakeawayOrderCreate`
  - `onOrderAdjustment`
- Müşteri fişi yazıcısı tercihleri:
  - `onPaymentComplete`
  - `onTableClose`
  - `onTakeawayComplete`
- Manuel yazdırma akışı bu politika katmanından etkilenmeden çalışmaya devam eder.

## 2. Event -> printer policy eşlemesi
- `kitchen_table_order_create` -> `kitchen` rolü + `autoPrint.onTableOrderCreate`
- `kitchen_takeaway_order_create` -> `kitchen` rolü + `autoPrint.onTakeawayOrderCreate`
- `kitchen_order_adjustment` -> `kitchen` rolü + `autoPrint.onOrderAdjustment`
- `receipt_payment_complete` -> `receipt` rolü + `autoPrint.onPaymentComplete`
- `receipt_table_close` -> `receipt` rolü + `autoPrint.onTableClose`
- `receipt_takeaway_complete` -> `receipt` rolü + `autoPrint.onTakeawayComplete`

## 3. Değişen dosyalar
- `server/services/printerAutoPrintPolicy.js` (yeni)
- `server/services/printJobs.js`
- `server/routes/orders.js`
- `server/routes/payments.js`
- `server/routes/admin.js`
- `server/tests/integration/autoPrintPreferences.integration.test.js` (yeni)
- `docs/audit/auto-print-preferences-pass-1.md` (yeni)

## 4. Korunan güvenlik davranışları
- `store-bridge/printers/encoding.js` ve `store-bridge/printers/renderers.js` değiştirilmedi.
- Auto-print kararları yalnız job üretim katmanında uygulanır; queue/bridge/renderer zinciri bypass edilmez.
- Manuel yazdırma seçimi (`forcedPrinterId`) korunur, role guardları korunur.
- Preview/print parity hattına dokunulmadı.

## 5. Backend’de yapılan minimum eklemeler
- Merkezi politika katmanı eklendi:
  - `isAutoPrintEnabledForPrinter(printer, eventType)`
  - event sabitleri: `AUTO_PRINT_EVENTS`
- `printJobs` fonksiyonlarına minimum opsiyon desteği eklendi:
  - `enqueueKitchenJobsForSentItems(..., options)`
  - `enqueueKitchenAdjustmentJobs(..., options)`
  - `enqueueReceiptJobForClosedOrder(..., options)` içinde `applyAutoPrintPolicy` + `eventType`
- `orders` route tetik eşlemeleri:
  - yeni dine-in sipariş -> `kitchen_table_order_create`
  - yeni takeaway sipariş -> `kitchen_takeaway_order_create`
  - item add/cancel/reduce -> `kitchen_order_adjustment`
  - masa kapatma -> `receipt_table_close`
  - takeaway delivered -> `receipt_takeaway_complete`
- `payments` route tetik eşlemeleri:
  - `print_receipt` -> `receipt_payment_complete`
  - `close_order` sonucu kapanış -> `receipt_table_close` / `receipt_takeaway_complete`
- `admin` print options merge/default tarafında `autoPrint` alanı kalıcı şekilde korunacak biçimde genişletildi.

## 6. Build/test sonuçları
- Client build:
  - `npm run build` (`client/`) ✅
- Server test:
  - `tests/encodePC857.test.js` ✅
  - `tests/printerPreview.test.js` ✅
  - `tests/integration/orders.integration.test.js` ✅
  - `tests/integration/payments.integration.test.js` ✅
  - `tests/integration/autoPrintPreferences.integration.test.js` ✅
- Toplam: 5 test dosyası, 72 test geçti.

## 7. Sonraki turda kalan otomatik yazdırma boşlukları
- Event bazlı kullanıcıya geri bildirim (ör. “tercih kapalı olduğu için otomatik yazdırılmadı”) henüz UI’da gösterilmiyor.
- `order_status -> in_kitchen` gibi manuel/operasyonel geçişlerde autoPrint politikasının ayrı bir ürün kararıyla netleştirilmesi gerekebilir.
- Tercihlerin kullanıcı bazlı audit görünürlüğü (hangi event hangi yazıcıda kapalı/açık) için küçük bir admin izleme paneli eklenebilir.
