# 80mm Print Layout Contract (Analiz)

Bu dokuman sadece analiz ve sözlesme tanımıdır. Bu turda kod, renderer, encoding, UI ve testler degistirilmemistir.

## 1. Mevcut 80 mm print ölçü analizi

### 1.1 Mevcut ölçü sistemi (render pipeline)
- Kaynak: `store-bridge/printers/renderers.js`
- Aktif satır genisligi:
  - `DEFAULT_LINE_WIDTH = 42`
  - `MIN_LINE_WIDTH = 32`
  - `MAX_LINE_WIDTH = 42`
- `resolveLineWidth()` davranısı:
  1. `payload.line_width`
  2. `BRIDGE_PRINT_LINE_WIDTH`
  3. default `42`
  - Sonuç her durumda `32..42` aralıgına clamp edilir.

Bu nedenle 80mm için kontrat, "fiziksel mm" yerine mevcut sistemdeki "karakter genisligi (ch)" uzayında tanımlanmalıdır.

### 1.2 Karakter genisligi ve Turkce/TL etkisi
- Kaynak: `store-bridge/printers/renderers.js`, `store-bridge/printers/encoding.js`
- `charDisplayWidth()`:
  - `₺` = `2` kolon
  - diger karakterler = `1` kolon
- `encodePC857` ve `encodeWin1254` her ikisinde de `₺ -> TL` donusumu vardır.
- Sonuc:
  - gorunen hizalama ile byte cıktısı uyumlu kalır (`2 kolon` = `TL` 2 byte).

### 1.3 Wrapping/kırılma davranısı
- `wrapText(text,maxWidth)`:
  - kelime bazlı sarmalama
  - tek kelime sıgmıyorsa `sliceByDisplayWidth()` ile parcalama
- `sliceByDisplayWidth` ve `displayWidth` tum kırılma hesaplarının ortak temelidir.
- Bu ortak taban, mutfak ve musterı fisinde aynı tasma mantıgını sağlar.

### 1.4 Kolon davranısı
- Mutfak urun satırı (`linesProductQty`):
  - sol: urun adı
  - sag: adet etiketi (`1 Ad`, `2 Tam`)
  - yer yetmezse adet ayrı satırda saga yaslanır
- Musteri urun satırı (`lineReceiptThreeCols`, `linesReceiptThreeCols`):
  - 3 kolon: `urun | miktar | tutar`
  - tutar kolonu sabit (`c3=11`)
  - urun kolonu dinamik (`~%55`)
  - uzun urun adında devam satırları yalnız urun adı tasır; miktar/tutar ilk satırda kalır.

### 1.5 Preview ile print hattı iliskisi
- Preview: `getPrinterPreviewPlainLines(...)`
- Gercek baskı: `payloadToEscPosBuffer(...)`
- Her iki yol da aynı line-builder fonksiyonlarını kullanır:
  - `buildKitchenLines`
  - `buildKitchenAdjustmentLines`
  - `buildReceiptLines`

Bu, sözlesmede parity kurallarını "aynı satır semantigi" etrafında tanımlamayı mumkun kılar.

## 2. Mutfak fişi layout sözleşmesi

### 2.1 Amaç
Mutfak fisinin amacı finansal detay degil, operasyonel hız ve okunabilirliktir.

### 2.2 Zorunlu alanlar
- Siparis turu (`Masa Siparisi` / `Paket Siparisi`)
- Masa veya musteri baglamı (masa no ya da paket musteri)
- Saat/tarih (en az saat-dakika, tercihen tam timestamp)
- Garson/kayıt eden kullanıcı
- Urun satırları
- Urun altı not satırları (varsa)

### 2.3 Kosullu alanlar
- Iptal/zayi/ikram/azaltma gibi ozel durum etiketi
- Teslim zamanı (paket ve gerekiyorsa)
- Istasyon bilgisi (`Mutfak`, `Bar`, `Izgara` vb.)
- Kısa fis no / yazıcı adı (operasyonel izleme icin)

### 2.4 Ust-govde-alt blok sırası
1. Ust blok:
   - ayırıcı
   - siparis no + tarih/saat
   - isletme adı (opsiyonel)
   - siparis turu + istasyon
   - masa/musteri satırı
