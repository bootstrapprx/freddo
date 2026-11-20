# Local cloudflared Compose design

## Intent

Freddo is a local deployer/orchestrator. It should start the `cloudflared` container
using a Compose file and a user-supplied tunnel token. Cloudflare account, tunnel,
DNS, and ingress provisioning remain outside Freddo.

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
  selection.
- Keep the tunnel token out of tracked Compose and application configuration files;
  Compose reads `CLOUDFLARE_TUNNEL_TOKEN` from the ignored local `.env`.
- Preserve independent Cloudflare Access JWT validation and bench/site deployment.
- Remove Cloudflare API credentials, API mutations, tunnel state JSON, and SaaS route
  publication from Freddo.

## Non-goals

- Create or configure Cloudflare tunnels, DNS records, Access policies, or ingress
  routes. Those remain configured in Cloudflare.
- Change bench creation or the Docker/Podman runtime abstraction.

## Design

- Add a small `deploy/cloudflared.compose.yml` service using the official cloudflared
  image and `tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN:?...}`.
- Add local task commands to start, stop, and follow this Compose service. Commands
  use the selected Docker or Podman Compose provider and the ignored project `.env`.
- Keep `FREDDO_REQUIRE_CLOUDFLARE_JWT`, `FREDDO_CLOUDFLARE_ACCESS_TEAM`, and
  `FREDDO_CLOUDFLARE_ACCESS_AUD`; they protect app login and do not provision the
  tunnel.
- Remove the API token/account ID/tunnel name/origin settings, Cloudflare provisioning
  CLI, Cloudflare-specific deploy tasks and SaaS route publishing. Bench/site creation
  remains available without publishing DNS or ingress routes.
- Update README and `.env.example` to describe local token setup and external route
  configuration. Keep `.env` ignored.

## Constraints and risks

- The token grants the connector access to the Cloudflare tunnel; it stays in the
  ignored local `.env` and must not be printed by task commands.
- Podman requires a Compose provider (`podman compose` provider or `podman-compose`).
- Cloudflare Access JWT validation remains optional/configurable as it is today.

## Open implementation calls

- Use the same `CONTAINER_RUNTIME=auto|docker|podman` selection already used by Freddo.
- Keep task names under `tunnel:*`, avoiding the old API-provisioning `cloudflare:*`
  names.
