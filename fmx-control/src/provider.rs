use crate::config::{Config, ProviderMode};
use crate::executor::{self, CommandSpec};
use serde::Serialize;
use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeStatus {
    pub ok: bool,
    pub text: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Provider {
    pub kind: &'static str,
    pub mode: &'static str,
    pub available: bool,
    pub command: Option<String>,
    pub fmx: RuntimeStatus,
    pub docker: RuntimeStatus,
    pub compose: RuntimeStatus,
}

impl Provider {
    pub async fn detect(config: &Config) -> Self {
        let resolved = if config.provider_mode == ProviderMode::Mock {
            find_in_path(&config.fmx_bin)
        } else {
            find_in_path(&config.fmx_bin)
        };

        let fmx = match (&resolved, config.provider_mode) {
            (_, ProviderMode::Mock) => RuntimeStatus {
                ok: false,
                text: Some("provider mock".to_string()),
            },
            (Some(path), _) => probe(path.as_path(), &["--version".to_string()], config).await,
            (None, _) => RuntimeStatus {
                ok: false,
                text: Some(format!("{} não encontrado no PATH", config.fmx_bin)),
            },
        };

        let docker = probe("docker", &["--version".to_string()], config).await;
        let compose = probe("docker", &["compose".to_string(), "version".to_string()], config).await;

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
            compose,
        }
    }

    pub fn command(&self) -> Result<&str, &'static str> {
        self.command.as_deref().ok_or("FMX_BIN_NOT_FOUND")
    }
}

async fn probe(program: impl AsRef<Path>, args: &[String], config: &Config) -> RuntimeStatus {
    let program = program.as_ref().to_string_lossy().into_owned();
    let mut spec = CommandSpec::new(program, args.to_vec(), config.health_timeout);
    if let Some(home) = &config.fmx_home {
        spec = spec.with_env("FRAPPE_MANAGER_HOME", home);
    }
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
