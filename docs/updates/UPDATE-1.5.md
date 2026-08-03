# UPDATE 1.5 — Developer experience: tests, linting, CI, error handling

Status: **proposed**
Scope: repo tooling, `server/**`, minimal frontend
Risk: low (additive; no behavior change if done carefully)
Depends on: none, but most valuable *after* 1.1–1.2 so the fixes get regression tests

There is currently **no test suite, no linter, no CI, and no type checking**.
For a project whose headline feature is "let Claude edit its own repo
unattended," an automated safety net is the single highest-leverage
investment: it's what lets the maintenance flow (and human contributors) change
code with confidence.

## 1.5.1 — Unit + integration tests

- Adopt Node's built-in test runner (`node:test` + `node:assert`) — zero new
  prod deps, fits the no-framework ethos.
- Priority coverage (maps to the audit's risk areas):
  - `paths.js`: blocklist, `data/`/`.env` protection (1.1.2), symlink
    resolution (1.1.3), Windows casing/short-names, traversal attempts.
  - `auth.js`: token sign/verify, expiry, tamper rejection, rate-limit
    backoff, `X-Forwarded-For` spoof resistance (1.1.1).
  - `fs-ops.js`: copy/move/unique-dest collisions, trash cap eviction,
    cross-device move fallback, zip-list truncation.
  - `settings.js`: default merge, notifications sub-merge, import allow-listing.
  - A boot smoke test: start the server on an ephemeral port, hit `/login`,
    `/api/auth/me` (401), log in, `/api/system` (200).
- Add `npm test` wired to the runner.

## 1.5.2 — Linting & formatting

- ESLint (flat config) with a small, pragmatic rule set (no-unused-vars,
  no-undef, prefer-const, no-floating-promises via a plugin if wanted).
  Many route handlers `require` `hub`/`settings` and never use them
  (`routes/console.js`, `routes/files.js` import `hub`; `routes/sessions.js`
  imports `hub`) — the linter will catch these dead imports.
- Prettier (or ESLint stylistic) for consistent formatting. Keep the existing
  style (2-space, single quotes, semicolons).

## 1.5.3 — Type safety without a build step

- Add JSDoc `@type` annotations + a `jsconfig.json` with `checkJs: true` so
  `tsc --noEmit` can type-check the CommonJS server without converting to TS or
  adding a bundler. Catches the "`s.proc.stdin` may be null after
  bootRestore" class of bugs statically.

## 1.5.4 — CI

- GitHub Actions workflow: matrix on `ubuntu-latest` + `windows-latest`, Node
  18/20/22. Run `npm ci`, `node --check` on every server file, `npm test`,
  ESLint, and `tsc --noEmit`. This is exactly the harness Claude Code on the
  web / PR automation can gate on.
- Add a `SessionStart` hook (see the `session-start-hook` skill) so web
  sessions self-verify they can run tests/linters.

## 1.5.5 — Error handling & observability

- Centralize server error handling: an Express error middleware that logs with
  a request id and returns a sanitized JSON error (several routes already do
  ad-hoc `try/catch`; unify them).
- Replace scattered `console.warn`/`console.log` with a tiny leveled logger
  (respecting a `SUPERVISOR_LOG` env) so production runs aren't noisy and
  debugging is opt-in.
- Add `process.on('unhandledRejection'|'uncaughtException')` handlers that log
  and (for uncaught) shut down cleanly via the existing `shutdown()` path.

## Acceptance

- `npm test`, `npm run lint`, and `tsc --noEmit` all pass locally and in CI on
  Windows + Linux.
- Regression tests exist for every fix shipped in 1.1 and 1.2.
- A failing test blocks the PR (branch protection / required check).
