# 02 - UX/UI Audit

Tarih: 2026-04-14  
Kapsam: masa ekranı, sipariş ekranı, adisyon paneli, ödeme/hızlı ödeme, modallar, ayarlar ekranları, görsel hiyerarşi, dokunmatik kullanım ve profesyonel POS hissi.  
Sınır: Bu raporda uygulama kodu değiştirilmedi; yalnızca analiz ve ekran akışı çıkarımı yapıldı.

Not: Bu denetim mevcut çalışma ağacındaki en güncel duruma göre yapıldı. Önceki ürün iş kuralı raporunda önerilen bazı düzeltmeler artık kodda görünür durumda: `Kaydet ve Mutfağa Gönder`, paket sipariş ödeme etiketi, rezerve masa transfer engeli, hızlı ödemede ödenmiş masayı kapatma gibi.

## 1. UX/UI genel özeti

Uygulama, restoran POS için doğru ana yüzeyleri barındırıyor: masalar, sipariş alma, adisyon, ödeme, hızlı ödeme, paket sipariş, Caller ID, ayarlar ve yazıcı ayarları. Operasyon ekranlarında hızlı erişim ve büyük yüzeyler düşünülmüş; özellikle sipariş ekranındaki ürün grid'i ve sağ adisyon paneli temel POS modeline uygun.

Ancak ürün profesyonel POS hissine henüz tam ulaşmıyor. Ana sorun tek tek ekranların varlığı değil, ekranlar arası aksiyon dilinin ve hiyerarşinin yeterince sistemleşmemesi:

- Kritik aksiyonlar bazen aynı görsel ağırlıkta yan yana duruyor: `Öde`, `Hızlı Öde`, `Yazdır`, `Masayı Taşı`, `İptal`.
- Masa ekranı ile sipariş ekranı aynı işi farklı UI kalıplarıyla yaptırıyor: masa taşıma, ödeme açma, kapatma.
- Modal sistemi çok kullanılıyor; bazı modallar POS hız ekranı gibi, bazıları ayar paneli gibi davranıyor.
- Görsel dil modernleşmiş olsa da koyu tema, yoğun kartlar, çok sayıda inline stil, güçlü gölgeler ve mor/purple accent bazı ekranlarda "operasyon aracı" yerine "dashboard template" hissi verebiliyor.
- Dokunmatik kullanımda ana butonlar çoğunlukla yeterli, ama ikon menüler, satır içi silme butonları, ürün miktar +/- butonları ve paket sipariş menüsü için hedef alanlar sınırda.

Net cevaplar:

- Kullanıcı en kritik aksiyonu ilk bakışta anlayabiliyor mu?
  - Masa ekranında kısmen. Dolu masada ana aksiyon masaya tıklamak, ama `...` menüsündeki işlemler kritik olmasına rağmen gizli. Sipariş ekranında daha iyi: sepet varsa tek ana aksiyon `Kaydet ve Mutfağa Gönder`; sepet yoksa `Ödeme / Hızlı Öde` görünüyor.

- Yeni masa ile kayıtlı masa davranışları arayüzde net ayrılmış mı?
  - Orta seviyede. Sağ panelde `Mevcut Ürünler` ve `Yeni Eklenen` ayrımı iyi. Fakat yeni masa için "taslak sipariş" durumu, kayıtlı masa için "mutfağa gitmiş sipariş" durumu daha görünür bir status çipiyle ayrılmalı.

- `Kaydet / Ödeme / Hızlı Öde / Masayı Kapat` aksiyonları durum bazlı tutarlı mı?
  - Artık daha tutarlı. `OrderScreen.jsx:590` ödeme açma koşulunu kaydedilmemiş ürün yokken aktif ediyor; `OrderScreen.jsx:1159` ana aksiyon dilini netleştiriyor. Masa ekranında `Masayı Kapat` yalnız tam ödenmiş hesapta gösteriliyor (`TablesScreen.jsx:262`, `TablesScreen.jsx:1153`). Hala aynı aksiyonlar farklı ekranlarda farklı layout ve isim ağırlıklarıyla sunuluyor.

- Gereksiz bilgi yoğunluğu var mı?
  - Evet, özellikle masa kartlarında süre, toplam, ödenen tutar, garson, hazır/ödendi rozeti, renk kodu ve menü aynı küçük kartta yarışıyor. Ödeme ekranı da güçlü ama iki kolonlu yapı, split ödeme, aksiyon tipi, ödeme tipi, tutar alanı ve ödeme kalemleri ile yoğun.

