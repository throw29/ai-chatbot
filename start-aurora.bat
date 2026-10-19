@echo off
setlocal EnableExtensions

rem Aurora AI one-click launcher for Windows.
rem Double-click this file (or the desktop shortcut) to start the backend and
rem open the chat UI. Pass --no-browser to skip opening the browser.

title Aurora AI Launcher

set "AURORA_DIR=%~dp0"
if "%AURORA_DIR:~-1%"=="\" set "AURORA_DIR=%AURORA_DIR:~0,-1%"
set "AURORA_URL=http://127.0.0.1:8000"
set "AURORA_HEALTH=http://127.0.0.1:8000/api/health"
set "OPEN_BROWSER=1"
if /I "%~1"=="--no-browser" set "OPEN_BROWSER=0"

call :health_ok
if not errorlevel 1 goto open_app

echo.
echo   Starting the Aurora AI backend...
echo   Project: %AURORA_DIR%
echo.

start "Aurora AI Backend" /D "%AURORA_DIR%" cmd /k "uv run uvicorn app.main:app --host 127.0.0.1 --port 8000"

set /a ATTEMPTS=0

:wait_loop
call :health_ok
if not errorlevel 1 goto open_app
set /a ATTEMPTS+=1
if %ATTEMPTS% GEQ 30 goto start_failed
timeout /t 1 /nobreak >nul
goto wait_loop

:start_failed
echo.
echo   Aurora AI could not start within 30 seconds.
echo   Run these commands in a terminal to see the error:
echo.
echo     cd /d "%AURORA_DIR%"
echo     uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
echo.
pause
exit /b 1

:open_app
if "%OPEN_BROWSER%"=="1" start "" "%AURORA_URL%"
exit /b 0

:health_ok
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%AURORA_HEALTH%' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { }; exit 1" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0
