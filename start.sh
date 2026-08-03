#!/usr/bin/env bash
# Supervisor launcher for POSIX (Linux/macOS) — mirrors start.bat.
set -euo pipefail
cd "$(dirname "$0")"

PIDFILE="data/supervisor.pid"

# Kill a stale prior process recorded in the PID file.
if [ -f "$PIDFILE" ]; then
  OLDPID="$(cat "$PIDFILE" 2>/dev/null || true)"
  rm -f "$PIDFILE"
  if [ -n "${OLDPID:-}" ] && kill -0 "$OLDPID" 2>/dev/null; then
    echo "[supervisor] killing prior process PID $OLDPID"
    kill -TERM "$OLDPID" 2>/dev/null || true
    sleep 1
    kill -KILL "$OLDPID" 2>/dev/null || true
  fi
fi

if [ ! -d node_modules ]; then
  echo "[supervisor] node_modules missing — running npm install..."
  npm install --no-audit --no-fund
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  echo "[supervisor] .env missing — copying from .env.example."
  cp .env.example .env
  echo "[supervisor] Edit .env to set SUPERVISOR_PASSWORD before first sign-in."
fi

exec node server/server.js
