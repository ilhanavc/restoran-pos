# Printer Release Hardening - Pass 1

## 1. Taranan akışlar
- Masa siparişi oluşturma (`POST /api/orders`, dine-in)
- Paket siparişi oluşturma (`POST /api/orders`, takeaway)
- Sipariş değişikliği / adjustment (`PATCH /api/orders/:orderId/items/:itemId`)
- Ödeme tamamlanması (`POST /api/payments`, `print_receipt`)
- Masa kapatma (`PATCH /api/orders/:id/status` -> `closed`, ayrıca `close_order=true` ödeme akışı)
- Takeaway tamamlanması (`PATCH /api/orders/:id/takeaway/delivery` -> `delivered`)
- Manuel fiş yazdırma (`POST /api/orders/:id/print-receipt`)
- Manuel paket etiketi yazdırma (`POST /api/orders/:id/takeaway/print-label`)
- Tercih açık/kapalı kombinasyonları (`autoPrint` event bazlı)
- Yanlış rol yazıcı seçme denemeleri (`receipt`/`kitchen` role guard)

### Regression checklist (release gate)
- [ ] Dine-in siparişte `onTableOrderCreate=true` iken mutfak job oluşur
- [ ] Dine-in siparişte `onTableOrderCreate=false` iken mutfak job oluşmaz
- [ ] Takeaway siparişte `onTakeawayOrderCreate=true` iken mutfak job oluşur
- [ ] Takeaway siparişte `onTakeawayOrderCreate=false` iken mutfak job oluşmaz
- [ ] Adjustment olayında `onOrderAdjustment=true` iken `kitchen_adjustment` job oluşur
- [ ] Adjustment olayında `onOrderAdjustment=false` iken `kitchen_adjustment` job oluşmaz
- [ ] Ödemede `onPaymentComplete=true` iken receipt job oluşur
- [ ] Ödemede `onPaymentComplete=false` iken receipt job oluşmaz
- [ ] Masa kapanışında `onTableClose=true` iken receipt job oluşur
- [ ] Masa kapanışında `onTableClose=false` iken receipt job oluşmaz
- [ ] Takeaway tamamlanmada `onTakeawayComplete=true` iken receipt job oluşur
- [ ] Takeaway tamamlanmada `onTakeawayComplete=false` iken receipt job oluşmaz
- [ ] Manuel fiş yazdırma, autoPrint kapalı olsa da çalışır
- [ ] Manuel paket etiketi yazdırma, autoPrint kapalı olsa da çalışır
- [ ] Yanlış rol yazıcı seçimi 400 ile reddedilir (fiş->kitchen, etiket->receipt)
- [ ] `encodePC857` ve `printerPreview` testleri yeşil kalır (Türkçe/parity kapısı)

## 2. Bulunan problemler
- Manuel yazdırma + role guard akışları için entegrasyon test kapsamı eksikti.
- AutoPrint kombinasyonlarında (`paymentComplete=false`, `tableClose=true`) kapanış davranışını doğrulayan test yoktu.
- Manuel yazdırma modalında durum etiketi, ana ekran sözlüğüyle tam tutarlı değildi (`Bağlı değil` vs `Bağlı değil / sorunlu`).

## 3. Uygulanan düzeltmeler
- `ManualPrintSelectorModal` durum metni tutarlı hale getirildi:
  - `Bağlı değil` -> `Bağlı değil / sorunlu`
- AutoPrint davranışında kritik kombinasyon ve manuel override regresyonlarını kapsayan testler eklendi.
- Role guard hatalarını release öncesi yakalayacak manuel yazdırma güvenlik testleri eklendi.

## 4. Eklenen/güncellenen testler
- Güncellendi:
  - `server/tests/integration/autoPrintPreferences.integration.test.js`
    - `paymentComplete=false + tableClose=true` kombinasyon testi eklendi
    - AutoPrint kapalıyken manuel fiş yazdırmanın çalıştığı test eklendi
- Eklendi:
  - `server/tests/integration/printManualGuards.integration.test.js`
    - Manuel fiş endpointinde yanlış rol (kitchen) reddi
    - Manuel paket etiketi endpointinde yanlış rol (receipt) reddi
    - `POST /api/payments` için yanlış `print_printer_id` rol reddi

## 5. Build/test sonuçları
- Client build:
  - `npm run build` (`client/`) ✅
- Server regression + güvenlik testleri:
  - `tests/encodePC857.test.js` ✅
  - `tests/printerPreview.test.js` ✅
  - `tests/integration/orderLifecycle.integration.test.js` ✅
  - `tests/integration/orders.integration.test.js` ✅
  - `tests/integration/payments.integration.test.js` ✅
  - `tests/integration/autoPrintPreferences.integration.test.js` ✅
  - `tests/integration/printManualGuards.integration.test.js` ✅
- Toplam: 7 dosya, 112 test geçti.

## 6. Kalan riskler
- Fiziksel cihaz üzerinde smoke test (gerçek yazıcı + farklı driver/firmware) bu turda otomatik değil, operasyonel adım olarak kalıyor.
- `Bağlı değil / sorunlu` tespiti discovered listesine dayanıyor; bazı network yazıcılarda keşif gecikmesi geçici false-negative üretebilir.
- Çoklu yazıcı senaryosunda event bazlı policy için per-printer observability (hangi printer neden skip edildi) UI’da henüz görünmüyor.

## 7. Release readiness kararı
- **Karar: Release adayı (Go), kontrollü rollout önerilir.**
- Gerekçe:
  - Kritik kırmızı çizgiler korunuyor (encoding/renderer/parity hattına dokunulmadı).
  - Manuel + otomatik yazdırma role guard ve tercih kombinasyonları testle sertleştirildi.
  - Regression test seti genişletildi ve tamamı yeşil.
