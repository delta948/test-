@echo off
cd /d "%~dp0frontend"
set BROWSER=none
set HOST=127.0.0.1
set PORT=3000
npm.cmd start
pause
