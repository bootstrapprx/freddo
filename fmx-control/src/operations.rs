use crate::model::{now_iso, Operation, OperationEvent};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Operations {
    inner: Arc<Mutex<Inner>>,
    max_events: usize,
}

struct Inner {
    operations: HashMap<String, Operation>,
    locked: HashSet<String>,
    sequence: u64,
}

impl Operations {
    pub fn new(max_events: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                operations: HashMap::new(),
                locked: HashSet::new(),
                sequence: 0,
            })),
            max_events,
        }
    }

    pub fn start(&self, kind: &'static str, bench: &str) -> Result<String, Option<String>> {
        let mut inner = self.lock();
        if inner.locked.contains(bench) {
            let existing = inner
                .operations
                .values()
                .find(|op| op.bench == bench && op.status == "running")
                .map(|op| op.id.clone());
            return Err(existing);
        }

        inner.locked.insert(bench.to_string());
        let bench_key = bench.replace(
            |ch: char| matches!(ch, '-' | '_' | '.'),
            "",
        );
        let id = format!("op-{bench_key}-{:04x}", inner.sequence);
        inner.sequence = inner.sequence.wrapping_add(1);
        inner.operations.insert(
            id.clone(),
            Operation {
                id: id.clone(),
                kind,
                bench: bench.to_string(),
                status: "running",
                summary: "operação iniciada".to_string(),
                created_at: now_iso(),
                finished_at: None,
                events: Vec::new(),
            },
        );
        Ok(id)
    }

    pub fn push_event(&self, id: &str, level: &'static str, message: String) {
        let mut inner = self.lock();
        let Some(operation) = inner.operations.get_mut(id) else {
            return;
        };
        operation.events.push(OperationEvent {
            id: format!("ev-{:04}", operation.events.len()),
            time: now_iso(),
            level,
            message,
        });
        if operation.events.len() > self.max_events {
            let excess = operation.events.len() - self.max_events;
            operation.events.drain(0..excess);
        }
    }

    pub fn finish(&self, id: &str, status: &'static str, summary: impl Into<String>) {
        let mut inner = self.lock();
        let bench = if let Some(operation) = inner.operations.get_mut(id) {
            operation.status = status;
            operation.summary = summary.into();
            operation.finished_at = Some(now_iso());
            Some(operation.bench.clone())
        } else {
            None
        };
        if let Some(bench) = bench {
            inner.locked.remove(&bench);
        }
    }

    pub fn get(&self, id: &str) -> Option<Operation> {
        self.lock().operations.get(id).cloned()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|error| error.into_inner())
    }
}
