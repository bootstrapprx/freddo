use crate::config::{Config, ProviderMode, RuntimeMode};
use crate::executor::{self, CommandSpec};
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeStatus {
    pub ok: bool,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ActiveRuntime {
    pub kind: &'static str,
    pub ok: bool,
    pub text: Option<String>,
    pub shim: Option<String>,
}

#[derive(Debug)]
pub struct Provider {
    pub kind: &'static str,
    pub mode: &'static str,
    pub available: bool,
    pub command: Option<String>,
    pub fmx: RuntimeStatus,
    /// Probe bruta da CLI docker, mantida para compatibilidade com clientes antigos.
    pub docker: RuntimeStatus,
    pub podman: RuntimeStatus,
    pub compose: RuntimeStatus,
    pub runtime: ActiveRuntime,
    shim_dir: Option<PathBuf>,
}

impl Provider {
    pub async fn detect(config: &Config) -> Self {
        let resolved = find_in_path(&config.fmx_bin);
        let docker = probe("docker", &["--version"], config).await;
        let podman = probe("podman", &["--version"], config).await;

        let mut selected = select_runtime(config, &docker, &podman);
        let mut shim_dir = create_shim_for(selected);
        let mut runtime = probe_runtime(selected, shim_dir.as_deref(), config).await;

        // No modo auto, uma CLI docker instalada sem daemon não deve bloquear um
        // host que tem Podman perfeitamente funcional.
        if config.runtime_mode == RuntimeMode::Auto
            && selected == "docker"
            && !runtime.ok
            && podman.ok
        {
            shim_dir = create_shim_for("podman");
            selected = "podman";
            runtime = probe_runtime(selected, shim_dir.as_deref(), config).await;
        }

        let compose = probe_compose(selected, config).await;
        if runtime.ok && !compose.ok {
            runtime.ok = false;
            runtime.text = Some(
                runtime
                    .text
                    .map(|text| format!("{text} · compose indisponível"))
                    .unwrap_or_else(|| "compose indisponível".to_string()),
            );
        }

        let fmx = match (&resolved, config.provider_mode) {
            (_, ProviderMode::Mock) => RuntimeStatus {
                ok: false,
                text: Some("provider mock".to_string()),
            },
            (Some(path), _) => {
                let mut spec = probe_spec(path, &["--version"], config);
                if let Some(dir) = &shim_dir {
                    spec = spec.with_path_prefix(dir);
                }
                run_spec(spec).await
            }
            (None, _) => RuntimeStatus {
                ok: false,
                text: Some(format!("{} não encontrado no PATH", config.fmx_bin)),
            },
        };

        let (kind, mode, available) = match config.provider_mode {
            ProviderMode::Mock => ("mock", "forced", false),
            ProviderMode::Fmx => ("fmx", "forced", fmx.ok),
            ProviderMode::Auto if fmx.ok => ("fmx", "auto", true),
            ProviderMode::Auto => ("mock", "auto", false),
        };

        Self {
            kind,
            mode,
            available,
            command: resolved.map(|path| path.to_string_lossy().into_owned()),
            fmx,
            docker,
            podman,
            compose,
            runtime,
            shim_dir,
        }
    }

    pub fn command(&self) -> Result<&str, &'static str> {
        self.command.as_deref().ok_or("FMX_BIN_NOT_FOUND")
    }

    /// Injeta o shim docker → podman apenas nos comandos que o `fmx` executa.
    pub fn prepare(&self, spec: CommandSpec) -> CommandSpec {
        match &self.shim_dir {
            Some(dir) => spec.with_path_prefix(dir),
            None => spec,
        }
    }
}

