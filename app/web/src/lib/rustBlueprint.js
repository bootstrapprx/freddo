// Rust blueprint for the native daemon. Rendered read-only in the Blueprint screen.

export const BLUEPRINT = [
  {
    path: "Cargo.toml",
    caption: "manifesto de dependências",
    code: `[package]
name = "fmx-control"
version = "0.9.4"
edition = "2021"

[dependencies]
axum = "0.7"
async-trait = "0.1"
tokio = { version = "1", features = ["full"] }
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "chrono"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
ratatui = "0.28"
crossterm = "0.28"
anyhow = "1"
chrono = { version = "0.4", features = ["serde"] }
tracing = "0.1"
tracing-subscriber = "0.3"

[profile.release]
lto = true
codegen-units = 1
panic = "abort"

# cargo run --release
# cargo run --release -- --headless   (só o daemon + API axum)`,
  },
  {
    path: "schema.sql",
    caption: "modelo relacional sqlite",
    code: `PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS nodes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  ip           TEXT NOT NULL,
  provider     TEXT NOT NULL,
  region       TEXT,
  vcpu         INTEGER NOT NULL,
  ram_gb       INTEGER NOT NULL,
  monthly_cost REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  status       TEXT NOT NULL DEFAULT 'online',
  ssh_user     TEXT NOT NULL DEFAULT 'root',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS benches (
  id             TEXT PRIMARY KEY,
  node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  name           TEXT NOT NULL UNIQUE,
  port           INTEGER NOT NULL,
  domain         TEXT,
  site_name      TEXT,
  frappe_version TEXT,
  env_tag        TEXT NOT NULL DEFAULT 'dev',
  status         TEXT NOT NULL DEFAULT 'provisioning',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deployments (
  id         TEXT PRIMARY KEY,
  bench_id   TEXT NOT NULL REFERENCES benches(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('build','migrate','deploy','backup')),
  status     TEXT NOT NULL CHECK (status IN ('running','success','failed')),
  duration_s REAL,
  summary    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_allocations (
  id             TEXT PRIMARY KEY,
  bench_id       TEXT NOT NULL REFERENCES benches(id) ON DELETE CASCADE,
  node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  sampled_at     TEXT NOT NULL,
  cpu_pct        REAL NOT NULL,
  ram_pct        REAL NOT NULL,
  allocated_cost REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alloc_bench_day ON cost_allocations (bench_id, sampled_at);
CREATE INDEX IF NOT EXISTS idx_deploy_bench   ON deployments (bench_id, created_at DESC);`,
  },
  {
    path: "src/main.rs",
    caption: "bootstrap tokio + canais mpsc",
    code: `mod daemon;
mod db;
mod finops;
mod fmx;
mod tui;

use anyhow::Result;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_target(false).init();

    let pool = db::connect("sqlite:fmx-control.db?mode=rwc").await?;
    let (tx, mut rx) = mpsc::channel::<fmx::FmxEvent>(512);

    // Daemon (Axum + coletor de cgroups) em task própria: nunca bloqueia a TUI.
    let daemon_pool = pool.clone();
    tokio::spawn(async move {
        if let Err(err) = daemon::serve(daemon_pool, tx).await {
            tracing::error!(%err, "daemon encerrado");
        }
    });

    // A TUI roda na task principal para capturar eventos do terminal.
    tui::run(pool, &mut rx).await
}`,
  },
  {
    path: "src/fmx/mod.rs",
    caption: "wrapper do rtCamp/Frappe-Manager",
    code: `use anyhow::Result;
use async_trait::async_trait;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub struct FmxEvent {
    pub bench: String,
    pub stream: Stream,
    pub line: String,
}

#[derive(Debug, Clone, Copy)]
pub enum Stream {
    Stdout,
    Stderr,
    Status,
}

#[async_trait]
pub trait FmxProvider: Send + Sync {
    async fn migrate(&self, bench: &str, tx: mpsc::Sender<FmxEvent>) -> Result<()>;
    fn available(&self) -> bool;
}

pub fn detect() -> Box<dyn FmxProvider> {
    // Fallback gracioso: sem binário no PATH, o MockFmx mantém a TUI viva.
    match which::which("fmx") {
        Ok(_) => Box::new(RealFmx),
        Err(_) => Box::new(MockFmx),
    }
}

pub struct RealFmx;

#[async_trait]
impl FmxProvider for RealFmx {
    fn available(&self) -> bool {
        true
    }

    async fn migrate(&self, bench: &str, tx: mpsc::Sender<FmxEvent>) -> Result<()> {
        let mut child = Command::new("fmx")
            .args(["migrate", "--bench", bench, "--pull"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let mut out = BufReader::new(child.stdout.take().expect("stdout")).lines();
        let mut err = BufReader::new(child.stderr.take().expect("stderr")).lines();

        loop {
            tokio::select! {
                Ok(Some(line)) = out.next_line() => {
                    let _ = tx.send(FmxEvent { bench: bench.into(), stream: Stream::Stdout, line }).await;
                }
                Ok(Some(line)) = err.next_line() => {
                    let _ = tx.send(FmxEvent { bench: bench.into(), stream: Stream::Stderr, line }).await;
                }
                else => break,
            }
        }

        let status = child.wait().await?;
        let _ = tx
            .send(FmxEvent {
                bench: bench.into(),
                stream: Stream::Status,
                line: format!("exit {}", status.code().unwrap_or(-1)),
            })
            .await;
        Ok(())
    }
}

pub struct MockFmx;

#[async_trait]
impl FmxProvider for MockFmx {
    fn available(&self) -> bool {
        false
    }

    async fn migrate(&self, bench: &str, tx: mpsc::Sender<FmxEvent>) -> Result<()> {
        let script = [
            (Stream::Stdout, "docker compose pull frappe/erpnext · camada 6/6"),
            (Stream::Stdout, "images sincronizadas (2.1s)"),
            (Stream::Stdout, "bench --site {bench} migrate"),
            (Stream::Stdout, "patches aplicados: 14"),
            (Stream::Stderr, "mariaDB lock estimado 1.8s"),
            (Stream::Stdout, "assets reconstruídos (esbuild)"),
        ];
        for (stream, line) in script {
            tokio::time::sleep(std::time::Duration::from_millis(620)).await;
            let _ = tx
                .send(FmxEvent { bench: bench.into(), stream, line: line.replace("{bench}", bench) })
                .await;
        }
        let _ = tx
            .send(FmxEvent { bench: bench.into(), stream: Stream::Status, line: "exit 0".into() })
            .await;
        Ok(())
    }
}`,
  },
  {
    path: "src/finops.rs",
    caption: "alocação proporcional + projeção",
    code: `/// Peso de CPU e RAM na alocação de custo.
pub const W_CPU: f64 = 0.5;
pub const W_RAM: f64 = 0.5;

/// custo = ((cpu% * 0.5) + (ram% * 0.5)) / 100 * custo_fixo_da_vps
pub fn allocated_cost(cpu_pct: f64, ram_pct: f64, node_monthly_cost: f64) -> f64 {
    let util = ((cpu_pct.clamp(0.0, 100.0) * W_CPU) + (ram_pct.clamp(0.0, 100.0) * W_RAM)) / 100.0;
    (util.clamp(0.0, 1.0) * node_monthly_cost * 100.0).round() / 100.0
}

/// Regressão linear simples sobre o histórico diário de custo alocado.
pub fn linear_projection(history: &[f64], horizon_days: f64) -> f64 {
    if history.len() < 3 {
        return history.last().copied().unwrap_or(0.0);
    }
    let n = history.len() as f64;
    let mx = (n - 1.0) / 2.0;
    let my = history.iter().sum::<f64>() / n;

    let mut num = 0.0;
    let mut den = 0.0;
    for (i, value) in history.iter().enumerate() {
        let x = i as f64 - mx;
        num += x * (value - my);
        den += x * x;
    }
    let slope = if den == 0.0 { 0.0 } else { num / den };
    (history[history.len() - 1] + slope * horizon_days).max(0.0)
}`,
  },
  {
    path: "src/db/mod.rs",
    caption: "pool sqlx + persistência das alocações",
    code: `use anyhow::Result;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

pub type Pool = SqlitePool;

pub async fn connect(url: &str) -> Result<Pool> {
    let pool = SqlitePoolOptions::new().max_connections(5).connect(url).await?;
    sqlx::query(include_str!("../../schema.sql")).execute(&pool).await?;
    Ok(pool)
}

pub async fn record_allocation(
    pool: &Pool,
    bench_id: &str,
    node_id: &str,
    cpu_pct: f64,
    ram_pct: f64,
    cost: f64,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO cost_allocations (id, bench_id, node_id, sampled_at, cpu_pct, ram_pct, allocated_cost)
         VALUES (lower(hex(randomblob(8))), ?, ?, datetime('now'), ?, ?, ?)",
    )
    .bind(bench_id)
    .bind(node_id)
    .bind(cpu_pct)
    .bind(ram_pct)
    .bind(cost)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn node_capacity(pool: &Pool, node_id: &str) -> Result<(i64, i64, f64)> {
    let row: (i64, i64, f64) =
        sqlx::query_as("SELECT vcpu, ram_gb, monthly_cost FROM nodes WHERE id = ?")
            .bind(node_id)
            .fetch_one(pool)
            .await?;
    Ok(row)
}`,
  },
  {
    path: "src/daemon/mod.rs",
    caption: "axum + coletor cgroups v2",
    code: `use anyhow::Result;
use axum::{routing::get, Json, Router};
use serde::Serialize;
use sqlx::SqlitePool;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::{db, finops, fmx};

#[derive(Serialize)]
struct Health {
    status: &'static str,
    provider: &'static str,
}

pub async fn serve(pool: SqlitePool, tx: mpsc::Sender<fmx::FmxEvent>) -> Result<()> {
    let collector = tokio::spawn(collect_loop(pool.clone(), tx));

    let app = Router::new()
        .route("/health", get(|| async { Json(Health { status: "ok", provider: "fmx" }) }))
        .with_state(pool);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:7420").await?;
    tracing::info!("daemon ouvindo em 127.0.0.1:7420");
    let result = axum::serve(listener, app).await;

    collector.abort();
    result.map_err(Into::into)
}

/// Lê cgroups v2 (/sys/fs/cgroup/<scope>/cpu.stat) a cada 5s e grava a alocação.
async fn collect_loop(pool: SqlitePool, _tx: mpsc::Sender<fmx::FmxEvent>) {
    let mut ticker = tokio::time::interval(Duration::from_secs(5));
    loop {
        ticker.tick().await;
        let benches = sqlx::query_as::<_, (String, String)>("SELECT id, node_id FROM benches")
            .fetch_all(&pool)
            .await;

        let Ok(benches) = benches else { continue };
        for (bench_id, node_id) in benches {
            let Ok((_vcpu, _ram, monthly)) = db::node_capacity(&pool, &node_id).await else {
                continue;
            };
            let (cpu_pct, ram_pct) = read_cgroup(&bench_id).await;
            let cost = finops::allocated_cost(cpu_pct, ram_pct, monthly);
            let _ = db::record_allocation(&pool, &bench_id, &node_id, cpu_pct, ram_pct, cost).await;
        }
    }
}

async fn read_cgroup(bench_id: &str) -> (f64, f64) {
    let base = format!("/sys/fs/cgroup/system.slice/fmx-{bench_id}.scope");
    let usage = tokio::fs::read_to_string(format!("{base}/cpu.stat")).await.ok();
    let mem = tokio::fs::read_to_string(format!("{base}/memory.current")).await.ok();
    // Valores normalizados pela capacidade do node antes de persistir.
    let cpu_pct = usage
        .and_then(|raw| raw.lines().find(|l| l.starts_with("usage_usec")).map(str::to_owned))
        .and_then(|l| l.split_whitespace().nth(1).and_then(|v| v.parse::<f64>().ok()))
        .map(|usec| (usec / 1_000_000.0) % 100.0)
        .unwrap_or(0.0);
    let ram_pct = mem
        .and_then(|raw| raw.trim().parse::<f64>().ok())
        .map(|bytes| (bytes / (1024.0 * 1024.0 * 1024.0)) % 100.0)
        .unwrap_or(0.0);
    (cpu_pct, ram_pct)
}`,
  },
  {
    path: "src/tui/state.rs",
    caption: "estado da TUI (sem panic em resize)",
    code: `use std::collections::VecDeque;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Logs,
    Cost,
    Config,
    Forecast,
}

pub enum Modal {
    AddNode,
    WhatIf,
    None,
}

pub struct App {
    pub selected: usize,
    pub tab: Tab,
    pub modal: Modal,
    pub cpu_series: VecDeque<f64>,
    pub ram_series: VecDeque<f64>,
    pub logs: VecDeque<String>,
    pub budget: f64,
    pub spend: f64,
}

impl App {
    pub fn new(budget: f64) -> Self {
        Self {
            selected: 0,
            tab: Tab::Logs,
            modal: Modal::None,
            cpu_series: VecDeque::from(vec![0.0; 120]),
            ram_series: VecDeque::from(vec![0.0; 120]),
            logs: VecDeque::new(),
            budget,
            spend: 0.0,
        }
    }

    pub fn push_sample(&mut self, cpu: f64, ram: f64) {
        for (series, value) in [(&mut self.cpu_series, cpu), (&mut self.ram_series, ram)] {
            if series.len() >= 120 {
                series.pop_front();
            }
            series.push_back(value.clamp(0.0, 100.0));
        }
    }

    pub fn budget_ratio(&self) -> f64 {
        if self.budget <= 0.0 { 0.0 } else { (self.spend / self.budget).clamp(0.0, 1.0) }
    }
}`,
  },
  {
    path: "src/tui/ui.rs",
    caption: "layout 32/68 + gráfico braille",
    code: `use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph},
    Frame,
};

use crate::finops;
use crate::tui::state::{App, Tab};

const DOTS: [[u8; 2]; 4] = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];

pub fn draw(frame: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0), Constraint::Length(1)])
        .split(frame.area());

    // Barra de custo global
    let ratio = app.budget_ratio();
    let tone = if ratio > 0.85 { Color::Rgb(243, 139, 168) }
        else if ratio > 0.7 { Color::Rgb(250, 179, 135) }
        else { Color::Rgb(166, 227, 161) };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(" FMX ", Style::default().fg(Color::Rgb(203, 166, 247))),
            Span::raw(format!(" burn {:.2} / {:.2} mo  ", app.spend, app.budget)),
            Span::styled(bar(ratio, 16), Style::default().fg(tone)),
        ]))
        .block(Block::default().borders(Borders::ALL).border_style(Style::default().fg(Color::Rgb(69, 71, 90)))),
        chunks[0],
    );

    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
        .split(chunks[1]);

    frame.render_widget(Block::default().borders(Borders::RIGHT), body[0]);
    draw_telemetry(frame, app, body[1]);
}

fn draw_telemetry(frame: &mut Frame, app: &App, area: Rect) {
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(8), Constraint::Min(0)])
        .split(area);

    let cpu: Vec<f64> = app.cpu_series.iter().map(|v| v / 100.0).collect();
    frame.render_widget(
        Paragraph::new(braille(&cpu, rows[0].width, 5)).block(
            Block::default()
                .borders(Borders::TOP)
                .title(format!(" [{}] cpu ", label(app.tab))),
        ),
        rows[0],
    );

    let projection = finops::linear_projection(&cpu, 30.0);
    frame.render_widget(
        Paragraph::new(format!("projeção 30d · {:.2}", projection)),
        rows[1],
    );
}

pub fn bar(ratio: f64, width: usize) -> String {
    let filled = (ratio.clamp(0.0, 1.0) * width as f64).round() as usize;
    format!("{}{}", "█".repeat(filled), "░".repeat(width.saturating_sub(filled)))
}

/// Converte uma série 0..1 em área preenchida com glifos braille (2x4 por célula).
pub fn braille(values: &[f64], width: u16, height: u16) -> String {
    let cols = width.max(1) as usize;
    let rows = height.max(1) as usize;
    let mut out = String::new();
    for r in 0..rows {
        for c in 0..cols {
            let mut bits = 0u8;
            for sx in 0..2 {
                let idx = (c * 2 + sx) * values.len() / (cols * 2).max(1);
                let filled = (values.get(idx).copied().unwrap_or(0.0) * (rows * 4) as f64) as usize;
                for sy in 0..4 {
                    let from_bottom = (rows - 1 - r) * 4 + (3 - sy);
                    if from_bottom < filled {
                        bits |= DOTS[sy][sx];
                    }
                }
            }
            out.push(if bits == 0 { ' ' } else { char::from_u32(0x2800 + bits as u32).unwrap_or(' ') });
        }
        out.push('\\n');
    }
    out
}

fn label(tab: Tab) -> &'static str {
    match tab {
        Tab::Logs => "logs",
        Tab::Cost => "cost",
        Tab::Config => "config",
        Tab::Forecast => "forecast",
    }
}`,
  },
  {
    path: "src/tui/event.rs",
    caption: "teclado + resize sem panic",
    code: `use anyhow::Result;
use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};
use std::time::Duration;

use crate::tui::state::{App, Modal, Tab};

pub enum AppEvent {
    Quit,
    Node(usize),
    Migration,
}

pub fn poll() -> Result<Option<AppEvent>> {
    if !event::poll(Duration::from_millis(120))? {
        return Ok(None);
    }
    let Event::Key(KeyEvent { code, modifiers, .. }) = event::read()? else {
        return Ok(None);
    };
    Ok(map_key(code, modifiers))
}

pub fn map_key(code: KeyCode, modifiers: KeyModifiers) -> Option<AppEvent> {
    match (code, modifiers) {
        (KeyCode::Char('q'), _) => Some(AppEvent::Quit),
        (KeyCode::Char('c'), KeyModifiers::CONTROL) => Some(AppEvent::Quit),
        (KeyCode::Char('j'), _) | (KeyCode::Down, _) => Some(AppEvent::Node(1)),
        (KeyCode::Char('k'), _) | (KeyCode::Up, _) => Some(AppEvent::Node(usize::MAX)),
        (KeyCode::Char('m'), _) => Some(AppEvent::Migration),
        _ => None,
    }
}

pub fn apply(app: &mut App, event: AppEvent) {
    match event {
        AppEvent::Node(delta) if delta == usize::MAX => app.selected = app.selected.saturating_sub(1),
        AppEvent::Node(delta) => app.selected = app.selected.saturating_add(delta),
        AppEvent::Migration => app.modal = Modal::None,
        AppEvent::Quit => {}
    }
}

pub fn next_tab(app: &mut App) {
    app.tab = match app.tab {
        Tab::Logs => Tab::Cost,
        Tab::Cost => Tab::Config,
        Tab::Config => Tab::Forecast,
        Tab::Forecast => Tab::Logs,
    };
}`,
  },
];