- Eski, amatör, kaba veya güvensiz görünen UI parçaları hangileri?
  - `window.confirm` kullanımı, inline style yoğunluğu, küçük ikon aksiyonları, ayarlar ekranındaki ham form hissi, yazıcı ayarlarında çok teknik seçeneklerin aynı yüzeye yığılması, modalların görev tipine göre yeterince ayrışmaması.

- Dokunmatik kullanım için buton boyutu, aralık, hiyerarşi yeterli mi?
  - Ana butonlarda çoğunlukla evet: `.btn` min-height 40, büyük aksiyonlarda 46-56 px var (`global.css:580`, `global.css:615-617`). Fakat satır içi ikonlar, ürün gridindeki +/- alanları, paket kartı üç nokta menüsü ve bazı ayar formları dokunmatik yoğun kullanım için dar.

## 2. Ekran bazlı değerlendirme

### 2.1 Masa ekranı

Kanıt:

- Masa veri/state yükleme ve socket/polling: `client/src/components/tables/TablesScreen.jsx:60-116`
- Transfer modu ve masa tıklama davranışı: `client/src/components/tables/TablesScreen.jsx:192-244`
- Masa kartı grid ve kart hiyerarşisi: `client/src/components/tables/TablesScreen.jsx:523-720`
- Masa aksiyon modalı: `client/src/components/tables/TablesScreen.jsx:1089-1167`
- Paket sipariş sidebar: `client/src/components/tables/TablesScreen.jsx:784-1056`

Güçlü yönler:

- Masa ekranı doğru şekilde tek bakışta operasyon merkezi olmayı hedefliyor.
- Boş, dolu, uzun süre, hazır ve ödenmiş durumları renk/rozet ile ayrılıyor.
- Dolu masa aksiyonları ana kartın içine gömülmemiş, ayrı action sheet modalında toplanmış.
- Paket siparişler yan panelde ayrı bir kuyruk olarak gösteriliyor.
- Transfer sonrası hedef masa vurgusu mevcut çalışma ağacında eklenmiş durumda; bu, yön bulmayı iyileştiriyor.

Kullanılabilirlik kusurları:

- Dolu masada kritik işlemler `...` arkasında. Yoğun servis anında `Öde` veya `Hızlı Öde` için önce küçük üç nokta hedefini bulmak gerekiyor.
- Masa kartı birincil tıklama ile sipariş açıyor, üç nokta ile işlem açıyor. Bu iyi, ancak kullanıcıya kart üzerinde "siparişi aç" affordance'ı yok.
- Transfer modu sadece "Hedef masayı seçin" metniyle ifade ediliyor (`TablesScreen.jsx:541`). Hangi masadan taşındığı aynı banner içinde görünmüyor.
- Rezerve masa açılırken browser confirm kullanılması akışı kaba ve native olmayan hale getiriyor.
- Paket sipariş kartındaki `Teslim Edildi` butonu disabled olduğunda sebep sadece title ile veriliyor (`TablesScreen.jsx:1046`). Dokunmatik cihazda title pratikte görünmez.

Görsel kalite kusurları:

- Masa kartları yoğun bilgi ve renk koduyla çalışıyor; ödendi, hazır ve süre uyarıları aynı görsel katmanı paylaşıyor.
- `HESAP ÖDENDİ` rozeti doğru ama çok küçük; yoğun kullanımda hızlı fark edilmesi için daha güçlü layout durumu gerekebilir (`TablesScreen.jsx:677`).
- Paket kartları gradient kullanıyor; operasyon ekranında gradient dekoratif kalıyor ve okunabilirliği her zaman artırmıyor.
- `btnBase` ile paket aksiyonları lokal stil üzerinden tanımlanmış (`TablesScreen.jsx:464`); global buton sisteminden kopuk.

Profesyonel ürün hissini bozan noktalar:

- Browser `window.confirm` kullanımı. POS'ta native confirm amatör ve güven vermeyen bir his yaratır.
- Aynı ekranda hem masa grid'i hem paket sipariş kuyruğu var; V1 için kabul edilebilir ama paket operasyonu büyüdükçe yan panel sıkışır.
- İşlem modalı tüm aksiyonları eşit kareler olarak sunuyor. `İptal` gibi yıkıcı aksiyon ile `Öde` aynı grid mantığında yan yana duruyor.

### 2.2 Sipariş ekranı

Kanıt:

