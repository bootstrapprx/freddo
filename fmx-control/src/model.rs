use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct ApiEnvelope<T: Serialize> {
    pub request_id: String,
    pub operation_id: Option<String>,
    pub status: &'static str,
    pub data: Option<T>,
    pub error: Option<ApiError>,
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OperationEvent {
    pub id: String,
    pub time: String,
    pub level: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Operation {
    pub id: String,
    pub kind: &'static str,
    pub bench: String,
    pub status: &'static str,
    pub summary: String,
    pub created_at: String,
    pub finished_at: Option<String>,
    pub events: Vec<OperationEvent>,
}

#[derive(Debug, Deserialize)]
pub struct BenchInput {
    pub name: String,
    #[serde(default = "default_apps")]
    pub apps: Vec<String>,
    #[serde(default = "default_environment")]
    pub environment: String,
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub python: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MigrationInput {
    #[serde(default = "default_target")]
    pub target: String,
    #[serde(default)]
    pub site: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ScaleInput {
    pub replicas: u32,
    #[serde(default = "default_scope")]
    pub scope: String,
}

#[derive(Debug, Deserialize)]
pub struct NodeInput {
    pub name: String,
    pub host: String,
}

fn default_apps() -> Vec<String> {
    vec!["erpnext".to_string()]
}

fn default_environment() -> String {
    "dev".to_string()
}

fn default_target() -> String {
    "site".to_string()
}

fn default_scope() -> String {
    "workers".to_string()
}

pub fn request_id() -> String {
    let seq = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut hasher = DefaultHasher::new();
    std::process::id().hash(&mut hasher);
    seq.hash(&mut hasher);
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    format!("req-{:016x}", hasher.finish())
}

pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;
    let second = rem % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z"
    )
}

fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month as u32, day as u32)
}

pub fn valid_identifier(value: &str, allow_dots: bool) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 120 {
        return false;
    }
    value.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || ch == '-'
            || ch == '_'
            || (allow_dots && ch == '.')
    }) && !value.starts_with(|ch: char| matches!(ch, '-' | '_' | '.'))
        && !value.ends_with(|ch: char| matches!(ch, '-' | '_' | '.'))
}

pub fn valid_app(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 160 {
        return false;
    }
    value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '-' | '_' | ':' | '@')
    })
}
