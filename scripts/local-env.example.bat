@echo off
REM Bu dosyayi "local-env.bat" olarak kopyalayip degerleri doldurun (local-env.bat commit edilmez).

REM StoreBridge, backend bridge endpoint'leri ve Caller ID helper icin ortak sifre (hepsi ayni olmali).
REM set "BRIDGE_TOKEN=ornek-guvenli-token-buraya"

REM Veritabanindaki businesses.id ile ayni olmali. npm run db:seed her calistiginda yeni UUID uretir;
REM bir kez seed sonrasi ID'yi ogrenip buraya yazin (or. SQLite: SELECT id FROM businesses LIMIT 1;).
REM set "BRIDGE_BUSINESS_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

REM Backend ve bridge icin API kok adresi (sonunda /api).
REM set "API_BASE=http://127.0.0.1:3001/api"

REM Yazdirma: gercek yazici/store-bridge kullanirken genelde true. Sadece mock yazdirmak icin false veya 0.
REM set "DISABLE_PRINT_JOB_MOCK=true"

REM Caller ID helper (opsiyonel):
REM set "CALLERID_SOURCE_TYPE=callerid_sdk_helper"
REM set "CALLERID_HELPER_POST_ENABLED=true"

REM start-all.bat ile Caller ID penceresini hic acma: 0 veya false
REM set "START_ALL_CALLERID=0"
