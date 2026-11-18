use crate::config::Config;
use crate::executor::{self, CommandSpec};
use crate::model::{
    valid_app, valid_identifier, ApiEnvelope, ApiError, BenchInput, MigrationInput, NodeInput,
    ScaleInput,
};
use crate::operations::Operations;
use crate::provider::{Provider, RuntimeStatus};
use crate::telemetry::{TelemetryRequest, TelemetryResult};
use axum::extract::{Path, Request, State};
use axum::http::{header::AUTHORIZATION, StatusCode};
use axum::middleware::{from_fn, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

pub struct AppState {
    pub config: Config,
    pub provider: Provider,
    pub operations: Operations,
}

pub type SharedState = Arc<AppState>;

pub fn router(state: SharedState) -> Router {
    let auth_state = state.clone();
    let v1 = Router::new()
        .route("/nodes", get(list_nodes).post(preflight_node))
        .route("/benches", post(create_bench))
        .route("/benches/{bench}/migrations", post(migrate_bench))
        .route("/benches/{bench}/workers/concurrency", post(scale_bench))
        .route("/operations/{id}", get(get_operation))
        .route("/telemetry/collect", post(collect_telemetry))
        .layer(from_fn(move |request: Request, next: Next| {
            let expected = auth_state.config.daemon_token.clone();
            async move { auth_check(expected, request, next).await }
        }));

    Router::new()
        .route("/healthz", get(health))
        .nest("/v1", v1)
        .with_state(state)
}

async fn auth_check(
    expected_token: Option<String>,
    request: Request,
    next: Next,
) -> Response {
    let Some(expected) = expected_token else {
        return next.run(request).await;
    };
    let provided = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();

    if provided != expected {
        return fail(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "token do daemon inválido",
            None,
        );
    }
    next.run(request).await
}

fn ok<T: Serialize>(data: T, operation_id: Option<String>) -> Response {
    let envelope = ApiEnvelope {
        request_id: crate::model::request_id(),
        operation_id,
        status: "succeeded",
        data: Some(data),
        error: None,
    };
    (StatusCode::OK, Json(envelope)).into_response()
}

fn accepted(operation_id: String) -> Response {
    let envelope = ApiEnvelope {
        request_id: crate::model::request_id(),
        operation_id: Some(operation_id.clone()),
        status: "accepted",
        data: Some(json!({ "operation_id": operation_id })),
        error: None,
    };
    (StatusCode::ACCEPTED, Json(envelope)).into_response()
}

fn fail(
    status: StatusCode,
    code: &'static str,
    message: impl Into<String>,
    operation_id: Option<String>,
) -> Response {
    let envelope = ApiEnvelope::<Value> {
        request_id: crate::model::request_id(),
        operation_id,
        status: "failed",
        data: None,
        error: Some(ApiError {
            code,
            message: message.into(),
            details: None,
        }),
    };
    (status, Json(envelope)).into_response()
}

#[derive(Serialize)]
struct HealthData {
    version: &'static str,
    provider: &'static str,
    mode: &'static str,
    available: bool,
    command: Option<String>,
    authenticated: bool,
    fmx: RuntimeStatus,
    docker: RuntimeStatus,
    compose: RuntimeStatus,
}

async fn health(State(state): State<SharedState>) -> Response {
    ok(
        HealthData {
            version: env!("CARGO_PKG_VERSION"),
            provider: state.provider.kind,
            mode: state.provider.mode,
            available: state.provider.available,
            command: state.provider.command.clone(),
            authenticated: state.config.daemon_token.is_some(),
            fmx: state.provider.fmx.clone(),
            docker: state.provider.docker.clone(),
            compose: state.provider.compose.clone(),
        },
        None,
    )
}

#[derive(Serialize)]
struct Check {
    name: &'static str,
    ok: bool,
    detail: Option<String>,
}

#[derive(Serialize)]
struct NodeData {
    name: String,
    host: String,
    ready: bool,
    checks: Vec<Check>,
}

async fn list_nodes(State(state): State<SharedState>) -> Response {
    ok(
        vec![NodeData {
            name: "local".to_string(),
            host: "127.0.0.1".to_string(),
            ready: state.provider.available && state.provider.docker.ok,
            checks: vec![
                Check {
                    name: "fmx",
                    ok: state.provider.available,
                    detail: state.provider.fmx.text.clone(),
                },
                Check {
                    name: "docker",
                    ok: state.provider.docker.ok,
                    detail: state.provider.docker.text.clone(),
                },
            ],
        }],
        None,
    )
}

async fn preflight_node(State(state): State<SharedState>, Json(input): Json<NodeInput>) -> Response {
    if !valid_identifier(input.name.trim(), false) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_NODE_NAME",
            "nome do node inválido",
            None,
        );
    }
    if input.host.trim().is_empty()
        || input.host.len() > 200
        || input.host.chars().any(char::is_whitespace)
    {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_NODE_HOST",
            "host do node inválido",
            None,
        );
    }

    ok(
        NodeData {
            name: input.name.trim().to_string(),
            host: input.host.trim().to_string(),
            ready: state.provider.available && state.provider.docker.ok,
            checks: vec![
                Check {
                    name: "fmx",
                    ok: state.provider.available,
                    detail: state.provider.fmx.text.clone(),
                },
                Check {
                    name: "docker",
                    ok: state.provider.docker.ok,
                    detail: state.provider.docker.text.clone(),
                },
            ],
        },
        None,
    )
}

