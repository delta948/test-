@echo off
title Frontend 127.0.0.1:3000
echo Starting frontend...
echo.
cd /d "%~dp0frontend"
set HOST=127.0.0.1
set PORT=3000
set LOG=%~dp0frontend_start.log
echo Folder: %cd%
echo Address: http://127.0.0.1:3000
echo Log: %LOG%
echo.
echo [%date% %time%] Starting frontend > "%LOG%"
echo Folder: %cd% >> "%LOG%"
if not exist "build\index.html" (
  echo ERROR: build\index.html not found.
  echo Run: npm.cmd run build
  echo ERROR: build\index.html not found. >> "%LOG%"
  echo.
  pause
  exit /b 1
)
if not exist "local-static-server.js" (
  echo ERROR: local-static-server.js not found.
  echo ERROR: local-static-server.js not found. >> "%LOG%"
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
echo If the browser says connection refused, this window probably closed or the server stopped.
echo.
"C:\Program Files\nodejs\node.exe" local-static-server.js 2>> "%LOG%"
echo.
echo Server stopped.
echo Server stopped. >> "%LOG%"
pause
