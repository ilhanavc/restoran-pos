@echo off
setlocal

if "%API_BASE%"=="" set API_BASE=http://127.0.0.1:3001/api
if "%CALLERID_SOURCE_TYPE%"=="" set CALLERID_SOURCE_TYPE=callerid_sdk_helper
if "%CALLERID_HELPER_POST_ENABLED%"=="" set CALLERID_HELPER_POST_ENABLED=0

echo [callerid-sdk-helper] starting...
dotnet run --project "%~dp0..\tools\callerid-sdk-helper\CallerIdSdkHelper.csproj" -- --api-base %API_BASE% --source-type %CALLERID_SOURCE_TYPE% --post-enabled %CALLERID_HELPER_POST_ENABLED% --bridge-token %BRIDGE_TOKEN%
