@echo off
title Scholaxia Admin Console
cd /d "%~dp0"

set "ELECTRON_FLAGS=--no-sandbox --disable-gpu --user-data-dir=%LOCALAPPDATA%\ScholaxiaAdmin"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install
)

start "" "%~dp0node_modules\electron\dist\electron.exe" %ELECTRON_FLAGS% main-admin.js
exit /b 0
