# 01 - Product & Business Rules Audit

Tarih: 2026-04-14  
Kapsam: masa, siparis, odeme, hizli odeme, masa kapatma/tasima, paket siparis, yazici/mutfak ve Caller ID is akislari.  
Kaynak baglam: `docs/audit/00-overall-audit.md`, `docs/audit/00a-prioritized-action-plan.md`, `docs/audit/00b-first-hardening-pass.md`.

Bu rapor kod degisikligi yapmadan, repo icindeki mevcut davranisi urun/operasyon kurallari acisindan cikarmak icin hazirlanmistir.

## 1. Urun akisi ozeti

Uygulama restoran POS icin iki ana siparis tipini destekliyor:

- `dine_in`: masa uzerinden acilan salon siparisi.
- `takeaway`: paket siparis / al-gotur akisi.

Ana urun modeli su sekilde calisiyor:

1. Kullanici masa ekranindan bos/dolu/rezerve masaya tiklar.
2. Siparis ekraninda urunler once lokal sepete eklenir.
3. `Kaydet` ile siparis olusturulur veya kayitli siparise yeni kalemler eklenir.
4. Backend, kaydedilen yeni kalemleri otomatik mutfaga gonderir.
5. Kaydedilmemis urun varken odeme aksiyonlari frontend tarafinda gizlenir.
6. Odeme ayrintili odeme ekrani veya hizli odeme modalindan alinir.
7. Masa kapatma sadece odenmis hesap icin masalar ekraninda veya odeme ekraninda mumkundur.
8. Masa tasima hem masalar ekranindan hem siparis ekranindan yapilabilir; her iki durumda da hedef siparise yonlendirme yerine masalar ekranina donulur.
9. Paket sipariste musteri secimi zorunludur; teslimat durumu masalar ekranindaki paket siparis yan panelinden yonetilir.
10. Caller ID gelen aramayi paket siparis acisina baglar; siparis kaydedildiginde call log ile order iliskilendirilir.

Kritik urun gercegi: Frontend "Kaydet" islemini siparisin olusturulmasi/urun eklenmesi gibi sunuyor; backend ise kaydedilen her yeni kalemi hemen mutfaga gonderip siparis durumunu `in_kitchen` yapabiliyor. Bu, POS dilinde "kaydet" ile "mutfaga gonder" davranisinin ayni islemde birlesmesi anlamina geliyor.

## 2. Kritik kullanici akislari

### 2.1 Masa acma

Mevcut davranis:

1. Kullanici `TablesScreen` uzerinde herhangi bir masaya tiklar.
2. Transfer modu aktif degilse `onOpenOrder(table)` calisir.
3. `App.jsx` bu masayi `/order/table/:id` rotasina `table`, `existingOrderId`, `orderType: dine_in` state'i ile tasir.
4. Masa bos ise `existingOrderId` yoktur; siparis ekrani yeni sepet ile acilir.
5. Masa dolu ise `existingOrderId` vardir; mevcut siparis yuklenir.

Kanıt:

- `client/src/components/tables/TablesScreen.jsx`: masa tiklama ve transfer modu ayrimi.
- `client/src/App.jsx`: `handleOpenOrder` ile masa siparis ekranina yonlendirme.
- `client/src/components/orders/OrderScreen.jsx`: `existingOrderId || table?.current_order_id` ile mevcut siparis yukleme.

Urun yorumu:

- Bos masa acma davranisi dogru.
- Rezerve masa icin ayri bir onay/kural yok; rezerve masa da siparis ekranina normal giriyor. Bu urun kuralı belirsiz.

### 2.2 Siparis olusturma

Mevcut davranis:

1. Kullanici urun secerek lokal sepete ekler.
2. Ayni urun/portion/modifier/not kombinasyonu tekrar eklenirse sepette miktar artar.
3. Kaydet butonu sadece sepette urun varken anlamlidir.
4. Yeni masa siparisinde `api.createOrder` cagrilir.
5. Backend siparisi `saved` status ile olusturur, masayi `occupied` yapar.
6. Backend hemen yeni kalemleri mutfak icin finalize eder, kalemleri `sent`, siparisi `in_kitchen` yapar.
7. Frontend basarili kayit sonrasi varsayilan olarak masalar ekranina doner.

Kanıt:

- `client/src/components/orders/OrderScreen.jsx`: `cartItems`, `quickAddFromGrid`, `handleSaveOrder`.
- `server/routes/orders.js`: `POST /orders`, masa durumunu guncelleme ve `finalizeKitchenForNewItems`.
- `server/services/printJobs.js`: mutfak yazdirma islerinin olusturulmasi.

Urun yorumu:

