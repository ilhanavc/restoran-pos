@echo off
cd /d "%~dp0.."
call "%~dp0load-env.bat"

if not defined CALLERID_HELPER_POST_ENABLED set "CALLERID_HELPER_POST_ENABLED=true"

REM start-all ile Caller ID penceresini ac/kapat: 1/true=ac (varsayilan), 0/false/no=kapat
if not defined START_ALL_CALLERID set "START_ALL_CALLERID=1"
set "RUN_CALLERID=1"
if /i "%START_ALL_CALLERID%"=="0" set "RUN_CALLERID=0"
if /i "%START_ALL_CALLERID%"=="false" set "RUN_CALLERID=0"
if /i "%START_ALL_CALLERID%"=="no" set "RUN_CALLERID=0"

title Restoran POS - Hepsini Baslat
echo.
echo  [start-all] POS + Bridge + (istege bagli) Caller ID ayri pencerelerde acilir.
echo  [start-all] Caller ID'yi bu akista kapatmak icin: START_ALL_CALLERID=0 (local-env.bat)
echo  [start-all] Simdi: START_ALL_CALLERID=%START_ALL_CALLERID%
echo.

start "POS | Restoran - Dev" "%~dp0start-pos-dev.bat"

timeout /t 8 /nobreak >nul

start "Bridge | Store Bridge" "%~dp0start-bridge.bat"

timeout /t 2 /nobreak >nul

if "%RUN_CALLERID%"=="1" (
  start "CallerID | SDK Helper" "%~dp0start-callerid-helper.bat"
) else (
  echo  [start-all] Caller ID helper bu sefer baslatilmadi START_ALL_CALLERID=%START_ALL_CALLERID%
  echo.
)

echo  [start-all] Tamam. Bu pencereyi kapatabilirsiniz.
timeout /t 3 /nobreak >nul
exit /b 0
