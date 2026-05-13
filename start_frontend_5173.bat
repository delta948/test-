@echo off
title Frontend 127.0.0.1:5173
echo Starting frontend on port 5173...
echo.
cd /d "%~dp0frontend"
set HOST=127.0.0.1
set PORT=5173
set LOG=%~dp0frontend_5173_start.log
echo Folder: %cd%
echo Address: http://127.0.0.1:5173
echo Log: %LOG%
echo.
echo [%date% %time%] Starting frontend on 5173 > "%LOG%"
if not exist "build\index.html" (
  echo ERROR: build\index.html not found.
  echo ERROR: build\index.html not found. >> "%LOG%"
  echo.
  pause
  exit /b 1
)
if not exist "C:\Program Files\nodejs\node.exe" (
  echo ERROR: Node.js not found at C:\Program Files\nodejs\node.exe
  echo ERROR: Node.js not found. >> "%LOG%"
  echo.
  pause
  exit /b 1
)
echo Server is starting. Keep this window open.
echo.
"C:\Program Files\nodejs\node.exe" local-static-server.js 2>> "%LOG%"
echo.
echo Server stopped.
echo Server stopped. >> "%LOG%"
pause
