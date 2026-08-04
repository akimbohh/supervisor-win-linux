# Deploying Supervisor on Linux

A fresh `git clone` on Ubuntu 24.04 reaches a working, boot-persistent install
via the steps below.

## One-line install (Ubuntu/Debian, run as root)

Paste this into an SSH session (Termius, etc.). It prompts for a password, then
installs prerequisites + Node (if missing), clones to `/opt/supervisor`,
installs deps, and creates + starts a boot-persistent `systemd` service bound to
all interfaces (reach it over Tailscale):

```bash
read -rsp 'Set a Supervisor password: ' PASS; echo; DIR=/opt/supervisor PORT=7778; apt-get update -qq && apt-get install -y -qq git build-essential python3 curl && { command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs; }; } && { [ -d "$DIR/.git" ] || git clone https://github.com/akimbohh/supervisor-win-linux.git "$DIR"; } && cd "$DIR" && npm install --no-audit --no-fund && printf '[Unit]\nDescription=Supervisor\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=%s\nEnvironment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\nEnvironment=SUPERVISOR_PORT=%s\nEnvironment=SUPERVISOR_BIND=0.0.0.0\nEnvironment=SUPERVISOR_PASSWORD=%s\nExecStart=%s server/server.js\nRestart=always\nRestartSec=2\n\n[Install]\nWantedBy=multi-user.target\n' "$DIR" "$PORT" "$PASS" "$(command -v node)" > /etc/systemd/system/supervisor.service && systemctl daemon-reload && systemctl enable --now supervisor && sleep 2 && curl -fsS localhost:$PORT/api/ping && echo " ✓ Supervisor is up on port $PORT"
```

Not root? Run `sudo -i` first, or prefix the line with `sudo bash -c '…'`.

This runs the service **as root** so power actions (shutdown/restart) and the
whole disk work without extra polkit/sudoers rules — appropriate for a personal
single-user panel reached over Tailscale. For a hardened non-root install, use
`install-linux.sh --service` (below) and add the polkit rule in
[Power actions](#power-actions-shutdown--restart--sleep).

Update later:  `cd /opt/supervisor && git pull && npm install --no-audit --no-fund && systemctl restart supervisor`
Uninstall:     `systemctl disable --now supervisor && rm /etc/systemd/system/supervisor.service && systemctl daemon-reload && rm -rf /opt/supervisor`

## Quick start

```bash
git clone <repo> /opt/supervisor && cd /opt/supervisor
./deploy/install-linux.sh          # installs deps, checks node-pty + inotify
sudo ./deploy/install-linux.sh --service   # install + enable the systemd unit
sudo systemctl start supervisor
journalctl -u supervisor -f        # logs
```

Then open `http://<host>:7778` over Tailscale, sign in, and change the password
immediately (the app refuses to bind anything but loopback until you do).

## Prerequisites

- **Node ≥ 18.**
- **A C toolchain for `node-pty`:** `sudo apt install build-essential python3 make g++`.
  Without it, node-pty fails to build — Console shells fall back to piped mode
  (no colors/resize) **and** Claude's workspace-trust dialog can't be
  auto-accepted, so new sessions would hang. The app surfaces `pty: false` in
  `GET /api/system/capabilities` and shows a banner; the manual fallback is to
  SSH in and run `claude` once per folder to accept the trust prompt.
- **Raise the inotify watch limit** so live file updates don't silently stop:
  ```bash
  echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-supervisor.conf
  sudo sysctl --system
  ```
  (Or enable polling in Settings for network/overlay mounts.)

## Power actions (shutdown / restart / sleep)

The service runs as a non-root user, so `systemctl poweroff/reboot/suspend`
need authorization. Grant it with **polkit** (preferred):

```
# /etc/polkit-1/rules.d/50-supervisor.rules
polkit.addRule(function(action, subject) {
  if (subject.user == "supervisor" &&
      (action.id == "org.freedesktop.login1.power-off" ||
       action.id == "org.freedesktop.login1.reboot" ||
       action.id == "org.freedesktop.login1.suspend")) {
    return polkit.Result.YES;
  }
});
```

…or a scoped **sudoers** rule if you prefer `shutdown(8)`:

```
supervisor ALL=(root) NOPASSWD: /usr/sbin/shutdown, /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot
```

On a virtualized VPS, **sleep/suspend has no meaning** — the capability system
reports `power.sleep: false` and the UI shows the control disabled with that
reason, rather than issuing a command that fails.

## Manual (no systemd)

```bash
./start.sh     # foreground; Ctrl-C to stop
./stop.sh      # kill PID-file process + anything on the port
```

`pm2` also works: `pm2 start server/server.js --name supervisor && pm2 save`.
The in-app restart detects pm2/systemd and just exits so the manager restarts it.
