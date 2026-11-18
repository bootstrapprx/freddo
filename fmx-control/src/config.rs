use std::env;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderMode {
    Auto,
    Fmx,
    Mock,
}

#[derive(Clone)]
pub struct Config {
    pub bind: String,
    pub fmx_bin: String,
    pub provider_mode: ProviderMode,
    pub daemon_token: Option<String>,
    pub fmx_home: Option<String>,
    pub command_timeout: Duration,
    pub health_timeout: Duration,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            bind: env::var("FMX_BIND").unwrap_or_else(|_| "127.0.0.1:7420".to_string()),
            fmx_bin: env::var("FMX_BIN").unwrap_or_else(|_| "fmx".to_string()),
            provider_mode: match env::var("FMX_PROVIDER")
                .unwrap_or_else(|_| "auto".to_string())
                .trim()
                .to_lowercase()
                .as_str()
            {
                "fmx" => ProviderMode::Fmx,
                "mock" => ProviderMode::Mock,
                _ => ProviderMode::Auto,
            },
            daemon_token: env::var("FMX_DAEMON_TOKEN").ok().filter(|v| !v.is_empty()),
            fmx_home: env::var("FRAPPE_MANAGER_HOME").ok().filter(|v| !v.is_empty()),
            command_timeout: Duration::from_secs(env_secs("FMX_COMMAND_TIMEOUT", 300)),
            health_timeout: Duration::from_secs(env_secs("FMX_HEALTH_TIMEOUT", 3)),
        }
    }
}

fn env_secs(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}