async fn create_bench(State(state): State<SharedState>, Json(input): Json<BenchInput>) -> Response {
    let name = input.name.trim().to_string();
    if !valid_identifier(&name, true) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_BENCH_NAME",
            "nome do bench inválido",
            None,
        );
    }
    if input.apps.is_empty() || input.apps.len() > 10 || input.apps.iter().any(|app| !valid_app(app)) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_APPS",
            "informe de 1 a 10 apps válidos",
            None,
        );
    }
    let environment = input.environment.trim().to_lowercase();
    if !matches!(environment.as_str(), "dev" | "prod") {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_ENVIRONMENT",
            "environment deve ser dev ou prod",
            None,
        );
    }
    if let Some(site) = &input.site {
        if !site.trim().is_empty() && !valid_identifier(site, true) {
            return fail(
                StatusCode::BAD_REQUEST,
                "INVALID_SITE",
                "site inválido",
                None,
            );
        }
    }

    if let Err(response) = ensure_ready(&state) {
        return response;
    }

    let id = match state.operations.start("create-bench", &name) {
        Ok(id) => id,
        Err(existing) => {
            return fail(
                StatusCode::CONFLICT,
                "BENCH_BUSY",
                "já existe uma operação em andamento para este bench",
                existing,
            )
        }
    };

    let mut args = vec![
        "-n".to_string(),
        "create".to_string(),
        name.clone(),
    ];
    for app in &input.apps {
        args.push("--apps".to_string());
        args.push(app.trim().to_string());
    }
    args.push("--environment".to_string());
    args.push(environment);
    if let Some(site) = input.site.filter(|value| !value.trim().is_empty()) {
        args.push("--alias-domains".to_string());
        args.push(site.trim().to_string());
    }
    if let Some(python) = input.python.filter(|value| !value.trim().is_empty()) {
        args.push("--python".to_string());
        args.push(python.trim().to_string());
    }

    let spec = command(&state, args);
    spawn_execution(state.clone(), id.clone(), vec![spec]);
    accepted(id)
}

async fn migrate_bench(
    State(state): State<SharedState>,
    Path(bench): Path<String>,
    Json(input): Json<MigrationInput>,
) -> Response {
    let bench = bench.trim().to_string();
    if !valid_identifier(&bench, true) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_BENCH_NAME",
            "nome do bench inválido",
            None,
        );
    }
    let target = input.target.trim().to_lowercase();
    if !matches!(target.as_str(), "site" | "infra" | "all") {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_MIGRATION_TARGET",
            "target deve ser site, infra ou all",
            None,
        );
    }
    let site = input.site.unwrap_or_else(|| bench.clone());
    if !valid_identifier(&site, true) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_SITE",
            "site inválido",
            None,
        );
    }

    if let Err(response) = ensure_ready(&state) {
        return response;
    }

    let id = match state.operations.start("migrate", &bench) {
        Ok(id) => id,
        Err(existing) => {
            return fail(
                StatusCode::CONFLICT,
                "BENCH_BUSY",
                "já existe uma operação em andamento para este bench",
                existing,
            )
        }
    };

    let mut steps = Vec::new();
    if target == "site" || target == "all" {
        steps.push(command(
            &state,
            vec![
                "-n".to_string(),
                "shell".to_string(),
                bench.clone(),
                "-c".to_string(),
                format!("bench --site {site} migrate"),
            ],
        ));
    }
    if target == "infra" || target == "all" {
        steps.push(command(
            &state,
            vec![
                "-n".to_string(),
                "migrate".to_string(),
                bench.clone(),
                "--auto-proceed".to_string(),
            ],
        ));
    }

    spawn_execution(state.clone(), id.clone(), steps);
    accepted(id)
}

