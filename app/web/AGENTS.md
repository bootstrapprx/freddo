# AGENTS.md

## Project context

`freddo` is a FMX control plane and FinOps dashboard built with **TanStack Start**, React 19 and plain JavaScript/JSX. It renders on Cloudflare Workers and persists data in Cloudflare D1 through Drizzle ORM. Authentication is handled by Better Auth (email/password + TOTP). Keep changes focused, preserve the conventions below, and write JavaScript/JSX only — the generated `src/routeTree.gen.ts` is the sole TypeScript file and is never hand-edited.

Start with `README.md` for local setup.

## Key files

- `src/routes/__root.jsx`: HTML document (`<html>`, `<head>` via `HeadContent`, `<Scripts />`) and global providers. There is no `index.html`.
- `src/routes/*.jsx`: one page per file (`index.jsx` → `/`, `posts.$id.jsx` → `/posts/$id`). `src/routes/api/*.js` are server routes (raw HTTP endpoints).
- `src/routeTree.gen.ts`: generated on every dev/build run — never edit or commit it manually.
- `src/db/schema.js`: Drizzle schema (auth + control plane). Migrations live in `drizzle/`.
- `src/db/index.js`: `getDb()` wraps the D1 binding from `cloudflare:workers`. Never share a handle across requests.
- `src/lib/server-fns.js`: all `createServerFn` calls, Zod validation and owner checks. Pages never query D1 directly.
- `src/lib/fmxRepo.js`: client-side query options and repository wrappers around server functions.
- `src/lib/auth.js`: Better Auth instance with Drizzle/D1 adapter, email/password, TOTP and TanStack Start cookie integration.
- `src/routes/api/auth/$.js`: Better Auth HTTP handler mounted on `/api/auth/*`.
- `src/lib/auth-middleware.js`: resolves the session into `context.user`; `requireUser` protects server functions, `requireUserRoute` protects server routes.
- `src/lib/AuthContext.jsx`: client session query (`useAuth()`, `authQuery`) resolved on the server and cached in the router's QueryClient.
- `src/lib/authClient.js`: browser Better Auth client plus small wrappers used by the auth pages.
- `src/components/auth/`: login, registration, password reset and TOTP screens.
- `src/routes/_authed.jsx`: login gate for every page under `src/routes/_authed/`.
- `src/hooks/useControlPlane.jsx`: UI state and TanStack Query reads/writes for the control plane.
- `src/components/ui/`: shadcn/ui kit. `src/index.css` + `tailwind.config.js`: design tokens.
- `vite.config.js`: Cloudflare plugin first, then TanStack Start and React. Every runtime dependency is prebundled so a package first imported mid-session cannot load a second React.
- `wrangler.jsonc`: Worker entry, D1 binding and compatibility flags. Secrets are set with `wrangler secret put` and read from `env` in server code.

## Server security

- Every server function and server route is a public HTTP endpoint. A page's `beforeLoad`, redirect or hidden button protects nothing on the server.
- `createCsrfMiddleware` is registered in `src/start.js` for `serverFn` requests; keep it there. Direct curl/API clients must send a same-origin `Origin`, `Sec-Fetch-Site`, or `Referer` header.
- A server function that needs a signed-in caller adds `.middleware([requireUser])` and reads `context.user`. Always check ownership before reading or changing rows (`owner_id` for control-plane tables).
- Validate input with `.validator(...)` (Zod is installed). Never trust ids, emails, roles or free-text values sent by the caller.
- Bound strings, arrays and numbers in credit-spending or write endpoints.
- App pages call the server through server functions, never by fetching their own routes. Server routes are for URLs requested by other services, links, images or webhooks.
- Never forward or log incoming request headers. Secrets belong in Worker secrets, never in `VITE_*` variables or the browser bundle.

## Working notes

- `npm run dev` runs Vite; server code runs in `workerd`, like production.
- `npm run db:migrate:local` applies `drizzle/` to the local D1 database. Use `npm run db:migrate:remote` before deploying a new schema.
- `npm run build` emits `dist/client`, `dist/server` and `.wrangler/deploy/config.json`; none are committed.
- Data flows through the router: `loader` + `Route.useLoaderData()` for reads, server functions + TanStack Query mutations for writes. The QueryClient is created per request in `src/router.jsx`; never share one across requests.
- `ssr: false` only on pages that need a signed-in user and on auth pages; other pages stay SSR'd.
- Server and first client render must match: read `window`, `document` and browser storage only in effects and handlers, and format dates/numbers with an explicit locale and time zone.
- Run `npm run lint` and `npm run build` before finishing code changes.
