//! Model competition: probe latency, score candidates, pick the best active model.
//!
//! Scoring only runs when `CompetitionSettings.enabled` is true. Three factors:
//! 1. Connection latency (lower is better) -- auto-probed via `GET /models`
//! 2. Throughput tokens/sec (higher is better) -- manual override or measured average
//! 3. Cost per 1K tokens (lower is better) -- user-configured

use crate::ai;
use crate::config::{AppSettings, CompetitionCandidate, CompetitionSettings};
use crate::secrets;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Per-candidate score breakdown returned to the UI for transparency.
#[derive(Debug, Clone, Serialize)]
pub struct CandidateScore {
    pub id: String,
    pub label: String,
    pub score: f64,
    pub latency_ms: Option<f64>,
    pub throughput_tps: Option<f64>,
    pub cost_per_1k: f64,
    pub norm_latency: f64,
    pub norm_throughput: f64,
    pub norm_cost: f64,
}

/// Result of a full competition evaluation pass.
#[derive(Debug, Clone, Serialize)]
pub struct CompetitionEvalResult {
    pub winner_id: Option<String>,
    pub scores: Vec<CandidateScore>,
    pub applied: bool,
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Effective throughput for scoring: prefer manual override, else measured average.
pub fn effective_throughput(c: &CompetitionCandidate) -> Option<f64> {
    if let Some(m) = c.manual_throughput_tps {
        if m > 0.0 {
            return Some(m);
        }
    }
    c.measured_throughput_tps.filter(|v| *v > 0.0)
}

/// Normalize a set of positive values into [0, 1] where higher raw -> higher norm.
fn normalize_higher_better(values: &[Option<f64>]) -> Vec<f64> {
    let present: Vec<f64> = values
        .iter()
        .filter_map(|v| *v)
        .filter(|v| *v > 0.0)
        .collect();
    if present.is_empty() {
        return values.iter().map(|_| 0.5).collect();
    }
    let min_v = present.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_v = present.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let span = (max_v - min_v).max(1e-9);
    values
        .iter()
        .map(|v| match v {
            Some(x) if *x > 0.0 => (*x - min_v) / span,
            _ => 0.0,
        })
        .collect()
}

/// Normalize so that *lower* raw values score higher (latency, cost).
fn normalize_lower_better(values: &[Option<f64>]) -> Vec<f64> {
    let present: Vec<f64> = values
        .iter()
        .filter_map(|v| *v)
        .filter(|v| *v >= 0.0)
        .collect();
    if present.is_empty() {
        return values.iter().map(|_| 0.5).collect();
    }
    let min_v = present.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_v = present.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let span = (max_v - min_v).max(1e-9);
    values
        .iter()
        .map(|v| match v {
            Some(x) if *x >= 0.0 => 1.0 - ((*x - min_v) / span),
            _ => 0.0,
        })
        .collect()
}

/// Score all enabled candidates and return ranked breakdowns + winner id.
pub fn evaluate(settings: &CompetitionSettings) -> CompetitionEvalResult {
    if !settings.enabled {
        println!("[competition] evaluate skipped -- competition disabled");
        return CompetitionEvalResult {
            winner_id: None,
            scores: Vec::new(),
            applied: false,
        };
    }

    let enabled: Vec<&CompetitionCandidate> =
        settings.candidates.iter().filter(|c| c.enabled).collect();

    if enabled.is_empty() {
        println!("[competition] evaluate: no enabled candidates");
        return CompetitionEvalResult {
            winner_id: None,
            scores: Vec::new(),
            applied: false,
        };
    }

    let latencies: Vec<Option<f64>> = enabled.iter().map(|c| c.measured_latency_ms).collect();
    let throughputs: Vec<Option<f64>> = enabled.iter().map(|c| effective_throughput(c)).collect();
    let costs: Vec<Option<f64>> = enabled
        .iter()
        .map(|c| Some(c.cost_per_1k_tokens.max(0.0)))
        .collect();

    let norm_lat = normalize_lower_better(&latencies);
    let norm_tp = normalize_higher_better(&throughputs);
    let norm_cost = normalize_lower_better(&costs);

    // Renormalize weights so they always sum to 1 even if the user edits them.
    let w_sum =
        (settings.weight_latency + settings.weight_throughput + settings.weight_cost).max(1e-9);
    let w_l = settings.weight_latency / w_sum;
    let w_t = settings.weight_throughput / w_sum;
    let w_c = settings.weight_cost / w_sum;

    let mut scores: Vec<CandidateScore> = enabled
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let score = w_l * norm_lat[i] + w_t * norm_tp[i] + w_c * norm_cost[i];
            CandidateScore {
                id: c.id.clone(),
                label: c.label.clone(),
                score,
                latency_ms: c.measured_latency_ms,
                throughput_tps: effective_throughput(c),
                cost_per_1k: c.cost_per_1k_tokens,
                norm_latency: norm_lat[i],
                norm_throughput: norm_tp[i],
                norm_cost: norm_cost[i],
            }
        })
        .collect();

    scores.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let winner_id = scores.first().map(|s| s.id.clone());
    println!(
        "[competition] evaluate winner={:?} scores={}",
        winner_id,
        scores
            .iter()
            .map(|s| format!("{}:{:.3}", s.label, s.score))
            .collect::<Vec<_>>()
            .join(", ")
    );

    CompetitionEvalResult {
        winner_id,
        scores,
        applied: false,
    }
}