- "Kaydet" aksiyonu kullaniciya sadece siparisi kaydediyor gibi gorunur, fakat fiilen mutfaga gonderir.
- Profesyonel POS'ta bu ya bilincli olarak "Mutfaga Gonder" diye adlandirilmali ya da "Kaydet" ve "Gonder" ayrilmalidir.

### 2.3 Urun ekleme

Mevcut davranis:

1. Urun gridinden urun secilir.
2. Urun aktif degilse veya fiyat/portion bulunamazsa hata verilir.
3. Urun lokal sepete eklenir.
4. Mevcut siparise eklenen yeni urunler de once lokal sepette tutulur.
5. Kaydedilene kadar mevcut siparisin backend toplamlarina dahil degildir.

Kanıt:

- `client/src/components/orders/OrderScreen.jsx`: `quickAddFromGrid`, `addItemToCart`, `cartSubtotal`, `savedTotal`, `displayTotal`.

Urun yorumu:

- Kayitli siparise yeni urun ekleme davranisi guvenli: odeme aksiyonlari kaydedilmemis urun varken gizleniyor.
- Ancak "ekrandaki toplam" ile "backendde odenebilir toplam" ayrimi kullaniciya yeterince net anlatilmiyor.

### 2.4 Siparisi kaydetme

Mevcut davranis:

1. Sepet bos ise kaydetme reddedilir.
2. Paket siparis ise musteri secimi zorunludur.
3. Yeni siparis icin `api.createOrder`, kayitli siparis icin `api.addOrderItems` cagrilir.
4. Basarili kayit sonrasi lokal sepet temizlenir.
5. Dine-in ve takeaway icin varsayilan yonlendirme masalar ekraninadir.

Kanıt:

- `client/src/components/orders/OrderScreen.jsx`: `handleSaveOrder`.
- `server/routes/orders.js`: `POST /orders`, `POST /orders/:id/items`.

Urun yorumu:

- Masa siparisi kaydedildikten sonra masalar ekranina donmek salon operasyonu icin kabul edilebilir.
- Paket sipariste kayit sonrasi masalar ekranina donmek urun acisindan tartismali; paket akisinin kendi listesine/aktif paket siparise odaklanmasi daha profesyoneldir.

### 2.5 Kaydedilmis siparise yeni urun ekleme

Mevcut davranis:

1. Kayitli siparis acilir.
2. Yeni urunler mevcut siparis kalemlerinden ayri olarak lokal sepete eklenir.
3. Kaydedilmemis degisiklik varken odeme ve hizli odeme aksiyonlari gizlenir.
4. Kaydet ile backend `addOrderItems` calisir.
5. Backend yeni kalemleri hemen mutfaga gonderir.

Kanıt:

- `client/src/components/orders/OrderScreen.jsx`: `hasUnsavedChanges`, `canOpenPayment`, bottom actions.
- `server/routes/orders.js`: `POST /orders/:id/items`, `finalizeKitchenForNewItems`.

Urun yorumu:

- Bu akista "once kaydet, sonra odeme" kuralı dogru ve risk azaltici.
- Fakat kullanici yeni urunleri ekledikten sonra "Kaydet" yaptiginda bunun mutfaga fis olarak gittigi daha acik olmalidir.

### 2.6 Odeme alma

Mevcut davranis:

1. Odeme ekrani yalnizca kayitli, kapanmamis ve aktif kalemi olan siparis icin acilir.
2. Kismi odeme desteklenir.
3. "Odeme al", "Ode ve kapat", "Ode ve yazdir", "Ode, yazdir ve kapat" aksiyonlari vardir.
4. Kapatma seciliyse kalan tutarin tamami odenmeden islem engellenir.
5. Tamamen odenmis sipariste odeme inputu yerine "Yazdir" ve "Masayi Kapat" aksiyonlari gosterilir.
6. Backend odemeyi kaydeder, `close_order` true ise tam odendi mi kontrol eder; tam degilse transaction rollback olur.

Kanıt:

- `client/src/components/payments/PaymentScreen.jsx`: aksiyon tipleri, tam odeme kontrolu, kapatma/yazdirma davranisi.
- `server/routes/payments.js`: `POST /payments`, `closeOrderAndTableIfPaid`.

Urun yorumu:

- Kismi odeme + kapatma engeli dogru.
- "Ode ve Yazdir" aksiyonu kapatmadan fis basabilir. Bu bilincli olabilir, ancak POS terminolojisinde "ara hesap/fis" ile "final fis" ayrimi yok.
- Tamamen odenmis sipariste tekrar hizli odeme modalindan kapatma mumkun degil; kapatma icin masalar ekranindaki "Masayi Kapat" veya ayrintili odeme ekranindaki kapatma aksiyonu kullaniliyor.

