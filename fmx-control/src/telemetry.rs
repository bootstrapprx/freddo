use crate::config::Config;
use crate::executor::{self, CommandSpec};
use crate::provider::Provider;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Deserialize)]
pub struct TelemetryRequest {
    #[serde(default)]
    pub benches: Vec<TelemetryBench>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryBench {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub node_id: String,
}

#[derive(Debug, Serialize)]
pub struct TelemetrySample {
    pub bench_id: String,
    pub node_id: String,
    pub cpu_pct: f64,
    pub ram_pct: f64,
    pub source: &'static str,
}

#[derive(Debug, Serialize)]
pub struct TelemetryResult {
    pub available: bool,
    pub collected_at: String,
    pub error: Option<String>,
    pub samples: Vec<TelemetrySample>,
}

pub async fn collect(
    request: TelemetryRequest,
    config: &Config,
    provider: &Provider,
) -> TelemetryResult {
    let runtime: &'static str = if provider.runtime.kind == "podman" {
        "podman"
    } else {
        "docker"
    };
    let ps_timeout = config.health_timeout.max(Duration::from_secs(3));
    let stats_timeout = config.health_timeout.max(Duration::from_secs(5));
    let mut samples = Vec::with_capacity(request.benches.len());
    let mut available = false;
    let mut last_error: Option<String> = None;

    for bench in request.benches {
        if bench.id.is_empty() {
            continue;
        }
        let name = if bench.name.is_empty() {
            bench.id.clone()
        } else {
            bench.name.clone()
        };
        let prefix = format!("fm__{}", name.replace('.', "_"));
        let ps_spec = CommandSpec::new(
            runtime,
            vec![
                "ps".to_string(),
                "--all".to_string(),
                "--filter".to_string(),
                format!("name=^/{prefix}"),
                "--format".to_string(),
                "{{.ID}}\t{{.Names}}".to_string(),
            ],
            ps_timeout,
        );

        let containers = match executor::run(&ps_spec).await {
            Ok(result) if result.status == 0 => parse_ps(&result.stdout),
            Ok(result) => {
                last_error = clean_error(&result.stderr, runtime).or_else(|| clean_error(&result.stdout, runtime));
                samples.push(unavailable(&bench));
                continue;
            }
            Err(error) => {
                last_error = Some(error.message());
                samples.push(unavailable(&bench));
                continue;
            }
        };

        if containers.is_empty() {
            last_error = Some(format!("nenhum container FMX encontrado para {prefix}"));
            samples.push(unavailable(&bench));
            continue;
        }

        let mut args = vec!["stats".to_string()];
        if runtime == "podman" {
            // O podman exige --all para ver containers parados, mas rejeita --all
            // combinado com IDs. Casamos as linhas pelo nome do container.
            args.push("--all".to_string());
        }
        args.extend([
            "--no-stream".to_string(),
            "--format".to_string(),
            "{{json .}}".to_string(),
        ]);
        if runtime != "podman" {
            let ids: Vec<&str> = containers.iter().map(|(id, _)| id.as_str()).collect();
            args.extend(ids.into_iter().map(str::to_string));
        }
        let stats_spec = CommandSpec::new(runtime, args, stats_timeout);
        let stats = match executor::run(&stats_spec).await {
            Ok(result) if result.status == 0 => parse_stats(&result.stdout),
            Ok(result) => {
                last_error = clean_error(&result.stderr, runtime).or_else(|| clean_error(&result.stdout, runtime));
                samples.push(unavailable(&bench));
                continue;
            }
            Err(error) => {
                last_error = Some(error.message());
                samples.push(unavailable(&bench));
                continue;
            }
        };

        let mut cpu_sum = 0.0;
        let mut ram_sum = 0.0;
        let mut found = 0usize;
        for (id, name) in &containers {
            let stat = stats.get(id).or_else(|| stats.get(name));
            if let Some((cpu, ram)) = stat {
                cpu_sum += cpu;
                ram_sum += ram;
                found += 1;
            }
        }

        if found == 0 {
            last_error = Some(format!("{runtime} stats sem dados para {prefix}"));
            samples.push(unavailable(&bench));
            continue;
        }

        available = true;
        samples.push(TelemetrySample {
            bench_id: bench.id,
            node_id: bench.node_id,
            cpu_pct: round2(cpu_sum / found as f64),
            ram_pct: round2(ram_sum / found as f64),
            source: runtime,
        });
    }

