@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then open this launcher again.
  pause
  exit /b 1
)
echo Opening Office Days Calculator...
echo Keep this window open while using the app. Close it to stop the server.
node "%~dp0server.js" --open
if errorlevel 1 pause