- Topbar, masa/paket/müşteri bağlamı ve arama: `client/src/components/orders/OrderScreen.jsx:642-720`
- Ödeme açma koşulu: `client/src/components/orders/OrderScreen.jsx:590-604`
- Ürün grid'i: `client/src/components/orders/OrderScreen.jsx:730-895`
- Adisyon paneli: `client/src/components/orders/OrderScreen.jsx:899-1180`
- Müşteri seçimi modalı: `client/src/components/orders/OrderScreen.jsx:1297-1415`

Güçlü yönler:

- Sol ürün grid'i + sağ adisyon paneli doğru POS modelidir.
- Topbar'da masa, salon alanı, müşteri ve paket telefon bilgisi bağlamsal olarak gösteriliyor.
- `Mevcut Ürünler` ve `Yeni Eklenen` ayrımı iyi bir hata önleme kuralıdır (`OrderScreen.jsx:936`, `OrderScreen.jsx:1037`).
- Kaydedilmemiş ürün varken ödeme aksiyonlarının gizlenmesi hata önlüyor (`OrderScreen.jsx:590`, `OrderScreen.jsx:1161`).
- `Kaydet ve Mutfağa Gönder` metni, iş kuralı ile UI dilini daha doğru hizalıyor (`OrderScreen.jsx:1159`).

Kullanılabilirlik kusurları:

- Ürün kartları 200px minimum grid ile düzenleniyor; hızlı servis için ürün yoğunluğu iyi ama ürün fotoğrafı veya kategori rengi yoksa ürünler metin listesine dönüşebilir.
- Ürün kartında miktar kontrolü sağda kırmızı bir dikey alana dönüşüyor. Kırmızı renk genelde tehlike/silme anlamı taşır; burada miktar kontrolü için agresif.
- Sağ adisyon paneli 460px sabit genişlikte. Düşük çözünürlüklü POS cihazlarında ürün grid alanını fazla daraltabilir.
- `Kaydet ve Mutfağa Gönder` butonu doğru ama uzun. Küçük ekran veya Türkçe uzun metinlerde satır kırılması riski var.
- Kayıtlı satır, gönderilmiş satır, ikram, iptal gibi durumlar var ama adisyon panelinde bu durumların kullanıcı mental modeli için açıklaması yok.

Görsel kalite kusurları:

- Sipariş ekranı çok fazla inline style içeriyor. Bu, tek tek bakıldığında çalışır ama sistematik tasarım kalitesini zayıflatır.
- Bazı mikro ikonlar emoji ile verilmiş: not göstergesinde `📝`. Bu, kurumsal POS hissini hafifletiyor.
- Topbar iyi düşünülmüş ama geri alanı büyük ve arama alanı ile yarışıyor; birincil görev "ürün ara/ekle" mi, "geri dön" mü ilk bakışta netleşmeli.

Profesyonel ürün hissini bozan noktalar:

- Müşteri seçimi modalı hem arama, hem yeni müşteri formu, hem seçili müşteri, hem adres alanını aynı yüzeye koyuyor. Paket sipariş için gerekli ama modüler akış hissi zayıf.
- Kayıtlı siparişe yeni ürün ekleme ile yeni sipariş oluşturma aynı butonla çözülüyor; metin doğru, fakat "bu ürünler mutfağa yeni fiş olarak gidecek" görsel olarak daha güçlü olmalı.

### 2.3 Sağ panel / adisyon paneli

Güçlü yönler:

- Sabit sağ panel POS kullanımında doğru. Kullanıcı toplamı ve adisyonu sürekli görür.
- Alt toplam alanı sticky gibi davranıyor ve ana aksiyonu en altta tutuyor.
- Yeni eklenen satırların accent sol çizgi ile ayrılması iyi.

Kullanılabilirlik kusurları:

- Mevcut kalemlerde miktar değişimi bazı durumlarda küçük `+/-` butonlarıyla, bazı durumlarda salt miktar metniyle gösteriliyor. Durum farkı doğru ama neden düzenlenemediği satırda açıklanmıyor.
- Silme/void ikonları küçük ve yıkıcı. Yoğun dokunmatik kullanımda yanlış void riski var.
- Toplam alanında `Ara toplam` ve `Toplam` var; KDV/indirim yoksa bu iki değer kullanıcı için gereksiz tekrar gibi algılanabilir.

Görsel kalite kusurları:

- Panelde satır yoğunluğu yüksek. Sipariş büyüdükçe her satır fiyat, modifier, not, status, miktar ve silme ikonuyla kalabalıklaşıyor.
- Alt toplam alanının güçlü gölgesi modern ama biraz "web dashboard" hissi veriyor; POS'ta daha düz, yüksek kontrastlı kasa paneli daha net olabilir.

