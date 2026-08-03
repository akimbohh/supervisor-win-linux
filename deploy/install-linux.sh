#!/usr/bin/env bash
# Supervisor — Linux install helper (P-9). Installs dependencies, verifies
# node-pty, and (optionally) sets up the systemd service. Idempotent.
#
# Usage:
#   ./deploy/install-linux.sh            # deps + node-pty check
#   sudo ./deploy/install-linux.sh --service   # also install+enable systemd unit
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[install] Node: $(node --version 2>/dev/null || echo 'NOT FOUND — install Node >=18')"

# node-pty needs a toolchain. Warn early and actionably (P-4).
if ! dpkg -s build-essential >/dev/null 2>&1 && ! command -v cc >/dev/null 2>&1; then
  echo "[install] WARNING: no C toolchain found. node-pty will fail to build, so"
  echo "          Console shells lose PTY features AND Claude's trust dialog cannot"
  echo "          be auto-accepted. Install it:  sudo apt install build-essential python3 make g++"
fi

echo "[install] Raising inotify watch limit recommendation..."
CUR=$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo 0)
if [ "${CUR:-0}" -lt 524288 ]; then
  echo "[install] fs.inotify.max_user_watches=$CUR is low; live file updates may stop."
  echo "          To raise persistently:  echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-supervisor.conf && sudo sysctl --system"
fi

echo "[install] Installing npm dependencies..."
npm ci --no-audit --no-fund || npm install --no-audit --no-fund

if [ "${1:-}" = "--service" ]; then
  if [ "$(id -u)" -ne 0 ]; then echo "[install] --service needs root (sudo)."; exit 1; fi
  echo "[install] Installing systemd unit. Edit User/WorkingDirectory/PATH in it as needed."
  sed "s#/opt/supervisor#$REPO_ROOT#" deploy/supervisor.service > /etc/systemd/system/supervisor.service
  systemctl daemon-reload
  systemctl enable supervisor
  echo "[install] Enabled. Start with:  sudo systemctl start supervisor"
  echo "[install] Logs:  journalctl -u supervisor -f"
else
  echo "[install] Done. Run ./start.sh to launch, or re-run with --service for systemd."
fi
