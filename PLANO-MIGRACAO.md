# Plano de migração — sair do Base44

Status: **F1 a F6 concluídas e validadas**.
Escopo: substituir dependências, runtime, serviços e referências do Base44 por implementação própria, preservando o produto (FMX Control Plane & FinOps).

Decisões confirmadas: **D1 + Drizzle**, **better-auth**, **email/senha + TOTP**, **execução por fases começando por build/deps**.

## Progresso

- ✅ **F1:** `npm install` (com lockfile), `eslint.config.js` corrigido; conflito de peers das deps de IA resolvido ao removê-las.
- ✅ **F2:** `@base44/*` removidos; plugin e módulo `base44:document` fora do build; middlewares e handler de erro próprios; Worker renomeado `freddo`; favicon e alias `@/` adicionados ao Vite; `.gitignore` limpo; arquivos gerenciados, IA, `app-params`, consent MCP e helpers de imagem do Base44 removidos.
- ✅ **F3:** schema Drizzle e migrações em `drizzle/`; binding `DB` no `wrangler.jsonc`; `getDb()` por request; server functions com Zod e checagem de `owner_id`; `useControlPlane`/`fmxRepo` passaram a ler e gravar no D1. Seed de demonstração idempotente por tabela, com inserção de alocações em lotes para respeitar o limite de 100 bindings por statement do D1; `settings` isolado por usuário (`owner_id`).
- ✅ **F4:** better-auth com `drizzleAdapter`, `twoFactor()` e `tanstackStartCookies()`; rota `/api/auth/*`; middlewares de sessão; Login, Registro, Reset e MFA reescritos. `createCsrfMiddleware` protege as server functions. Sign-up, sign-in, get-session, ativação/verificação TOTP e `twoFactorRedirect` validados por smoke test.
- ✅ **F5:** `AGENTS.md`, README raiz, `app/web/README.md`, `.dev.vars.example` e `.gitignore` reescritos; fluxos sem equivalente removidos; nenhuma dependência ou reference ao Base44 permanece no código-fonte.
- ✅ **F6:** `npm run lint` e `npm run build` passando; D1 local validado com seed completo, reload autenticado e escrita real (`createNodeFn`) persistida; varredura final sem resultados fora deste plano histórico.
- F1/F2 foram commitadas pelo usuário em `a4a8a37`. F3/F4/F5 permanecem no working tree.

---

## 1. Stack identificado

| Camada | Tecnologia | Origem |
| --- | --- | --- |
| App | React 19, JavaScript/JSX (sem TypeScript), Vite 8 | independente do Base44 — **manter** |
| Roteamento/SSR | TanStack Start + Router + Query + `ssr-query`, render no Cloudflare `workerd` | independente — **manter** |
| UI | Tailwind 3, shadcn/ui (Radix), lucide, sonner, framer-motion | kit compartilhado com o template Base44, mas código local — **manter** |
| Deploy | `@cloudflare/vite-plugin` + `wrangler`, entry `src/server.js` | infraestrutura própria — **manter**, só renomear |
| Dados | 6 esquemas em `entities/*.jsonc` (FmxNode, FmxBench, FmxDeployment, FmxCostAllocation, FmxSettings, User) + `src/lib/fmxRepo.js` | **Base44** (entity store + RLS) — substituir |
| Auth | `@base44/sdk`, `/api/apps/<id>/auth/*`, `/auth/mfa`, `/oauth/consent`, `base44_access_token` | **Base44** — substituir |
| Build | `@base44/vite-plugin`, módulo virtual `base44:document`, `VITE_BASE44_*`, PREBUNDLE de transports do SDK | **Base44** — remover |
| Erros | `src/server.js`, `src/lib/error-capture.js`, `error-capture.server.js` (“managed files”, `_b44_error`, header `x-b44-feed-context`) | **Base44** — remover/substituir |
| IA | `@tanstack/ai*` + `gatewayModel()` via `asServiceRole.aiGateway` | **Base44**; sem uso real no app hoje — remover ou trocar por chave própria |
| Documentação | `AGENTS.md`, `CLAUDE.md`, `.gitignore`, nome do Worker | **Base44** — reescrever |

### Estado atual do snapshot (antes da migração)
- `src/api/` e `src/hooks/` estão **vazios**, mas `src/routes/_authed/index.jsx` importa `@/hooks/useControlPlane` e 9 arquivos importam `@/api/base44Client` → o projeto **não compila** hoje.
- `node_modules/` ausente, sem lockfile. `npm install` falha com conflito de peers entre `@tanstack/ai@0.54` e `@tanstack/ai-openai@0.22` (alias removido na F2 por não ser usado).
- `eslint.config.js` não existe; o arquivo se chama `estilint.config.js` (typo) → `npm run lint` falha. Corrigido na F1.
- Outras importações locais quebradas: `@/hooks/use-mobile` (sidebar), `../../hooks/use-size` (use-responsive-image), `@/components/ui/sonner` (o arquivo é `sooner.jsx`). `ConsentPage.jsx` e `ai.server.js` não têm importadores.
- Nenhuma chamada de dados real: a UI usa `fmxSample.js`. O `blueprint.jsx` descreve o daemon Rust pretendido (axum + SQLite em `127.0.0.1:7420`) como destino final.

