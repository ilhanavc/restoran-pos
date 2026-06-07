@echo off
chcp 65001 >nul
title Restoran POS - Kapatiliyor
echo POS servisleri kapatiliyor...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3002.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5174.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1

echo Tamamlandi!
timeout /t 2 /nobreak >nul
