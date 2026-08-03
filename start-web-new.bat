@echo off
rem Supervisor — launches the redesigned UI from web.new/.
rem
rem Identical to start.bat except SUPERVISOR_WEB_DIR points the server at
rem web.new instead of web. Run start.bat to use the original UI.

setlocal
cd /d "%~dp0"

set "SUPERVISOR_WEB_DIR=web.new"

rem ── Sanity check: make sure web.new actually exists ────────────────────────
if not exist "%SUPERVISOR_WEB_DIR%\index.html" (
  echo [supervisor] %SUPERVISOR_WEB_DIR%\index.html not found.
  echo [supervisor] Falling back to start.bat would launch the original UI.
  pause
  exit /b 1
)

rem ── Kill any prior supervisor process ──────────────────────────────────────
if exist "data\supervisor.pid" goto :have_pidfile
goto :after_kill

:have_pidfile
set "OLDPID="
set /p OLDPID=<"data\supervisor.pid"
del /f /q "data\supervisor.pid" >nul 2>&1
if "%OLDPID%"=="" goto :after_kill
echo [supervisor] killing prior process PID %OLDPID%
taskkill /F /T /PID %OLDPID% >nul 2>&1
ping -n 2 127.0.0.1 >nul

:after_kill

rem ── Dependencies ───────────────────────────────────────────────────────────
if not exist node_modules (
  echo [supervisor] node_modules missing — running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo [supervisor] npm install failed. Fix the errors above and re-run start-web-new.bat.
    pause
    exit /b 1
  )
)

if not exist .env (
  if exist .env.example (
    echo [supervisor] .env missing — copying from .env.example.
    copy /y .env.example .env >nul
    echo [supervisor] Edit .env to set SUPERVISOR_PASSWORD before first sign-in.
  )
)

rem ── Launch ─────────────────────────────────────────────────────────────────
echo [supervisor] launching UI from %SUPERVISOR_WEB_DIR%\
node server\server.js
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
  echo [supervisor] server exited with code %EXITCODE%.
)
pause
endlocal
exit /b %EXITCODE%
