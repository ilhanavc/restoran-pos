# Yazıcı Kabul Test Matrisi

Tarih: release öncesi ve her yeni yazıcı eklendiğinde  
Hedef: Gerçek cihazda üretim öncesi Türkçe karakter, kes komutu, şablon ve hata durumu doğrulaması.

---

## Profil Tanımları

| Profil | Bağlantı | Örnek model |
|--------|----------|-------------|
| **P1** — Ağ ESC/POS | TCP/IP (port 9100) | JP-80H, Epson TM-T88, Bixolon SRP-350 |
| **P2** — USB Windows Spooler | USB → Windows yazıcı sürücüsü | Herhangi bir USB POS yazıcı |
| **P3** — Türkçe firmware sorunu | TCP/IP veya USB; ESC @ `skipInit=true` gerektiren cihazlar | Bazı no-brand Çin klonları |

Her profil için aşağıdaki tüm adımları uygulayın. Geçen adımları ✅, başarısız olanları ❌ olarak işaretleyin.

---

## Türkçe Karakter Testi

Her şablonda şu karakterler bozulmadan basılmalıdır:

```
Ç ç  Ğ ğ  İ i  Ö ö  Ş ş  Ü ü  ₺
```

Kontrol noktaları:
- [ ] Büyük harfler doğru: **Ç Ğ İ Ö Ş Ü**
- [ ] Küçük harfler doğru: **ç ğ ı ö ş ü**
- [ ] Türk Lirası sembolü: **₺** (veya "TL" — encoding moduna göre)
- [ ] Karakter bozulması yok (?, kutu, noktalı sembol)

Encoding ayarı (StoreBridge):
- `win1254` — Windows 1254 (önerilen çoğu cihaz)
- `pc857` — PC857 code page (ESC t 12)
- `skipInit=true` — bazı cihazlarda `ESC @` sonrası encoding sıfırlanıyor

---

## Şablon Testleri

### T1 — Mutfak Fişi (MASA MUTFAK)
- [ ] Sipariş numarası ve masa adı doğru
- [ ] Her kalem adı Türkçe karaktersiz değil
- [ ] Modifier / not satırı görünüyor
- [ ] Tarih/saat doğru
- [ ] Kes komutu çalışıyor (kağıt tam kesiliyor)

### T2 — Kasa Fişi (MASA KASA)
- [ ] İşletme adı, adresi, vergi no başlıkta
- [ ] Ürün adları + fiyatlar doğru
- [ ] Toplam, KDV, ödeme satırları doğru
- [ ] Footer metni görünüyor
- [ ] Kes komutu çalışıyor

### T3 — Paket Fişi / Etiketi (PAKET KASA + PAKET MUTFAK)
- [ ] Müşteri adı ve adresi doğru
- [ ] Telefon numarası doğru
- [ ] Paket notu görünüyor (varsa)
- [ ] Paket etiketi kitchen yazıcıya gitmiş (routing kontrolü)
- [ ] Kes komutu çalışıyor

### T4 — Fiş Tekrar Baskısı
- [ ] Kapatılan siparişin fişi "Tekrar Yazdır" ile basılıyor
- [ ] Aynı fiş iki kez kuyruğa gönderilmiyor (idempotency)

### T5 — Mutfak Güncelleme Fişi
- [ ] Ürün ekleme/iptal sonrası güncelleme fişi basılıyor
- [ ] Fark satırları doğru gösteriliyor

---

## Hata Durumu Testleri

### H1 — Yazıcı Kapalıyken
1. Yazıcıyı kapat
2. Sipariş ver → mutfak fişi kuyruğa girmeli
3. Masalar ekranında **"Yazdırma sorunu var"** banner'ı görünmeli
4. Hata kodu `network_timeout` veya `usb_print_failed` görünmeli
5. Türkçe aksiyon mesajı okunabilir olmalı
6. Yazıcıyı aç → **"Tekrar Dene"** butonuna bas → fiş basılmalı

- [ ] H1 başarılı

### H2 — Kağıt Bitti
1. Yazıcıdaki kağıdı bitir
2. Fiş gönder → StoreBridge hata vermeli
3. Kağıt tak → retry ile fiş basılmalı

- [ ] H2 başarılı

### H3 — Ağ Yazıcısı IP Değişikliği
1. Yazıcı IP'sini değiştir
2. Yeni IP'yi Ayarlar → Yazıcı Ayarları'nda güncelle
3. Yazıcı keşfi yeniden çalıştır
4. Test baskısı başarılı

- [ ] H3 başarılı

### H4 — USB Yazıcı Sürücüsü
1. Windows Aygıt Yöneticisi'nde yazıcı görünüyor mu?
2. Cihaz adı StoreBridge keşfinde görünüyor mu?
3. Ayarlar'da yazıcı adı (device.physicalName) Windows adıyla eşleşiyor mu?
4. Test baskısı başarılı

- [ ] H4 başarılı

---

## StoreBridge Sağlık Kontrolü

Her yazıcı profili testinden sonra **Ayarlar → StoreBridge Durumu** sayfasını kontrol edin:

- [ ] Durum: "Sağlıklı" (yeşil rozet)
- [ ] Keşfedilen yazıcı sayısı doğru
- [ ] Print kuyruğu: başarısız iş = 0, takılı iş = 0
- [ ] Son log satırlarında hata yok

---

## Kabul Kriterleri

Release için minimum geçme koşulları:

| Kriter | Zorunlu |
|--------|---------|
| T1–T3 şablonlar Türkçe karaktersiz geçiyor | ✅ Zorunlu |
| T4 tekrar baskı çalışıyor | ✅ Zorunlu |
| H1 hata→retry akışı çalışıyor | ✅ Zorunlu |
| En az 1 ağ yazıcısı (P1) tam geçti | ✅ Zorunlu |
| En az 1 USB yazıcısı (P2) tam geçti | Önerilir |
| P3 (skipInit) test edildi (cihaz varsa) | Önerilir |

---

## Test Kayıt Tablosu

| Tarih | Yazıcı Modeli | Profil | T1 | T2 | T3 | T4 | T5 | H1 | Notlar |
|-------|--------------|--------|----|----|----|----|----|----|--------|
| | | P1 | | | | | | | |
| | | P2 | | | | | | | |
| | | P3 | | | | | | | |

---

## Sık Karşılaşılan Sorunlar

| Belirti | Olası neden | Çözüm |
|---------|-------------|-------|
| Türkçe karakter bozuk (?, □) | Yanlış encoding veya ESC @ sıfırlıyor | `skipInit=true` dene; encoding modunu `pc857` veya `win1254` değiştir |
| Yazıcı keşfedilmiyor | Firewall, ağ segmenti, USB sürücü | Windows güvenlik duvarında 9100 portunu aç; USB sürücü kur |
| Kağıt kesmiyor | ESC/POS kesme komutu desteklenmiyor | `print_options.output.cutCommand` ayarını kontrol et |
| İlk baskı Türkçe, sonraki baskılar bozuk | ESC @ sonrası code page sıfırlanıyor | `skipInit=true` etkinleştir |
| StoreBridge yazıcıyı görmüyor | Tarama yapılmadı | Ayarlar → Yazıcı Ayarları → "Taramayı Yenile" |
| USB yazıcı "sürücü yok" | Windows sürücü kurulmamış | Yazıcı CD'sinden veya üretici sitesinden sürücü kur |
