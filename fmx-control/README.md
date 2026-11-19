# fmx-control

Daemon local Rust que expõe o **Frappe-Manager (`fmx`)** como uma API HTTP para o Worker do `freddo`.

Ele **não é** a fonte de verdade: executa operações, coleta telemetria e devolve resultados/operações assíncronas. O Worker persiste nodes, benches, deployments, logs e amostras no D1.

## Referências

Este daemon foi desenhado sobre duas bases reais presentes no workspace:

- `Frappe-Manager/`: CLI `fmx` 0.20.0. Comandos usados: `-n create`, `-n migrate <bench> --auto-proceed`, `shell <bench> -c ...`, `start --reconfigure-workers`, `restart --workers --supervisor`.
- `musical-lamp/`: padrões de executor com timeout/kill, eventos ordenados de operação, cache do último snapshot e contrato `/api/v1` com envelope `{data,error}`.

Não existe `fmx node`, `fmx scale` ou `fmx migrate --bench` no Frappe-Manager. Escala de workers é feita com `bench set-config -g background_workers N` + reconfiguração/restart.

## Build e execução

```bash
cd fmx-control
cargo build --release --offline
./target/release/fmx-control
```

Variáveis de ambiente:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `FMX_BIND` | `127.0.0.1:7420` | Endereço HTTP do daemon. |
| `FMX_BIN` | `fmx` | Nome ou caminho do binário `fmx`. |
| `FMX_PROVIDER` | `auto` | `auto`, `fmx` ou `mock`. No `auto`, detecta `fmx` no `PATH`. |
| `FMX_RUNTIME` | `auto` | `auto`, `docker` ou `podman`. No `auto`, prefere Docker e usa Podman como fallback. |
| `FMX_DAEMON_TOKEN` | — | Se definido, exige `Authorization: Bearer <token>` nas rotas `/v1`. |
| `FRAPPE_MANAGER_HOME` | — | Raiz do Frappe-Manager, encaminhada ao CLI. |
| `FMX_COMMAND_TIMEOUT` | `300` | Timeout das operações, em segundos. |
| `FMX_HEALTH_TIMEOUT` | `3` | Timeout dos probes de saúde, em segundos. |

## API

- `GET /healthz` — versão, provider, `fmx --version`, probes brutos de `docker`/`podman`, compose e `runtime: { kind, ok, text, shim }`.
- `GET/POST /v1/nodes` — inventário/local e preflight de host.
- `POST /v1/benches` — inicia `fmx -n create <bench> --apps ... --environment dev|prod`.
- `POST /v1/benches/:bench/migrations` — `target: site|infra|all`.
- `POST /v1/benches/:bench/workers/concurrency` — `replicas: 1..20`, `scope: workers|web`.
- `GET /v1/operations/:id` — status, eventos e resultado da operação.
- `POST /v1/telemetry/collect` — `ps`/`stats` do runtime ativo, com `source: docker|podman|unavailable`.

Respostas usam o envelope:

```json
{
  "request_id": "req-...",
  "operation_id": "op-...",
  "status": "accepted",
  "data": { "operation_id": "op-..." },
  "error": null
}
```

Códigos HTTP: `200` leitura, `202` operação aceita, `400` argumento inválido, `401` token inválido, `409` operação concorrente, `503` FMX/runtime de containers indisponíveis (`FMX_UNAVAILABLE` ou `RUNTIME_UNAVAILABLE`).

## Docker e Podman

O Frappe-Manager 0.20 chama a CLI `docker` diretamente (inclusive `docker version --format json`, que exige uma chave `Server`). Em hosts sem Docker, o daemon detecta `podman` + `podman-compose`, cria um diretório temporário com um shim executável chamado `docker` e o antepenha ao `PATH` **apenas dos comandos `fmx`**:

- `docker version --format json` é respondido com o JSON do `podman version`, acrescido de `Server`.
- Qualquer outro argumento é repassado para `podman` (`docker compose up` → `podman compose up`).

O shim é removido quando o daemon encerra. A telemetria não usa o shim: ela chama `podman ps --all`/`podman stats --all --no-stream` diretamente quando `FMX_RUNTIME=podman` (ou quando o modo `auto` cai no Podman), mantendo `source: "podman"` nas amostras. Com Docker disponível, nada muda: `source: "docker"`.

## Segurança

- Bind em loopback por padrão.
- Token opcional via `FMX_DAEMON_TOKEN`.
- Nenhum comando é montado com shell; argumentos são passados como lista e validados.
- Valores que parecem segredos são redacionados nos eventos (`PASSWORD`, `TOKEN`, `SECRET`, `API_KEY`, `LICENSE`).
- `fmx info` não é exposto, porque imprime credenciais.