### 2.4 Ödeme ve hızlı ödeme akışı

Kanıt:

- Ayrıntılı ödeme action tipleri: `client/src/components/payments/PaymentScreen.jsx:13-18`
- Ayrıntılı ödeme ekranı/modalı: `client/src/components/payments/PaymentScreen.jsx:190`
- Split ödeme girişi: `client/src/components/payments/PaymentScreen.jsx:255`
- Tam ödeme sonrası kapatma: `client/src/components/payments/PaymentScreen.jsx:361-386`
- İşlem aksiyonu, ödeme tipi, alınacak tutar: `client/src/components/payments/PaymentScreen.jsx:397-452`
- Hızlı ödeme operation tipleri ve tam ödenmiş kapatma: `client/src/components/payments/QuickPaymentModal.jsx:7-12`, `QuickPaymentModal.jsx:40-57`

Güçlü yönler:

- Ayrıntılı ödeme ekranı kısmi ödeme ve split ödeme gibi gerçek restoran ihtiyaçlarını destekliyor.
- Tam ödenmiş hesapta yeni ödeme almak yerine `Yazdır` ve `Masayı Kapat` gösterilmesi doğru.
- Hızlı ödeme modalı tam bakiye odemesi için sade; iki ödeme tipi büyük hedeflerle sunuluyor.
- Hızlı ödeme artık hesap ödenmişse kapatma aksiyonuna dönüşüyor; bu iş akışı iyi toparlıyor.

Kullanılabilirlik kusurları:

- `Kaydet`, `Öde ve Kapat`, `Öde ve Yazdır`, `Öde, Yazdır ve Kapat` aynı seçim grubunda. "Kaydet" ödeme bağlamında tahsilatı kaydetmek demek, sipariş ekranındaki "Kaydet" ile anlam çakışması yaratabilir.
- `Öde ve Yazdır` ile `Öde, Yazdır ve Kapat` ayrımı hala bilişsel yük yaratıyor. Kullanıcı fis basınca masanın kapanıp kapanmadığını hızlı anlayamayabilir.
- Ayrıntılı ödeme modalı çok büyük ve yoğun. Sol tarafta kalemler, sağda toplam/aksiyon/tip/tutar var; kasiyer için güçlü ama garson için ağır.
- "Tümünü Al" ile "Kalanı Al" kısmi ödeme senaryosunda birbirine yakın ve her zaman anlamlı değil.

Görsel kalite kusurları:

- Ödeme ekranında kart içinde kart hissi var: özet kutuları, kalan kutusu, aksiyon kutusu, ödeme tipi kutusu, tutar kutusu.
- Aksiyon buttonlarının tone sistemi teknik olarak var ama ürün dili daha güçlü değil: final kapatma aksiyonu en baskın işlem olmalı.

Profesyonel ürün hissini bozan noktalar:

- Ödeme aksiyonları çok teknik kombinasyonlar gibi görünüyor. Profesyonel POS'ta "Tahsil Et", "Tahsil Et ve Masayı Kapat", "Hesap Yazdır" gibi iş dili daha net olmalı.
- Hızlı ödeme ve ayrıntılı ödeme aynı kavramları farklı layout içinde sunuyor. Kullanıcı öğrenme maliyeti artıyor.

### 2.5 Modal yapıları

Kanıt:

- Global modal sistemi: `client/src/styles/global.css:686-720`
- Masa action sheet modalı: `client/src/components/tables/TablesScreen.jsx:1089-1167`
- Sipariş müşteri modalı: `client/src/components/orders/OrderScreen.jsx:1297-1415`
- Hızlı ödeme modalı: `client/src/components/payments/QuickPaymentModal.jsx:90-240`

Güçlü yönler:

- Modal altyapısı tutarlı sınıflar kullanıyor: `.modal`, `.modal-header`, `.modal-body`, `.modal-footer`.
- ESC ve dış tıklama bazı menü/modal durumlarında düşünülmüş.
- Action sheet yaklaşımı dokunmatik POS için doğru yönde.

Kullanılabilirlik kusurları:

- Her modal aynı davranış tipinde değil. Bazıları hızlı aksiyon sheet, bazıları form, bazıları detay ekranı gibi.
- Yıkıcı işlemler için bazı yerlerde özel confirm modalı var, bazı yerlerde `window.confirm` var. Bu tutarsız.
- Modal kapatma ikonları genellikle 36px civarı; yoğun dokunmatik kullanım için 44px hedef daha güvenli.