### 2.7 Hizli odeme

Mevcut davranis:

1. Hizli odeme kalan tutarin tamamini odetir.
2. Sadece nakit/kart secimi vardir.
3. Kismi tutar girilemez.
4. "Odeme al", "Ode ve kapat", "Ode ve yazdir", "Ode, yazdir ve kapat" aksiyonlari vardir.
5. Kalan tutar sifirsa modal aksiyonlari disabled olur; mevcut odenmis masayi bu modal ile kapatmak mumkun degildir.

Kanıt:

- `client/src/components/payments/QuickPaymentModal.jsx`: `totalDue` uzerinden tam odeme, action type'lar, disabled butonlar.

Urun yorumu:

- Hizli odemenin tam bakiye odemesi almasi dogru bir POS kısayolu.
- Ancak "hesap zaten odenmis ama masa kapanmamis" durumunda hizli odeme modalinin kapatma sunmamasi operasyonel belirsizlik yaratir.

### 2.8 Masayi kapatma

Mevcut davranis:

1. Masa karti odenmis siparisi `HESAP ODENDI` olarak gosterir.
2. Masalar ekraninda "Masayi Kapat" aksiyonu yalnizca paid hesapta gorunur.
3. Kapatma `api.updateOrderStatus(orderId, 'closed')` ile yapilir.
4. Backend siparisi kapatir, masayi bosaltir, musteri istatistiklerini gunceller, dine-in icin receipt job ekleyebilir.
5. Odeme ekraninda da tam odenmis siparis icin "Masayi Kapat" vardir.

Kanıt:

- `client/src/components/tables/TablesScreen.jsx`: `isTableBillPaid`, masa aksiyon modali, `handleClosePaidTable`.
- `client/src/components/payments/PaymentScreen.jsx`: `closePaidOrder`.
- `server/routes/orders.js`: `PATCH /orders/:id/status` `closed` branch.

Urun yorumu:

- Odenmis masa ile kapali masa arasinda ara durum vardir. Bu dogru bir isletme kuralidir: hesap odendi, masa fiziksel olarak henuz bosalmamis olabilir.
- Ancak bu ara durumun adi ve aksiyon sahipligi net degil. Kullanici bazen odeme ekranindan, bazen masa ekranindan kapatir.

### 2.9 Masa tasima

Mevcut davranis:

1. Masalar ekraninda dolu kaynak masa icin "Masayi Tasi" baslatilir.
2. Hedef masa secilir.
3. Backend hedef masa `occupied` ise reddeder; rezerve masa icin acik engel yoktur.
4. Source order hedef table_id'ye tasinir.
5. Source masa bosaltilir, hedef masa kaynak masa status/current_order_id/guest_count degerlerini alir.
6. Frontend reload yapar ve masalar ekraninda kalir.
7. Siparis ekranindan tasima da mumkundur; basarili tasima sonrasi masalar ekranina doner.

Kanıt:

- `client/src/components/tables/TablesScreen.jsx`: transfer mode, `handleTableTransfer`.
- `client/src/components/orders/OrderScreen.jsx`: `openMoveDialog`, `handleMoveTable`.
- `server/routes/tables.js`: `POST /tables/:id/transfer`.

Urun yorumu:

- Hedef rezerve masaya tasima belirsiz ve risklidir.
- Tasima sonrasi hedef masanin siparisine otomatik gecilmemesi operasyon acisindan ekstra adim yaratir.

### 2.10 Paket siparis akisi

Mevcut davranis:

1. Paket siparis `/order/takeaway` rotasindan acilir.
2. Caller ID veya paket yan panelinden mevcut paket siparise gecilebilir.
3. Yeni paket sipariste musteri secimi zorunludur.
4. Siparis kaydedilince takeaway label print job eklenir.
5. Acik paket siparisler masalar ekraninda yan panelde listelenir.
6. Paket siparis durumlari yan panelden `out_for_delivery` ve `delivered` olarak ilerletilir.
7. `delivered` aksiyonu backendde siparisi `closed` yapar.

Kanıt:

- `client/src/App.jsx`: `handleNewTakeawayOrder`.
- `client/src/components/orders/OrderScreen.jsx`: takeaway customer zorunlulugu.
- `client/src/components/tables/TablesScreen.jsx`: open takeaway sidebar ve delivery action buttonlari.
- `server/routes/orders.js`: takeaway open list, label print, delivery status update.

Urun yorumu:

- Paket sipariste musteri zorunlulugu dogru.
- Teslim edildi aksiyonunun direkt `closed` yapmasi urun olarak kabul edilebilir; fakat odeme alinmadan teslim edildi yapilabiliyorsa bu buyuk is kuralı riskidir. Kodda delivery status update icin odeme kontrolu gorunmuyor.

