# Hızlı başlatma (dükkan / Windows)

1. **Bir kez:** `scripts/local-env.example.bat` dosyasını `scripts/local-env.bat` olarak kopyalayın; `BRIDGE_TOKEN` ve `BRIDGE_BUSINESS_ID` değerlerini doldurun (işletme id’si veritabanındaki `businesses.id` ile aynı olmalı).

2. **Her gün:** `scripts/start-all.bat` dosyasına çift tıklayın (veya masaüstüne kısayol). Açılır: POS, Bridge, isteğe bağlı Caller ID.

3. **Caller ID’yi bu akışta istemiyorsanız:** `local-env.bat` içine `set START_ALL_CALLERID=0` ekleyin — yalnızca POS ve Bridge pencereleri açılır.

4. **Sorun çıkarsa** ilgili penceredeki metni okuyun; pencereler genelde hemen kapanmaz (`cmd /k` veya duraklatma).

5. **Caller ID (SDK helper):** Vendor `cid.dll` repoda yok; `tools\callerid-sdk-helper\cidshow_x64\` veya `cidshow_x86\` altına kopyalayın (veya `CID_DLL_*_PATH`). Ayrıntı: `tools\callerid-sdk-helper\README.md`.

Ayrıntılı tablo ve manuel komutlar için ana `README.md` dosyasındaki “Windows: tek tık” bölümüne bakın.
