@echo off
chcp 65001 >nul
cd /d "%~dp0"
title SAE Server Watchdog

set "PY=%LOCALAPPDATA%\Python\PythonCore-3.14.64\python.exe"
if not exist "%PY%" set "PY=python"

netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  echo Server not running - starting it...
  start "" /min "%PY%" server.py
  timeout /t 2 >nul 2>&1
  start "" http://localhost:8000
)

:loop
timeout /t 60 >nul 2>&1
netstat -ano | findstr /r /c:":8000 .*LISTENING" >nul 2>&1
if errorlevel 1 (
  start "" /min "%PY%" server.py
)
goto loop