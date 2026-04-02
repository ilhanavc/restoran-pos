@echo off
setlocal

cd /d "%~dp0.."

if exist "%~dp0local-env.bat" call "%~dp0local-env.bat"

title CallerID ^| SDK Helper
echo ==========================================
echo Caller ID SDK Helper
echo ==========================================
echo.

if "%API_BASE%"=="" set API_BASE=http://127.0.0.1:3001/api

if "%BRIDGE_TOKEN%"=="" (
  echo [start-callerid-helper] HATA: POST acikken BRIDGE_TOKEN zorunlu.
  echo scripts\local-env.bat icinde BRIDGE_TOKEN tanimlayin.
  pause
  exit /b 1
)

if exist "tools\callerid-sdk-helper\cidshow_x64\cid.dll" goto run_helper
if exist "tools\callerid-sdk-helper\cidshow_x86\cid.dll" goto run_helper

echo [start-callerid-helper] HATA: cid.dll bulunamadi.
echo Beklenen klasorler:
echo   tools\callerid-sdk-helper\cidshow_x64\
echo   tools\callerid-sdk-helper\cidshow_x86\
pause
exit /b 1

:run_helper
echo [start-callerid-helper] API_BASE=%API_BASE%
echo [start-callerid-helper] BRIDGE_TOKEN tanimli
echo.

dotnet run -c Release --project .\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj -- --api-base %API_BASE% --post-enabled true --source-type callerid_sdk_helper --bridge-token %BRIDGE_TOKEN%

echo.
echo [start-callerid-helper] Bitti veya hata ile cikti.
pause