### 2.11 Yazici / mutfak akisi

Mevcut davranis:

1. Yeni siparis veya yeni eklenen kalemler kaydedildiginde mutfak print job olusur.
2. Mutfak print job item bazli printer routing yapar.
3. Iptal veya miktar azaltma gibi degisiklikler icin mutfak adjustment job olusabilir.
4. Masa kapatma veya print receipt aksiyonu receipt job olusturur.
5. Paket siparis olusunca label job olusur.
6. Print job idempotency key ile duplicate basim engellenmeye calisilir.

Kanıt:

- `server/routes/orders.js`: `finalizeKitchenForNewItems`, item update/cancel.
- `server/routes/payments.js`: odeme sonrasi receipt job.
- `server/services/printJobs.js`: kitchen, adjustment, receipt, takeaway label enqueue akislari.

Urun yorumu:

- Mutfak ve siparis yasam dongusu birbirine sikica bagli.
- "Kaydet" = "mutfaga gonder" oldugu icin UI metinleri ve operasyon egitimi bu gercege uygun olmali.

### 2.12 Caller ID akisi

Mevcut davranis:

1. Backend gelen aramayi `call_logs` icine `ringing` olarak yazar.
2. Frontend admin/cashier icin her 4 saniyede yeni ringing call log poll eder.
3. Popup'ta musteri ve gecmis siparis bilgileri gosterilir.
4. "Siparisi Ac" kullaniciyi paket siparis ekranina goturur.
5. Siparis kaydedilirse `call_log_id` order ile iliskilendirilir ve call log status `opened_order` olur.
6. Kullanici siparis ekranini kaydetmeden terk ederse server tarafinda call log `ringing` kalabilir; frontend sadece session bazli suppress yapar.

Kanıt:

- `server/services/callerIdService.js`: `processIncomingCall`, `linkCallLogToOrder`.
- `server/routes/callerid.js`: recent/history/status endpointleri.
- `client/src/context/IncomingCallContext.jsx`: popup polling, dismiss, open order navigation.
- `server/routes/orders.js`: order create sonrasi call log link.

Urun yorumu:

- Caller ID'nin paket siparise baglanmasi dogru.
- "Siparisi Ac" tiklaninca call log durumunun hemen `opened_order` veya `in_progress` yapilmamasi amatör bir bosluk; kaydedilmeden terk edilen aramalar operasyon ekraninda tekrar belirebilir veya yanlis durumla kalabilir.

## 3. Mevcut is kuralı matrisi

| Durum | Kullanici ne goruyor | Ana aktif aksiyon | Gizli/engelli olmasi gerekenler | Mevcut risk |
|---|---|---|---|---|
| Bos masa | Bos masa karti | Masaya tiklayip siparis acma | Odeme, hizli odeme, yazdir, kapat | Uygun |
| Rezerve masa | Rezerve masa karti | Masaya tiklayip siparis acma | Normal siparis acma onaysiz olmamali | Rezerve kuralı belirsiz |
| Dolu masa, kaydedilmis siparis | Masa dolu, toplam/tutar bilgisi | Siparisi ac, ode, hizli ode, yazdir, tasi, iptal | Masa kapat sadece tam odenmisse gorunmeli | Genel olarak uygun |
| Dolu masa, hesap odenmemis | Dolu masa | Odeme / hizli odeme | Masayi kapat | Uygun |
| Dolu masa, hesap tam odenmis ama kapanmamis | `HESAP ODENDI` rozeti | Masayi kapat, yazdir | Yeni odeme alma | Ara durum dogru ama sahiplik belirsiz |
| Yeni siparis, sepette urun var | Sepet ve Kaydet | Kaydet | Odeme, hizli odeme | Uygun |
| Yeni siparis, sepet bos | Bos sepet | Urun ekleme | Kaydet, odeme, hizli odeme | Uygun |
| Kayitli siparis, yeni urun eklenmis | Kayitli kalemler + lokal sepet | Kaydet | Odeme, hizli odeme | Uygun, ama "mutfaga gider" metni eksik |
| Kayitli siparis, kaydedilmemis degisiklik yok | Kalemler ve toplam | Odeme, hizli odeme, urun ekleme | Kaydet | Uygun |
| Siparis kapali | Kapali siparis | Geri don / goruntuleme | Urun ekleme, odeme, iptal | Frontend/route bazinda daha net kilitlenmeli |
| Siparis iptal | Iptal siparis | Geri don / goruntuleme | Urun ekleme, odeme, kapatma | Backend koruyor, UI netligi denetlenmeli |
| Paket siparis yeni | Musteri secimi + sepet | Musteri sec, urun ekle, kaydet | Musterisiz kaydet | Uygun |
| Paket siparis acik | Yan panelde kart | Siparisi ac, label yazdir, iptal, teslimat durum ilerlet | Odeme alinmadan teslim edildi tartismali | Odeme/teslim kuralı eksik |
| Paket siparis teslimata cikti | Yan panelde durum | Teslim edildi | Tekrar teslimata cikar | Uygun |
| Paket siparis teslim edildi | Listeden dusmeli / kapanir | Kapali kayit | Aktif panel aksiyonlari | Backend kapatiyor |
| Hizli odeme, borc var | Modal, kalan tutar | Tam tutari nakit/kart ode | Kismi odeme | Uygun |
| Hizli odeme, borc yok | Modal aksiyonlari disabled | Kapatma beklenebilir | Odeme alma | Kapatma yok, operasyonel bosluk |
| Masa tasima, kaynak dolu hedef bos | Transfer modu | Hedef sec ve tasi | Dolu hedef | Uygun |
| Masa tasima, hedef rezerve | Transfer mumkun gorunebilir | Tasi | Rezerve hedefe onaysiz tasima | Riskli |
| Caller ID ringing | Popup | Siparisi ac / kapat | Tekrar popup spam | Kaydetmeden terk edilirse server durumu kalir |