2. Govde:
   - baslık (`URUN/ADET`)
   - urun satırları (`linesProductQty`)
   - urun notları (indentli)
3. Alt blok:
   - ayırıcı
   - kısa no / yazıcı adı (opsiyonel)

### 2.5 Mutfak için satır kuralları
- Finansal toplamlar mutfak fisinde defaultta gosterilmez.
- Urun adı tasarsa yeni satıra iner; adet gorunurlugu korunur.
- Not satırı urunle birlikte gruplanır; not kaybı olmaz.

## 3. Müşteri fişi layout sözleşmesi

### 3.1 Amaç
Musteri fisinin amacı finansal dogruluk + hukuki/operasyonel izlenebilirlik + profesyonel gorunumdur.

### 3.2 Zorunlu alanlar
- Isletme ust bilgisi (ad; adres/telefon varsa dahil)
- Fis metadatası (siparis no, tarih-saat, siparis turu)
- Urun satır tablosu (`urun | miktar | tutar`)
- Toplam blokları:
  - ara toplam
  - indirim (varsa)
  - genel toplam
- Odeme blokları:
  - odeme tipi ve tutar
  - para ustu (varsa)

### 3.3 Opsiyonel alanlar
- Musteri adı, telefon, teslimat adresi
- Servis/ek ucret satırları (is kuralı acılırsa)
- Vergi satırları (`KDV` / vergi toplamı)
- Alt not / tesekkur metni

### 3.4 Ust-govde-alt blok sırası
1. Ust blok:
   - isletme bilgileri
   - siparis tipi + fis metadatası
   - masa/musteri baglamı
2. Govde:
   - kolon baslıgı (`URUN`, `MIKTAR`, `TUTAR`)
   - urun satırları (`linesReceiptThreeCols`)
   - modifier/not satırları (urun altında)
3. Alt blok:
   - ara toplam / indirim / genel toplam
   - odemeler
   - footer
   - kısa fis no

### 3.5 Finansal tutarlılık kuralı
- Satır toplamı, ara toplam, indirim, genel toplam ve odeme toplamı birbiriyle tutarlı olmalı.
- Parasal alanlar sag hizalı olmalı.

## 4. Satır kırılma ve taşma kuralları

### 4.1 Genel kural
- Oncelik: bilgi kaybı olmadan devam satırı.
- Kritik alanlarda (urun adı, not, musteri adı, adres) agresif truncation kullanılmaz.

### 4.2 Alan bazlı kural seti
- Urun adı:
  - sıgmıyorsa wrap
  - musteride miktar+tutar ilk satırda kalır
- Not satırları:
  - urun altına indentli bir veya cok satır
  - not asla drop edilmez
- Uzun masa/musteri/kategori adları:
  - tek satıra zorlanmaz
  - wrap ile birden fazla satıra acılır
- Siparis no/saat gibi kimlik alanları:
  - oncelik korunur; gerekirse yan alan kısalır

### 4.3 Truncation ne zaman kabul edilebilir?
- Yalnız dekoratif/tekrarlı alanlarda (or. ikincil acıklama)
- Kritik is/finans/kimlik alanlarında truncation kabul edilmez.

## 5. Kolon ve hizalama kuralları

### 5.1 Grid prensibi (80mm)
- Kontrat, `32..42` karakterlik line-width bandında gecerli olmalıdır.
- Bu bant icinde layout stabil kalmalı; kolonlar kaymamalı.

### 5.2 Mutfak kolon kuralı
- Mutfakta esas kolonlar: `urun` + `adet`.
- Adet her zaman sag referanslı gorunmelidir.
- Yer darsa adet alt satıra saga yaslı inebilir; kaybolamaz.

### 5.3 Musteri kolon kuralı
- Uc kolon standardı: `urun | miktar | tutar`.
- Tutar kolonu sabit genislikte ve sag hizalı kalır.
- Miktar ortadaki kolonda, urun adı solda; tasma urun kolonundan cözulur.

### 5.4 ₺ ve fiyat hizalaması
- `₺` sembolu layout hesaplarında `2` kolon kabul edilmelidir (mevcut davranıs).
- Fiyat stringleri `fmtMoney` ile normalize edilip sag hizalanmalıdır.
- `₺ -> TL` donusumunu bozan farklı gorunum trickleri kullanılmamalıdır.