Görsel kalite kusurları:

- `.modal` radius 16px (`global.css:686`) operasyonel POS için biraz fazla yumuşak. Modern olabilir, ama cihaz üstü kasa uygulamasında daha keskin ve stabil görünüm tercih edilebilir.
- Büyük modallar web uygulaması hissi veriyor; kiosk/POS ekranında tam ekran panel veya bottom sheet ayrımı daha profesyonel olur.

### 2.6 Ayarlar ekranı

Kanıt:

- Ayarlar ana ekranı kartları: `client/src/components/settings/SettingsHome.jsx`
- Ayarlar layout sadece `Outlet`: `client/src/components/settings/SettingsLayout.jsx`
- Yazıcı detay ekranı teknik form ve preview: `client/src/components/settings/PrinterDetailPage.jsx:1-180`
- Ayar ekranı dosya boyutları: `PrinterDetailPage.jsx` 44 KB, `MenuSettingsPage.jsx` 35 KB, `MenuProductEditorPage.jsx` 21 KB.

Güçlü yönler:

- Ayarlar ana ekranı kategorileri kartlarla ayırıyor, kullanıcı yön bulabiliyor.
- Yazıcı önizleme paneli var; bu çok değerli, çünkü yazıcı ayarı görsel geri bildirim ister.
- Menü tanımları, salon bölgeleri, yazıcı yönlendirme gibi domainler ayrı route'lara bölünmüş.

Kullanılabilirlik kusurları:

- `SettingsLayout` yalnız `Outlet` döndürüyor. Ayarlar alt ekranlarında ortak bağlam, breadcrumb, ayarlar navigasyonu veya güvenli çıkış modeli yok.
- Yazıcı ayarları çok teknik seçenekleri aynı formda topluyor: `escT`, `skipInit`, `skipPhoenixCmd`, `encodingMode`, `lineWidth`. Bu alanlar sahadaki işletmeci için anlaşılır değil.
- Ayarlar ana ekranındaki açıklama metinleri bazı yerde geliştirici dili içeriyor: "simülasyonu (test)", "Ayarlar > Yazıcılar".

Görsel kalite kusurları:

- Ayarlar ana ekranı temel kart grid'i iyi ama operasyon ekranlarından kopuk, daha standart admin panel hissinde.
- Yazıcı preview kağıdı iyi fikir ama çevresindeki teknik form yoğunluğu profesyonel kurulum sihirbazı hissi vermiyor.

Profesyonel ürün hissini bozan noktalar:

- Kritik teknik ayarlar "gelişmiş" katmanına ayrılmamış.
- Yazıcı/encoding gibi hata riski yüksek alanlarda adım adım kurulum, test fişi ve son doğrulama akışı yok.

## 3. Kritik kullanılabilirlik sorunları

### P1 - Kritik masa aksiyonları gizli ve aynı ağırlıkta

- Kanıt: Masa işlemleri `...` menüsü ve action sheet ile açılıyor (`TablesScreen.jsx:706`, `TablesScreen.jsx:1089-1167`).
- Etki: Garson veya kasiyer yoğun anda `Öde`, `Hızlı Öde`, `Masayı Kapat` gibi işlemleri hızlı bulamayabilir.
- Kök neden: Kart birincil tıklaması sipariş açma, işlem menüsü ikincil küçük ikon. Action sheet içinde tüm aksiyonlar benzer grid tile.
- Öneri: Dolu masada kart üzerinde 1 adet bağlamsal ana aksiyon göster: borç varsa `Öde`, tam ödendiyse `Masayı Kapat`, hazır varsa `Siparişi Aç`.

### P1 - Ödeme dili ve yazdırma/kapatma kombinasyonları fazla bilişsel yük yaratıyor

- Kanıt: `paymentActions` dört kombinasyon içeriyor (`PaymentScreen.jsx:13-18`).
- Etki: Kullanıcı fis bastığında masanın kapanıp kapanmadığını karıştırabilir.
- Kök neden: Teknik boolean kombinasyonları UI aksiyonu olarak sunulmuş: `closeOrder`, `printReceipt`.
- Öneri: İş diliyle yeniden düzenle: `Tahsil Et`, `Tahsil Et ve Masayı Kapat`, `Hesap Yazdır`, `Final Fiş ve Kapat`.

### P1 - Paket sipariş yan paneli ödeme ve teslimat kararlarını sıkışık gösteriyor