## 4. Celiskiler ve belirsizlikler

### 4.1 Kullanici beklentisi ile mevcut davranis farki

P1 - "Kaydet" aksiyonu fiilen mutfaga gonderiyor.

- Etki: Garson sadece siparisi kaydettigini sanabilir; mutfakta fis basilmis olur.
- Kok neden: Backend `createOrder` ve `addOrderItems` sonrasi `finalizeKitchenForNewItems` calistiriyor.
- Oneri: V1'de buton metni "Kaydet ve Mutfaga Gonder" yapilmali veya UI'da net yardim metni verilmeli. Daha ileri surumde "Kaydet" ve "Mutfaga Gonder" ayrilabilir.

P1 - Paket siparis teslim edildi aksiyonu odeme kontrolu olmadan siparisi kapatiyor olabilir.

- Etki: Tahsilatsiz paket siparis kapatilabilir, kasa/acik hesap uyumsuzlugu olusur.
- Kok neden: Delivery status endpointinde payment total kontrolu gorunmuyor.
- Oneri: "Teslim edildi" icin odeme zorunlulugu urun karari olarak netlestirilmeli. Kapida odeme desteklenecekse teslimde odeme modalina zorunlu yonlendirme gerekir.

P2 - "Ode ve Yazdir" ile "Ode, Yazdir ve Kapat" ayrimi UI'da yeterince keskin degil.

- Etki: Kullanici fis bastiginda masanin kapandigini sanabilir.
- Kok neden: Payment action type'lari close/print kombinasyonlari ile calisiyor, fakat receipt tipi/semantigi ayrilmamis.
- Oneri: Ara hesap, tahsilat fisi, final fis ayrimi urun dilinde netlestirilmeli.

### 4.2 Yeni masa / kayitli masa farki

P2 - Bos/rezerve/dolu masa acilis kuralı ayni tik davranisina bagli.

- Etki: Rezerve masa yanlislikla normal siparise donusebilir.
- Kok neden: Table click handler sadece transfer mode kontrolu yapiyor, reservation icin ayri confirm/kural yok.
- Oneri: Rezerve masada "Rezervasyonu kullanarak siparis ac" onayi veya rezervasyon iptali/oturma akisi olmalidir.

P2 - Yeni siparis ve kayitli siparis ayni ekranda dogru ayriliyor; ancak kullaniciya durum etiketi zayif.

- Etki: Garson "bu siparis kayitli mi, sepette bekleyen var mi" ayrimini kacirabilir.
- Kok neden: Lokal sepet ve kayitli siparis birlikte gosteriliyor, metinsel uyari sinirli.
- Oneri: "Kaydedilmemis urunler" ve "Mutfaga gonderilmis urunler" ayrimi daha belirgin yapilmali.

### 4.3 Kaydetmeden once / kaydettikten sonra aksiyonlar

P1 - Kaydedilmemis urun varken odeme gizleniyor; bu dogru. Fakat mevcut kayitli kalemler icin kismi odeme almak istenirse engellenir.

- Etki: Gercek operasyonda misafir bir kismi odeyip masada kalirken garson yeni urun eklemis olabilir; odeme almak icin once yeni urunu mutfaga gondermek zorunda kalir.
- Kok neden: `canOpenPayment` tum unsaved cart varligini global kilit gibi kullaniyor.
- Oneri: V1 icin mevcut kural korunabilir. V2'de "kaydedilmemis urunleri iptal et/kaydetmeden odemeye git" karari sunulabilir.

