@echo off
setlocal

if "%BRIDGE_TOKEN%"=="" (
  echo [callerid-clipboard] BRIDGE_TOKEN tanimli degil.
  echo Once set BRIDGE_TOKEN=... yapin.
  exit /b 1
)

if "%API_BASE%"=="" set API_BASE=http://127.0.0.1:3001/api
if "%CALLERID_SOURCE_TYPE%"=="" set CALLERID_SOURCE_TYPE=callerid_clipboard

echo [callerid-clipboard] starting...
powershell -ExecutionPolicy Bypass -File "%~dp0callerid-clipboard-listener.ps1"
