# freddo

FMX control plane e dashboard de FinOps, rodando em Cloudflare Workers com TanStack Start, D1, Drizzle e Better Auth.

## Requisitos

- Node.js 20+ e npm
- Wrangler 4+ (instalado como dev dependency)
- Rust/Cargo e o CLI `fmx` 0.20+ no `PATH` para o daemon `fmx-control`
- Docker ativo no host para provisionar benches e coletar telemetria real

## Setup local

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Edite `.dev.vars` com uma chave aleatória em `BETTER_AUTH_SECRET` e a URL local em `BETTER_AUTH_URL`. O app fica em `http://localhost:5173` por padrão.

O seed de demonstração (nodes, benches, deployments, alocações e configurações) é gravado no D1 na primeira carga de cada usuário autenticado. Ele é idempotente por tabela: se um lote falhar, a próxima carga completa apenas o que falta. Depois disso, as alterações persistem no banco.

## Daemon fmx-control

O Worker não executa `fmx` diretamente. O daemon Rust em `../../fmx-control` roda no mesmo host do Docker e expõe uma API em loopback. Ele detecta `fmx` no `PATH`, executa operações assíncronas com ID/eventos e coleta telemetria com `docker ps`/`docker stats`. O D1 continua sendo a fonte da verdade.

```bash
npm run daemon:build
npm run daemon:dev
```

Variáveis em `.dev.vars` (local) ou `wrangler secret put` (produção):

| Variável | Padrão | Uso |
| --- | --- | --- |
| `FMX_DAEMON_URL` | `http://127.0.0.1:7420` | Endereço HTTP do daemon. |
| `FMX_TELEMETRY_INTERVAL_S` | `15` | Intervalo mínimo entre coletas persistidas. |
| `FMX_DAEMON_TOKEN` | — | Token Bearer exigido pelo daemon nas rotas `/v1`. |

Configuração do daemon: `FMX_BIND`, `FMX_BIN`, `FMX_PROVIDER` (`auto|fmx|mock`), `FRAPPE_MANAGER_HOME`, `FMX_COMMAND_TIMEOUT`, `FMX_HEALTH_TIMEOUT`. Detalhes em `../../fmx-control/README.md`.

Ações da UI chamam comandos reais do Frappe-Manager: `fmx -n create`, `fmx shell <bench> -c "bench --site <site> migrate"`, `fmx -n migrate <bench> --auto-proceed` e `bench set-config -g background_workers N` seguido de `fmx start --reconfigure-workers` e `fmx restart --workers --supervisor`. Não existem `fmx node`, `fmx scale` ou `fmx migrate --bench`.

Se Docker não estiver disponível, o daemon responde `503 DOCKER_UNAVAILABLE`, a telemetria fica marcada como `unavailable` e a UI mostra o estado real — sem números inventados. Os dados de demonstração seguem marcados como `seed (demo)`.

## Banco de dados

O schema Drizzle está em `src/db/schema.js` e as migrações SQL em `drizzle/`.

```bash
npm run db:generate       # gera uma nova migração após alterar o schema
npm run db:migrate:local  # aplica migrações no D1 local
npm run db:migrate:remote # aplica migrações no D1 remoto
```

O binding `DB` está configurado em `wrangler.jsonc`. Antes de publicar, substitua `database_id` pelo ID do seu banco.

## Autenticação

- Email/senha e sessões em cookie via Better Auth.
- TOTP (aplicativo autenticador) em `/mfa`; códigos de recuperação são exibidos na ativação.
- Reset de senha usa `RESEND_API_KEY` e `EMAIL_FROM` quando configurados. Sem eles, o link é apenas logado no terminal — adequado para desenvolvimento, não para produção.

```bash
wrangler secret put BETTER_AUTH_SECRET
wrangler secret put BETTER_AUTH_URL
wrangler secret put RESEND_API_KEY   # opcional em produção
wrangler secret put EMAIL_FROM       # opcional em produção
```

SMS, SSO e provedores sociais estão fora do escopo deste MVP.

## Comandos

```bash
npm run dev            # servidor de desenvolvimento
npm run build          # build de cliente e Worker
npm run lint           # ESLint
npm run daemon:build   # compila o daemon Rust
npm run daemon:dev     # executa o daemon em 127.0.0.1:7420
npm run deploy         # build + wrangler deploy
```

## Estrutura

- `src/routes`: páginas e rotas de API (incluindo `/api/auth/$`).
- `src/lib/server-fns.js`: server functions com validação Zod e checagem de dono.
- `src/db`: schema e cliente Drizzle/D1.
- `src/components`: UI do control plane e telas de autenticação.
- `src/hooks/useControlPlane.jsx`: estado da UI e consultas ao control plane.

Consulte `AGENTS.md` para as convenções de código e segurança.
