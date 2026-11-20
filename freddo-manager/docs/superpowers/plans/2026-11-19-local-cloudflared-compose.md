# Local cloudflared Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freddo locally deploys sites at operator-supplied FQDNs and orchestrates one Cloudflare Tunnel connector container without provisioning Cloudflare resources.

**Architecture:** A Compose service runs `cloudflared` with the tunnel token interpolated from the ignored project `.env` and joins Frappe-Manager's external `fm-global-frontend-network`. The operator configures Cloudflare public hostnames to the tunnel and its origin to `http://global-nginx-proxy:80`; Freddo's `saas deploy <fqdn>` starts the connector and creates a bench at that FQDN.

**Tech Stack:** Python CLI/Settings, Taskfile, Docker Compose or Podman Compose, YAML.

**Spec:** `docs/superpowers/specs/2026-11-19-local-cloudflared-compose-design.md`

## Global Constraints

- Keep Docker and Podman runtime selection (`auto|docker|podman`).
- Keep the Cloudflare tunnel token out of tracked files; Compose requires `CLOUDFLARE_TUNNEL_TOKEN` from the ignored `.env`.
- Do not call the Cloudflare API or mutate tunnels, DNS, ingress, or Access configuration.
- Preserve Cloudflare Access JWT validation independently of tunnel orchestration.
- Public site creation uses a full FQDN supplied by the operator; the FQDN is the Frappe-Manager bench/site hostname.
- Cloudflared joins external network `fm-global-frontend-network`; tunnel origin is `http://global-nginx-proxy:80`.

## Review Focus

- Missing tunnel token: Compose must fail before starting a container; interpolation requires a non-empty token.
- Missing external network: Compose should report the missing Frappe-Manager network without creating a conflicting network.
- Podman without a Compose provider: the task should surface provider failure without falling back to Docker.
- Invalid or local-only hostname: SaaS deploy must reject non-FQDNs before invoking `fmx`.
- Failed bench creation: do not start the tunnel for this attempt. If tunnel startup fails after bench creation, report that the site exists but is not reachable through Cloudflare yet.

---

### Task 1: Replace Cloudflare API provisioning with local Compose orchestration

**Files:**
- Create: `deploy/cloudflared.compose.yml`
- Modify: `Taskfile.yml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Compose requires `${CLOUDFLARE_TUNNEL_TOKEN:?Set CLOUDFLARE_TUNNEL_TOKEN in .env}`, passes it as `TUNNEL_TOKEN`, and runs `cloudflare/cloudflared:latest` with `tunnel --no-autoupdate run` so the token is not a process argument.
- Compose attaches the service to external network `fm-global-frontend-network`.
- Add `task tunnel:compose -- <compose-args>` to select Docker Compose or Podman Compose using `CONTAINER_RUNTIME` and pass the ignored `.env` explicitly.
- Change `saas:deploy` to invoke the local FQDN deploy CLI first (so `fmx` creates its external network), then call `task tunnel:compose -- up -d`; remove Cloudflare API token/account requirements.

- [ ] **Step 1: Add `deploy/cloudflared.compose.yml`** with one restartable `cloudflared` service, `TUNNEL_TOKEN` environment interpolation (never a command argument), and the external Frappe-Manager network.
- [ ] **Step 2: Add `task tunnel:compose`** that selects Docker or Podman Compose according to `CONTAINER_RUNTIME` (`auto` prefers Docker only when its socket is present; otherwise Podman when installed), passes `--env-file .env`, and forwards `CLI_ARGS`.
- [ ] **Step 3: Update `saas:deploy`** to require `SAAS_DOMAIN`, invoke `freddo-manager saas deploy "$SAAS_DOMAIN"`, then start the tunnel Compose service without Cloudflare API credentials. This order lets `fmx` create `fm-global-frontend-network` before Compose attaches to it.
- [ ] **Step 4: Update `.env.example`** with an empty `CLOUDFLARE_TUNNEL_TOKEN` entry and remove tunnel API token/account/name/origin variables while retaining Cloudflare Access JWT settings.
- [ ] **Step 5: Update README** with `.env` setup, tunnel lifecycle command examples, and Cloudflare dashboard setup: public FQDN or wildcard route to the tunnel, origin `http://global-nginx-proxy:80`.
- [ ] **Step 6: Check task and Compose rendering** with `task --list`, `task --dry tunnel:compose -- up -d`, and `git diff --check`.

### Task 2: Remove Cloudflare API code and keep FQDN site deployment

**Files:**
- Modify: `backend/freddo_manager/__main__.py`
- Modify: `backend/freddo_manager/config.py`
- Delete: `backend/freddo_manager/cloudflare.py`
- Delete: `tests/test_cloudflare.py`
- Modify: `README.md`

**Interfaces:**
- Keep `freddo-manager saas deploy <fqdn> --apps ... --admin-password ... --environment ...` as a local bench creation command.
- Normalize and validate the FQDN with the existing `DOMAIN_RE` in `executor.allowlist`; create the bench with that FQDN and its `www.<fqdn>` alias.
- Keep `require_cloudflare_jwt`, `cloudflare_access_team`, and `cloudflare_access_aud` Settings; remove only tunnel provisioning Settings and CLI.

- [ ] **Step 1: Simplify `_saas_deploy`** to validate/normalize the FQDN locally, call the existing `JobExecutor` `bench.create`, and print the site's HTTPS URL and generated admin password; remove route and Cloudflare client handling.
- [ ] **Step 2: Remove `cloudflare` CLI parsers/dispatch** (`setup|status|add|remove|sync`) and remove `--no-route` from `saas deploy`.
- [ ] **Step 3: Remove tunnel provisioning fields and validator** from `Settings`, retaining Cloudflare Access JWT fields.
- [ ] **Step 4: Delete the API provisioning module and its obsolete tests**; keep the shared HTTP dependency if still used elsewhere (it is not removed by this change).
- [ ] **Step 5: Remove stale Cloudflare API and route commands from README**, retaining Cloudflare Access guidance and documenting that Cloudflare hostnames must match the FQDN passed to `saas deploy`.
- [ ] **Step 6: Check task/CLI help and source references** with `freddo-manager --help`, `freddo-manager saas deploy --help`, `rg -n 'CloudflareClient|cloudflare setup|FREDDO_CLOUDFLARE_API_TOKEN|FREDDO_CLOUDFLARE_ACCOUNT_ID'`, and `git diff --check`.
