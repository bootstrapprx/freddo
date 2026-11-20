# Local cloudflared Compose design

## Intent

Freddo is a local deployer/orchestrator. It should start the `cloudflared` container
using a Compose file and a user-supplied tunnel token. Each site deploy uses the public
FQDN supplied by the operator instead of a `.localhost` hostname. Cloudflare account,
tunnel, DNS, and public-hostname routing remain configured by the operator.

## Approaches

1. **Compose-only tunnel orchestration (chosen):** remove Freddo's Cloudflare API
   client and route provisioning; add a Compose service and local `up`/`down`/`logs`
   tasks. Keep bench creation and Cloudflare Access JWT validation. The tunnel token
   is provided through an ignored local `.env`, referenced by Compose interpolation.
2. **External tunnel management:** remove all Cloudflare tunnel code and require the
   operator to run `cloudflared` separately. This would not meet the request for Freddo
   to orchestrate the container.
3. **Keep API provisioning:** retain account tokens and DNS/ingress mutations. This
   keeps the current workflow that the user asked to remove.

## Goals

- Run the `cloudflared` container locally with the existing Docker/Podman runtime
  selection, attached to Frappe-Manager's external `fm-global-frontend-network` and
  using `http://global-nginx-proxy:80` as the tunnel origin ([Frappe-Manager architecture](https://opensource.rtcamp.com/Frappe-Manager/latest/reference/architecture/)).
- Keep the tunnel token out of tracked Compose and application configuration files;
  Compose reads `CLOUDFLARE_TUNNEL_TOKEN` from the ignored local `.env`.
- Preserve independent Cloudflare Access JWT validation and bench/site deployment at
  the operator-supplied FQDN.
- Remove Cloudflare API credentials, API mutations, tunnel state JSON, and SaaS route
  publication from Freddo.

## Non-goals

- Create or configure Cloudflare tunnels, DNS records, Access policies, or public
  hostname routes. Those remain configured in Cloudflare and must route site FQDNs to
  `http://global-nginx-proxy:80`.
- Change bench creation or the Docker/Podman runtime abstraction.

## Design

- Add a small `deploy/cloudflared.compose.yml` service using the official cloudflared
  image, the external `fm-global-frontend-network`, and
  `tunnel --no-autoupdate run`; set `TUNNEL_TOKEN` from required Compose interpolation
  `${CLOUDFLARE_TUNNEL_TOKEN:?...}` so the token does not appear in process arguments
  ([Cloudflare run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/)).
- Add a `tunnel:compose` task to pass Compose actions (up/down/logs) through to this
  service. It uses the selected Docker or Podman Compose provider and ignored project `.env`.
- Keep `FREDDO_REQUIRE_CLOUDFLARE_JWT`, `FREDDO_CLOUDFLARE_ACCESS_TEAM`, and
  `FREDDO_CLOUDFLARE_ACCESS_AUD`; they protect app login and do not provision the
  tunnel.
- Remove API token/account ID/tunnel name/origin settings, Cloudflare provisioning CLI,
  Cloudflare-specific API deploy tasks, and route publishing. Keep `saas deploy <fqdn>`
  as a local bench/site deploy command; it creates the site at the supplied FQDN and
  does not mutate Cloudflare configuration.
- Update README and `.env.example` to describe local token setup and external route
  configuration. Keep `.env` ignored.

## Constraints and risks

- The token grants the connector access to the Cloudflare tunnel; it stays in the
  ignored local `.env` and must not be printed by task commands.
- Podman requires a Compose provider (`podman compose` provider or `podman-compose`).
- The operator must configure Cloudflare public hostnames for each site FQDN (or a
  wildcard) to the tunnel, with the tunnel origin set to `http://global-nginx-proxy:80`.
- Cloudflare Access JWT validation remains optional/configurable as it is today.

## Open implementation calls

- Use the same `CONTAINER_RUNTIME=auto|docker|podman` selection already used by Freddo.
- Keep `SAAS_DOMAIN` as the required full public FQDN for a site deploy; `fmx` uses it
  as the bench/site hostname and the URL printed after creation is `https://<fqdn>`.
- Keep task names under `tunnel:*`, avoiding the old API-provisioning `cloudflare:*`
  names.