## 6. Preview/print parity kuralları

### 6.1 Zorunlu parity ilkesi
- Preview ve print aynı line-builder path'i kullanmalıdır.
- Ayrı bir HTML layout engine ile ayrı bir ESC/POS layout engine tasarlamak yasaktır.

### 6.2 Kabul edilebilir farklar
- ESC/POS kontrol byte farkları (`ESC t`, init, cut)
- Fiziksel yazıcı firmware kaynaklı mikro spacing farkları
- Kagıt yogunlugu / kafa ısısı kaynaklı ton farkı

### 6.3 Kabul edilemez farklar
- Aynı payload icin farklı satır kırılımı
- Farklı kolon hizası
- Farklı blok sırası
- Preview'de gorunup printte kaybolan satırlar (ve tersi)
- Turkce karakter previewde dogru, fiziksel baskıda bozuk sonucu

### 6.4 Fiziksel smoke test gereksinimleri
- En az 2 profil:
  - `win1254` (primary)
  - `pc857` (fallback)
- Zorunlu senaryolar:
  - uzun urun adları
  - cok satırlı notlar
  - `ÇĞİÖŞÜ çğıöşü İı ₺`
  - mutfak + musteri fisi + adjustment
- Basarı kriteri:
  - satır kırılımı/kolon hizası/alan sırası parity gecmeli

## 7. Türkçe karakter güvenlik notları

### 7.1 Kırmızı çizgi referansı
- `store-bridge/printers/encoding.js`
- `store-bridge/printers/renderers.js`
- `server/tests/encodePC857.test.js`
- `server/tests/printerPreview.test.js`

### 7.2 Encoding riskini artıran kararlar
- Ayrı bir layout motoru ile wrap/hizalama hesaplarını degistirmek
- `displayWidth`/`charDisplayWidth` mantıgını bypass etmek
- `₺` icin width/encode uyumunu bozacak ozel gosterim
- `ESC t` davranısını standart dısı sadeleştirme

### 7.3 Harf kaybı/tasma riskinin yuksek oldugu alanlar
- Uzun modifier/not satırları
- Mutfakta urun+adet dar genislikte cakisınca
- Musteride 3 kolon satırında uzun urun adları
- Adres/musteri adı gibi degisken uzun metinler

### 7.4 Guvenli fallback kuralları
- Bilinmeyen karakterde mevcut fallback davranısı korunur.
- Kritik metinlerde truncate yerine wrap tercih edilir.
- Print pipeline daima:
  - `print_jobs -> bridge -> payloadToEscPosBuffer`
  zincirinde kalır, bypass edilmez.

## 8. Güvenli uygulama sırası

1. **Kontrat dondurma:** Bu dokuman referans kabul edilip kapsam dısı degisiklikler engellenir.
2. **Fixture matrisi:** mutfak/musteri icin kısa-orta-uzun metin payload seti olusturulur.
3. **Parity kapısı:** preview ve fiziksel print aynı satır semantigi ile dogrulanır.
4. **Turkce kapısı:** karakter seti (`ç, ğ, ı, İ, ö, ş, ü, Ç, Ğ, I, İ, Ö, Ş, Ü, ₺`) cihazda dogrulanır.
5. **Kademeli uygulama:** once layout sözleşmesi, sonra UI sadeleştirme, en son ileri opsiyonlar.
6. **Regresyon zorunlulugu:** mevcut encoding/preview/bridge queue test kontratları zayıflatılmaz.
7. **Geri donus planı:** parity veya Turkce karakterde regresyon olursa son stabil davranısa geri donulur.

---

## Referans kaynaklar
- `docs/audit/printer-redesign-plan.md`
- `store-bridge/printers/renderers.js`
- `store-bridge/printers/encoding.js`
- `server/routes/admin.js`
- `client/src/components/settings/PrinterDetailPage.jsx`
- `server/tests/encodePC857.test.js`
- `server/tests/printerPreview.test.js`
- `server/tests/integration/bridgePrintJobs.integration.test.js`
