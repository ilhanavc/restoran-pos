@echo off
cd /d "%~dp0.."
call "%~dp0load-env.bat"

if not defined CALLERID_HELPER_POST_ENABLED set "CALLERID_HELPER_POST_ENABLED=true"
if "%CALLERID_SOURCE_TYPE%"=="" set "CALLERID_SOURCE_TYPE=callerid_sdk_helper"

set "NEED_TOKEN=0"
if /i "%CALLERID_HELPER_POST_ENABLED%"=="true" set "NEED_TOKEN=1"
if "%CALLERID_HELPER_POST_ENABLED%"=="1" set "NEED_TOKEN=1"
if "%NEED_TOKEN%"=="1" if "%BRIDGE_TOKEN%"=="" (
  echo.
  echo  [start-callerid-helper] HATA: POST acikken BRIDGE_TOKEN zorunlu.
  echo  scripts\local-env.bat icinde BRIDGE_TOKEN tanimlayin.
  pause
  exit /b 1
)

if not exist "tools\callerid-sdk-helper\cidshow_x64\cid.dll" (
  if not exist "tools\callerid-sdk-helper\cidshow_x86\cid.dll" (
    echo.
    echo  [start-callerid-helper] UYARI: cid.dll bulunamadi (cidshow_x64 veya cidshow_x86).
    echo  Vendor DLL'i yerlestirin veya CID_DLL_X64_PATH kullanin. Ayrintilar: tools\callerid-sdk-helper\README.md
    echo.
  )
)

title CallerID ^| SDK Helper
echo.
echo  ========================================
echo   Caller ID - SDK Helper (.NET)
echo  ========================================
echo   POST: %CALLERID_HELPER_POST_ENABLED%  API: %API_BASE%
echo   cid.dll gerekir; hata olursa mesaj asagida kalir (cmd /k).
echo  ========================================
echo.

set "CID_PROJ=tools\callerid-sdk-helper\CallerIdSdkHelper.csproj"
cmd /k dotnet run --project "%CID_PROJ%" -- --api-base "%API_BASE%" --source-type "%CALLERID_SOURCE_TYPE%" --post-enabled "%CALLERID_HELPER_POST_ENABLED%" --bridge-token "%BRIDGE_TOKEN%"
