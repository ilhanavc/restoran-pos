# Caller ID SDK Helper

Bu yardımcı uygulama `cid.dll` callback modelini izole bir süreçte çalıştırır.

## Amaç

- Vendor `SetEvents` callback akışını Node/native ffi olmadan doğrulamak
- İlk sürümde güvenli log üretmek
- İsteğe bağlı olarak mevcut backend bridge endpoint'ine POST atmak
- Clipboard listener çözümünü fallback olarak korumak

## DLL Yerleşimi

Build sonrası exe klasöründe aşağıdaki dizinlerden biri bulunmalıdır:

- `cidshow_x64/cid.dll` (64-bit process)
- `cidshow_x86/cid.dll` (32-bit process)

Alternatif olarak `--dll-path` veya `CID_DLL_X64_PATH` / `CID_DLL_X86_PATH` ile mutlak yol verilebilir.

## Build

```powershell
dotnet build .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -c Release
```

## Çalıştırma

Log-only (önerilen ilk test):

```powershell
dotnet run --project .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -- --api-base http://127.0.0.1:3001/api
```

POST açık:

```powershell
dotnet run --project .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -- `
  --api-base http://127.0.0.1:3001/api `
  --bridge-token YOUR_BRIDGE_TOKEN `
  --post-enabled true `
  --source-type callerid_sdk_helper
```

## Notlar

- Varsayılan `post-enabled` kapalıdır.
- Telefon gönderimi yalnızca 10-11 hane için yapılır.
- Aynı numaraya debounce uygulanır (`CALLERID_HELPER_DEBOUNCE_MS`, varsayılan `4000`).
- Hata durumunda süreç kapanmak yerine log üretir.
