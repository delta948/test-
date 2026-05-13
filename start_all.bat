@echo off
cd /d "%~dp0"
start "backend 8000" cmd /k start_backend.bat
start "frontend 3000" cmd /k start_frontend_static.bat
