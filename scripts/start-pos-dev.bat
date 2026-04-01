@echo off
cd /d "%~dp0.."
call "%~dp0load-env.bat"

title POS ^| Restoran - Dev
echo.
echo  ========================================
echo   POS - Frontend + Backend
echo  ========================================
echo   Komut: npm run dev  (Vite + API)
echo   Env: API_BASE, DISABLE_PRINT_JOB_MOCK (load-env)
echo   Uyari: Bridge token burada zorunlu degil; POS ayri acilir.
echo  ========================================
echo.

cmd /k "npm run dev"
