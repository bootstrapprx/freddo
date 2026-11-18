use std::time::Duration;

#[derive(Debug, Clone)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub envs: Vec<(String, String)>,
    pub timeout: Duration,
}

impl CommandSpec {
    pub fn new(program: impl Into<String>, args: Vec<String>, timeout: Duration) -> Self {
        Self {
            program: program.into(),
            args,
            envs: Vec::new(),
            timeout,
        }
    }

    pub fn with_env(mut self, key: &str, value: &str) -> Self {
        self.envs.push((key.to_string(), value.to_string()));
        self
    }

    pub fn display(&self) -> String {
        format!("{} {}", self.program, self.args.join(" "))
    }
}

#[derive(Debug, Clone)]
pub struct CommandResult {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug)]
pub enum ExecutorError {
    Spawn(String),
    Timeout,
}

impl ExecutorError {
    pub fn message(&self) -> String {
        match self {
            Self::Spawn(message) => format!("falha ao executar comando: {message}"),
            Self::Timeout => "timeout ao executar comando".to_string(),
        }
    }
}

pub async fn run(spec: &CommandSpec) -> Result<CommandResult, ExecutorError> {
    let mut command = tokio::process::Command::new(&spec.program);
    command
        .args(&spec.args)
        .envs(spec.envs.iter().map(|(key, value)| (key, value)))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    match tokio::time::timeout(spec.timeout, command.output()).await {
        Ok(Ok(output)) => Ok(CommandResult {
            status: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }),
        Ok(Err(error)) => Err(ExecutorError::Spawn(error.to_string())),
        Err(_) => Err(ExecutorError::Timeout),
    }
}

const SECRET_HINTS: [&str; 5] = ["PASSWORD", "TOKEN", "SECRET", "API_KEY", "LICENSE"];

/// Reduz o risco de vazar credenciais que o FMX imprime em tabelas/logs.
pub fn redact(text: &str) -> String {
    text.lines()
        .map(|line| {
            let upper = line.to_uppercase();
            if !SECRET_HINTS.iter().any(|hint| upper.contains(hint)) {
                return line.to_string();
            }
            if let Some((key, _)) = line.split_once('=') {
                format!("{key}=••••••")
            } else if let Some((key, _)) = line.split_once(':') {
                format!("{key}: ••••••")
            } else {
                "<redacted>".to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secret_values() {
        let input = "DB_PASSWORD=super-secret\nfrappe: normal\ngithub_token: abc123";
        let output = redact(input);
        assert!(output.contains("DB_PASSWORD=••••••"));
        assert!(output.contains("github_token: ••••••"));
        assert!(!output.contains("super-secret"));
        assert!(!output.contains("abc123"));
        assert!(output.contains("frappe: normal"));
    }
}
