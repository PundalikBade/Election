@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Student Association Election Server

set "PY=%LOCALAPPDATA%\Python\PythonCore-3.14.64\python.exe"
if not exist "%PY%" set "PY=python"

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo.
  echo  The server is ALREADY running at http://localhost:8000
  echo  Opening your browser...
  start http://localhost:8000
  timeout /t 5 >nul
  exit /b 0
)

echo.
echo  ==============================================
echo    Student Association Election System
echo    Open in browser : http://localhost:8000
echo    Admin login     : admin / admin123
echo    Demo voter      : AIML_01 / PIN 482913
echo    Press Ctrl+C to stop the server.
echo  ==============================================
echo.
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:8000"
"%PY%" server.py
pause