/// Run scoring and, if a winner differs from the active model, apply it onto `settings`.
pub fn evaluate_and_apply(settings: &mut AppSettings) -> CompetitionEvalResult {
    let mut result = evaluate(&settings.competition);
    if !settings.competition.enabled {
        return result;
    }
    let Some(ref winner_id) = result.winner_id else {
        return result;
    };
    let already = settings
        .competition
        .active_candidate_id
        .as_ref()
        .map(|id| id == winner_id)
        .unwrap_or(false);
    if already {
        if let Some(c) = settings
            .competition
            .candidates
            .iter()
            .find(|c| &c.id == winner_id)
            .cloned()
        {
            settings.apply_candidate(&c);
        }
        result.applied = false;
        return result;
    }
    if let Some(c) = settings
        .competition
        .candidates
        .iter()
        .find(|c| &c.id == winner_id)
        .cloned()
    {
        settings.apply_candidate(&c);
        result.applied = true;
        println!(
            "[competition] switched active model -> {} ({})",
            c.label, c.model
        );
    }
    result
}

/// Probe connection latency for one candidate (`GET /models` RTT in ms).
pub async fn probe_candidate(
    client: &reqwest::Client,
    app_data: &Path,
    candidate: &CompetitionCandidate,
    timeout_secs: u64,
) -> Result<f64, String> {
    let mut probe_settings = AppSettings::default();
    probe_settings.provider = candidate.provider.clone();
    probe_settings.base_url = candidate.base_url.clone();
    probe_settings.model = candidate.model.clone();
    probe_settings.timeout_secs = timeout_secs.max(5).min(60);

    let api_key = secrets::get_api_key_slot(app_data, candidate.provider.secret_slot());

    let started = std::time::Instant::now();
    ai::test_connection(client, &probe_settings, api_key.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    println!(
        "[competition] probe ok id={} label={} latency_ms={:.1}",
        candidate.id, candidate.label, ms
    );
    Ok(ms)
}

/// Probe all enabled candidates that are due (or force=true), update measured latency in place.
pub async fn probe_due_candidates(
    client: &reqwest::Client,
    app_data: &Path,
    settings: &mut AppSettings,
    force: bool,
) -> usize {
    if !settings.competition.enabled {
        println!("[competition] probe skipped -- competition disabled");
        return 0;
    }
    let interval = settings.competition.probe_interval_secs.max(30);
    let now = now_unix();
    let timeout = settings.timeout_secs;
    let mut updated = 0usize;

    let due_ids: Vec<String> = settings
        .competition
        .candidates
        .iter()
        .filter(|c| {
            if !c.enabled {
                return false;
            }
            if force {
                return true;
            }
            match c.last_probe_unix {
                None => true,
                Some(ts) => now.saturating_sub(ts) >= interval,
            }
        })
        .map(|c| c.id.clone())
        .collect();

    for id in due_ids {
        let snapshot = match settings
            .competition
            .candidates
            .iter()
            .find(|c| c.id == id)
            .cloned()
        {
            Some(c) => c,
            None => continue,
        };
        match probe_candidate(client, app_data, &snapshot, timeout).await {
            Ok(ms) => {
                if let Some(c) = settings
                    .competition
                    .candidates
                    .iter_mut()
                    .find(|c| c.id == id)
                {
                    c.measured_latency_ms = Some(ms);
                    c.last_probe_unix = Some(now);
                    updated += 1;
                }
            }
            Err(e) => {
                eprintln!(
                    "[competition] probe failed id={} label={} err={}",
                    snapshot.id, snapshot.label, e
                );
                if let Some(c) = settings
                    .competition
                    .candidates
                    .iter_mut()
                    .find(|c| c.id == id)
                {
                    c.last_probe_unix = Some(now);
                }
            }
        }
    }
    println!("[competition] probe pass updated={updated}");
    updated
}

/// Update rolling average throughput after a successful generation.
pub fn record_throughput_sample(
    settings: &mut AppSettings,
    candidate_id: Option<&str>,
    tokens: Option<u64>,
    elapsed_secs: f64,
) {
    if !settings.competition.enabled {
        return;
    }
    if elapsed_secs <= 0.05 {
        return;
    }
    let Some(tok) = tokens.filter(|t| *t > 0) else {
        return;
    };
    let sample = tok as f64 / elapsed_secs;
    let id = candidate_id
        .map(|s| s.to_string())
        .or_else(|| settings.competition.active_candidate_id.clone());
    let Some(id) = id else {
        return;
    };
    if let Some(c) = settings
        .competition
        .candidates
        .iter_mut()
        .find(|c| c.id == id)
    {
        let next = match c.measured_throughput_tps {
            Some(old) if old > 0.0 => 0.3 * sample + 0.7 * old,
            _ => sample,
        };
        c.measured_throughput_tps = Some(next);
        println!(
            "[competition] throughput sample id={} sample={:.2} tps ema={:.2}",
            id, sample, next
        );
    }
}
