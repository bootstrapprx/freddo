# freddo-manager

Console web de **host único** para operar distribuições Frappe/ERPNext gerenciadas pelo
[Frappe-Manager](https://github.com/rtcamp/frappe-manager) (`fmx`), com telemetria própria.

Implementação do `frappe-console-spec.pdf`. Os projetos `app/web`, `frappeops`, `fmx-control`,
`musical-lamp` e `Frappe-Manager` foram usados **apenas como referência**; este é um app novo,
com nome distinto para não confundir com as tentativas abandonadas.

## Arquitetura

```
Browser (127.0.0.1) --> API (FastAPI, sem acesso ao runtime)
                            | Unix socket + SO_PEERCRED
                            v
                      Executor (fmx / Docker|Podman Compose)
                         |                       |
                         v                       v
                   Docker/Podman          cloudflared --> proxy global --> sites
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
# $FREDDO_HOME/config.json e emite um token de configuracao inicial
task bootstrap

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
Cole o token exibido no terminal na tela inicial para definir a senha e configurar TOTP.
O token fica salvo somente como hash, pode ser usado uma vez e expira em 24 horas.

### Produção (systemd + Cloudflare Access)

O caminho recomendado é `task deploy`: ele cria as contas `freddo-api` e
`freddo-collector`, os diretórios com dono/permissões corretos, copia o código, gera os
`.env` com o uid/gid reais da conta da API, emite um token de bootstrap e instala/reinicia
os units. Use esse token na tela local para definir a senha e registrar TOTP. O usuário dono dos benches (`EXEC_USER`, padrão `freddo`) deve
existir antes; em hosts Docker ele precisa pertencer ao grupo `docker`.

```bash
task verify
# validação do host/runtime antes do deploy
task deploy:preflight
# FM_HOME é solicitado no TTY (padrão sugerido: $HOME/frappe do usuário dono dos benches)
# ou pode ser passado explicitamente:
task deploy FM_HOME=/caminho/escolhido/frappe
```

`task deploy:preflight` funciona como doctor: cria as contas de serviço ausentes, cria a raiz
de benches se ela ainda não existir e habilita o daemon Docker ou o socket rootless do Podman
quando necessário. Também ajusta o grupo/permissões dos bancos SQLite compartilhados e libera
a chave TOTP somente para a API. Depois valida systemd, Python 3.12+, Node/npm, `fmx` e o
acesso ao runtime configurado (`CONTAINER_RUNTIME=auto|docker|podman`). Dependências de
aplicação ausentes, como `fmx`, Node 22+ ou o provider Compose do runtime, são apontadas com
erro para evitar instalar versões incompatíveis. O deploy da aplicação é nativo via systemd e
continua operando os benches existentes pelo Frappe-Manager e Docker/Podman. O caminho
`FM_HOME` escolhido também é aplicado ao unit do Executor, sem depender de
`/home/freddo/frappe`.

O bootstrap padrão emite um token aleatório de uso único, válido por 24 horas; use-o na
tela local para criar a senha e configurar TOTP. Para configurar somente pela CLI, passe
uma senha explicitamente (`freddo-manager bootstrap --password ...`); `--no-totp` continua
disponível apenas nesse modo. Para instalação manual, os passos equivalentes estão em
[`Taskfile.yml`](Taskfile.yml) (`deploy:prereq`, `deploy:files`, `deploy:env`,
`deploy:bootstrap`, `deploy:units`).

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
No modo rootless, o deploy executa o Coletor como o dono dos benches para que ele alcance o
socket privado do Podman; a API continua sem acesso ao runtime.

Unit files de exemplo em [`deploy/`](deploy/). A API escuta apenas em `127.0.0.1` e não
participa do túnel público. Cloudflare Access JWT continua opcional como defesa extra, mas
não é necessário para acessar o painel local.

### Cloudflare Tunnel + deploy de SaaS

O painel **Deploy** configura localmente o token do túnel existente, mantém os domínios base
`kodoo.online` e `kalkulisto.com.br`, e cria sites como `erp.kodoo.online`. O token fica em
`$FREDDO_HOME/cloudflared/cloudflared.env`, protegido pelo grupo `freddo-tunnel`; a tela nunca o devolve.
O processo API não recebe acesso ao Docker: o Executor inicia o container `cloudflared`.

No Cloudflare, mantenha o túnel remote-managed já criado e configure uma vez os hostnames
wildcard `*.kodoo.online` e `*.kalkulisto.com.br` para o túnel, com origem
`http://global-nginx-proxy:80`. Isso encaminha sites ao proxy compartilhado do
Frappe-Manager. Não configure hostname público para o Freddo Manager. Os wildcards exigem
que o operador controle a zona DNS dos domínios.

No app, salve o token e os domínios base. Crie o primeiro site antes de conectar o túnel,
pois o deploy cria a rede externa `fm-global-frontend-network`. Depois use **Conectar** no
painel Deploy. O deploy de sites parte do formulário da aplicação, e não de uma task shell.

```bash
# Operar o container manualmente quando necessário:
task tunnel:compose -- logs -f
task tunnel:compose -- down
```

O painel exibe uma vez a senha administrativa gerada. `CONTAINER_RUNTIME=auto|docker|podman`
seleciona o runtime; neste servidor Docker é o padrão detectado. Em Podman,
`podman compose` requer um provider Compose instalado. O painel local usa
`http://127.0.0.1:8710` por padrão.

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
task tunnel:compose -- ps    # estado do conector local
```

Deploy em host Docker:

```bash
task deploy \
  PUBLIC_ORIGIN=http://127.0.0.1:8710 \
  FM_HOME=/home/freddo/frappe
```

`FM_HOME` nunca é fixo: `deploy:prereq` pergunta em um terminal e grava a resposta em
`/etc/freddo-manager/fm-home` para as tarefas seguintes (ou use `FM_HOME=...`). O valor também
é persistido no `config.json` do usuário dono dos benches pelo bootstrap.
`EXECUTOR_UID`/`EXECUTOR_GID` são derivados automaticamente da conta da API; as vars
do Taskfile só são usadas como fallback se a conta ainda não existir.

Deploy em host Podman (após `task deploy`, aplica drop-ins que removem o grupo
`docker` e forçam o socket rootless):

```bash
task deploy:podman \
  PODMAN_SOCKET=/run/user/1000/podman/podman.sock \
  XDG_RUNTIME_DIR=/run/user/1000
```

Outras tarefas: `task deploy:preflight`, `task deploy:prereq`, `task deploy:check`, `task deploy:env`,
`task deploy:bootstrap`, `task deploy:units`,
`task deploy:status`, `task deploy:logs -- -n 100`, `task deploy:restart`,
`task tunnel:compose -- <args>` e
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
`collector`, `runtime`, `catalog` e `verify-audit`. Deploys públicos usam o painel Deploy para
validar a associação ao domínio configurado. O `--help` de cada
subcomando documenta as opções.

## Apps

A área **Apps** mantém URLs Git HTTPS/SSH sem credenciais, uma ref por versão do Frappe e os
resultados de validação e teste. As releases só aparecem no Deploy quando o repositório foi
validado e a suíte passou para o mesmo commit. Para adicionar uma release, salve sua ref,
valide o repositório e execute o teste. Credenciais de repositórios privados devem estar
disponíveis ao processo Frappe-Manager no host; não coloque tokens na URL.

Os testes criam um bench descartável `freddo-app-test-*`, executam `bench run-tests --app`
e tentam removê-lo mesmo após falha. Se a remoção falhar, o job reporta isso e o operador
deve remover o bench temporário. Testes nunca são executados em benches existentes.

Na página Apps, install adiciona o app a um site existente; update faz backup com arquivos,
troca para a ref configurada e migra o site. **Prévia remoção** executa o dry-run do Frappe.
Remover exige step-up, confirmação `app@bench` e cria backup antes de desinstalar o app do
site. O código-fonte permanece no bench para não remover um app ainda usado por outro site.

O Deploy recebe IDs de releases em vez de URLs ou nomes livres e o Executor confere novamente
compatibilidade, estado habilitado e commit testado antes de criar o bench.

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
