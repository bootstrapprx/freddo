# In-app domain-bound deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure the existing local tunnel and allowed base domains in freddo-manager, then deploy sites from its UI as subdomains while keeping the manager private.

**Architecture:** Store allowed domains in the existing SQLite state DB and the tunnel token in a protected local env file. The authenticated API validates and persists configuration, while fixed allowlisted operations run cloudflared Compose through the existing Docker-capable Executor. The UI provides domain/tunnel settings and an in-app site deployment form.

**Tech Stack:** FastAPI, Pydantic, SQLite/aiosqlite, existing Unix-socket Executor and Docker Compose, React, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-20-in-app-domain-bound-deploy-design.md`

## Global Constraints

- Keep freddo-manager API bound to `127.0.0.1`; do not route the manager through Cloudflare.
- Do not make Cloudflare API calls or create DNS/hostname routes.
- Initial base domains are `kodoo.online` and `kalkulisto.com.br`.
- Public sites use `<site-label>.<base-domain>` and Cloudflare wildcard routes target `http://global-nginx-proxy:80`.
- The API process must not gain Docker access; only the existing Executor runs tunnel Compose operations.
- The tunnel token must never be returned from API reads or persisted in job args, audit records, or command arguments.
- Retain Docker and Podman compatibility and existing bench operations.
- Do not add or run tests in this task; use static checks and build/dry-run verification only.

## Review Focus

- A forged base domain or invalid label must not escape the configured domain allowlist; validate at the API boundary.
- A tunnel token must not appear in job data, audit details, response payloads, or process arguments; pass it only through the protected env file.
- A failed Compose startup must leave the saved configuration recoverable and report a failed job without exposing the token.
- Removing a configured base domain must not rename or delete existing benches.
- The manager must remain loopback-only while wildcard routes expose only site hostnames through the shared proxy.

---

### Task 1: Persistent domain settings and protected tunnel operations

**Files:**
- Modify: `backend/freddo_manager/db/state.py`
- Modify: `backend/freddo_manager/api/schemas.py`
- Create: `backend/freddo_manager/api/routes/deployment.py`
- Modify: `backend/freddo_manager/api/app.py`
- Modify: `backend/freddo_manager/executor/allowlist.py`
- Modify: `backend/freddo_manager/executor/runner.py`
- Modify: `backend/freddo_manager/executor/server.py`
- Modify: `deploy/cloudflared.compose.yml`

**Interfaces:**
- `GET /api/v1/deployment/config` returns `domains: string[]`, `tunnel_configured: bool`, and no token value.
- `PUT /api/v1/deployment/domains` accepts `domains: string[]`; domains must be normalized valid base domains.
- `PUT /api/v1/deployment/tunnel-token` accepts `token: string`; token input must be a single nonempty line. `DELETE` removes the local token file.
- `POST /api/v1/deployment/tunnel/connect` and `/disconnect` queue `tunnel.up` or `tunnel.down` and return the normal `JobResponse`.
- The `deployment_domains` setting defaults to `kodoo.online` and `kalkulisto.com.br` only on a fresh state DB.
- `$FREDDO_HOME/cloudflared/cloudflared.env` is written atomically, mode `0640`; its directory is group `freddo-tunnel`, and only API/Executor units receive that supplementary group.
- Add only fixed Compose argv for tunnel up/down to `DEFAULT_ARGV_MAP`; commands use the existing runtime shim and never interpolate token values. The Compose definition reads `FREDDO_HOME` from the Executor environment.

- [ ] Add SQLite get/set methods for one JSON domain-list setting and initialize its defaults without overwriting operator changes.
- [ ] Add Pydantic request validation for DNS labels/base domains and a bounded single-line token; reject empty domain sets and duplicate domains.
- [ ] Implement authenticated, CSRF-protected domain, token, and tunnel-action endpoints; audit only changed domain names and whether the token was configured, never the token itself.
- [ ] Implement atomic protected token-file writes under the dedicated group directory, with same-user local development behavior.
- [ ] Extend fixed allowlist operations for `tunnel.up` and `tunnel.down`; permit the `tunnel.` family through Executor IPC, use global locking, and execute the Compose file from the installed project path.
- [ ] Update Compose to load `TUNNEL_TOKEN` from `${FREDDO_HOME}/cloudflared/cloudflared.env` while keeping it out of command arguments.
- [ ] Review serialized job records and audit paths to confirm no token can enter them; run Python AST parsing and `git diff --check`.

### Task 2: Domain settings and in-app site deployment UI

**Files:**
- Modify: `backend/freddo_manager/__main__.py`
- Modify: `web/src/lib/api.js`
- Modify: `web/src/App.jsx`
- Modify: `web/src/components/Layout.jsx`
- Create: `web/src/pages/Deployment.jsx`
- Modify: `backend/freddo_manager/api/routes/deployment.py`
- Modify: `backend/freddo_manager/api/schemas.py`

**Interfaces:**
- `POST /api/v1/deployment/sites` accepts `label`, `base_domain`, `version`, `apps`, and `environment`; it validates the label/domain binding, composes the full FQDN, and queues the existing `bench.create` operation.
- `POST /api/v1/deployment/sites` does not add the generic bench endpoint's `www.<fqdn>` alias.
- Site response uses the existing `JobResponse` shape, including the one-time generated admin password behavior.
- `Deployment` page contains the write-only tunnel token field, editable allowed-domain list, connector connect/disconnect status/actions, and a deploy form with a live FQDN preview.

- [ ] Add API client calls for deployment config, tunnel actions, and site creation.
- [ ] Add a protected `/deployment` route and navigation item.
- [ ] Build the settings form with initial domains, token write-only behavior, saved-state indicator, validation errors, and connect/disconnect job feedback.
- [ ] Build the site form from a label plus configured-domain selector; preview `<label>.<domain>` and submit through the dedicated endpoint.
- [ ] Add the site request schema and route; validate the label and selected configured domain, create the bench with the composed FQDN and no implicit `www` alias, and audit only non-secret deploy metadata.
- [ ] Remove the unrestricted `freddo-manager saas deploy <fqdn>` CLI entry point so public deploys go through configured base-domain validation in the app.
- [ ] Run the web production build and inspect the resulting diff.

### Task 3: Local-only host defaults, preflight, and operator documentation

**Files:**
- Modify: `Taskfile.yml`
- Modify: `deploy/freddo-api.service`
- Modify: `deploy/freddo-executor.service`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- `deploy:preflight` creates the `freddo-tunnel` group idempotently and verifies required accounts/runtime; systemd API and Executor units gain the group explicitly.
- Native deploy defaults `PUBLIC_ORIGIN` and `CORS_ORIGINS` to `http://127.0.0.1:8710`.
- Remove the `saas:deploy` Task and the unrestricted SaaS CLI command; `tunnel:compose` remains a local operator diagnostic/lifecycle fallback.
- README documents one-time wildcard setup for the two domains and confirms the manager hostname is never routed.

- [ ] Add the dedicated tunnel group and runtime Compose-provider checks to `deploy:preflight`, and add the group to both API/Executor systemd units without giving the collector access to it.
- [ ] Change production deploy defaults to the loopback manager origin and matching CORS origin; retain API host binding at `127.0.0.1`.
- [ ] Remove stale CLI-only SaaS steps from README and document in-app setup, wildcard routes, token handling, and Docker operation.
- [ ] Verify `task --list`, dry-run task rendering, API route/source references, AST parsing, frontend build output, and `git diff --check`; do not run tests.