---

## 2. Inventário de acoplamento

| Arquivo | Acoplamento | Ação |
| --- | --- | --- |
| `package.json` | `@base44/sdk`, `@base44/vite-plugin` | remover; adicionar pacotes da arquitetura-alvo |
| `vite.config.js` | plugin `base44()`, `base44:document`, `SDK_TRANSPORTS`, nomes em comments | remover plugin e ajustar PREBUNDLE |
| `wrangler.jsonc` | `name: base44-tanstack-app` | renomear para `freddo`; adicionar binding do banco |
| `src/start.js` | `authMiddleware`, `base44RequestMiddleware`, middlewares de erro gerenciados | trocar por middlewares próprios (auth + logging) |
| `src/server.js` + `src/lib/error-capture*.js` | reporting `_b44_error` | substituir por handler padrão + `console.error`/Sentry |
| `src/lib/auth-middleware.js` | `createClientFromRequest`, `getAccessToken`, `context.getBase44()`, `requireUser(Route)` | reimplementar com verificação de sessão própria; manter contrato `context.user` |
| `src/lib/AuthContext.jsx` | `base44.auth.hasToken/me/logout/redirectToLogin` | trocar por cliente de sessão próprio; manter `authQuery`, `useAuth()` e a gate |
| `src/lib/app-params.js` | `VITE_BASE44_*`, `getAccessToken()`, `base44_access_token` | eliminar; substituir por config pública (`VITE_APP_URL`) |
| `src/lib/authMfa.js`, `authMfaFlow.js` | `/api/apps/<id>/auth/*`, `/api/apps/public/login-info`, `/auth/mfa`, `setToken` | reescrever contra o-provider de auth escolhido |
| `src/components/auth/*.jsx` (14 arquivos) | login/registro/OTP/reset/MFA/consent MCP | adaptar fluxos; remover `ConsentPage` e `UserNotRegistered` se o provider não tiver equivalente |
| `src/lib/fmxRepo.js` | `base44.entities.*.filter/create` | reescrever como repositório sobre server functions + banco |
| `entities/*.jsonc` | esquemas com RLS `created_by_id` / `user_condition` | converter para schema Drizzle/SQL + regras de acesso no servidor |
| `src/routes/__root.jsx` | `Base44Scripts`, `data-react-root`, comentário de logo | remover scripts e atributo; adicionar favicon próprio |
| `src/lib/ai.server.js` | `asServiceRole.aiGateway.connection()` | remover com as deps de IA (ou chave própria) |
| `src/components/ui/image*.js*`, `image-helpers.js` | `media.base44.com`, eventos `base44:image-replace`, `data-base44-image` | remover se não usados; usar `<img>` local |
| `AGENTS.md`, `CLAUDE.md`, `.gitignore`, README | documentação da plataforma, `base44 link` | reescrever para o projeto novo |
| Comentários espalhados | “plataforma”, “managed”, “builder” | limpar na passada final |

