# Printer Detail Screen - Pass 1

## 1. Yapılan UI/bilgi mimarisi değişiklikleri
- `PrinterDetailPage` rol odaklı sade bilgi mimarisiyle yeniden düzenlendi.
- Ekran dört net bölüme ayrıldı:
  - `Genel`
  - `Tercihler`
  - `Önizleme ve Test`
  - `Gelişmiş`
- Genel bölümde teknik olmayan kullanıcı için temel akış sadeleştirildi:
  - yazıcı adı
  - rol (Mutfak yazıcısı / Müşteri fişi yazıcısı)
  - aktif/pasif
  - (yalnız receipt rolünde) varsayılan yazıcı
  - fiziksel cihaz seçimi
- Tercihler bölümünde rol bazlı işletme dili kullanıldı:
  - Mutfak için: masa siparişi, paket siparişi, sipariş değişikliği/ayarlama otomatik yazdırma tercihleri
  - Mutfak için kategori atamaları kullanıcı dostu etiketlerle gösterildi
  - Müşteri fişi için: ödeme tamamlandığında, masa kapandığında, paket tamamlandığında otomatik yazdırma tercihleri
- Önizleme ve Test bölümü görünür hale getirildi:
  - güvenli sunucu preview hattı korunarak canlı önizleme gösteriliyor
  - test yazdırma aksiyonu bu bölümde net konumlandırıldı
- Gelişmiş bölüm varsayılan kapalı yapıda bırakıldı:
  - bağlantı tipi, ip/port, line width, esc t, skip init, skip phoenix, encoding modu
  - sınırlı önizleme font ayarları

## 2. Değişen dosyalar
- `client/src/components/settings/PrinterDetailPage.jsx`
- `client/src/components/settings/printerDefaults.js`
- `docs/audit/printer-detail-screen-pass-1.md`

## 3. Korunan davranışlar
- Preview hattı korunmuştur:
  - `api.postAdminPrinterPreview`
  - backend `getPrinterPreviewPlainLines` akışı
- Test yazdırma akışı korunmuştur:
  - `api.postPrinterTest`
- Discovered printers akışı korunmuştur:
  - `api.getDiscoveredPrinters`
  - `api.refreshDiscoveredPrinters`
- Kayıt/güncelleme akışı korunmuştur:
  - `api.postAdminPrinter`
  - `api.patchAdminPrinter`
  - `api.patchPrinterSettings`
- Detaydan listeye geri dönüş ve silme/pasifleştirme akışı korunmuştur.

## 4. Teknik olarak bilinçli gizlenen alanlar
- ESC/POS teknik ayarları ana akıştan çıkarılıp `Gelişmiş` altına taşındı:
  - `escT`
  - `skipInit`
  - `skipPhoenixCmd`
  - `encodingMode`
  - bağlantı alt detayları
  - satır genişliği
- Teknik uyarı metni eklendi: karakter/çıktı sorunu yoksa bu ayarlara dokunulmaması yönünde.

## 5. Build/test sonuçları
- `client` build: **başarılı**
  - Komut: `npm run build` (`client/`)
- Print güvenlik testleri: **başarılı**
  - Komut: `npm run test -- --run tests/encodePC857.test.js tests/printerPreview.test.js` (`server/`)
  - Sonuç: 2 dosya, 33 test geçti
- Düzenlenen dosyalar için lint/diagnostics:
  - `PrinterDetailPage.jsx`: sorun yok
  - `printerDefaults.js`: sorun yok

## 6. Sonraki turda manuel yazdırma seçimi için hazır alanlar
- Detay ekranındaki rol odaklı model, manuel yazdırma seçimi için net filtre tabanı hazırlar:
  - mutfak işlemlerinde `kitchen` rolü
  - müşteri fişi işlemlerinde `receipt` rolü
- Fiziksel cihaz eşleştirme alanı sadeleştirildiği için, manuel yazdırma diyaloğunda cihaz adı/rol eşleştirmesi reuse edilebilir.
- Tercihler sekmesi ile `Önizleme ve Test` sekmesinin ayrılması, sonraki turda “manuel yazdırmadan önce hedef yazıcı seçimi” UX’ine doğal giriş sağlar.
