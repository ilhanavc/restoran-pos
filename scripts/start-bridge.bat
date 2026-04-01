@echo off
cd /d "%~dp0.."
call "%~dp0load-env.bat"

if "%BRIDGE_TOKEN%"=="" (
  echo.
  echo  [start-bridge] HATA: BRIDGE_TOKEN tanimli degil.
  echo  scripts\local-env.bat olusturup BRIDGE_TOKEN yazin veya ortam degiskenini kullanin.
  pause
  exit /b 1
)
if "%BRIDGE_BUSINESS_ID%"=="" (
  echo.
  echo  [start-bridge] HATA: BRIDGE_BUSINESS_ID tanimli degil.
  echo  Veritabanindaki businesses.id ile ayni olmali. local-env.example.bat dosyasina bakin.
  pause
  exit /b 1
)

title Bridge ^| Store Bridge
echo.
echo  ========================================
echo   Store Bridge - Yazdirma / API poll
echo  ========================================
echo   Komut: npm run bridge
echo   Gerekli: BRIDGE_TOKEN, BRIDGE_BUSINESS_ID, API_BASE
echo   Backend ayakta olmali (once POS calistirin).
echo  ========================================
echo.

cmd /k "npm run bridge"
