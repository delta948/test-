@echo off
cd /d "%~dp0frontend"
set BROWSER=none
set PORT=3000
set CI=false
npm.cmd start > "%~dp0frontend_run.log" 2> "%~dp0frontend_run.err.log"
