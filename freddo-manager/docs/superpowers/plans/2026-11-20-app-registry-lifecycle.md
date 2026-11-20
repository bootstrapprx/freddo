# App Registry and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Apps area for persistent repository/release management, safe app tests, deploy selection, and lifecycle operations on existing benches.

**Architecture:** Persist apps and per-Frappe-version releases in the existing SQLite DB. Authenticated API actions queue fixed Executor jobs; the Executor revalidates registry state before constructing commands. App tests use a temporary Frappe-Manager bench with guaranteed cleanup, while existing-bench install/update/uninstall are explicit jobs with backups and operator confirmation.

**Tech Stack:** FastAPI, Pydantic, SQLite/aiosqlite, existing Executor and Frappe-Manager CLI, React, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-11-20-app-registry-lifecycle-design.md`

## Global Constraints

- Manager stays bound to `127.0.0.1`; no Cloudflare API integration.
- Repositories are HTTPS or SSH URLs without embedded credentials; credentials come from the existing Frappe-Manager runtime configuration.
- Only exact passing app releases for the selected Frappe version can appear in Deploy.
- App test suites run only in disposable benches; cleanup is attempted on every exit path.
- App install/update/uninstall are observable Executor jobs; update/uninstall create a backup first.
- Uninstall requires explicit step-up and confirmation naming the app and bench.
- Keep Docker and Podman support through the existing Executor/runtime shim.
- Do not add or run implementation tests; validate with static checks and a production web build. The Apps product itself provides repository and disposable-bench app tests.

## Review Focus

- Invalid, local, credential-bearing, or malformed repository URLs must be rejected before network access.
- A changed URL/ref invalidates old test status and cannot be selected by Deploy.
- A failed app test must still clean its temporary bench and persist a failed result.
- Uninstall must back up first, show the Frappe dry-run impact, and retain source if another site uses it.
- Executor must reject stale, disabled, incompatible, or untested app release IDs even if API input is forged.

---

### Task 1: Persistent app catalog and authenticated API

**Files:**
- Modify: `backend/freddo_manager/db/state.py`
- Modify: `backend/freddo_manager/api/schemas.py`
- Create: `backend/freddo_manager/apps.py`
- Create: `backend/freddo_manager/api/routes/apps.py`
- Modify: `backend/freddo_manager/api/app.py`

**Interfaces:**
- `AppRegistry.list_apps()`, `get_release(app, frappe_version)`, `save_app(...)`, `save_release(...)`, and `record_validation(...)` use the existing StateDB.
- `GET /api/v1/apps` returns app metadata, release refs, compatibility, validation/test state, tested commit, and timestamps; it never returns credentials.
- App mutations require existing authentication and CSRF protection. Archive replaces hard deletion.
- `POST /api/v1/apps/{app}/validate` queues `app.validate` with app/release IDs, never a caller-supplied URL.

- [x] Add `managed_app` and `managed_app_release` tables with unique app package names, HTTPS/SSH URL, enabled/archive state, per-Frappe ref, validation/test state, tested commit, and timestamps.
- [x] Seed `frappe`, `erpnext`, and `hrms` as unverified official repository records without marking any release deployable.
- [x] Add Pydantic validation for Python package names, network URLs, refs, and supported Frappe release identifiers; reject credentials, local paths, query secrets, and unsupported schemes.
- [x] Implement the `AppRegistry` DB methods and authenticated list/create/update/archive/release endpoints.
- [x] Implement validation-job submission and persist job/result metadata without accepting repository URLs from job callers.
- [x] Include the router in `api/app.py`; verify route and schema parsing with Python compilation and Ruff.

### Task 2: Executor validation, isolated app testing, and bench lifecycle jobs

**Files:**
- Modify: `backend/freddo_manager/executor/allowlist.py`
- Modify: `backend/freddo_manager/executor/runner.py`
- Modify: `backend/freddo_manager/executor/server.py`
- Create: `backend/freddo_manager/executor/apps.py`
- Modify: `backend/freddo_manager/config.py` only if app job timeouts need a distinct bound

**Interfaces:**
- Executor app operations accept app/release IDs plus a bench name where required; they resolve URL/ref from SQLite.
- `app.validate`, `app.test`, `app.install`, `app.update`, `app.uninstall.preview`, and `app.uninstall` run through the existing job stream and bench/global locks.
- `app.test` creates a uniquely named temporary bench, runs `bench --site <temp-site> run-tests --app <app>`, and always attempts `fmx delete` in cleanup.
- `app.uninstall` first runs `uninstall-app --dry-run`, creates a backup, then uninstalls; source is removed only if no site in the bench still uses the app.

- [x] Make Executor independently resolve and validate registered release IDs, enabled state, compatibility, test freshness, and tested commit before `bench.create` uses the release.
- [x] Implement repository validation with `git ls-remote` and a bounded timeout; store the resolved commit or a redacted failure result.
- [x] Add a streamed app-test orchestrator that creates the disposable bench, runs the app suite, and attempts deletion in `finally` even after create/test failure or cancellation.
- [x] Add install/update/uninstall orchestration using fixed `fmx`/`bench` argv; quote validated app/site identifiers and never accept arbitrary shell strings.
- [x] Add `app.uninstall.preview` to run the Frappe dry-run and return the impact summary without mutating the site.
- [x] Back up before update/uninstall; require step-up and the exact `app@bench` confirmation for uninstall; persist app test state only when the complete test job succeeds.
- [x] Wire lifecycle operations into JobExecutor's cancellation, timeout, streaming, and lock behavior; verify command rendering and static checks without running bench mutations.

### Task 3: Apps rail and catalog/release management UI

**Files:**
- Modify: `web/src/lib/api.js`
- Modify: `web/src/App.jsx`
- Modify: `web/src/components/Layout.jsx`
- Create: `web/src/pages/Apps.jsx`

**Interfaces:**
- Protected route `/apps` and same-level Apps navigation item.
- Page supports app metadata/repository editing, per-Frappe release refs, enable/archive, repository validation, disposable test jobs, and visible job/test results.
- Mutations invalidate `apps` and `jobs` queries and surface streamed job IDs through the existing Jobs UI.

- [x] Add client methods for catalog CRUD, release CRUD, repository validation, tests, and bench lifecycle actions.
- [x] Add the authenticated Apps route and navigation item beside Deploy, Benches, and Jobs.
- [x] Build app and release forms with clear states for unverified, validation failed, test failed, tested, stale, disabled, and archived.
- [x] Show test commit, compatible Frappe release, last test time, job link, and validation/test output without exposing repository credentials.
- [x] Add per-app existing-bench actions for install, update, test preview, and uninstall confirmation; uninstall must show the dry-run impact before the final action.

### Task 4: Tested-release selection in Deploy

**Files:**
- Modify: `web/src/pages/Deployment.jsx`
- Modify: `backend/freddo_manager/api/schemas.py`
- Modify: `backend/freddo_manager/api/routes/deployment.py`
- Modify: `backend/freddo_manager/executor/allowlist.py`

**Interfaces:**
- Deploy request contains app/release IDs plus Frappe version, not free-form app text or URLs.
- API and Executor both enforce enabled state, exact version compatibility, and passing test for the selected commit.
- `bench.create` receives registry-resolved Frappe Manager app specifications.

- [x] Replace the comma-separated Apps field with a multi-select filtered to tested releases compatible with the chosen Frappe version.
- [x] Submit selected release IDs; reject empty/duplicate/incompatible selections and stale test results at the API boundary.
- [x] Recheck release status in Executor before composing the `fmx create --apps` arguments.
- [x] Preserve the public domain/subdomain behavior and one-time admin password response; show selected app versions in the accepted job summary.

### Task 5: Documentation and delivery review

**Files:**
- Modify: `README.md`
- Modify: `Taskfile.yml` only if app catalog/help commands are added

- [x] Document app registration, release mapping, repository validation, isolated test workflow, existing-bench lifecycle, backup behavior, and private repository runtime credentials.
- [x] Document that app tests never run against existing production benches and cleanup failures need operator attention.
- [x] Run Ruff, Python compilation, Task dry-render where applicable, `npm --prefix web run build`, and `git diff --check`; do not execute app/bench jobs during implementation.
- [x] Review the final diff against the spec and confirm manager remains loopback-only and Docker/Podman paths remain unchanged.
