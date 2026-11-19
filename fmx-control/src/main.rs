mod api;
mod config;
mod executor;
mod model;
mod operations;
mod provider;
mod telemetry;

use api::SharedState;
use config::Config;
use operations::Operations;
use provider::Provider;
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let config = Config::from_env();
    let provider = Provider::detect(&config).await;
    let bind = config.bind.clone();

    eprintln!(
        "fmx-control {} · {bind} · provider={} mode={} fmx={} runtime={} ({}) · compose={}",
        env!("CARGO_PKG_VERSION"),
        provider.kind,
        provider.mode,
        if provider.fmx.ok { "ok" } else { "indisponível" },
        provider.runtime.kind,
        if provider.runtime.ok { "ok" } else { "indisponível" },
        if provider.compose.ok { "ok" } else { "indisponível" }
    );

    let state = SharedState::new(api::AppState {
        config,
        provider,
        operations: Operations::new(300),
    });
    let listener = TcpListener::bind(&bind).await?;
    axum::serve(listener, api::router(state)).await
}