P2 - Kayit sonrasi otomatik masalar ekranina donus her akista ayni.

- Etki: Paket sipariste veya ek urun girisinde kullanici bekledigi siparis detayinda kalmayabilir.
- Kok neden: `handleSaveOrder` default navigate tables.
- Oneri: Dine-in icin masalar ekranina donmek korunabilir; takeaway icin paket paneline veya siparis detayina odakli davranis tasarlanmalidir.

### 4.4 Hizli odeme mantigi

P2 - Hizli odeme tam bakiye odeme icin iyi; fakat odenmis masayi kapatamaz.

- Etki: "Hizli Ode" acildiginda borc yoksa kullanici masayi kapatmak icin geri donmek zorunda kalir.
- Kok neden: Modal butonlari `totalDue <= 0.02` iken disabled.
- Oneri: Borc yoksa modal "Bu hesap odenmis, masayi kapat" aksiyonuna donusmelidir veya hizli odeme butonu yerine direkt kapatma gosterilmelidir.

P2 - Hizli odeme sadece nakit/kart destekliyor.

- Etki: Yemek karti, havale, online odeme gibi operasyonlar kayit altina alinamaz.
- Kok neden: Payment schema ve UI payment type enum'u dar.
- Oneri: V1'de kabul edilebilir; V2 icin odeme tipi konfigurasyonu gereklidir.

### 4.5 Masa kapatma mantigi

P1 - Masayi kapatma icin backend `PATCH /orders/:id/status closed` branchinde odeme kontrolu net gorunmuyor.

- Etki: Frontend sadece odenmis masada kapatma gosteriyor olsa da API dogrudan kullanilirsa odemesiz kapatma riski olabilir.
- Kok neden: Kapatma kurali frontend tarafinda daha guclu, backend status endpointinde kapatma guard'i payment endpoint kadar belirgin degil.
- Oneri: Backend status close icin de total paid >= grand total kontrolu zorunlu olmalidir. Paket teslim gibi ozel durumlar ayrica modellenmelidir.

P2 - Odenmis ama kapanmamis masa ara durumu iyi, fakat status olarak ayri modellenmiyor.

- Etki: Raporlama ve UI kararlarinda hesaplanmis durumlara bagimlilik artar.
- Kok neden: Paid state order.status degil, payments toplamindan turetiliyor.
- Oneri: V1'de hesaplanmis durum korunabilir; UI'da "Hesap odendi, masa acik" dili netlestirilmeli.

### 4.6 Masa tasima sonrasi beklenen yonlendirme

P2 - Tasima sonrasi hedef masaya/siparise yonlendirme yok.

- Etki: Garson tasimanin sonucunu gormek icin hedef masayi tekrar bulur.
- Kok neden: Hem table transfer hem order screen move akisi reload/navigate tables ile bitiyor.
- Oneri: Basarili tasima sonrasi hedef masa karti highlight edilmeli veya hedef siparis acilmalidir.

P1 - Hedef masa rezerve ise backend reddetmiyor.

- Etki: Rezervasyon uzerine aktif siparis tasinabilir.
- Kok neden: Transfer endpoint sadece `target.status === 'occupied'` kontrol ediyor.
- Oneri: Hedef sadece `empty` olmalidir; `reserved` icin yetkili onayli ayri akis tasarlanmalidir.

## 5. Amator gorunen davranislar

P1 - Islem isimleri teknik davranisi sakliyor.

- "Kaydet" kelimesi mutfak fisi basabilecek bir aksiyonu ifade ediyor.
- "Yazdir" receipt mi, ara hesap mi, final fis mi belirsiz.
- "Teslim Edildi" odeme/kapama semantigini gizliyor.

P1 - Kritik kurallar frontendde guclu, backendde her endpointte ayni sertlikte degil.

- Odeme ile kapatma payment endpointinde daha guvenli.
- Status close endpointi ayni payment guard'i acik sekilde gostermiyor.
- Paket teslim kapatma akisi odeme kuralindan bagimsiz gorunuyor.

P2 - Rezerve masa ve dolu masa operasyonlari ayni transfer/acma davranisina cok yakin.

- Rezervasyon profesyonel POS'ta ayri operasyonel durumdur.
- Onaysiz siparis acma veya tasima rezervasyon disiplinini bozar.

P2 - Caller ID "siparisi acildi" durumu sadece siparis kaydedilince servera yaziliyor.

- Kullanici popup'tan siparis ekranina gecer ama siparisi kaydetmeden cikarsa arama durumu belirsiz kalir.
- Bu, canli operasyonda tekrar eden popup veya eksik takip yaratir.

