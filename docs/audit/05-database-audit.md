# 05 - Database / Transactional Systems Denetimi

Denetim tarihi: 2026-04-14  
Kapsam: tablo semasi, migration disiplini, tarihsel veri guvenligi, tenancy, siparis/odeme iliskileri, urun/kategori/yazici eslemeleri, print job ve musteri verisi.

Son uygulama turunda guvenli ve uygulanabilir iyilestirmeler koda alindi: tarihsel snapshot kolonlari, snapshot backfill, indeks dostu tarih sorgulari, seed production guard'i, yeni kurulumlar icin CHECK constraint'leri ve raporlarin snapshot verisine tasinmasi uygulandi.

## Veri modeli ozeti

Uygulama SQLite uzerinde tek migration dosyasi ile calisiyor: [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js). Model cok kiracili bir yapiya hazir: neredeyse tum ana tablolarda `business_id` var ve route'lar `req.businessId` ile scope uyguluyor.

Ana tablolar:

- `businesses`, `branches`, `roles`, `users`: tenant, sube ve kullanici yetki temeli.
- `dining_areas`, `tables`: masa ve salon modeli.
- `categories`, `products`, `product_portions`, `product_modifiers`, `product_combos`: canli menu tanimlari.
- `orders`, `order_items`, `payments`, `payment_allocations`: tarihsel islem kaydi.
- `printers`, `printer_routing`, `print_jobs`: yazici tanimi, kategori-yazici eslemesi ve job gecmisi.
- `customers`, `customer_phones`, `customer_addresses`, `call_logs`: musteri ve Caller ID baglami.

Sema genel olarak pratik POS akisini tasiyor; ancak profesyonel urun kalitesi acisindan en onemli ayrim, "canli tanim verisi" ile "tarihsel islem verisi" arasinda tam olarak tamamlanmamis. Siparis kalemi urun adi/fiyati snapshot'liyor; fakat kategori, vergi, yazici hedefi ve bazi raporlar hala canli menu tanimlarina bakiyor.

## Guclu yonler

### 1. Siparis satirinda temel urun snapshot'i var

`order_items` tablosu `product_id` ile canli urune bagli kalirken, `product_name`, `quantity`, `unit_price`, `modifiers`, `vat_rate`, `portion_id`, `portion_label` gibi islem anindaki kritik alanlari da sakliyor ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):217).

Etki: Urun adi veya fiyat degisse bile gecmis adisyonda temel tutar ve urun adi korunuyor.

### 2. Urun ve kategori silme hard delete degil

Urun silme `DELETE` yerine `is_deleted = 1`, `is_active = 0` yapiyor ([server/routes/products.js](D:/dev/restoran-pos-v3/server/routes/products.js):380). Kategori silme de kategoriyi pasife aliyor ve alt urunleri pasif/silinmis isaretliyor ([server/routes/categories.js](D:/dev/restoran-pos-v3/server/routes/categories.js):102).

Etki: Gecmis siparislerdeki `product_id` FK baglari hard delete ile kopmuyor.

### 3. Odeme idempotency icin veri modeli guclendirildi

Son backend hardening ile `payments` tablosuna `idempotency_key` ve `source` alanlari eklendi ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):250). Existing DB icin kolon ekleme ve unique index kurulumu migration icinde garantiye alindi ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):595).

Etki: Odeme tekrar istegi finansal kaydi iki kez olusturmayacak sekilde veri modelinde de destekleniyor.

### 4. Print job idempotency var

`print_jobs.idempotency_key` UNIQUE tanimli ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):301). Bu, mutfak/fis/paket etiketi job'larinda duplicate yazdirma riskini azaltan dogru bir karar.

### 5. Business scope icin temel indeksler mevcut

`users`, `tables`, `orders`, `products`, `categories`, `customers`, `payments`, `print_jobs` gibi ana tablolarda business veya iliski odakli indeksler var ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):343).

## Tarihsel veri riskleri

### P1 - Kategori bazli raporlar canli urun/kategori tanimina bagli

Kanit: Raporlarda kategori kirdirimi `order_items -> products -> categories` join'i ile hesaplanıyor ([server/routes/reports.js](D:/dev/restoran-pos-v3/server/routes/reports.js):43). `order_items` icinde `category_id` veya `category_name` snapshot'i yok ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):217).

