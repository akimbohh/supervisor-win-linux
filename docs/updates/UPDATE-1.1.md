# UPDATE 1.1 — Security & correctness hardening (backend)

Status: **proposed**
Scope: `server/lib/paths.js`, `server/lib/auth.js`, `server/server.js`, `server/routes/*`, `server/lib/maintenance.js`, remove `supervisor.js`
Risk: low–medium (touches the auth and file-safety guards; needs manual boot test)
Depends on: none

This is the first and highest-priority update. It closes the concrete
security and correctness holes found in `AUDIT.md` §1 (Critical/High). None of
these change the product's intentional design (single trusted user, post-auth
arbitrary exec, no TLS) — they close *pre-auth* and *secret-exposure* gaps that
the design does **not** intend.

## 1.1.1 — Rate-limit bypass via spoofed `X-Forwarded-For` (Critical)

`server.js:53` sets `app.set('trust proxy', true)`, and `routes/auth.js:7`
keys the login lockout on `req.ip`. With `trust proxy` fully on, `req.ip` is
taken from the client-supplied `X-Forwarded-For` header, so an attacker can
send a different `X-Forwarded-For` on every request and **never trip the
exponential-backoff lockout** — defeating the only brute-force defense on the
single password.

**Fix**
- Set `trust proxy` to a specific, trusted hop count or CIDR (e.g. `'loopback'`
  or the Tailscale interface), not blanket `true`. For the "reached only over
  Tailscale / localhost" model, `app.set('trust proxy', 'loopback')` is right.
- Additionally, keep a second global counter that rate-limits **all** failed
  logins regardless of IP (e.g. hard cap of N failures/minute server-wide) so
  IP rotation can't help even if a proxy is later added.
- Consider a small fixed per-attempt delay (200–500 ms) on every login POST.

**Acceptance**: with `curl` sending varying `X-Forwarded-For`, the 4th+ wrong
password still returns HTTP 429.

## 1.1.2 — File API can read/overwrite the app's own secrets (High)

`paths.js` `ensureSafe()` + the default blocklists (`DEFAULT_BLOCKLIST_WIN`,
`DEFAULT_BLOCKLIST_NIX`) do **not** cover the repo's own `data/` directory or
`.env`. An authenticated user (or anything that gets a valid cookie) can:

- `GET /api/files/read?path=<repo>/data/secret.bin` → the HMAC cookie-signing
  key. With it, an attacker can **forge session cookies forever**, surviving
  password changes.
- Read `data/passwd.json` (scrypt hash), `data/vapid.json` (push private key),
  and `.env` (initial password, if left in place).
- `POST /api/files/write` / `/delete` to corrupt or replace those files.

Yes, this is post-auth, but a personal admin panel should not let a stray
XSS, a borrowed session, or a shoulder-surfed password escalate to a
permanent, unrevocable cookie-forging key.

**Fix**
- Add the resolved absolute path of `data/` and the project root's `.env` to a
  **hard, non-overridable** blocklist checked inside `ensureSafe()` (separate
  from the user-editable `settings.blocklist`, which users can accidentally
  empty).
- Rotate `secret.bin` on password change so a leaked old key stops minting
  valid cookies (store a key version in the token payload; reject old versions).

**Acceptance**: `GET /api/files/read?path=…/data/secret.bin` returns 403
`EBLOCKED`, and changing the password invalidates all prior cookies.

## 1.1.3 — Blocklist is prefix-only and symlink-blind (High)

`isBlocked()` compares `path.resolve(p)` against resolved blocklist prefixes.
It never calls `fs.realpath`, so a symlink **inside** an allowed folder that
points into a blocked one (e.g. a link to `C:\Windows` or to `data/`) bypasses
the check — `listDir` already follows symlinks for stat. On Windows, the 8.3
short-name form of a path (`C:\PROGRA~1`) and alternate path spellings can also
sidestep a naive prefix match.

**Fix**
- Resolve real paths with `fs.realpathSync.native` (falling back to `resolve`
  when the target doesn't exist yet, e.g. for `write`/`mkdir`) before the
  blocklist comparison.
- Normalize Windows short names / drive-letter casing.
- Refuse to traverse *into* a symlink that resolves outside the requested
  root when listing, or clearly flag such entries and never operate on them.

**Acceptance**: a symlink pointing at a blocked directory cannot be listed,
read, written, moved, or zipped through the API.

## 1.1.4 — Headless maintenance run can hang on permission prompts (Medium bug)

`lib/maintenance.js:60` documents that `--dangerously-skip-permissions` is
used so `claude -p` can edit files non-interactively, but the actual spawn at
line 74 is `spawn('claude', ['-p'], …)` — the flag is missing. A headless run
that tries to use Edit/Write will stall waiting for a permission answer that
can never arrive (stdin is closed right after the prompt), then time out with
no useful output.

**Fix**
- Add the intended flag (`claude -p --dangerously-skip-permissions`) **or**
  update the comment and UX to reflect that maintenance is read-only/plan-mode.
  Given the feature's stated purpose (self-editing this repo), the flag is the
  intended behavior — make it explicit and gate it behind a settings toggle so
  it's an informed choice.
- Surface a clear error in the maintenance log if `claude` exits non-zero
  because of a permission stall.

**Acceptance**: a maintenance request that edits a file completes and lists the
modified files, or fails with an explicit reason.

## 1.1.5 — Remove the dead, unauthenticated legacy server (Medium)

`supervisor.js` at the repo root is the abandoned v0 prototype. It has **no
authentication**, sets `Access-Control-Allow-Origin: *`, exposes
`/api/folders`, and spawns `claude rc` in any folder on an unauthenticated
`POST /api/sessions`. If anyone ever runs `node supervisor.js` (it's the file
the name suggests), they expose full RCE to the whole network.

**Fix**: delete `supervisor.js`, or move it to `legacy/` with a loud header and
remove it from `package.json`'s implied entrypoints. `main` is already
`server/server.js`; the root file is a footgun.

**Acceptance**: no unauthenticated code path can spawn a process or list
folders.

## 1.1.6 — Cookie `secure` / CSRF hardening (Low, design-aware)

`auth.js` sets the session cookie without `Secure` (intentional — no TLS) and
`sameSite: 'lax'`. Given the Tailscale-only model this is acceptable, but:

- Make `Secure` opt-in via env (`SUPERVISOR_TLS=1`) for users who *do* put a
  TLS proxy in front, as the README suggests.
- State-changing endpoints rely on JSON bodies (a cross-site form POST can't
  set `application/json`), which is a decent implicit CSRF barrier, but
  `sameSite: 'lax'` + the power endpoint (which re-checks the password) is the
  only thing standing between a malicious same-site subresource and a POST.
  Consider `sameSite: 'strict'` for the session cookie and a per-session CSRF
  token echoed in a header for mutations. Document the decision either way.

**Acceptance**: documented threat-model note in README; `Secure` togglable.

---

## Suggested commit sequence

1. `paths.js`: hard blocklist for `data/` + `.env`, realpath resolution.
2. `auth.js` + `server.js`: `trust proxy` scoping, global login throttle, key
   versioning on password change.
3. `maintenance.js`: fix/clarify the permissions flag + error surfacing.
4. Remove `supervisor.js`.
5. README: threat-model + `Secure`/CSRF notes.

Each step is independently testable by booting the server and exercising the
relevant endpoint with `curl`.
