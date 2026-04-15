# Regresyon Kontrol Listesi

Tarih: 2026-04-14  
Amaç: Her önemli kod değişikliğinden önce ve sonra çalıştırılacak manuel + otomatik kontrol adımları.

---

## Bölüm 1: Otomatik Kontroller (Her Değişiklikte Zorunlu)

```bash
# Tüm testleri çalıştır (239 test, ~4 saniye)
npm test

# Build'in kırılmadığını doğrula
npm run build --prefix client
```

Beklenen çıktı:
- `Test Files  20 passed`
- `Tests  239 passed`
- Build: `dist/index.html` üretildi, chunk uyarısı kabul edilebilir

---

## Bölüm 2: Masa Yönetimi

### M1 — Masa Açma

| # | Adım | Beklenen Sonuç |
|---|---|---|
| M1.1 | Boş masaya tıkla | Sipariş ekranı açılır |
| M1.2 | Ürün ekle, kaydet | Masa durumu "Dolu" olur, renk değişir |
| M1.3 | Masalar ekranına dön | Masa grid'de sipariş tutarı görünür |
| M1.4 | Boş masaya "Dolu" durumu PATCH isteği gönder | 400 hatası alınır |

### M2 — Masa Kapatma

| # | Adım | Beklenen Sonuç |
|---|---|---|
| M2.1 | Dolu masaya ödeme al (tam) | Ödeme tamamlanır |
| M2.2 | Siparişi kapat | Masa durumu "Boş" olur |
| M2.3 | Masalar ekranını yenile | Masa tutarı 0, sipariş bağlantısı yok |
| M2.4 | Kapalı masayı tekrar açmaya çalış | Yeni sipariş başlatılabilir |

### M3 — Masa Transferi

| # | Adım | Beklenen Sonuç |
|---|---|---|
| M3.1 | Dolu masadan boş masaya transfer | Transfer başarılı, kaynak boşalır |
| M3.2 | Dolu masadan dolu masaya transfer | Hata mesajı: "Hedef masa boş olmalı" |
| M3.3 | Transfer sonrası siparişi kontrol et | Siparişin table_id hedef masaya güncellendi |
| M3.4 | Transfer sonrası ödeme al | Ödeme hedef masa üzerinde alınabilir |

---

## Bölüm 3: Sipariş Akışı

### S1 — Yeni Sipariş Oluşturma

| # | Adım | Beklenen Sonuç |
|---|---|---|
| S1.1 | Masa seç → ürün ekle → kaydet | Sipariş oluşur, mutfak fişi kuyruğa girer |
| S1.2 | Ürün listesinde olmayan ID ile istek gönder | 400: "Ürün bulunamadı" |
| S1.3 | items dizisi boş | 400: "En az bir ürün gerekli" |
| S1.4 | Takeaway + müşteri seç → kaydet | Paket etiketi kuyruğa girer |

### S2 — Kayıtlı Siparişe Ürün Ekleme

| # | Adım | Beklenen Sonuç |
|---|---|---|
| S2.1 | Açık siparişe yeni ürün ekle | grand_total güncellenir, mutfak fişi kuyruğa girer |
| S2.2 | Kapalı siparişe ürün eklemeyi dene | 400: "Kapalı siparişe ürün eklenemez" |
| S2.3 | 2 adet ekle | grand_total = önceki + 2 × birim fiyat |

### S3 — Sipariş İptali

| # | Adım | Beklenen Sonuç |
|---|---|---|
| S3.1 | Ödeme almadan siparişi iptal et | Sipariş cancelled, masa boşalır, kalemler cancelled |
| S3.2 | Kısmi ödeme sonrası iptal dene | 400: "Ödeme kaydı olan sipariş iptal edilemez" |
| S3.3 | Zaten iptal edilmiş siparişi iptal et | 400 hatası |

### S4 — Kalem Durumu Geçişleri

| # | Durum Geçişi | Beklenen |
|---|---|---|
| S4.1 | new → sent | ✅ İzin verilir |
| S4.2 | new → preparing | ❌ 400 hatası |
| S4.3 | new → cancelled | ✅ İzin verilir |
| S4.4 | sent → preparing | ✅ İzin verilir |
| S4.5 | sent → ready | ✅ İzin verilir |
| S4.6 | ready → served | ✅ İzin verilir |
| S4.7 | ready → new | ❌ 400 hatası |
| S4.8 | cancelled → served | ❌ 400 hatası |
| S4.9 | comped → any | ❌ 400 hatası |