Etki: Bir urun sonradan baska kategoriye tasinirse veya kategori yeniden adlandirilirsa, gecmis satislar bugunku kategoriye gore raporlanir. Bu restoran sahibi icin tarihsel ciro analizini bozabilir.

Kok neden: Urun snapshot'i var ama kategori snapshot'i yok.

Uygulandi: `order_items` icine `category_id_snapshot`, `category_name_snapshot`, `printer_target_snapshot` eklendi. Yeni siparislerde bu alanlar order create/add-items sirasinda dolduruluyor; mevcut kayitlar icin best-effort backfill calisiyor.

### P1 - Yazici routing tarihsel olarak snapshot'lanmiyor

Kanit: Canli urun/kategori yazici hedefleri `products.printer_target` ve `categories.printer_target` alanlarindan geliyor ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):98, [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):114). Siparis satirinda o anki yazici hedefi saklanmiyor.

Etki: Kategori veya urunun yazici hedefi degisirse, gecmis order item'dan tekrar mutfak/duzeltme job'u uretilirken bugunku routing ile tarihsel routing karisabilir.

Kok neden: Yazici hedefi canli tanim verisi olarak kalmis, order item transaction snapshot'ina alinmamis.

Uygulandi: `printer_target_snapshot` eklendi ve yeni siparis satirlarinda urun/kategori routing bilgisinden donduruluyor.

### P2 - Vergi ve servis ucreti modeli tutar guvenligi icin yetersiz

Kanit: `orders` tablosunda `subtotal`, `discount_amount`, `discount_percent`, `service_charge`, `vat_total`, `grand_total` alanlari REAL olarak duruyor ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):199). `order_items.vat_rate` var ama create akisi `vat_rate` ve `vat_total` icin fiilen 0 yaziyor.

Etki: Gelecekte KDV, servis bedeli veya yuvarlama kurallari ciddiye alindiginda eski siparislerin hangi kural setiyle hesaplandigi anlasilmayabilir.

Kok neden: Fiyat hesaplama policy versiyonu ve para birimi/tutar minor unit modeli yok.

Oneri: V2 icin `currency`, `pricing_policy_version`, `subtotal_cents`, `grand_total_cents` gibi integer minor-unit modeline gecis planlanmali. Kisa vadede REAL kalacaksa tum hesaplar merkezi `round2` ile korunmali ve audit testleri artirilmali.

### P2 - Kullanici, musteri ve masa isimleri tarihsel belgelerde kismen canli okunuyor

Kanit: Orders `user_id`, `customer_id`, `table_id` FK sakliyor ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):195). Bazı query'ler kullanici/masa/musteri adini canli join ile aliyor.

Etki: Garson adi, masa adi veya musteri adi degisirse eski rapor ekrani yeni adla gorunebilir. Finansal tutar bozulmaz, ama tarihsel operasyon raporu zayiflar.

Uygulandi: `orders.table_name_snapshot`, `orders.user_name_snapshot`, `orders.customer_name_snapshot` alanlari eklendi ve mevcut kayitlar icin backfill calistirildi. Musteri sonradan siparise baglandiginda snapshot da guncelleniyor.

## Silme / update riskleri

### P1 - Foreign key davranislari ON DELETE politikasiz

Kanit: Cok sayida FK `REFERENCES` ile tanimli, fakat cogu `ON DELETE` davranisi belirtmiyor. Ornek: `orders.table_id REFERENCES tables(id)`, `order_items.product_id REFERENCES products(id)`, `payments.order_id REFERENCES orders(id)` ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):195, [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):220, [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):241).

Etki: SQLite foreign key enforcement aktifse hard delete denemeleri patlar; aktif degilse orphan kayit riski dogar. Uygulama tarafinda soft delete kullanimi bu riski azaltiyor ama sema seviyesinde politika net degil.

Kok neden: Referential action standardi belirlenmemis.

Oneri: Islem tablolari icin hard delete yasaklanmali. Tanim tablolarinda soft delete standart olmali. Gercek `ON DELETE` davranisi yalnizca lookup/child cleanup icin bilincli kullanilmali; ornegin `product_portions` icin `ON DELETE CASCADE` zaten var ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):137).

### P2 - Seed script production icin tehlikeli davranis tasiyor

