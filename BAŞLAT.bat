@echo off
chcp 65001 >nul
title Restoran POS - Demo
color 0A

echo ============================================
echo   RESTORAN POS - DEMO BASLATILIYOR
echo ============================================
echo.

REM Eski node sureclerini temizle
echo [1/4] Eski sunucular temizleniyor...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 2 /nobreak >nul

REM Backend baslat
echo [2/4] Backend (port 3002) baslatiliyor...
start "POS Backend" /MIN cmd /c "cd /d D:\dev\restoran-pos-v3\server && set PORT=3002 && node index.js"
timeout /t 5 /nobreak >nul

REM Frontend baslat
echo [3/4] Frontend (port 5174) baslatiliyor...
start "POS Frontend" /MIN cmd /c "cd /d D:\dev\restoran-pos-v3\client && npx vite --port 5174"
timeout /t 6 /nobreak >nul

REM Tarayiciyi ac
echo [4/4] Tarayici aciliyor...
start "" "http://localhost:5174"

echo.
echo ============================================
echo   HAZIR! Tarayicida acildi.
echo.
echo   Kapatmak icin: KAPAT.bat dosyasini calistir
echo ============================================
echo.
timeout /t 5 /nobreak >nul
