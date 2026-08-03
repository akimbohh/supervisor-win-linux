#!/usr/bin/env bash
# Stop a running Supervisor: PID-file process + anything on the port.
set -uo pipefail
cd "$(dirname "$0")"

PORT="${SUPERVISOR_PORT:-7778}"
PIDFILE="data/supervisor.pid"
FOUND=0

if [ -f "$PIDFILE" ]; then
  OLDPID="$(cat "$PIDFILE" 2>/dev/null || true)"
  rm -f "$PIDFILE"
  if [ -n "${OLDPID:-}" ] && kill -0 "$OLDPID" 2>/dev/null; then
    echo "[stop] killing PID $OLDPID"; kill -TERM "$OLDPID" 2>/dev/null || true; FOUND=1
  fi
fi

# Anything still bound to the port.
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null && FOUND=1 || true
elif command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:"$PORT" 2>/dev/null || true)"
  if [ -n "$PIDS" ]; then echo "[stop] killing listeners: $PIDS"; kill $PIDS 2>/dev/null || true; FOUND=1; fi
fi

[ "$FOUND" -eq 0 ] && echo "[stop] nothing to kill." || echo "[stop] done."