impl Drop for Provider {
    fn drop(&mut self) {
        if let Some(dir) = &self.shim_dir {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

fn select_runtime(config: &Config, docker: &RuntimeStatus, podman: &RuntimeStatus) -> &'static str {
    match config.runtime_mode {
        RuntimeMode::Docker => "docker",
        RuntimeMode::Podman => "podman",
        RuntimeMode::Auto if docker.ok => "docker",
        RuntimeMode::Auto if podman.ok => "podman",
        RuntimeMode::Auto => "none",
    }
}

fn create_shim_for(kind: &'static str) -> Option<PathBuf> {
    if kind != "podman" {
        return None;
    }
    create_docker_shim().ok()
}

async fn probe(program: impl AsRef<Path>, args: &[&str], config: &Config) -> RuntimeStatus {
    run_spec(probe_spec(program, args, config)).await
}

fn probe_spec(program: impl AsRef<Path>, args: &[&str], config: &Config) -> CommandSpec {
    let mut spec = CommandSpec::new(
        program.as_ref().to_string_lossy().into_owned(),
        args.iter().map(|value| value.to_string()).collect(),
        config.health_timeout,
    );
    if let Some(home) = &config.fmx_home {
        spec = spec.with_env("FRAPPE_MANAGER_HOME", home);
    }
    spec
}

async fn run_spec(spec: CommandSpec) -> RuntimeStatus {
    match executor::run(&spec).await {
        Ok(result) if result.status == 0 => RuntimeStatus {
            ok: true,
            text: first_line(&result.stdout).or_else(|| first_line(&result.stderr)),
        },
        Ok(result) => RuntimeStatus {
            ok: false,
            text: Some(
                first_line(&result.stderr)
                    .or_else(|| first_line(&result.stdout))
                    .unwrap_or_else(|| format!("exit {}", result.status)),
            ),
        },
        Err(error) => RuntimeStatus {
            ok: false,
            text: Some(error.message()),
        },
    }
}

/// Valida o mesmo contrato usado pelo Frappe-Manager: `version --format json`
/// precisa conter uma chave `Server` não vazia.
async fn probe_runtime(
    kind: &'static str,
    shim_dir: Option<&Path>,
    config: &Config,
) -> ActiveRuntime {
    let shim = shim_dir.map(|path| path.to_string_lossy().into_owned());
    if kind == "none" {
        return ActiveRuntime {
            kind,
            ok: false,
            text: Some("docker e podman não encontrados".to_string()),
            shim,
        };
    }
    if kind == "podman" && shim_dir.is_none() {
        return ActiveRuntime {
            kind,
            ok: false,
            text: Some("falha ao criar o shim docker → podman".to_string()),
            shim,
        };
    }

    let mut spec = probe_spec("docker", &["version", "--format", "json"], config);
    if let Some(dir) = shim_dir {
        spec = spec.with_path_prefix(dir);
    }

    let status = match executor::run(&spec).await {
        Ok(result) if result.status == 0 => {
            let server = serde_json::from_str::<Value>(&result.stdout)
                .ok()
                .and_then(|value| value.get("Server").cloned());
            let ready = server
                .as_ref()
                .map(|value| match value {
                    Value::Object(map) => !map.is_empty(),
                    Value::Null | Value::Bool(false) => false,
                    _ => true,
                })
                .unwrap_or(false);
            RuntimeStatus {
                ok: ready,
                text: Some(if ready {
                    format!("{kind} pronto para o fmx")
                } else {
                    "resposta sem Server: o fmx rejeitaria este runtime".to_string()
                }),
            }
        }
        Ok(result) => RuntimeStatus {
            ok: false,
            text: Some(
                first_line(&result.stderr)
                    .or_else(|| first_line(&result.stdout))
                    .unwrap_or_else(|| format!("exit {}", result.status)),
            ),
        },
        Err(error) => RuntimeStatus {
            ok: false,
            text: Some(error.message()),
        },
    };

    ActiveRuntime {
        kind,
        ok: status.ok,
        text: status.text,
        shim,
    }
}

async fn probe_compose(kind: &'static str, config: &Config) -> RuntimeStatus {
    let program = if kind == "podman" { "podman" } else { "docker" };
    probe(program, &["compose", "version"], config).await
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn find_in_path(command: &str) -> Option<PathBuf> {
    let candidate = Path::new(command);
    if candidate.components().count() > 1 {
        return candidate.is_file().then(|| candidate.to_path_buf());
    }

    let path = env::var_os("PATH")?;
    env::split_paths(&path)
        .map(|dir| dir.join(command))
        .find(|path| is_executable(path))
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_file()
        && path
            .metadata()
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

const DOCKER_SHIM: &str = r#"#!/usr/bin/env python3
"""Compatibilidade mínima da CLI docker com o Podman para o Frappe-Manager."""
import json
import os
import subprocess
import sys

args = sys.argv[1:]

if args and args[0] == "version":
    fmt = None
    for index, arg in enumerate(args):
        if arg in ("--format", "-f") and index + 1 < len(args):
            fmt = args[index + 1]
            break
        if arg.startswith("--format="):
            fmt = arg.split("=", 1)[1]
            break
    if fmt in ("json", "{{json .}}"):
        try:
            payload = json.loads(
                subprocess.check_output(
                    ["podman", "version", "--format", "json"], text=True
                )
            )
            client = payload.get("Client") or {}
            if not payload.get("Server"):
                payload["Server"] = {
                    "Version": client.get("Version", ""),
                    "APIVersion": client.get("APIVersion", ""),
                }
            print(json.dumps(payload))
            sys.exit(0)
        except Exception as exc:
            print(f"docker shim: {exc}", file=sys.stderr)
            sys.exit(1)

os.execvp("podman", ["podman", *args])
"#;

fn create_docker_shim() -> std::io::Result<PathBuf> {
    let temp = env::temp_dir();
    cleanup_stale_shims(&temp);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = temp.join(format!(
        "fmx-control-docker-shim-{}-{nonce:x}",
        std::process::id()
    ));
    fs::create_dir_all(&dir)?;
    fs::write(dir.join("docker"), DOCKER_SHIM)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir.join("docker"), fs::Permissions::from_mode(0o755))?;
    }

    Ok(dir)
}

/// SIGTERM não executa destructors: limpa diretórios de daemons que já não existem.
fn cleanup_stale_shims(temp: &Path) {
    let Ok(entries) = fs::read_dir(temp) else {
        return;
    };
    let current = std::process::id();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.strip_prefix("fmx-control-docker-shim-") else {
            continue;
        };
        let Some(pid) = rest.split('-').next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };
        if pid != current && !process_alive(pid) {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    let Ok(stat) = fs::read_to_string(format!("/proc/{pid}/stat")) else {
        return false;
    };
    // O campo logo após o nome entre parênteses é o estado: Z = zombie.
    let state = stat
        .rsplit_once(')')
        .and_then(|(_, rest)| rest.trim_start().chars().next())
        .unwrap_or('Z');
    state != 'Z'
}

#[cfg(not(unix))]
fn process_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_docker_first_in_auto() {
        let mut config = Config::from_env();
        config.runtime_mode = RuntimeMode::Auto;
        let ok = RuntimeStatus { ok: true, text: None };
        let bad = RuntimeStatus { ok: false, text: None };
        assert_eq!(select_runtime(&config, &ok, &bad), "docker");
        assert_eq!(select_runtime(&config, &bad, &ok), "podman");
    }
}
