@echo off
REM Ortak varsayilanlar: scripts\local-env.bat varsa once o yuklenir (override).
if exist "%~dp0local-env.bat" call "%~dp0local-env.bat"

if not defined API_BASE set "API_BASE=http://127.0.0.1:3001/api"
if not defined DISABLE_PRINT_JOB_MOCK set "DISABLE_PRINT_JOB_MOCK=true"
