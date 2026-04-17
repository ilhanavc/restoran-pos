# Printer Discovery UX Pass-1

## 1. Ayırılan hata durumları
- **Bridge erişilemiyor** (`bridge_unreachable`, `auth_error`):
  - Mesaj: `Bu bilgisayarda yazıcı tarama servisine ulaşılamadı.`
- **Bridge yapılandırması eksik** (`lastErrorCode=bridge_not_configured` veya `bridge_unconfigured`):
  - Mesaj: `StoreBridge aktif değil ya da yapılandırılmamış.`
- **Bridge çalışıyor ama yazıcı yok** (`empty`):
  - Mesaj: `Bağlı yazıcı bulunamadı.`
- **Kayıtlı profil + canlı keşif doğrulanamadı**:
  - Fiziksel cihaz seçimi korunur.
  - Ek bilgi: `Kayıtlı yazıcı profili korunur, canlı tarama yeniden denendiğinde doğrulama güncellenir.`

## 2. Güncellenen kullanıcı mesajları
- Ana ekran ve detay ekranı aynı discovery sözlüğünü kullanacak şekilde hizalandı.
- `Bağlı değil / sorunlu` ile `Bridge yapılandırması eksik` ayrıldı.
- Liste ekranında tarama aksiyonunun altında discovery durum metni görünür hale getirildi.
- Detay ekranında keşif mesajının tonu/ifadesi ortak mapping’e taşındı.
- `Bağlı değil` ifadesi önceki turdaki ekran diliyle tutarlı olacak şekilde `Bağlı değil / sorunlu` biçiminde korunur.

## 3. Değişen dosyalar
- `client/src/components/settings/printerDiscoveryStatus.js` (yeni ortak mapping helper)
- `client/src/components/settings/PrinterListPage.jsx`
- `client/src/components/settings/PrinterDetailPage.jsx`
- `client/src/services/api.js`
- `docs/audit/printer-discovery-ux-pass-1.md`

## 4. Korunan davranışlar
- `store-bridge/printers/encoding.js` ve `store-bridge/printers/renderers.js` değiştirilmedi.
- Queue/bridge/`print_jobs` zincirine dokunulmadı.
- Bridge discovery akışının temel iş mantığı korunup yalnız UX mesajlama ayrımı iyileştirildi.
- Kayıtlı yazıcı profili silinmeden, canlı keşif sorununda görünür tutulmaya devam eder.

## 5. Build/test sonuçları
- Client build:
  - `npm run build` (`client/`) ✅
- İlgili testler:
  - `tests/encodePC857.test.js` ✅
  - `tests/printerPreview.test.js` ✅
  - `tests/integration/adminPrinters.integration.test.js` ✅
- Sonuç: 3 test dosyası, 42 test geçti.
