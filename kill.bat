@echo off
rem Kill any supervisor process — listener on 7778 OR a zombie tracked by the
rem PID file. Useful when start.bat misbehaves or the server is hung mid-boot
rem (running but not bound).

setlocal
cd /d "%~dp0"

set PORT=7778
set FOUND=0

rem ── PID file (catches zombies that aren't listening) ──────────────────────
if exist "data\supervisor.pid" (
  set "OLDPID="
  set /p OLDPID=<"data\supervisor.pid"
  del /f /q "data\supervisor.pid" >nul 2>&1
  if not "%OLDPID%"=="" (
    echo [kill] PID file said %OLDPID% — killing it.
    taskkill /F /T /PID %OLDPID% >nul 2>&1
    set FOUND=1
  )
)

rem ── Anything still listening on the port ──────────────────────────────────
echo [kill] scanning port %PORT%...
for /f "tokens=5" %%P in ('netstat -ano -p tcp ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  if not "%%P"=="0" (
    echo [kill] killing listener PID %%P
    taskkill /F /T /PID %%P >nul 2>&1
    set FOUND=1
  )
)

if %FOUND%==0 (
  echo [kill] nothing to kill.
) else (
  echo [kill] done.
)

endlocal