- Kanıt: Paket kartı toplam, süre, durum, ödeme etiketi, menü ve iki teslimat butonunu tek kartta topluyor (`TablesScreen.jsx:784-1056`).
- Etki: Paket operasyonu arttığında kartlar hem bilgi hem aksiyon yoğunluğu nedeniyle yavaşlar.
- Kök neden: Paket sipariş ana ekran yerine masa ekranı yan paneline gömülü.
- Öneri: V1'de yan panel korunabilir ama kart hiyerarşisi sadeleşmeli: müşteri, tutar, ödeme durumu, tek sonraki aksiyon. V2'de ayrı paket operasyon ekranı.

### P2 - Dokunmatik hedefler bazı kritik mikro aksiyonlarda sınırda

- Kanıt: Global `.btn-icon` min-width 36 ve min-height auto (`global.css:617`); ürün grid +/- butonları inline 4px padding ile çalışıyor; satır silme ikonları 4px paddingli.
- Etki: Yanlış azaltma/silme/menü açma riski.
- Kök neden: Desktop mouse ergonomisi ile dokunmatik POS ergonomisi aynı tasarım sisteminde karışmış.
- Öneri: Operasyon ekranları için minimum 44x44 px hit target policy.

### P2 - Ayarlar ekranı teknik kullanıcıya göre tasarlanmış, işletmeciye göre değil

- Kanıt: Yazıcı detay ekranı çok sayıda teknik state ve seçenek taşıyor (`PrinterDetailPage.jsx:1-180`).
- Etki: Yanlış yazıcı/encoding ayarı canlı işletmede fiş bozulması veya yazdırmama riski yaratır.
- Kök neden: Kurulum sihirbazı yerine teknik form yaklaşımı.
- Öneri: Basit/gelişmiş ayrımı, profil seçimi, test fişi, son doğrulama.

## 4. Görsel kalite ve profesyonellik sorunları

### P1 - Tasarım sistemi var ama uygulama yüzeyi inline stillerle parçalanıyor

- Kanıt: Operasyon ekranlarında büyük miktarda inline style kullanımı var: masa kartı, paket kartı, sipariş grid'i, adisyon paneli, ödeme kartları.
- Etki: Aynı tip UI parçaları küçük farklarla çoğalır; profesyonel sistem hissi azalır.
- Kök neden: Component tokenları ve varyant sınıfları yeterli kullanılmıyor.
- Öneri: `pos-action-tile`, `pos-status-chip`, `pos-order-line`, `pos-summary-panel`, `pos-touch-icon-button` gibi sınıflar/komponentler çıkar.

### P1 - Renk dili operasyonel anlamdan çok tema hissi taşıyor

- Kanıt: Accent koyu temada `#6366f1`, light temada `#6C63FF` (`global.css:25`, `global.css:126`); gradient ve mor/purple vurgular mevcut.
- Etki: Restoran POS gibi hızlı ve hata önleyici üründe mor/purple dashboard estetiği, durum renklerinin operasyonel netliğini azaltabilir.
- Kök neden: Genel SaaS/dashboard paleti POS domainine uyarlanmış.
- Öneri: Accent'i daha nötr/kurumsal bir renge çek, durum renklerini sadece operasyon anlamı için kullan: yeşil odendi/hazır, sarı aktif/uyarı, kırmızı risk/iptal, mavi transfer/bilgi.

### P2 - Border radius ve gölge dili fazla yumuşak

- Kanıt: `--radius-md: 12px`, `--radius-lg: 16px`, `--radius-xl: 20px` (`global.css:90-94`); `.modal` radius `var(--radius-lg)` (`global.css:686`).
- Etki: Bazı ekranlarda modern ama oyuncak/web dashboard hissi oluşuyor.
- Kök neden: Tüm ürün aynı yumuşak kart diline yaslanıyor.
- Öneri: Operasyon ekranlarında radius 8px standardına yaklaş; ayarlar/rapor gibi düşük frekanslı ekranlarda daha yumuşak dil kalabilir.

### P2 - Kart içinde kart ve kutu yoğunluğu

- Kanıt: Ödeme ekranında özet kutuları, kalan kutusu, aksiyon kutusu, ödeme tipi kutusu, tutar kutusu aynı modal içinde.
- Etki: İlk bakışta "şimdi ne yapmalıyım?" sorusu yavaş cevaplanır.
- Kök neden: Her bilgi grubu ayrı kartlaştırılmış.
- Öneri: Ödeme ekranında tek güçlü toplam paneli ve tek ana aksiyon alanı bırak; yardımcı seçenekleri ikincil yap.

