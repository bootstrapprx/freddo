# In-app domain-bound site deployment

## Intent

Keep freddo-manager as a host-local control panel. Let its authenticated UI configure the
existing Cloudflare Tunnel token and the operator's site domains, then create sites from
the app under those domains. The operator named `kodoo.online` and `kalkulisto.com.br`.

## Approaches

1. **Local token and domain binding (chosen):** Freddo stores the existing connector token
   in a protected local file, manages allowed base domains in its own state, and uses the
   existing privileged Executor to run the local Compose service and create benches. The
   tunnel's public hostnames remain configured once in the Cloudflare dashboard.
2. **Cloudflare API management:** Freddo would create or mutate public hostname/DNS routes.
   This is rejected because it gives Freddo Cloudflare account permissions and puts it in
   Cloudflare resource provisioning, which the operator explicitly does not want.
3. **Host-only configuration:** Keep the token in `.env` and use Task commands. This is
   insufficient because tunnel and domain binding should be configured in the app UI.

## User-visible behavior

- The Freddo Manager API remains bound to `127.0.0.1`; its local origin defaults to
  `http://127.0.0.1:8710`. No public hostname is routed to the manager.
- An authenticated Tunnel/Domains settings view accepts the existing tunnel token and
  manages the allowed base domains. The initial entries are `kodoo.online` and
  `kalkulisto.com.br`. The token is write-only in the UI; reads return only whether it is
  configured.
- The site deployment view asks for a site label and one configured base domain, previews
  the resulting FQDN, and submits the existing bench creation job with that complete FQDN.
  A label such as `erp` under `kodoo.online` creates `erp.kodoo.online`.
- Saving the token stores it locally; the **Conectar** action starts or updates the
  `cloudflared` Compose service through the Executor. Bench creation stays in the existing
  allowlisted job path. The first site must exist before connecting because it creates the
  external network.
- Keep existing Docker behavior and Docker Compose as the server runtime; do not remove
  Podman compatibility already provided by the project.

## Routing and security boundaries

- The existing remote-managed tunnel is not created or edited by Freddo. In the Cloudflare
  dashboard, configure wildcard public hostnames for `*.kodoo.online` and
  `*.kalkulisto.com.br` to the existing tunnel, with origin `http://global-nginx-proxy:80`.
  These routes expose created sites through the shared Frappe-Manager proxy only.
- Keep the manager's API listener on loopback and do not add it to the tunnel's public
  hostname routes. Cloudflare Access JWT remains available as defense in depth, but does
  not make a public manager route part of this feature.
- The API process remains without Docker access. It stores the tunnel token in
  `$FREDDO_HOME/cloudflared/cloudflared.env`, mode `0640`, in a directory owned by the
  dedicated `freddo-tunnel` group. The API and Executor can access it; the collector cannot
  access the file or directory. The token is never returned by
  GET endpoints, inserted in job arguments/audit entries, or printed in Compose command
  arguments. A dedicated group keeps the collector out of this file's access boundary.
- The Executor receives only fixed tunnel lifecycle operations. Domain and site labels are
  validated at the API boundary, and the requested base domain must be in the configured
  allowlist.

## Scope

- Add persistent site-domain configuration and a protected tunnel-token storage path.
- Add authenticated API endpoints for reading/saving tunnel status and managing base
  domains, plus fixed Executor operations for starting/restarting/stopping the connector.
- Add an in-app deployment view and replace the free-form public domain field in that flow
  with a site label plus configured base-domain selection.
- Update Taskfile preflight/install units for the narrow token file access group and use a
  loopback manager origin by default.
- Update README with the one-time Cloudflare wildcard setup and local-only manager access.
- Preserve current Frappe-Manager bench creation, access JWT validation, Docker/Podman
  runtime support, and existing local bench operations.

## Non-goals

- Cloudflare API calls, DNS record creation, Tunnel resource creation, or per-site public
  hostname mutation.
- Publishing freddo-manager on either customer domain.
- Replacing the existing bench executor, adding a new container engine dependency, or
  changing Frappe-Manager's shared reverse proxy.

## Open implementation details

- Use the existing SQLite state database for the base-domain list and an atomic,
  mode-restricted local file for the token so the API can configure it while the Executor
  can consume it without giving Docker access to the API.
- Keep the existing tunnel Compose definition and move its token source to the protected
  file written by the app.
- Add a dedicated `freddo-tunnel` system group to the API and Executor units only; the
  pre-flight doctor creates the group and repairs membership/permissions idempotently.
- Create a small focused API/UI surface instead of changing the generic bench API contract
  for other local benches.
