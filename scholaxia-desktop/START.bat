@echo off
title Scholaxia Student
cd /d "%~dp0"

REM Flags that avoid startup hangs from stale GPU/sandbox processes.
REM Dedicated profile dir keeps logins persistent and avoids stale profile locks.
set "ELECTRON_FLAGS=--no-sandbox --disable-gpu --user-data-dir=%LOCALAPPDATA%\ScholaxiaStudent"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install
)

start "" "%~dp0node_modules\electron\dist\electron.exe" %ELECTRON_FLAGS% .
exit /b 0