### S5 — Otomatik İptal (Tüm Kalemler İptal)

| # | Adım | Beklenen Sonuç |
|---|---|---|
| S5.1 | Ödeme olmadan tek kalemin statusünü cancelled yap | Sipariş cancelled, masa boşalır |
| S5.2 | Ödeme olan siparişte tek kalem cancelled yap | Sipariş cancelled olmaz (ödeme koruması) |

---

## Bölüm 4: Ödeme Akışı

### O1 — Tam Ödeme

| # | Adım | Beklenen Sonuç |
|---|---|---|
| O1.1 | Nakit tam ödeme al | Ödeme kaydı oluşur, order.status değişmez (close_order=false) |
| O1.2 | close_order=true ile tam ödeme al | order.status=closed, masa boşalır |
| O1.3 | Nakit alma: cash_received < amount | 400: "Alınan nakit tutarı ödeme tutarından düşük olamaz" |
| O1.4 | Tutarı kalan bakiyeyi aşan ödeme | 400: "Ödeme tutarı kalan bakiyeyi aşıyor" |
| O1.5 | Kapalı siparişe ödeme ekleme | 400: "Bu siparişe ödeme eklenemez" |
| O1.6 | İdempotency key ile aynı isteği 2 kez gönder | İkinci istek 200 + idempotent_replay:true döner |

### O2 — Hızlı Ödeme (Quick Payment)

| # | Adım | Beklenen Sonuç |
|---|---|---|
| O2.1 | 50/100/200/500 butonuna bas | Tutar alanı otomatik dolar |
| O2.2 | Toplam 100 TL, 100 TL buton → ödeme al | Masa "Ödendi" labelı gösterir |
| O2.3 | Para üstü hesaplanır | Değişim tutarı doğru gösterilir |

### O3 — Split Ödeme

| # | Adım | Beklenen Sonuç |
|---|---|---|
| O3.1 | Kalem bazlı 2 kişiye böl | Her ödeme kendi allocation'ını taşır |
| O3.2 | Tüm kalemleri öde → sipariş kapanır | order.status=closed |
| O3.3 | Kalem adedi aşan allocation | 400: "kalan adet yetersiz" |
| O3.4 | Unallocated ödeme varken split dene | 400: "kalem bazlı olmayan ödeme var" |

---

## Bölüm 5: Yazıcı Akışı

### Y1 — Mutfak Fişi

| # | Adım | Beklenen Sonuç |
|---|---|---|
| Y1.1 | Sipariş oluştur → print_jobs tablosu | `job_type=kitchen` status=printed (mock) |
| Y1.2 | İkinci kez ürün ekle | Yeni kitchen job oluşur |
| Y1.3 | Yazıcı eksikse | `status=failed`, `last_error_code=printer_missing` |

### Y2 — Fiş / Kasa Makbuzu

| # | Adım | Beklenen Sonuç |
|---|---|---|
| Y2.1 | Sipariş kapat → print_jobs tablosu | `job_type=receipt` status=printed (mock) |
| Y2.2 | print_receipt=true ile ödeme | Receipt job kuyruğa girer |

### Y3 — Yazıcı Bridge Lease

| # | Adım | Beklenen Sonuç |
|---|---|---|
| Y3.1 | Bridge job claim eder | claimed_by set, claimed_until gelecekte |
| Y3.2 | Farklı bridge aynı job'ı claim eder | 409 Conflict |
| Y3.3 | Lease süresi geçmişse aynı job yeniden claim edilebilir | 200 |
| Y3.4 | Failed job admin retry | Job tekrar pending olur |

---

## Bölüm 6: Ayarlar Ekranı

### A1 — İşletme Ayarları

| # | Adım | Beklenen Sonuç |
|---|---|---|
| A1.1 | Kaydetmeden çıkış dene | ConfirmDialog açılır (tarayıcı native confirm değil) |
| A1.2 | Onayla → çıkış | Değişiklikler kaybolur |
| A1.3 | İptal → geri dön | Değişiklikler korunur |