P2 - Paket siparis yan paneli masalar ekranina gomulu.

- Isletme icin paket siparis ayri bir operasyon kuyrugudur.
- Masa gridinin yanina eklenmis panel V1 icin pratik, fakat urun olgunlugu dusuk gorunuyor.

P2 - Siparis statuleri urun diliyle tam ortusmuyor.

- `saved`, `in_kitchen`, `closed`, `cancelled` gibi teknik statusler var.
- "Odenmis ama masa acik", "teslimata cikti", "hazirlaniyor", "servis edildi" gibi urun durumlari farkli kaynaklardan turetiliyor.

## 6. Profesyonel urun icin onerilen kural seti

### 6.1 V1 icin korunmasi gereken kurallar

1. Kaydedilmemis urun varken odeme/hizli odeme aksiyonlarini gizle.
   - Bu, kullanicinin ekranda gordugu toplam ile backenddeki tahsil edilebilir toplam arasinda hata yapmasini engeller.

2. Hizli odeme kalan tutarin tamamini kapatsin.
   - Hizli odeme profesyonel POS'ta "tek hamlede tahsilat" akisidir; kismi odeme ayrintili odeme ekraninda kalmalidir.

3. Masa kapatma sadece hesap tam odenince gorunsun.
   - Odenmis ama fiziksel olarak acik masa ara durumu korunmalidir.

4. Paket sipariste musteri secimi zorunlu kalsin.
   - Caller ID, adres, gecmis siparis ve teslimat icin temel veri kalitesi gerekir.

5. Kayitli siparise yeni urunler once lokal sepete gelsin.
   - Yanlis dokunmalarin mutfaga aninda gitmesini engeller.

6. Gonderilmis siparis kalemlerinde miktar/portion degisikligi kisitlansin.
   - Mutfak operasyonu icin gonderilmis kalemde rastgele degisiklik profesyonel degildir.

7. Mutfak adjustment job mantigi korunsun.
   - Iptal/azaltma mutfaga ayrica bildirilmelidir.

### 6.2 V1 icin duzeltilmesi gereken kurallar

1. "Kaydet" butonunun is kuralı netlestirilmeli.
   - En dusuk riskli V1 cozum: buton/metin "Kaydet ve Mutfaga Gonder" olarak degismeli veya uyari metni belirginlesmeli.

2. Backend masa kapatma guard'i payment guard'i ile ayni seviyeye getirilmeli.
   - Order status close, odeme tam degilse reddetmelidir.

3. Paket "Teslim Edildi" aksiyonu odeme durumunu kontrol etmelidir.
   - Odenmemis paket icin "once odeme al" yonlendirmesi gerekir.

4. Masa transfer hedefi sadece bos masa olmali.
   - Rezerve masaya tasima icin ayrica yetkili onay gerekir.

5. Caller ID open-order status server tarafina hemen yazilmalidir.
   - "Siparisi Ac" tiklaninca call log `opened_order` veya yeni bir `in_progress` status almalidir.

6. Yazdirma aksiyonlari urun dilinde ayrilmalidir.
   - Ara hesap, tahsilat fisi ve final fis ayrimi yapilmalidir.

7. Paket siparis kayit sonrasi yonlendirme ayrilmalidir.
   - Dine-in masalar ekranina donebilir; takeaway aktif paket siparis kuyruguna veya detayina odaklanmalidir.

### 6.3 Onerilen durum modeli

Salon siparisi icin:

- `draft`: frontend lokal, backend kaydi yok.
- `open_unsent`: backendde kayitli ama mutfaga gonderilmemis. V2 icin.
- `in_kitchen`: mutfaga gonderildi.
- `partially_paid`: en az bir odeme var, hala borc var.
- `paid_open`: hesap odendi, masa fiziksel olarak acik.
- `closed`: masa kapandi.
- `cancelled`: iptal edildi.

Paket siparis icin:

- `draft`: musteri/urun hazirlaniyor.
- `in_kitchen`: mutfaga gitti.
- `ready`: hazir. V2 mutfak durumuyla.
- `out_for_delivery`: teslimata cikti.
- `delivered_unpaid`: kapida odeme senaryosu varsa.
- `delivered_paid_closed`: teslim edildi ve kapandi.
- `cancelled`: iptal edildi.

V1'de bu modelin tamamini uygulamak sart degil; fakat UI kararlarinda bu ayrimlarin isimlendirilmesi gerekir.

## 7. Hemen duzeltilmesi gerekenler

P1 - Backend status close icin odeme kontrolu eklenmeli.

