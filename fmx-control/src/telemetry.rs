use crate::config::Config;
use crate::executor::{self, CommandSpec};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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

pub async fn collect(request: TelemetryRequest, config: &Config) -> TelemetryResult {
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
            "docker",
            vec![
                "ps".to_string(),
                "--all".to_string(),
                "--filter".to_string(),
                format!("name=^/{prefix}"),
                "--format".to_string(),
                "{{.ID}}\t{{.Names}}".to_string(),
            ],
            Duration::from_secs(4),
        );

        let containers = match executor::run(&ps_spec).await {
            Ok(result) if result.status == 0 => parse_ps(&result.stdout),
            Ok(result) => {
                last_error = clean_error(&result.stderr).or_else(|| clean_error(&result.stdout));
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

        let ids: Vec<&str> = containers.iter().map(|(id, _)| id.as_str()).collect();
        let mut args = vec![
            "stats".to_string(),
            "--no-stream".to_string(),
            "--format".to_string(),
            "{{json .}}".to_string(),
        ];
        args.extend(ids.into_iter().map(str::to_string));
        let stats_spec = CommandSpec::new("docker", args, Duration::from_secs(5));
        let stats = match executor::run(&stats_spec).await {
            Ok(result) if result.status == 0 => parse_stats(&result.stdout),
            Ok(result) => {
                last_error = clean_error(&result.stderr).or_else(|| clean_error(&result.stdout));
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
            last_error = Some(format!("docker stats sem dados para {prefix}"));
            samples.push(unavailable(&bench));
            continue;
        }

        available = true;
        samples.push(TelemetrySample {
            bench_id: bench.id,
            node_id: bench.node_id,
            cpu_pct: round2(cpu_sum / found as f64),
            ram_pct: round2(ram_sum / found as f64),
            source: "docker",
        });
    }

    let _ = config;
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

fn parse_stats(output: &str) -> std::collections::HashMap<String, (f64, f64)> {
    output
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|row| {
            let id = field(&row, &["ID", "Id", "id", "Container", "Name"])?;
            let cpu = number_field(&row, &["CPUPerc", "CpuPerc", "cpu_perc", "CPUPercent"]);
            let ram = number_field(&row, &["MemPerc", "MemoryPerc", "mem_perc", "MemoryPercent"]);
            Some((id, (cpu, ram)))
        })
        .collect()
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

fn clean_error(text: &str) -> Option<String> {
    let value = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("comando docker falhou");
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
    }

    #[test]
    fn parses_ps_output() {
        let containers = parse_ps("abc\tfm__erp_prod__frappe\ndef\tfm__erp_prod__worker\n");
        assert_eq!(containers.len(), 2);
        assert_eq!(containers[0].1, "fm__erp_prod__frappe");
    }
}