Kanit: Seed script baslarken cok sayida tabloyu `DELETE FROM` ile temizliyor ([server/seeds/run.js](D:/dev/restoran-pos-v3/server/seeds/run.js):12).

Etki: Yanlis ortamda calistirilirsa canli veri silinebilir.

Uygulandi: Seed script production ortaminda `--force` verilmeden calismayacak sekilde guvenceye alindi.

### P2 - Product/category update tarihsel raporlari dolayli etkiliyor

Kanit: Product update `name`, `price`, `category_id`, `printer_target` gibi canli alanlari degistirebiliyor ([server/routes/products.js](D:/dev/restoran-pos-v3/server/routes/products.js):249). Order item temel tutari korusa da kategori/yazici hedefi snapshot'i eksik.

Etki: Urun adi ve fiyat gecmis adisyonu bozmaz; kategori/yazici raporlari bozabilir.

Uygulandi: Raporlardaki kategori kirilimi canli kategori join'i yerine order item snapshot alanlarini kullanacak sekilde tasindi.

## Parasal alanlar

### P1 - REAL para alani uzun vadeli risk

Kanit: `products.price`, `orders.subtotal`, `orders.grand_total`, `payments.amount`, `payment_allocations.line_total` REAL olarak saklaniyor ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):110, [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):199, [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):246, [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):264).

Etki: Kucuk yuvarlama farklari, split payment ve gun sonu raporlarinda birikebilir. Mevcut kod `round2` ile pratik tolerans uyguluyor; fakat database modeli profesyonel finansal sistem icin ideal degil.

Oneri: V2 migration planinda integer minor unit yani kurus bazli alanlara gecilmeli. Kisa vadede yeni para alanlari icin CHECK constraint ve merkezi rounding testleri eklenmeli.

### P2 - Tutar CHECK constraint'leri eksik

Kanit: `payments.amount REAL NOT NULL` ama `CHECK(amount > 0)` yok ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):246). `products.price REAL NOT NULL` ama DB seviyesinde positive constraint yok ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):110).

Etki: API validation atlanirsa negatif/sifir tutar DB'ye girebilir.

Uygulandi: Yeni kurulum semasinda kritik numeric alanlara CHECK constraint eklendi. Mevcut SQLite tablolarinda constraint eklemek tablo recreation gerektirdigi icin canli veri uzerinde zorlayici tablo yeniden olusturma yapilmadi.

## Performans ve indeks notlari

Bu turda dusuk riskli indeks iyilestirmeleri uygulandi:

- `tables.current_order_id`: masa karti ve aktif order lookup'lari icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):347).
- `orders(business_id, created_at)`: tarihsel siparis listesi ve rapor filtreleri icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):352).
- `orders(business_id, status, created_at)`: aktif/kapanmis siparis listeleri icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):353).
- `orders(business_id, closed_at)`: kapanis bazli raporlar icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):354).
- `order_items(product_id)`: urun bazli analiz ve FK lookup icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):356).
- `products(business_id, is_active, is_deleted)`: menu listesi icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):359).
- `payments(business_id, created_at)` ve `payments(business_id, payment_type, created_at)`: ciro/odeme tipi raporlari icin ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):366).
- `print_jobs(business_id, status, claimed_at, created_at)`: Bridge pending/unclaimed job sorgusu icin; kolon migration'dan sonra kuruluyor ([server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js):580).

Not: Rapor sorgularinda `date(created_at)` kullanimi indeks verimini sinirlayabilir. Daha profesyonel yaklasim, tarih araligini `created_at >= ? AND created_at < ?` ile sorgulamak veya ayrica `business_date` kolonu tutmaktir.

## Veri modeli amatorluk belirtileri

### 1. Tek dosyada buyuyen migration

Tum sema ve sonradan eklenen migration yamalari tek [server/migrations/run.js](D:/dev/restoran-pos-v3/server/migrations/run.js) dosyasinda. `CREATE TABLE`, `ALTER TABLE`, backfill, tablo recreation ve seed benzeri default portion doldurma ayni dosyada.

Risk: Uretim migration sirasini izlemek, rollback planlamak ve hangi versiyonda hangi alanin geldigini anlamak zorlasiyor.

Oneri: Numarali migration dosyalari ve `schema_migrations` tablosu eklenmeli. `run.js` sadece migration runner olmali.