- Risk: API veya farkli UI yolu ile odemesiz masa kapatma.
- Is etkisi: Gun sonu kasa ve satis raporu hatasi.
- Kapsam: `server/routes/orders.js` closed branch.

P1 - Paket `delivered` aksiyonunda odeme kuralı netlestirilmeli.

- Risk: Tahsilat alinmadan paket siparis kapanabilir.
- Is etkisi: Kasa acigi, operasyonel takip kaybi.
- Kapsam: `server/routes/orders.js` takeaway delivery status endpoint, frontend delivery button akisi.

P1 - "Kaydet" aksiyonunun urun dili duzeltilmeli.

- Risk: Mutfaga istenmeden fis gitmesi.
- Is etkisi: Yanlis hazirlanan urun, fire, mutfak karmasasi.
- Kapsam: `client/src/components/orders/OrderScreen.jsx` buton metni/yardim metni; daha buyuk karar icin backend akisi.

P1 - Transfer hedefi rezerve masa icin engellenmeli veya onayli hale getirilmeli.

- Risk: Rezervasyonun ezilmesi.
- Is etkisi: Musteri memnuniyetsizligi ve masa yonetimi hatasi.
- Kapsam: `server/routes/tables.js`, `client/src/components/tables/TablesScreen.jsx`.

P2 - Caller ID open-order durum boslugu kapatilmali.

- Risk: Arama popup'inin yanlis tekrar etmesi veya takipte belirsizlik.
- Is etkisi: Telefon siparislerinde kayip/tekrar is.
- Kapsam: `client/src/context/IncomingCallContext.jsx`, `server/services/callerIdService.js`, `server/routes/callerid.js`.

## 8. Sonraki asamada koda dokulebilecek dusuk riskli iyilestirmeler

1. UI metinlerini netlestir:
   - "Kaydet" yerine "Kaydet ve Mutfaga Gonder".
   - "Yazdir" yerine "Hesap Yazdir" veya "Fis Yazdir".
   - "Ode ve Yazdir" yerine "Ode ve Hesap Yazdir"; kapatma iceren aksiyonda "Masayi Kapat" kelimesi mutlaka gorunsun.

2. Kaydedilmemis urun alanini daha belirgin yap:
   - "Kaydedilmemis urunler" ve "Mutfaga gonderilmis urunler" ayrimi.
   - Odeme gizliyken sebep metni daha net: "Yeni urunler once mutfaga gonderilmeli."

3. Hizli odemede borc yoksa modal davranisini degistir:
   - "Bu hesap zaten odenmis" bilgisi.
   - Yetki uygunsa "Masayi Kapat" aksiyonu.

4. Transfer sonrasi hedef masayi vurgula:
   - Basarili transferden sonra masalar ekraninda hedef masa highlight.
   - Alternatif: hedef masanin siparisine otomatik gec.

5. Rezerve masa acilisinda onay ekle:
   - "Bu masa rezerve. Rezervasyonu kullanarak siparis acilsin mi?"
   - Yetki/rol gereksinimi sonradan eklenebilir.

6. Paket siparis yan panelinde odeme durumunu goster:
   - `odenmedi`, `kismi odendi`, `odendi` etiketi.
   - Teslim edildi butonunun neden disabled oldugu acik olsun.

7. Caller ID popup'tan siparis acildiginda server status guncelle:
   - V1 icin `opened_order` status hemen yazilabilir.
   - Daha dogru model icin `in_progress` status eklenebilir.

8. Aksiyon görünürlükleri icin tek bir frontend policy fonksiyonu olustur:
   - Masa aksiyonlari ve siparis aksiyonlari ayni kurallari kullanmali.
   - Bu dusuk/orta riskli bir kalite iyilestirmesidir; davranis degisikligi icermeden test edilebilir.

## Ek: Onceliklendirilmis urun backlog'u

### Hemen

- P1: Odeme tamamlanmadan `closed` status engeli.
- P1: Paket teslim edildi aksiyonunda odeme kuralı.
- P1: Kaydet/mutfaga gonder urun dili.
- P1: Rezerve masaya transfer/acma kuralı.

### Bu hafta

- P2: Hizli odemede odenmis masa kapatma davranisi.
- P2: Caller ID "siparisi acildi ama kaydedilmedi" durumu.
- P2: Transfer sonrasi hedef masa yonlendirme/highlight.
- P2: Paket siparis yan panelinde odeme durum etiketi.

### Sonra

- V2: Kaydet ve mutfaga gonder aksiyonlarini ayirma.
- V2: Siparis status modelini urun durumlariyla yeniden tasarlama.
- V2: Paket siparis icin ayri operasyon ekrani.
- V2: Odeme tipi konfigurasyonu ve ara/final fis ayrimi.