    TelemetryResult {
        available,
        collected_at: crate::model::now_iso(),
        error: last_error,
        samples,
    }
}

fn unavailable(bench: &TelemetryBench) -> TelemetrySample {
    TelemetrySample {
        bench_id: bench.id.clone(),
        node_id: bench.node_id.clone(),
        cpu_pct: 0.0,
        ram_pct: 0.0,
        source: "unavailable",
    }
}

fn parse_ps(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(2, '\t');
            let id = fields.next()?.trim().to_string();
            let name = fields.next().unwrap_or_default().trim().to_string();
            if id.is_empty() {
                None
            } else {
                Some((id, name))
            }
        })
        .collect()
}

/// Indexa cada linha por ID e por nome: o `podman ps` devolve IDs curtos enquanto
/// o `podman stats` reporta `ContainerID` completo.
fn parse_stats(output: &str) -> HashMap<String, (f64, f64)> {
    let mut stats = HashMap::new();
    for row in output.lines().filter_map(|line| serde_json::from_str::<Value>(line).ok()) {
        let cpu = number_field(
            &row,
            &["CPU", "CPUPerc", "CpuPerc", "cpu_perc", "CPUPercent"],
        );
        let ram = number_field(
            &row,
            &["MemPerc", "MemoryPerc", "mem_perc", "MemoryPercent"],
        );
        let value = (cpu, ram);
        if let Some(id) = field(&row, &["ContainerID", "ID", "Id", "id", "Container"]) {
            stats.insert(id, value);
        }
        if let Some(name) = field(&row, &["Name", "Names"]) {
            stats.insert(name, value);
        }
    }
    stats
}

fn field<'a>(row: &'a Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| row.get(*key).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn number_field(row: &Value, keys: &[&str]) -> f64 {
    keys.iter()
        .find_map(|key| row.get(*key))
        .map(|value| match value {
            Value::Number(number) => number.as_f64().unwrap_or(0.0),
            Value::String(text) => parse_percent(text),
            _ => 0.0,
        })
        .unwrap_or(0.0)
}

fn parse_percent(value: &str) -> f64 {
    value
        .trim()
        .trim_end_matches('%')
        .replace(',', ".")
        .parse::<f64>()
        .unwrap_or(0.0)
        .clamp(0.0, 100.0)
}

fn clean_error(text: &str, runtime: &str) -> Option<String> {
    let fallback = format!("comando {runtime} falhou");
    let value = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or(&fallback);
    Some(value.to_string())
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_docker_stats_jsonl() {
        let input = concat!(
            "{\"ID\":\"abc\",\"Name\":\"fm__erp_prod__frappe\",\"CPUPerc\":\"12.50%\",\"MemPerc\":\"40.20%\"}\n",
            "not json\n"
        );
        let stats = parse_stats(input);
        assert_eq!(stats.get("abc"), Some(&(12.5, 40.2)));
        assert_eq!(stats.get("fm__erp_prod__frappe"), Some(&(12.5, 40.2)));
    }

    #[test]
    fn parses_podman_stats_jsonl() {
        let input = concat!(
            "{\"AvgCPU\":0,\"ContainerID\":\"a18e0f0e22538f5a1e7e6e350a88a0709d50d596446962cf9d2925b912d142a8\",",
            "\"Name\":\"fm__erp_prod__frappe\",\"CPU\":12.5,\"MemPerc\":40.2}\n"
        );
        let stats = parse_stats(input);
        assert_eq!(
            stats.get("a18e0f0e22538f5a1e7e6e350a88a0709d50d596446962cf9d2925b912d142a8"),
            Some(&(12.5, 40.2))
        );
        assert_eq!(stats.get("fm__erp_prod__frappe"), Some(&(12.5, 40.2)));
    }

    #[test]
    fn parses_ps_output() {
        let containers = parse_ps("abc\tfm__erp_prod__frappe\ndef\tfm__erp_prod__worker\n");
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].1, "fm__erp_prod__frappe");
    }
}