> As diretrizes do `AGENTS.md` atual (“nunca editar arquivos gerenciados”, “use a CLI base44”, “não defina rotas em /api/apps/**”) são específicas da plataforma de origem e **deixam de valer** após a migração. Os padrões TanStack/JS/SSR permanecem.

---

## 3. Arquitetura-alvo (confirmada)

**Stack escolhida, mantendo o que já funciona:**

- **Frontend/SSR:** TanStack Start em Cloudflare Workers (inalterado).
- **Persistência:** Cloudflare **D1 (SQLite)** com **Drizzle ORM**; schemas derivados de `entities/*.jsonc`, migrações versionadas em `drizzle/`, `WRANGLER_D1_DB` via binding.
- **Camada de dados:** `src/lib/server-fns.js` com `createServerFn` + validação Zod + `requireUser`; `fmxRepo.js` vira repositório tipado (list/create para nodes, benches, deployments, alocações, settings). Regras de “dono/admin” dos JSONC passam a ser checagens explícitas no servidor (`owner_id`, papel).
- **Auth:** **better-auth** (email/senha, sessão em cookie, TOTP/MFA, reset por email e OAuth opcional) com adapter Drizzle/D1. Mantém a gate `_authed`, `useAuth()` e as telas existentes, trocando apenas as chamadas de rede. MCP consent é removido (não há MCP próprio hoje).
- **Hook faltante:** implementar `src/hooks/useControlPlane.jsx` com TanStack Query sobre as server functions, preservando a API usada pela página (`nodes`, `benches`, `tree`, `costs`, `addNode`, `addBench`, `runMigration`, etc.) e mantendo `fmxSample.js` apenas como fallback de demo explícito.
- **IA:** remover `@tanstack/ai*` e `ai.server.js` (não há feature de IA no app). Se o usuário quiser IA depois, usar `OPENAI_API_KEY` via secrets do Worker.
- **Erros:** remover os 3 arquivos gerenciados; manter middlewares de request/function apenas para auth, com `console.error` estruturado.
- **Imagens:** remover os helpers específicos do Base44 e favicon estático em `public/`.
- **Nomenclatura/docs:** Worker `freddo`, README com setup local (`npm install`, `wrangler d1 migrations apply`, `npm run dev`), `AGENTS.md` reescrito sem menções à plataforma antiga.

**Alternativas descartadas:** backend Node/Postgres, Supabase (Auth+DB) e integração direta com o daemon Rust local. Daemon Rust segue apenas como blueprint/documentação do produto, não como backend do app web.

---

## 4. Plano de execução (fases)

**F0 — Decisões (esta etapa)**
- Confirmar persistência, provider de auth, hosting e se MFA/OAuth fazem parte do MVP.

**F1 — Baseline e higiene**
- `npm install`; corrigir `estilint.config.js` → `eslint.config.js`; garantir lint/build atuais (criando os dois arquivos ausentes apenas como stubs temporários, se necessário para medir o baseline).
- Registrar o que já falha hoje para não confundir com regressão da migração.

**F2 — Desacoplamento de build e runtime**
- Remover `@base44/*` do `package.json` e do `vite.config.js`; excluir `base44:document`, `SDK_TRANSPORTS`, variáveis `VITE_BASE44_*`.
- Reescrever `src/start.js`, `src/server.js`; deletar `src/lib/error-capture*.js`; trocar middlewares em `auth-middleware.js`.
- Renomear Worker, limpar `.gitignore` e `__root.jsx` (sem `Base44Scripts`/`data-react-root`).

**F3 — Dados e persistência — ✅ concluída**
- Gerar schema/migrações D1 a partir dos 6 JSONC (incluindo `created_by_id`, `role`).
- Reescrever `fmxRepo.js` e criar `server-fns.js` com Zod + `requireUser`.
- Implementar `useControlPlane.jsx` e endotar o seed `fmxSample.js` via migração/seed script.
- Validar que `/` renderiza nós/benches/deployments/alocações/settings vindos do banco local.

**F4 — Autenticação — ✅ concluída**
- Instalar/configurar o provider escolhido; tabelas de usuário/sessão/conta; migrar `AuthContext.jsx`, `AuthGate.jsx`, `authMfa*.js`, páginas de login/registro/reset/MFA.
- Remover fluxos sem equivalente (consent MCP, “usuário não registrado” da plataforma, login-info `by-id`, redirecionamentos `/auth/mfa`).
- Garantir `returnTo` seguro e testar sign-up → login → logout → reset → MFA.

**F5 — Limpeza final de referências — ✅ concluída**
- Remover helpers de imagem/IA, deps de template não usadas (Stripe, Leaflet, Three, etc., após confirmar imports), e comentários/docs.
- Reescrever `AGENTS.md`, `CLAUDE.md`, README e `.env.example`.
- Rodar `grep -ri base44 .` e `grep -ri "_b44\|x-b44" .` até não haver resultados no código-fonte.

**F6 — Validação e entrega — ✅ concluída (commits F3/F5 pendentes)**
- `npm install`, `npm run lint`, `npm run build`, `npm run dev` + smoke test das rotas `/`, `/login`, `/blueprint`.
- Verificar que nenhum segredo vai para o bundle do browser.
- Commit único por fase, com o diff revisado.

---

## 5. Critérios de aceite

1. `grep -riE 'base44|_b44|x-b44' app/web --exclude-dir=node_modules` retorna **0 resultados** fora deste plano e do histórico do Git.
2. `npm run lint` e `npm run build` passam do zero.
3. Login/cadastro/logout/reset/MFA funcionam sem URLs `/api/apps/**` ou `/auth/mfa` da plataforma antiga.
4. Dados do control plane persistem entre recarregamentos em D1 local.
5. README documenta setup, variáveis de ambiente e deploy sem CLI do Base44.
6. Nenhuma dependência `@base44/*` ou módulo `base44:*` no bundle.

---

## 6. Decisões confirmadas

1. **Persistência:** D1 + Drizzle.
2. **Auth:** better-auth.
3. **MVP de auth:** email/senha + TOTP; SMS, SSO e providers sociais fora do escopo inicial.
4. **IA:** remover dependências e `ai.server.js` (sem feature de IA no app).
5. **Estratégia:** execução por fases, começando por build/deps (F1 → F2 → F3 → F4 → F5 → F6).
