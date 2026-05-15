# Demo Video Senaryosu — 5 Dakika (Sessiz + Alt Yazılı)

> Bu doküman, **Restoran POS v1.1.0 bitirme projesi** demo videosunu adım adım kaydetmen için hazırlanmıştır. Her sahne için zaman, ne tıklayacağın ve ekrana çıkacak alt yazı belirtilmiştir.

**Toplam süre:** ~4 dakika 30 saniye (post-prod ile 5 dk)
**Format:** Sessiz, Türkçe alt yazılı
**Çözünürlük:** 1920×1080 @ 30 fps

---

## 🎬 Ön Hazırlık (Kayda Başlamadan Önce)

### 1. Kayıt aracı seç (Windows için)

| Araç | Avantaj | Dezavantaj |
|------|---------|-----------|
| **OBS Studio** (ücretsiz) | Profesyonel, çoklu kaynak, hotkey | Kurulum biraz öğrenme gerektirir |
| **Windows Game Bar** (Win+G) | Kurulu geliyor, tek tuş | Sadece tek pencere, kısıtlı |
| **ScreenToGif** (ücretsiz) | GIF + MP4, basit | Düşük kalite (animasyonlar için) |

**Tavsiyem:** OBS Studio. Tek seferlik 15 dk kurulum.

### 2. Kayıt ayarları
- **Çözünürlük:** 1920×1080
- **FPS:** 30
- **Codec:** H.264 (MP4)
- **Bitrate:** 8000 kbps (yeterli kalite, makul boyut)

### 3. Hazırlık adımları
- [ ] **Restoran POS.exe**'yi aç, **admin@demo.com / 123456** ile giriş yap
- [ ] Pencereyi **tam ekran** yap (F11 veya maksimize)
- [ ] Başka açık pencereleri kapat (taşma engellensin)
- [ ] Discord/Bildirim sesini kapat
- [ ] Demo veriyi kontrol et: 5 kategori (Smoke + 4 demo) + 20+ ürün
- [ ] Bir önceki kayıt varsa sil

### 4. Klip düzenleme aracı (sonradan)
- **DaVinci Resolve** (ücretsiz, profesyonel)
- **Clipchamp** (Windows 11 yerleşik, basit ama yeterli)

---

## 🎥 Sahne Planı

### 📌 Sahne 1 — Açılış (0:00 → 0:10) [10 sn]

**Görsel aksiyon:**
- Siyah arka plan üzerinde başlık (post-prod)
- Veya proje logosu (`P` simgesi, mor renk)

**Alt yazı (büyük, ortalı):**
```
RESTORAN POS v1.1.0
Bitirme Projesi Demo
[Ad Soyad] — [Üniversite]
```

**Kayıt notu:** Kayıt için kaydı durdurabilirsin, bu sahne post-prod'da eklenir. Veya Restoran POS.exe açılırken splash ekranı kaydet.

---

### 📌 Sahne 2 — Giriş Ekranı (0:10 → 0:25) [15 sn]

**Görsel aksiyon:**
1. Login ekranı görünüyor (zaten açık olmalı — kayıttan önce çıkış yap)
2. **"Yönetici"** demo hızlı giriş butonuna tıkla
3. Otomatik dolduğunu göster (admin@demo.com)
4. **"Giriş Yap"** butonuna tıkla
5. Masa ekranına geçiş

**Alt yazı (sahne başında 4 sn):**
```
🔐 Çoklu Rol Bazlı Kimlik Doğrulama
Yönetici · Kasiyer · Garson · Mutfak
```

**Hız ipucu:** Mouse hareketlerini ağır yap (izleyici takip etsin).

---

### 📌 Sahne 3 — Masa Yönetimi (0:25 → 0:45) [20 sn]

**Görsel aksiyon:**
1. Masa ekranı açık
2. Üst sekmelerden alanları sırayla göster: **İç Salon → Bahçe → VIP → Üst Kat**
3. Doluluk renk göstergesini vurgula (yeşil/sarı/kırmızı)

**Alt yazı (sahne başında 4 sn):**
```
🪑 Çoklu Alan + Doluluk Görselleştirmesi
4 alan · 24 masa · Renk skalası ile durum
```

**Vurgu:** Boş masalar yeşil; bir önce sipariş aldığın masa renk değiştirir.

---

### 📌 Sahne 4 — Sipariş Akışı (0:45 → 1:30) [45 sn]

**Görsel aksiyon:**
1. **"M1"** masasına tıkla → Sipariş ekranı açılır
2. **"Pideler"** kategorisine tıkla → 5 ürün görünür
3. **"Kaşarlı Pide"** ekle → sepete düşer
4. **"Ana Yemekler"** kategorisine geç
5. **"Adana Kebap"** ekle → sepette
6. **"İçecekler"** kategorisine geç
7. **"Ayran"** × 2 (2 kez tıkla)
8. Sepette toplamı vurgula (~720 TL civarı)
9. **"Mutfağa Gönder"** butonuna tıkla
10. Onay diyalogu çık → **"Onayla"**

