# Printer Main Screen - Pass 1

## 1. Yapılan UI değişiklikleri
- `Yazıcı Ayarları` ana ekranı, teknik tablo yerine modern satır/liste odaklı yapıya dönüştürüldü.
- Ekran üstüne hızlı durum özeti eklendi:
  - toplam yazıcı
  - aktif yazıcı
  - mutfak yazıcısı
  - müşteri fişi yazıcısı
  - sorunlu/eksik kurulum adedi
- Ana aksiyonlar sadeleştirildi:
  - `Yeni Yazıcı Ekle`
  - `Yazıcıları Tara / Yenile`
- Her yazıcı satırında kullanıcı dostu bilgi mimarisi uygulandı:
  - yazıcı adı
  - rol rozeti (`Mutfak yazıcısı`, `Müşteri fişi yazıcısı`, legacy fallback)
  - durum rozeti (`Hazır`, `Eksik kurulum`, `Pasif`, `Bağlı değil / sorunlu`)
  - seçili fiziksel cihaz adı
  - bağlantı özeti
  - kısa iş bilgisi (mutfakta kategori atama sayısı / fiş yazdırır bilgisi)
- Satır aksiyonları güncellendi:
  - `Düzenle`
  - `Test`
  - üç nokta menüsü içinde `Aktifleştir/Pasifleştir` ve `Sil`
- Teknik yoğun ayar (`kitchenAdjustmentIncludeNew`) ana akışı boğmaması için "Gelişmiş operasyon ayarı" altında tutuldu.

## 2. Değişen dosyalar
- `client/src/components/settings/PrinterListPage.jsx`
- `docs/audit/printer-main-screen-pass-1.md`

## 3. Korunan davranışlar
- Yazıcı detay sayfasına geçiş akışı korunmuştur (`/settings/printers/:id`).
- Mevcut admin API sözleşmeleri korunmuştur:
  - `getPrinterSettings`
  - `getAdminPrinterRouting`
  - `getDiscoveredPrinters`
  - `refreshDiscoveredPrinters`
  - `patchAdminPrinter`
  - `postPrinterTest`
- Test yazdırma davranışı korunmuştur (mevcut queue/bridge zinciri üzerinden).
- Mevcut silme akışı (`PrinterDeleteModal`) korunmuştur.

## 4. Bilinçli olarak dokunulmayan alanlar
- `store-bridge/printers/encoding.js`
- `store-bridge/printers/renderers.js`
- preview parity hattı (`getPrinterPreviewPlainLines` / `payloadToEscPosBuffer`)
- print queue ve bridge akışları
- yazıcı detay ekranı büyük ölçekli refactoru
- manuel yazdırma dialogu
- otomatik yazdırma tercihleri (yeni modelin implementasyonu)

## 5. Build/test sonuçları
- `client` build: **başarılı**
  - Komut: `npm run build` (`client/`)
- İlgili print güvenlik testleri: **başarılı**
  - Komut: `npm run test -- --run tests/encodePC857.test.js tests/printerPreview.test.js` (`server/`)
  - Sonuç: 2 test dosyası, 33 test geçti
- `client` lint komutu global uyarılar nedeniyle fail verdi:
  - Komut: `npm run lint` (`client/`)
  - Sebep: projede mevcut (önceden var olan) çoklu warning (`max-warnings 0`)
  - Bu pass kapsamında yeni kritik lint hatası eklenmedi.

## 6. Sonraki turda detay ekranı için hazır bekleyen alanlar
- Rol odaklı sade detay bölümleri (`Genel`, `Tercihler`, `Önizleme/Test`, `Gelişmiş`) için ana ekran dili hazırlandı.
- Ana ekran satırında gösterilen "kısa bilgi" alanı, detay sayfasında rehberli ayar kartlarına bağlanmaya hazır.
- Durum rozetleri için kullanılan sade statü modeli, detay sayfasında doğrulama checklist’i ile genişletilebilir.
- Legacy tiplerin kullanıcı dostu etiketlenmesi yapıldı; sonraki turda güvenli migration/uyumluluk adımları planlanabilir.
