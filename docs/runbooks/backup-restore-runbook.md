# Backup & Restore Runbook — Restoran POS v3

**Hedef kitle:** Saha teknisyeni, sistem yöneticisi  
**Gereksinim:** Windows 10/11, yönetici yetkisi

---

## 1. Otomatik Backup Nasıl Çalışır?

Uygulama açık olduğu sürece her gece **02:00**'de otomatik yedek alınır.  
Yedekler şurada saklanır:

```
%APPDATA%\restoran-pos\backups\
```

Genellikle şu klasöre karşılık gelir:

```
C:\Users\<KullaniciAdi>\AppData\Roaming\restoran-pos\backups\
```

**Dosya adı formatı:** `pos-YYYY-MM-DD.db`  
**Saklama süresi:** Son 30 gün (daha eskiler otomatik silinir)

Uygulama başladığında bugünkü yedek yoksa **hemen** alır; aksi halde 02:00'yi bekler.

---

## 2. Mevcut Yedekleri Görme

```
Win + R → %APPDATA%\restoran-pos\backups
```

veya terminalde:

```bat
dir "%APPDATA%\restoran-pos\backups"
```

---

## 3. Manuel Yedek Alma (Acil Durum)

Otomatik backup çalışmadıysa veya hemen yedek almak istiyorsanız:

1. Uygulamayı kapatın.
2. Şu dosyayı güvenli bir konuma kopyalayın:

```
%APPDATA%\restoran-pos\pos.db
```

Örnek komut:

```bat
copy "%APPDATA%\restoran-pos\pos.db" "D:\yedekler\pos-%date:~-4,4%-%date:~-10,2%-%date:~-7,2%.db"
```

---

## 4. Restore — Veri Kaybı Sonrası Kurtarma

> ⚠️ **Dikkat:** Restore işlemi mevcut veritabanının üzerine yazar. Geri dönüş yoktur. Önce mevcut dosyayı yedekleyin.

### Adım 1 — Uygulamayı tamamen kapatın

Görev çubuğunda sağ tıklayıp "Kapat" ya da:

```bat
taskkill /IM "Restoran POS.exe" /F
taskkill /IM "Restoran POS Setup.exe" /F 2>nul
```

### Adım 2 — Mevcut bozuk veritabanını yedekleyin (ihtiyati)

```bat
copy "%APPDATA%\restoran-pos\pos.db" "%APPDATA%\restoran-pos\pos.db.bozuk"
```

### Adım 3 — Yedeği geri yükleyin

```bat
copy "%APPDATA%\restoran-pos\backups\pos-2026-04-14.db" "%APPDATA%\restoran-pos\pos.db"
```

`pos-2026-04-14.db` yerine kurtarmak istediğiniz tarihin dosyasını kullanın.

### Adım 4 — Uygulamayı başlatın

Masaüstündeki kısayoldan veya başlat menüsünden açın.  
Uygulama `pos.db`'yi otomatik olarak kullanmaya başlar.

---

## 5. Hangi Yedek Dosyasını Seçmeliyim?

| Senaryo | Tavsiye |
|---------|---------|
| Bugün veri silindi / yanlış işlem | Dünkü yedek: `pos-<dün>.db` |
| Son 1 haftada sıkıntı fark edildi | En eski sorunsuz tarih |
| Disk arızası / sistem çökmesi | Mümkünse harici kopyalanan en son yedek |

---

## 6. Yedekleme Başarısız Olursa

Uygulama log dosyasında hata mesajı görünür:

```
%APPDATA%\restoran-pos\logs\electron-main.log
```

Yaygın nedenler ve çözümleri:

| Hata | Olası Neden | Çözüm |
|------|-------------|-------|
| `Veritabanı bulunamadı` | pos.db yanlış yerde | `%APPDATA%\restoran-pos\` altında pos.db var mı kontrol edin |
| `EACCES / EPERM` | Klasör erişim izni yok | Uygulamayı yönetici olarak çalıştırın |
| `backups\` klasörü oluşturulamıyor | Disk dolu veya kota aşımı | Disk alanını kontrol edin |
| Hiç yedek yok (klasör boş) | Uygulama gece 02:00'de kapalıydı | Manuel yedek alın (Bölüm 3) |

---

## 7. Yedeklerin Harici Konuma Kopyalanması (Önerilen)

Otomatik yedekler yalnızca yerel diske yazılır. Disk arızasına karşı güvence için şu batch dosyasını her gece çalıştırın (Windows Görev Zamanlayıcı):

```bat
@echo off
set SRC=%APPDATA%\restoran-pos\backups
set DST=\\NAS\pos-yedek\   REM ağ sürücüsü veya harici disk

robocopy "%SRC%" "%DST%" pos-*.db /XO /NJH /NJS /NDL
echo Yedek kopyalama tamamlandı: %DATE% %TIME%
```

---

## 8. Restore Sonrası Kontrol Listesi

- [ ] Uygulama hatasız açıldı
- [ ] Admin girişi çalışıyor
- [ ] Masa listesi görünüyor
- [ ] Son sipariş geçmişi mevcut (Reports > Sipariş Geçmişi)
- [ ] Yazıcı testi başarılı
- [ ] Gerekirse kaybolan günlük işlemleri manuel girildi

---

## 9. Önemli Dosya Konumları

| Dosya | Konum |
|-------|-------|
| Aktif veritabanı | `%APPDATA%\restoran-pos\pos.db` |
| Yedekler | `%APPDATA%\restoran-pos\backups\pos-YYYY-MM-DD.db` |
| Uygulama log | `%APPDATA%\restoran-pos\logs\electron-main.log` |
| POS yapılandırma | `%APPDATA%\restoran-pos\pos-config.json` |

---

*Son güncelleme: Nisan 2026 — Restoran POS v1.0.9*