**Alt yazı (sahne başında 5 sn):**
```
📋 Hızlı Sipariş Alma
Kategori → Ürün → Sepet → Mutfak (tek tıkla)
```

**Vurgu:** İşlem akıcı görünmeli — duraksamadan tıkla.

---

### 📌 Sahne 5 — Mutfak Ekranı (Gerçek Zamanlı) (1:30 → 1:55) [25 sn]

**Görsel aksiyon:**
1. Sol menüden **"Mutfak"** ekranına geç
2. **Az önce gönderilen siparişin anında listede olduğunu göster** (Socket.io)
3. Bir kalem üzerinde "Hazırlandı" işaretleyici tıkla
4. Renk değiştirdiğini göster

**Alt yazı (sahne başında 5 sn):**
```
⚡ Gerçek Zamanlı Mutfak Senkronizasyonu
Socket.io · Polling yok · Anlık güncelleme
```

**Vurgu:** Real-time'ı vurgula — "yenile" tıklama gerek yok.

---

### 📌 Sahne 6 — Ödeme (1:55 → 2:25) [30 sn]

**Görsel aksiyon:**
1. Sol menüden Masalar'a geri dön
2. Az önceki M1 masasına tıkla
3. **"Ödeme"** butonuna tıkla → Ödeme ekranı
4. Toplam tutarı göster
5. **"100 TL"** hızlı miktar butonuna ardarda tıkla → otomatik nakit girişi
6. **"Nakit"** seç
7. Para üstü otomatik hesaplanır
8. **"Ödemeyi Tamamla"** tıkla
9. Mutlu mesajı/onay → masa boşa düşer

**Alt yazı (sahne başında 5 sn):**
```
💳 Hızlı Ödeme + Para Üstü
Nakit · Kart · Karışık · İndirim destekli
```

---

### 📌 Sahne 7 — Paket Sipariş + Müşteri Tanıma (2:25 → 3:00) [35 sn]

**Görsel aksiyon:**
1. Sol menüden **"Paket"** sekmesine geç
2. **Müşteri Ara** alanına `905321234567` yaz
3. Otomatik olarak **"Ahmet Yıldız"** ve adresleri yüklenir
4. Adresleri kısaca göster
5. Bir ürün ekle (örn: Kavurmalı Pide)
6. **Ödeme tipi:** Nakit seç (zorunlu — bu özelliği vurgula)
7. **"Sipariş Oluştur"** tıkla
8. Paket kuyruğuna düştüğünü göster

**Alt yazı (sahne başında 5 sn):**
```
☎️ Paket Sipariş + CallerID Entegrasyonu
Telefon ile otomatik müşteri tanıma
```

**Vurgu:** Telefon numarasıyla otomatik tanıma — pratik özellik.

---

### 📌 Sahne 8 — Menü Yönetimi (3:00 → 3:30) [30 sn]

**Görsel aksiyon:**
1. Üst menüden **"Tanımlamalar"** sekmesine geç (kullanıcı dedi: ayrı bölüm)
2. **"Menü Tanımları"** sayfası
3. Sol panel: 5 kategori listesi (Smoke + Çorbalar + Pideler + Ana Yemekler + İçecekler)
4. **"Pideler"**'e tıkla → 5 ürün sağ panelde
5. **"+ Ekle"** butonuna tıkla → Yeni kategori modali açılır
6. Modali kısaca göster (ad, ikon seçenekleri, renk paleti)
7. **İptal** tıkla, kapat
8. Bir ürün kartına sağ tıkla veya üç-nokta menüsünden **"Sil"**
9. Onay modali → İptal (silme!)

**Alt yazı (sahne başında 5 sn):**
```
🍽️ Esnek Menü Yönetimi
Hibrit silme · Renk + ikon · Yazıcı hedefi
```

---

### 📌 Sahne 9 — Raporlar (3:30 → 4:05) [35 sn]

**Görsel aksiyon:**
1. Sol menüden **"Raporlar"**
2. Bugün için 4 grafik:
   - Saatlik satış (line)
   - Kategori dağılımı (pie)
   - Ödeme tipi (donut)
   - En çok satan ürünler (bar)
3. Grafiklere kısaca odaklan
4. Tarih aralığı değiştir (örn: Son 7 Gün)
5. Sayıların güncellendiğini göster
6. **"Excel'e Aktar"** butonuna tıkla (kayıt etme, sadece göster)

**Alt yazı (sahne başında 5 sn):**
```
📊 İnteraktif Raporlama
4 grafik · Excel/PDF export · X-Z dönem kapatma
```

---

### 📌 Sahne 10 — Yedek + Geri Yükleme (4:05 → 4:25) [20 sn]

