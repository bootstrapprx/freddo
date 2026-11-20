# freddo-manager

Console web de **host único** para operar distribuições Frappe/ERPNext gerenciadas pelo
[Frappe-Manager](https://github.com/rtcamp/frappe-manager) (`fmx`), com telemetria própria.

Implementação do `frappe-console-spec.pdf`. Os projetos `app/web`, `frappeops`, `fmx-control`,
`musical-lamp` e `Frappe-Manager` foram usados **apenas como referência**; este é um app novo,
com nome distinto para não confundir com as tentativas abandonadas.

## Arquitetura

```
Browser --HTTPS--> Cloudflare Tunnel/Access --> API (FastAPI, sem acesso ao runtime)
                                                  | Unix socket + SO_PEERCRED
                                                  v
                                            Executor (fmx / docker|podman compose)
                                                  |
                                          Docker Engine ou Podman + arquivos do fm
```

| Componente | Tecnologia | Papel |
| --- | --- | --- |
| Web | React + Vite + TanStack Query + shadcn/ui + uPlot + xterm.js | UI, gráficos, logs SSE e terminal |
| API | FastAPI + Uvicorn + Pydantic | auth, validação, jobs, leitura de estado, SSE/WS |
| Executor | Python asyncio, Unix socket | único processo que invoca `fmx`/Docker (allowlist) |
| Coletor | psutil + CLI Docker/Podman + HTTP + TLS | métricas, rollups e alertas |
| Estado | SQLite WAL (`state.db`) | usuário, sessões, jobs, audit, templates, alertas |
| Telemetria | SQLite (`telemetria.db`) | séries, amostras e rollups (5 min / 1 h) |

O painel **nunca** replica o estado do runtime de forma autoritativa: cada leitura consulta
`fmx list` / `fmx info`, labels Compose e `<runtime> ps --format json`.

## Instalação (desenvolvimento)

Requer Python 3.12+ e Node 22+.

```bash
cd freddo-manager
uv venv .venv && uv pip install -e '.[dev]'
source .venv/bin/activate

# solicita a raiz dos benches (sugestão: ~/frappe), salva em
# $FREDDO_HOME/config.json e cria a credencial única + TOTP
freddo-manager bootstrap

# opcional: trocar a raiz depois
freddo-manager configure

# sobe a stack usando o FM_HOME salvo (env FREDDO_FM_HOME tem precedência)
freddo-manager serve

# inspeciona o runtime detectado (Docker ou Podman)
freddo-manager runtime
```

Em outro terminal:

```bash
cd web && npm install && npm run dev
```

Abra `http://localhost:5173`. A API fica em `http://127.0.0.1:8710/api/v1`.

### Produção (systemd + Cloudflare Access)

O caminho recomendado é `task deploy`: ele cria as contas `freddo-api` e
`freddo-collector`, os diretórios com dono/permissões corretos, copia o código, gera os
`.env` com o uid/gid reais da conta da API, cria a credencial (senha digitada no terminal)
e instala/reinicia os units. O usuário dono dos benches (`EXEC_USER`, padrão `freddo`) deve
existir antes; em hosts Docker ele precisa pertencer ao grupo `docker`.

```bash
task verify
task deploy FM_HOME=/home/freddo/frappe PUBLIC_ORIGIN=https://console.seudominio.com \
  EXECUTOR_UID=$(id -u freddo-api) EXECUTOR_GID=$(id -g freddo-api)
```

Para bootstrap sem segundo fator, passe `--no-totp`:
`task deploy:bootstrap -- --no-totp --force`. Para instalação manual, os passos
equivalentes estão em [`Taskfile.yml`](Taskfile.yml) (`deploy:prereq`, `deploy:files`,
`deploy:env`, `deploy:bootstrap`, `deploy:units`).

O Executor roda como dono dos benches (grupo `docker` em hosts Docker); a API roda como
`freddo-api`, sem acesso ao runtime, e só consegue falar com o socket graças ao
`SO_PEERCRED` + uid/gid configurados. O coletor roda em conta separada com acesso somente
de leitura aos containers. A API também serve o build de `web/dist` quando ele existe.

### Podman

Em hosts Podman, não instale o pacote `docker` nem crie o grupo `docker`. A compatibilidade
é automática: `freddo-manager runtime` mostra `kind: podman`, o socket usado e cria um shim
`docker -> podman` em `$FREDDO_HOME/runtime-bin`. Esse diretório é injetado no `PATH` do
Executor, e `CONTAINER_HOST`/`DOCKER_HOST` apontam para o socket do Podman — isso evita a
mensagem de "docker ausente/grupo docker" emitida pelo próprio `fmx`.

Antes de iniciar os units, habilite o socket rootless para o usuário dono dos benches:

```bash
sudo loginctl enable-linger freddo
sudo -u freddo systemctl --user enable --now podman.socket
```

No `executor.env` e no `collector.env` daquele host:

```env
FREDDO_CONTAINER_RUNTIME=podman
XDG_RUNTIME_DIR=/run/user/<uid-de-freddo>
FREDDO_PODMAN_SOCKET=/run/user/<uid-de-freddo>/podman/podman.sock
```

Remova `SupplementaryGroups=docker`, `Wants=docker.service` e `After=docker.service` dos
units nesse host. Para um socket rootful, use `/run/podman/podman.sock` com
`podman system service --time=0 unix:///run/podman/podman.sock` habilitado via systemd.

Unit files de exemplo em [`deploy/`](deploy/). A API escuta apenas em `127.0.0.1`; o acesso
externo passa por Cloudflare Tunnel + Cloudflare Access. Defina
`FREDDO_REQUIRE_CLOUDFLARE_JWT=1`, `FREDDO_CLOUDFLARE_ACCESS_TEAM=<team>` e
`FREDDO_CLOUDFLARE_ACCESS_AUD=<aud>` para validar o JWT do Access além da sessão local.

### Cloudflare Tunnel + deploy de SaaS

O provisionamento do túnel é idempotente e usa o modo **remote-managed**: um API token da
Cloudflare (permissões `Account > Cloudflare Tunnel: Edit` e `Zone > DNS: Edit`) cria ou
recupera o túnel, grava o token dele em `$FREDDO_HOME/cloudflare.json` (`0600`), publica os
CNAMEs proxied (`<tunnel-id>.cfargotunnel.com`) e a configuração de ingress no hostname
público → `127.0.0.1:8710`. Por fim instala o serviço `cloudflared` com esse token.
Nenhum segredo é escrito em units, `.env` ou no repositório.

Pré-requisitos: `cloudflared` instalado no host, domínio com nameservers na Cloudflare e
`FREDDO_CLOUDFLARE_API_TOKEN` / `FREDDO_CLOUDFLARE_ACCOUNT_ID` no ambiente do operador.

```bash
# cria/recupera túnel + serviço + rotas dos benches já existentes
task deploy:cloudflare

# estado real do túnel (connections, status, hostnames)
task cloudflare:status

# cria o bench E o site efetivo via Executor, depois publica a rota
SAAS_DOMAIN=cliente.exemplo.com task saas:deploy -- --apps erpnext hrms

# sincroniza rotas com os benches reais (remove rotas obsoletas)
FREDDO_HOME=/var/lib/freddo-manager freddo-manager cloudflare sync
```

O comando `saas deploy` usa o mesmo `JobExecutor` allowlistado da API (nenhum shell) e
imprime **uma vez** a senha administrativa gerada para o site. O nome do bench é o FQDN do
cliente; `www.<fqdn>` é registrado como alias. O site real criado pelo `fmx` em
`workspace/frappe-bench/sites` passa a aparecer em `sites` no `GET /api/v1/benches` —
o painel não inventa sites: se o diretório não existe, a lista é vazia.

Os papéis continuam separados: a API permanece sem acesso ao runtime; o CLI de deploy é
executado no host como o usuário dono dos benches, usando o mesmo Executor e a mesma
auditoria. O túnel termina TLS na Cloudflare, então a origem é HTTP em loopback — não é
necessário emitir certificado Let's Encrypt com `fmx ssl add` nesse cenário.
Para proteger o console com Access além da sessão local, configure o aplicativo
do Access para o hostname do túnel e os env `FREDDO_REQUIRE_CLOUDFLARE_JWT`,
`FREDDO_CLOUDFLARE_ACCESS_TEAM` e `FREDDO_CLOUDFLARE_ACCESS_AUD`.

## Configuração

Todas as opções usam o prefixo `FREDDO_` (veja [`backend/freddo_manager/config.py`](backend/freddo_manager/config.py)):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `FREDDO_HOME` | `~/.local/state/freddo-manager` | raiz dos bancos, socket e segredos |
| `FREDDO_FM_BIN` | `fmx` | binário do Frappe-Manager (`fm` está deprecado) |
| `FREDDO_FM_HOME` | solicitado no bootstrap | `FRAPPE_MANAGER_HOME`; sobrescreve `$FREDDO_HOME/config.json` |
| `FREDDO_CONTAINER_RUNTIME` | `auto` | `auto`, `docker` ou `podman` |
| `FREDDO_DOCKER_SOCKET` | `/var/run/docker.sock` | socket do Docker |
| `FREDDO_PODMAN_SOCKET` | detectado | socket do Podman (`XDG_RUNTIME_DIR`, `/run/user/$UID` ou `/run/podman`) |
| `FREDDO_ENABLE_SHELL` | `0` | terminal web (desligado por padrão) |
| `FREDDO_CLOUDFLARE_API_TOKEN` | — | token com escopo Tunnel (Account) + DNS (Zone) |
| `FREDDO_CLOUDFLARE_ACCOUNT_ID` | — | account ID da Cloudflare |
| `FREDDO_CLOUDFLARE_TUNNEL_NAME` | `freddo-manager` | nome do túnel remote-managed |
| `FREDDO_CLOUDFLARE_ORIGIN` | `http://127.0.0.1:8710` | origem local do ingress (loopback) |
| `FREDDO_ARGV_MAP` | — | **caminho** para JSON com templates de argv do `fmx` |
| `FREDDO_CATALOG` | — | **caminho** para JSON com `versions` e `apps` permitidos |
| `FREDDO_ALERT_WEBHOOK_URL` | — | canal webhook/email dos alertas |
| `FREDDO_TELEGRAM_TOKEN` / `FREDDO_TELEGRAM_CHAT` | — | canal Telegram |

## Taskfile

O [`Taskfile.yml`](Taskfile.yml) automatiza instalação, validação e deploy. Requer
[go-task](https://taskfile.dev/) (`task --version` deve mostrar 3.x). Nesta máquina
ele está instalado em `~/.local/bin/task`, que precede `/usr/bin/task` (Taskwarrior,
ainda disponível pelo caminho absoluto). Em outras máquinas com o mesmo conflito,
instale o go-task em `~/.local/bin` e garanta que esse diretório venha antes de
`/usr/bin` no PATH.

```bash
task                         # lista as tarefas
task install                 # venv + npm ci
task verify                  # ruff + pytest + lock + build
task bootstrap -- --password 'SenhaForte!2026' --no-totp --force
task dev                     # API + Vite (usa fmx/runtime reais)
task runtime                 # inspeciona Docker/Podman
task backup                  # backup consistente
task deploy:cloudflare       # provisiona túnel + DNS + ingress + serviço
task cloudflare:status       # estado real do túnel
task saas:deploy SAAS_DOMAIN=cliente.exemplo.com
```

Deploy em host Docker:

```bash
task deploy \
  PUBLIC_ORIGIN=https://console.example.com \
  FM_HOME=/home/freddo/frappe
```

`EXECUTOR_UID`/`EXECUTOR_GID` são derivados automaticamente da conta da API; as vars
do Taskfile só são usadas como fallback se a conta ainda não existir.

Deploy em host Podman (após `task deploy`, aplica drop-ins que removem o grupo
`docker` e forçam o socket rootless):

```bash
task deploy:podman \
  PODMAN_SOCKET=/run/user/1000/podman/podman.sock \
  XDG_RUNTIME_DIR=/run/user/1000
```

Outras tarefas: `task deploy:prereq`, `task deploy:check`, `task deploy:env`,
`task deploy:bootstrap`, `task deploy:units`,
`task deploy:status`, `task deploy:logs -- -n 100`, `task deploy:restart`,
`task deploy:cloudflare`, `task cloudflare:status`, `task saas:deploy` e
`task deploy:docker` para reverter os drop-ins.

## Comandos implementados

| fmx | Endpoint | Tipo |
| --- | --- | --- |
| `list` / `info` | `GET /benches`, `GET /benches/{b}` | leitura |
| `create` / `delete` | `POST /benches`, `DELETE /benches/{b}` | job (FQDN, senha admin gerada, alias `www`; delete exige step-up + nome) |
| `start` / `stop` / `restart` / `reset` | `POST /benches/{b}/actions/{a}` | job (mutex por bench) |
| `update` | `PATCH /benches/{b}/config` | job (campos validados) |
| `logs` | `GET /benches/{b}/logs` | SSE |
| `shell` | `WS /benches/{b}/shell` | desligado por padrão, gravado |
| `ssl` | `GET/POST /benches/{b}/ssl` | status + emissão/renovação |
| `ngrok` | `POST /benches/{b}/ngrok` | step-up + TTL obrigatório |
| `services` | `GET /services`, `POST /services/{s}/actions/{a}` | leitura + job global |
| `migrate` | `POST /system/fm/migrate` | job global + backup confirmado |
| `self` | `GET /system/fm`, `POST /system/fm/update` | versão + job global |

`code` (abre VS Code local) está fora de escopo, conforme a especificação.

Comandos CLI de operação: `freddo-manager bootstrap`, `configure`, `serve`, `executor`,
`collector`, `runtime`, `catalog`, `verify-audit`, `cloudflare setup|status|add|remove|sync`
e `saas deploy <fqdn>`. O `--help` de cada subcomando documenta as opções.

## Segurança

- senha Argon2id + TOTP obrigatório, bloqueio progressivo e códigos de recuperação;
- sessão em cookie HttpOnly/Secure/SameSite=Strict, só o hash no banco, ociosa 30 min / absoluta 12 h;
- CSRF por requisição + checagem de `Origin`, CSP rígida e headers de hardening;
- step-up (5 min) para delete, reset, ngrok, shell, migrate e self update;
- Executor com allowlist, argv em lista (nunca shell), `SO_PEERCRED` (uid **e** gid), locks por bench e globais;
- até o terminal web (`fmx shell`) roda dentro do Executor: a API só repassa E/S e grava o transcript;
- shim Docker/Podman feito com symlink em diretório privado, sem wrapper shell;
- redação de segredos na saída de jobs e audit log encadeado por hash (`freddo-manager verify-audit`);
- segredos cifrados com chave do host em `FREDDO_HOME/secret.key` (guarde fora do host).

## Backup

O script usa o API de backup online do SQLite (seguro com bancos abertos), grava
`audit-verify.json` e gera um tar com permissão `600`:

```bash
FREDDO_HOME=/var/lib/freddo-manager deploy/backup.sh /var/backups/freddo-manager
```

Guarde `secret.key` e o tar em local **fora do host**. Sem a chave, TOTP e segredos
cifrados não podem ser recuperados.

## Testes

```bash
task verify
# ou, sem go-task:
uv sync --frozen
.venv/bin/pytest -q
cd web && npm ci && npm run build
```

## Estrutura

```
freddo-manager/
├── backend/freddo_manager/   # API, executor, coletor, segurança e persistência
├── web/                      # SPA React/Vite
├── tests/                    # pytest
├── deploy/                   # units systemd + backup
├── scripts/                  # wrapper dev.py (API + Vite com shutdown limpo)
├── Taskfile.yml              # atalhos de dev, validação e deploy
└── pyproject.toml
```