async fn scale_bench(
    State(state): State<SharedState>,
    Path(bench): Path<String>,
    Json(input): Json<ScaleInput>,
) -> Response {
    let bench = bench.trim().to_string();
    if !valid_identifier(&bench, true) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_BENCH_NAME",
            "nome do bench inválido",
            None,
        );
    }
    let replicas = input.replicas;
    if !(1..=20).contains(&replicas) {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_REPLICAS",
            "réplicas deve estar entre 1 e 20",
            None,
        );
    }
    let scope = input.scope.trim().to_lowercase();
    if !matches!(scope.as_str(), "workers" | "web") {
        return fail(
            StatusCode::BAD_REQUEST,
            "INVALID_SCOPE",
            "scope deve ser workers ou web",
            None,
        );
    }

    if let Err(response) = ensure_ready(&state) {
        return response;
    }

    let id = match state.operations.start("scale", &bench) {
        Ok(id) => id,
        Err(existing) => {
            return fail(
                StatusCode::CONFLICT,
                "BENCH_BUSY",
                "já existe uma operação em andamento para este bench",
                existing,
            )
        }
    };

    let steps = if scope == "workers" {
        vec![
            command(
                &state,
                vec![
                    "-n".to_string(),
                    "shell".to_string(),
                    bench.clone(),
                    "-c".to_string(),
                    format!("bench set-config -g background_workers {replicas}"),
                ],
            ),
            command(
                &state,
                vec![
                    "-n".to_string(),
                    "start".to_string(),
                    bench.clone(),
                    "--reconfigure-workers".to_string(),
                ],
            ),
            command(
                &state,
                vec![
                    "-n".to_string(),
                    "restart".to_string(),
                    bench.clone(),
                    "--workers".to_string(),
                    "--supervisor".to_string(),
                ],
            ),
        ]
    } else {
        vec![
            command(
                &state,
                vec![
                    "-n".to_string(),
                    "shell".to_string(),
                    bench.clone(),
                    "-c".to_string(),
                    format!("bench set-config -g gunicorn_workers {replicas}"),
                ],
            ),
            command(
                &state,
                vec![
                    "-n".to_string(),
                    "restart".to_string(),
                    bench,
                    "--supervisor".to_string(),
                ],
            ),
        ]
    };

    spawn_execution(state.clone(), id.clone(), steps);
    accepted(id)
}

async fn get_operation(State(state): State<SharedState>, Path(id): Path<String>) -> Response {
    match state.operations.get(&id) {
        Some(operation) => ok(operation, Some(id)),
        None => fail(
            StatusCode::NOT_FOUND,
            "OPERATION_NOT_FOUND",
            "operação não encontrada",
            Some(id),
        ),
    }
}

async fn collect_telemetry(
    State(state): State<SharedState>,
    Json(request): Json<TelemetryRequest>,
) -> Response {
    let result: TelemetryResult = crate::telemetry::collect(request, &state.config).await;
    ok(result, None)
}

fn ensure_ready(state: &SharedState) -> Result<(), Response> {
    if state.provider.kind == "mock" {
        return Ok(());
    }
    if !state.provider.available {
        return Err(fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "FMX_UNAVAILABLE",
            state.provider.fmx.text.clone().unwrap_or_else(|| "fmx indisponível".to_string()),
            None,
        ));
    }
    if !state.provider.docker.ok {
        return Err(fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "DOCKER_UNAVAILABLE",
            state.provider.docker.text.clone().unwrap_or_else(|| "Docker indisponível".to_string()),
            None,
        ));
    }
    Ok(())
}

fn command(state: &SharedState, args: Vec<String>) -> CommandSpec {
    let program = state
        .provider
        .command()
        .unwrap_or(&state.config.fmx_bin)
        .to_string();
    let mut spec = CommandSpec::new(program, args, state.config.command_timeout);
    if let Some(home) = &state.config.fmx_home {
        spec = spec.with_env("FRAPPE_MANAGER_HOME", home);
    }
    spec
}

fn spawn_execution(state: SharedState, id: String, steps: Vec<CommandSpec>) {
    tokio::spawn(async move {
        if state.provider.kind == "mock" {
            let bench = state
                .operations
                .get(&id)
                .map(|operation| operation.bench)
                .unwrap_or_default();
            for (level, message) in [
                ("CMD", format!("mock fmx · {bench}")),
                ("INFO", "comando validado pelo fmx-control".to_string()),
                ("OK", "exit 0".to_string()),
            ] {
                state.operations.push_event(&id, level, message);
                tokio::time::sleep(Duration::from_millis(180)).await;
            }
            state.operations.finish(&id, "succeeded", "operação concluída (mock)");
            return;
        }

        for spec in steps {
            state.operations.push_event(&id, "CMD", spec.display());
            match executor::run(&spec).await {
                Ok(result) => {
                    for line in result.stdout.lines().map(str::trim).filter(|line| !line.is_empty()) {
                        state
                            .operations
                            .push_event(&id, "INFO", executor::redact(line));
                    }
                    for line in result.stderr.lines().map(str::trim).filter(|line| !line.is_empty()) {
                        state
                            .operations
                            .push_event(&id, "WARN", executor::redact(line));
                    }
                    if result.status != 0 {
                        state.operations.finish(
                            &id,
                            "failed",
                            format!("fmx encerrou com exit {}", result.status),
                        );
                        return;
                    }
                }
                Err(error) => {
                    state.operations.push_event(&id, "ERROR", error.message());
                    state.operations.finish(&id, "failed", error.message());
                    return;
                }
            }
        }
        state.operations.finish(&id, "succeeded", "operação concluída");
    });
}