**Görsel aksiyon:**
1. Sol menüden **"Ayarlar"** veya **"Bakım ve Yedekleme"**
2. **"Manuel Yedek Al"** butonu vurgula
3. Tıkla → yedekleme başlar → success toast
4. Yedek listesini göster (timestamp, boyut, SHA-256)

**Alt yazı (sahne başında 5 sn):**
```
💾 Otomatik + Manuel Yedekleme
SHA-256 doğrulamalı · Geri yükleme garantili
```

---

### 📌 Sahne 11 — Kapanış (4:25 → 4:35) [10 sn]

**Görsel aksiyon:**
- Siyah arka plan üzerinde son slayt (post-prod)

**Alt yazı (büyük, ortalı):**
```
✨ 452 Otomatik Test · 0 Lint Warning
🛡️ JWT · CORS · Rate Limit · Sentry
🇹🇷 PC857 ESC/POS · Socket.io · CallerID

GitHub: github.com/ilhanavc/restoran-pos
Email: ilhanavci499@gmail.com

Teşekkürler 🎓
```

---

## 🎬 Post-Production (Düzenleme)

### Clipchamp veya DaVinci Resolve ile

1. Ham kaydı içe aktar
2. **Hatalı tıklamaları kes** (Ctrl+B ile split, gereksiz parçayı sil)
3. **Hızlı kısımları 1.5x oynatma** ile sıkıştır (uzun bekleme süreleri varsa)
4. **Alt yazıları ekle:**
   - Her sahne başında 4-5 saniye
   - Beyaz yazı + siyah saydam kutu arka plan
   - Yazı boyutu: 50-60 pt
   - Font: Inter, Roboto veya Segoe UI Semibold
5. **Geçişler:** Sahneler arası 0.3 sn fade (overuse etme)
6. **Müzik (opsiyonel):**
   - Royalty-free: YouTube Audio Library, Pixabay Music
   - Düşük volume (-20 dB), yalnızca arka plan
   - Önerilen: "Corporate", "Tech" temaları

### Çıktı ayarları
- **Format:** MP4 (H.264)
- **Çözünürlük:** 1920×1080
- **FPS:** 30
- **Bitrate:** 8 Mbps
- **Boyut:** ~250-350 MB beklenir

---

## 📤 Paylaşım

### YouTube (Unlisted) — Önerilen
1. youtube.com'a giriş yap
2. Video yükle
3. **Görünürlük:** "Unlisted" (sadece link ile erişim)
4. Başlık: `Restoran POS v1.1.0 — Bitirme Projesi Demo`
5. Açıklama:
   ```
   Restoran yönetimi için geliştirilen tam kapsamlı POS sistemi.

   🔗 GitHub: https://github.com/ilhanavc/restoran-pos
   📦 Demo: https://github.com/ilhanavc/restoran-pos/releases/tag/v1.1.0-graduation

   Özellikler:
   • Electron + React + Express + SQLite
   • 452 otomatik test, 0 lint warning
   • Türkçe ESC/POS yazıcı + CallerID
   • Socket.io real-time
   • JWT + bcrypt + Sentry
   ```
6. Link'i kopyala
7. README'ye veya GitHub release açıklamasına ekle

### Alternatif: Direkt MP4 dosyası
- Google Drive / OneDrive'a yükle
- Paylaşım linki al
- Üniversite e-mail'iyle erişim ver

---

## ✅ Kayıt Sırası Hızlı Kontrol Listesi

- [ ] OBS Studio kuruldu, ayarlar yapıldı
- [ ] Restoran POS.exe açık, admin ile giriş yapıldı
- [ ] Tam ekran (F11)
- [ ] Discord/Bildirim sesi kapalı
- [ ] Demo seed çalışıyor (5 kategori, 20+ ürün)
- [ ] Bir kez baştan sona pratik yap (kayıt yapmadan)
- [ ] Kaydı başlat, sahneleri sırayla uygula
- [ ] Kaydı durdur, dosyayı kontrol et
- [ ] Düzenleme aracında aç, kes-ekle yap
- [ ] Alt yazıları ekle
- [ ] MP4 olarak dışa aktar
- [ ] YouTube'a yükle veya buluta koy
- [ ] Link'i README + GitHub Release'a ekle

---

## 💡 Profesyonel İpuçları

1. **İlk kaydı sıfır kabul et** — pratik için yap, ikincisi gerçek.
2. **Mouse hareketi yavaş ve net** olsun. Hızlı hareketler izleyiciyi yorar.
3. **Tıklamadan önce 1 saniye bekle** — alt yazı okunsun.
4. **Hata yaparsan kayıt durdurma**, kesip yeniden çekmek daha pahalı. Devam et, post-prod'da kes.
5. **Final video 4-5 dk** olsun. 6+ dakika çok uzun (akademik sunumda dikkat dağıtır).
6. **Üst-sağ köşede üniversite logosu** koyabilirsin (opsiyonel watermark).

İyi şanslar! 🎓
