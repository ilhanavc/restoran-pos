# 00b - İlk Sertleştirme Geçişi

Tarih: 2026-04-13  
Temel raporlar:

- `docs/audit/00-overall-audit.md`
- `docs/audit/00a-prioritized-action-plan.md`

Kapsam: En güvenli ve yüksek değerli 3 kalite iyileştirmesi. Büyük mimari değişiklik, yeni özellik veya davranışsal kapsam genişletmesi yapılmadı.

## Seçilen 3 iyileştirme

### 1. Yazıcı encoding mantığını renderer monolitinden ayırma

Neden seçildi:

- Audit'te P1 olarak işaretlenen Türkçe karakter/yazıcı kod sayfası karmaşıklığına doğrudan temas ediyor.
- Davranışı değiştirmeden, en riskli dosyalardan biri olan `store-bridge/printers/renderers.js` boyutunu ve sorumluluk yoğunluğunu azaltıyor.
- Sonraki adımda yazıcı profili testlerini büyütmek için daha temiz bir modül sınırı veriyor.

Etkilenen dosyalar:

- `store-bridge/printers/encoding.js`
- `store-bridge/printers/renderers.js`

Yapılan değişiklik:

- PC857 ve Windows-1254 encode fonksiyonları, ESC t çözümleyicileri, fallback/transliteration davranışı ve printable text normalize fonksiyonu yeni `encoding.js` modülüne taşındı.
- `renderers.js` mevcut `encodePC857` ve `encodeWin1254` export'larını koruyacak şekilde re-export yapıyor; mevcut test/import yüzeyi kırılmadı.

### 2. Yazıcı encoding test kapsamını güçlendirme

Neden seçildi:

- Türkçe karakter bozulması sahadaki ana risklerden biri.
- Küçük test ekleriyle default Win1254 davranışı ve PC857 davranışı daha net kilitlendi.

Etkilenen dosyalar:

- `server/tests/encodePC857.test.js`

Yapılan değişiklik:

- Varsayılan renderer modunun Windows-1254 `ESC t 32` kullandığı ve Phoenix FS komutunu göndermediği doğrulandı.
- PC857 modunda `ESC t 12` kullanıldığı, Phoenix FS komutunun korunduğu ve `Ç` karakterinin PC857 byte değeriyle çıktığı doğrulandı.

### 3. Frontend route bazlı lazy loading

Neden seçildi:

- Audit'te P1 olarak işaretlenen büyük frontend bundle uyarısına doğrudan ve düşük riskli yanıt veriyor.
- Ekranları ilk yüklemeden ayırarak düşük donanımlı POS cihazlarında açılış yükünü azaltır.

Etkilenen dosyalar:

- `client/src/App.jsx`

Yapılan değişiklik:

- Ana ekran route componentleri `React.lazy` ile dinamik import'a taşındı.
- Route ağacı `Suspense` ile sarıldı.
- Ödeme modal componentleri de lazy yüklenecek şekilde sarıldı.
- Basit bir route fallback eklendi.

## Değişen dosyalar

- `docs/audit/00a-prioritized-action-plan.md`: P0/P1/P2 maddeleri kategori bazlı eylem planına dönüştürüldü.
- `docs/audit/00b-first-hardening-pass.md`: Bu sertleştirme geçişinin raporu oluşturuldu.
- `client/src/App.jsx`: Route bazlı lazy loading eklendi.
- `server/tests/encodePC857.test.js`: Encoding/ESC-POS komut testleri genişletildi.
- `store-bridge/printers/encoding.js`: Yeni encoding modülü eklendi.
- `store-bridge/printers/renderers.js`: Encoding sorumlulukları yeni modüle taşındı, mevcut public export korundu.

## Doğrulama sonuçları

- `npm install --prefix server`
  - Başarılı.
  - Önceki `vitest` bulunamadı blokajını çözdü.

- `npm run build --prefix client`
  - Başarılı.
  - Önceki büyük ana chunk yaklaşık 948 kB idi.
  - Bu geçişten sonra ana `index` chunk yaklaşık 264.88 kB oldu.
  - Ekranlar ayrı chunk'lara bölündü: örnek `OrderScreen` 38.42 kB, `PaymentScreen` 30.46 kB, `PrinterDetailPage` 26.72 kB.
  - Hala büyük vendor chunklar var: `xlsx` 429.03 kB, `PieChart` 369.36 kB.

- `npm test --prefix server`
  - İlk deneme başarısız oldu; sebep `better-sqlite3` native modülünün farklı Node ABI ile derlenmiş olmasıydı.
  - `npm rebuild better-sqlite3 --prefix server` çalıştırıldı.
  - İkinci deneme başarılı: 12 test dosyası, 108 test geçti.

- Lint/typecheck
  - Root/client/server scriptlerinde `lint` veya `typecheck` komutu bulunmadı.
  - Bu nedenle lint/typecheck çalıştırılamadı.

## Kalan açık riskler

- Yazıcı encoding ayrıştırması davranış korumalı yapıldı, ancak fiziksel yazıcı üzerinde gerçek çıktı testi yapılmadı. Özellikle JP80H/Phoenix benzeri cihazlarda fiili `ESC t` davranışı yerinde doğrulanmalı.
- Route lazy loading build seviyesinde doğrulandı; gerçek Electron penceresinde kullanıcı akışlarıyla smoke test yapılmadı.
- `xlsx` ve chart/vendor chunkları hala büyük. Bu geçiş ana app chunkını küçülttü ama bütün bundle optimizasyonunu tamamlamadı.
- Server testleri native rebuild sonrası geçti; bu durum CI veya temiz makinede bağımlılık kurulum/rebuild adımının netleştirilmesi gerektiğini gösteriyor.
- Lint/typecheck gate'i hala yok.