### A2 — Yazıcı Ayarları

| # | Adım | Beklenen Sonuç |
|---|---|---|
| A2.1 | Yazıcı sil (pending job var) | 400: "Bekleyen yazdırma işi var" |
| A2.2 | Yazıcı pasifleştir | ConfirmDialog açılır |
| A2.3 | Varsayılanlara dön | ConfirmDialog açılır |

### A3 — Menü Yönetimi

| # | Adım | Beklenen Sonuç |
|---|---|---|
| A3.1 | Kategori sil | ConfirmDialog açılır |
| A3.2 | Ürün kaldır | ConfirmDialog açılır |
| A3.3 | Toplu pasifleştir | Standart tehlikeli işlem onayı |

---

## Bölüm 7: Entegrasyon Başarısızlık Senaryoları

### E1 — StoreBridge Kapalıyken

| # | Senaryo | Beklenen Sonuç |
|---|---|---|
| E1.1 | Bridge kapalıyken sipariş oluştur | POS çalışmaya devam eder, job pending kalır |
| E1.2 | Bridge kapalıyken ödeme al | POS çalışmaya devam eder |
| E1.3 | Bridge yeniden açıldığında | Pending job'lar işlenir |

### E2 — Yazıcı Bağlantı Kesilirse

| # | Senaryo | Beklenen Sonuç |
|---|---|---|
| E2.1 | Yazıcı IP yanıt vermez | `last_error_code=network_timeout`, job failed |
| E2.2 | Yazıcı silinmişse | `last_error_code=printer_missing`, job failed |
| E2.3 | Job failed → admin retry | Manuel retry pending'e döndürür |

### E3 — Caller ID Kapalıyken

| # | Senaryo | Beklenen Sonuç |
|---|---|---|
| E3.1 | CID helper kapalı | POS sipariş akışı etkilenmez |
| E3.2 | CID yeniden bağlandığında | Reconnect otomatik denenmeye başlar |

### E4 — Veritabanı Erişim Hatası

| # | Senaryo | Beklenen Sonuç |
|---|---|---|
| E4.1 | DB dosyası kilitle | API 500 döner, uygulama çökmez |
| E4.2 | Transaction sırasında hata | Tüm işlem geri alınır (rollback) |

---

## Bölüm 8: Frontend Utility Doğrulamaları

Aşağıdaki utility fonksiyonları 239 otomatik testle kapsanıyor. Değişiklik yapılırsa test çalıştırılmalı:

| Utility | Test Dosyası | Test Sayısı |
|---|---|---|
| `orderPaymentState.js` | `orderPaymentState.test.js` | 33 |
| `orderActionPolicy.js` | `orderActionPolicy.test.js` | 30 |

**Dikkat:** Bu dosyalar değiştirilirse `isOrderFullyPaid`, `canCloseOrder`, `canOpenOrderPayment` davranışlarını otomatik testler korur.

---

## Bölüm 9: Release Öncesi Checklist

```bash
# 1. Tüm testler geçmeli
npm test
# Beklenen: 239 passed, 0 failed

# 2. Production build kırılmamış olmalı
npm run build --prefix client
# Beklenen: dist/index.html üretildi

# 3. Native modül rebuild (ABI kontrolü)
npm run smoke:electron-sqlite

# 4. Desktop preflight (paket girdileri)
npm run desktop:preflight

# 5. Smoke: temel login
npm run debug:login
```

### Manuel Doğrulama (Release Sonrası)

- [ ] Kurulum sonrası `%APPDATA%\restoran-pos\logs\electron-main.log` oluşuyor mu?
- [ ] İlk açılışta `pos-config.json` içinde `jwtSecret` üretildi mi?
- [ ] Yazıcı bağlantı testi ile PC857 Türkçe karakterler doğru çıkıyor mu?
- [ ] Masa aç → sipariş ver → ödeme al → kapat akışı çalışıyor mu?
- [ ] Kasiyer rolü ile admin-only sayfaya erişim engellenıyor mu?

---

*Bu doküman `docs/audit/08-qa-regression-audit.md` audit raporu ile birlikte güncellenmeli.*