## 5. UI davranış matrisi

| Durum | Görünmesi gereken ana aksiyon | Gizli/disabled olması gerekenler | Mevcut durum | UX kararı |
|---|---|---|---|---|
| Boş masa | Masayı aç / sipariş başlat | Öde, hızlı öde, yazdır, kapat, taşı | Kart tıklaması sipariş açıyor | Uygun, ama kartta ana aksiyon etiketi eklenmeli |
| Rezerve masa | Rezervasyonu kullanarak sipariş aç | Onaysız açma, hedef transfer | Onay eklendi, transfer engeli var | Uygun, native modal ile iyileştirilmeli |
| Dolu masa, borç var | Öde veya siparişi aç | Masayı kapat | Ödeme menü içinde, kapat gizli | Ana aksiyon daha görünür olmalı |
| Dolu masa, hesap ödendi | Masayı kapat | Yeni ödeme alma | `HESAP ÖDENDİ`, kapatma menüde | Kart üzerinde direkt kapat önerilir |
| Dolu masa, hazır ürün var | Siparişi aç / servis aksiyonu | Kapat, ilgisiz aksiyonlar | `HAZIR` rozeti var | İyi, ama hazır ve ödendi önceliği netleşmeli |
| Transfer modu | Hedef boş masayı seç | Rezerve/dolu hedef, kaynak tekrar seçimi dışında tüm işlemler | Banner var, hedef olmayanlar tıklanabilir ama reddediliyor | Dolu/rezerve hedefler görsel disabled olmalı |
| Yeni sipariş, sepet boş | Ürün ekle | Kaydet, ödeme, hızlı ödeme | Boş sepet mesajı | Uygun |
| Yeni sipariş, sepet dolu | Kaydet ve Mutfağa Gönder | Ödeme, hızlı ödeme | Tek ana buton var | Uygun |
| Kayıtlı sipariş, yeni ürün eklendi | Kaydet ve Mutfağa Gönder | Ödeme, hızlı ödeme | Tek ana buton var | Uygun |
| Kayıtlı sipariş, sepet boş | Ödeme / Hızlı Öde | Kaydet | İki aksiyon var | Uygun, ana öneri durum bazlı seçilmeli |
| Kayıtlı sipariş, tamamen ödendi | Masayı kapat / yazdır | Yeni ödeme alma | Ödeme ekranında doğru, masada menü içinde | Masada daha görünür olmalı |
| Paket sipariş, müşteri yok | Müşteri seç | Kaydet/gönder | Uyarı ve modal var | Uygun |
| Paket sipariş, hazırlanıyor, ödenmedi | Ödeme al veya teslimata çıkarma kuralına göre sıradaki aksiyon | Teslim edildi | Ödeme etiketi var, teslim disabled | Disabled sebebi touch cihazda görünür olmalı |
| Paket sipariş, teslimatta, ödendi | Teslim edildi | Tekrar teslimata çıkar | Doğru | Uygun |
| Paket sipariş, teslimatta, ödenmedi | Ödeme al | Teslim edildi | Teslim disabled | Kartta "Ödeme alınmadan teslim edilemez" görünür olmalı |
| Hızlı ödeme, borç var | Nakit/Kart ile tahsil et | Kısmi tutar | Büyük butonlar var | Uygun |
| Hızlı ödeme, borç yok | Masayı kapat | Ödeme tipi seçimi | Artık kapatma gösteriyor | Uygun |
| Ayrıntılı ödeme, borç var | Seçilen ödeme aksiyonunu tamamla | Kapatma için kısmi ödeme | Kontrol var | Uygun, dil sadeleşmeli |
| Ayrıntılı ödeme, borç yok | Yazdır / Masayı Kapat | Yeni ödeme alma | Doğru | Uygun |

## 6. Amatör görünen UI alanları

1. Browser confirm kullanımı.
   - Rezerve masa açma ve transfer gibi kritik işlemlerde native confirm, ürünün kendi güvenilirlik hissini kırar.

2. Teknik aksiyon kombinasyonlarının doğrudan butona dönüşmesi.
   - `Öde ve Yazdır`, `Öde, Yazdır ve Kapat` gibi metinler backend boolean kombinasyonları gibi duruyor.

3. Inline style yoğunluğu.
   - Profesyonel UI sistemi olan ürünlerde operasyon ekranları tasarım tokenları ve component varyantları üzerinden yönetilir.