### 2. Tarihsel snapshot standardi net degil

Order item urun adi/fiyati snapshot'liyor, ama kategori/yazici/masa/kullanici snapshot'i yok. Bu kismi model "bazilari tarihsel, bazilari canli" gibi okunuyor.

Oneri: Her order create sirasinda hangi alanlar tarihsel belge kabul ediliyor, tek policy dokumani ve testleri olmali.

### 3. Seed script destructive ve ortam guard'i zayif

Seed baslangicinda tablo temizleme var ([server/seeds/run.js](D:/dev/restoran-pos-v3/server/seeds/run.js):12). Bu demo icin pratik, production icin tehlikeli.

Oneri: `NODE_ENV=production` durumunda seed script calismamali; destructive mode icin explicit flag istemeli.

### 4. Para modeli DB seviyesinde yeterince sert degil

API guard'lari artirildi, fakat DB constraint'leri hala finansal sistem kadar kati degil.

Oneri: Yeni numeric alanlar icin CHECK; uzun vadede integer cents.

## Onerilen iyilestirmeler

### Hemen / dusuk risk

1. Uygulandi: Rapor sorgularinda `date(column)` filtreleri indeks dostu aralik filtrelerine tasindi.
2. Uygulandi: Seed script'e production guard ve `--force` parametresi eklendi.
3. Uygulandi: Yeni kurulum semasinda kritik numeric alanlara CHECK constraint eklendi; API validation zaten korunuyor.
4. Korundu: Printer routing unique index temizleme davranisi migration akisi icinde kaldi.

### Bu hafta / orta risk

1. Uygulandi: `order_items` icine kategori ve yazici hedef snapshot alanlari eklendi.
2. Uygulandi: Order create/add-items sirasinda kategori/yazici snapshot dolduruluyor.
3. Uygulandi: Raporlardaki kategori breakdown snapshot alanlarina tasindi.
4. Kismen uygulandi: Seed script production guard ile guvenceye alindi; non-destructive setup modu ayri urunlestirme adimi olarak duruyor.

### Sonraki faz / yuksek dikkat

1. Kismen uygulandi: Para alanlari icin yeni kurulumlarda CHECK constraint ve API validation sertlestirildi. Tam integer minor unit gecisi geriye donuk veri uyumlulugu gerektirdigi icin ayri kontrollu migration olarak kalmali.
2. Kalmali: Migration sistemini numarali migration runner'a tasima ayri refactor olarak duruyor.
3. Kalmali: Soft delete ve referential action politikasini domain dokumani ve DB constraint stratejisiyle netlestirme halen gerekli.
4. Kismen uygulandi: Tarihsel belge modeli snapshot alanlariyla guclendirildi; tam immutable fiscal snapshot sonraki fazda ele alinmali.

## Uygulanmis duzeltmeler

Uygulanan duzeltmeler:

- Masa aktif siparis lookup indeksi.
- Order tarih/status/closed_at indeksleri.
- Order item product lookup indeksi.
- Order item kategori snapshot indeksi.
- Product active/deleted menu filtre indeksi.
- Payment tarih ve payment type rapor indeksleri.
- Print job bridge claim/pending indeksi.
- Order item kategori/yazici snapshot kolonlari ve backfill.
- Order header masa/musteri/kullanici snapshot kolonlari ve backfill.
- Order create/add-items akisini snapshot yazacak sekilde guncelleme.
- Gunluk kategori raporunu canli kategori yerine tarihsel snapshot verisine tasima.
- Rapor ve odeme ozeti tarih filtrelerini indeks dostu aralik sorgularina tasima.
- Seed script production guard'i.
- Yeni kurulum semasinda para/adet alanlari icin CHECK constraint'leri.

Canli veritabaninda migration basariyla calisti; 164 `order_items` satiri ve 91 `orders` satiri icin best-effort snapshot backfill uygulandi.

## Son karar

Veri modeli restoran POS icin temel operasyonu tasiyor ve son uygulamalarla tarihsel raporlama guvenligi belirgin sekilde iyilesti. Kategori/yazici hedef snapshot'i artik korunuyor. Kalan ana teknik borclar: para alanlarinin REAL olarak tutulmasi, migration sisteminin tek dosyada buyumesi ve tam immutable fiscal snapshot modelinin henuz bulunmamasi.
