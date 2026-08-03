@echo off
rem Supervisor — convenience launcher for Windows.
rem Reads config from .env (see .env.example).

setlocal
cd /d "%~dp0"

rem ── Kill any prior supervisor process ──────────────────────────────────────
rem Server writes data\supervisor.pid on boot, removes it on clean shutdown.
rem Plain `set /p` is dramatically more robust than `for /f` here — Windows'
rem batch parser has trouble with pipes/&& inside for-loop bodies.
if exist "data\supervisor.pid" goto :have_pidfile
goto :after_kill

:have_pidfile
set "OLDPID="
set /p OLDPID=<"data\supervisor.pid"
del /f /q "data\supervisor.pid" >nul 2>&1
if "%OLDPID%"=="" goto :after_kill
echo [supervisor] killing prior process PID %OLDPID%
taskkill /F /T /PID %OLDPID% >nul 2>&1
rem Brief pause so the killed process releases the port before we bind.
ping -n 2 127.0.0.1 >nul

:after_kill

rem ── Dependencies ───────────────────────────────────────────────────────────
if not exist node_modules (
  echo [supervisor] node_modules missing — running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo [supervisor] npm install failed. Fix the errors above and re-run start.bat.
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
node server\server.js
set EXITCODE=%ERRORLEVEL%

echo.
if %EXITCODE% NEQ 0 (
  echo [supervisor] server exited with code %EXITCODE%.
)
pause
endlocal
exit /b %EXITCODE%