4. Mikro ikon butonlarının kritik işlemler taşıması.
   - Üç nokta menüsü, çöp ikonları, küçük +/- kontrolleri dokunmatik hata riskini artırır.

5. Ayarlar ekranında teknik ham seçeneklerin işletmeciye açılması.
   - `escT`, `skipPhoenixCmd`, encoding gibi alanlar gelişmiş profil arkasına alınmalı.

6. Aynı aksiyonun farklı ekranlarda farklı sunulması.
   - Masa ekranında ödeme action sheet içinde; sipariş ekranında sağ panel altında; ödeme ekranında modal içinde; hızlı ödeme ayrı modalda.

7. Paket siparişin masa ekranına yan panel olarak sıkışması.
   - V1 için pratik, ancak profesyonel paket operasyonu için ayrı queue daha doğru.

## 7. Hemen düzeltilmesi gerekenler

### P1 - Masa kartında durum bazlı ana aksiyon görünür olmalı

- Dolu ve borçlu masa: `Öde` veya `Siparişi Aç`.
- Dolu ve ödenmiş masa: `Masayı Kapat`.
- Hazır ürünlü masa: `Siparişi Aç` / `Servis` aksiyonu.
- Amaç: Kritik işi üç nokta menüsünden çıkarmak.

### P1 - Ödeme aksiyon dili sadeleştirilmeli

- `Kaydet` ödeme bağlamında `Tahsilatı Kaydet` olmalı.
- `Öde ve Yazdır` yerine fis türü netleşmeli.
- Kapatma içeren aksiyonlarda "Masayı Kapat" ifadesi açık olmalı.

### P1 - Disabled aksiyonların nedeni dokunmatik cihazda görünür olmalı

- Paket siparişte `Teslim Edildi` disabled ise sebep kart üzerinde görünmeli.
- Tooltip/title yeterli değil.

### P2 - Touch target standardı sertleştirilmeli

- Operasyon ekranlarında tüm kritik hedefler minimum 44x44 px olmalı.
- Satır silme, +/- ve üç nokta butonları bu standarda çekilmeli.

### P2 - Ayarlar yazıcı ekranı basit/gelişmiş olarak ayrılmalı

- İşletmeci için: yazıcı adı, tür, bağlantı, test fişi, varsayılan yap.
- Gelişmiş için: encoding, ESC t, Phoenix komutu, line width.

## 8. Sonraki turda uygulanabilecek düşük riskli iyileştirmeler

1. Masa action sheet'te aksiyon önceliği düzenle.
   - `Öde` ve `Masayı Kapat` en üstte ve daha geniş; `İptal` ayrı danger bölgesinde.

2. Masa kartına bağlamsal küçük CTA ekle.
   - Borçlu: `Öde`.
   - Ödenmiş: `Kapat`.
   - Boş: `Sipariş aç`.

3. Paket kartında disabled sebep satırı göster.
   - "Teslim için ödeme tamamlanmalı" gibi kalıcı metin.

4. Global `btn-icon` ve operasyon ikon butonlarını 44px hedefe çek.
   - Özellikle masa menüsü, satır silme, ürün +/-.

5. Ödeme aksiyon metinlerini iş diline çevir.
   - Davranış değiştirmeden sadece copy ve hiyerarşi düzeni.

6. `window.confirm` yerine mevcut modal sistemiyle confirm bileşeni kullan.
   - Rezerve masa ve masa transfer onayları için.

7. Sipariş panelinde `Mevcut Ürünler` ve `Yeni Eklenen` ayrımını güçlendir.
   - Yeni ürün bölümünde "Mutfağa gönderilmedi" çipi.

8. Ayarlar ana ekranında operasyonel olmayan teknik ifadeleri temizle.
   - "simülasyonu (test)" ve "Ayarlar > Yazıcılar" gibi iç/dokümantasyon dili kaldırılmalı.

9. Yazıcı ayarında "Gelişmiş ayarlar" katmanı aç/kapa yapılmalı.
   - Varsayılan görünüm kurulum sihirbazı gibi sade olmalı.

10. UI sistem borcu için küçük component listesi çıkar.
    - `StatusChip`, `ActionTile`, `TouchIconButton`, `OrderLine`, `SummaryPanel`, `ConfirmDialog`.

Bu iyileştirmeler düşük risklidir; çoğu davranış değiştirmeden copy, hiyerarşi, görünürlük ve dokunmatik hedef standardı iyileştirmesi olarak uygulanabilir.
