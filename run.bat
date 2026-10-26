@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on PATH.
  echo Install Node.js, or serve the folder yourself:  npx serve .
  pause
  exit /b 1
)

node serve.mjs %*
