//! Merge built-in command templates with user-defined JSON and apply `{{placeholders}}`.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

/// One runnable prompt template (preset or user-defined).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptCommand {
    pub id: String,
    pub title: String,
    pub prompt: String,
}

const EMBEDDED_DEFAULTS: &str = include_str!("../resources/default_commands.json");

/// Load factory defaults compiled into the binary (always available).
pub fn load_embedded_defaults() -> Vec<PromptCommand> {
    serde_json::from_str(EMBEDDED_DEFAULTS).unwrap_or_else(|e| {
        eprintln!("[commands] embedded defaults parse error: {}", e);
        vec![]
    })
}

pub fn user_commands_path(app_data: &PathBuf) -> PathBuf {
    app_data.join("user_commands.json")
}

/// Payload returned to the UI: user rows plus optional full merged `id` order (includes built-ins).
#[derive(Debug, Clone, Serialize)]
pub struct UserCommandsLoad {
    pub commands: Vec<PromptCommand>,
    pub order: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum UserCommandsFile {
    /// New format: explicit command rows + merged list order (ids, including built-in ids).
    V2 {
        commands: Vec<PromptCommand>,
        #[serde(default)]
        order: Vec<String>,
    },
    /// Legacy: JSON array of user command objects only.
    Legacy(Vec<PromptCommand>),
}

#[derive(Serialize)]
struct UserCommandsDiskOut {
    commands: Vec<PromptCommand>,
    order: Vec<String>,
}

fn legacy_merge_order_ids(defaults: &[PromptCommand], user_cmds: &[PromptCommand]) -> Vec<String> {
    let mut seen: HashMap<String, ()> = HashMap::new();
    let mut order: Vec<String> = Vec::new();
    for c in defaults {
        if !seen.contains_key(&c.id) {
            order.push(c.id.clone());
        }
        seen.insert(c.id.clone(), ());
    }
    for c in user_cmds {
        if !seen.contains_key(&c.id) {
            order.push(c.id.clone());
        }
        seen.insert(c.id.clone(), ());
    }
    order
}

/// Read `user_commands.json` as either a legacy array or `{ commands, order }`.
pub fn load_user_commands_snap(app_data: &PathBuf) -> UserCommandsLoad {
    let path = user_commands_path(app_data);
    if let Ok(bytes) = std::fs::read(&path) {
        match serde_json::from_slice::<UserCommandsFile>(&bytes) {
            Ok(UserCommandsFile::V2 { commands, order }) => {
                println!(
                    "[commands] loaded {} user commands + order len {} from {:?}",
                    commands.len(),
                    order.len(),
                    path
                );
                return UserCommandsLoad { commands, order };
            }
            Ok(UserCommandsFile::Legacy(v)) => {
                println!(
                    "[commands] loaded {} user commands (legacy array) from {:?}",
                    v.len(),
                    path
                );
                return UserCommandsLoad {
                    commands: v,
                    order: vec![],
                };
            }
            Err(e) => eprintln!("[commands] user_commands.json parse error: {}", e),
        }
    }
    UserCommandsLoad {
        commands: vec![],
        order: vec![],
    }
}

pub fn save_user_commands(
    app_data: &PathBuf,
    cmds: &[PromptCommand],
    order: &[String],
) -> anyhow::Result<()> {
    std::fs::create_dir_all(app_data)?;
    let path = user_commands_path(app_data);
    let payload = UserCommandsDiskOut {
        commands: cmds.to_vec(),
        order: order.to_vec(),
    };
    let json = serde_json::to_string_pretty(&payload)?;
    std::fs::write(&path, json)?;
    println!(
        "[commands] wrote {} user commands + order len {} to {:?}",
        cmds.len(),
        order.len(),
        path
    );
    Ok(())
}

/// Defaults first, then user commands; later entries with the same `id` replace earlier ones.
pub fn merged_commands(app_data: &PathBuf) -> Vec<PromptCommand> {
    let defaults = load_embedded_defaults();
    let snap = load_user_commands_snap(app_data);

    let mut map: HashMap<String, PromptCommand> = HashMap::new();
    for c in &defaults {
        map.insert(c.id.clone(), c.clone());
    }
    for c in &snap.commands {
        map.insert(c.id.clone(), c.clone());
    }

    if snap.order.is_empty() {
        let order = legacy_merge_order_ids(&defaults, &snap.commands);
        return order.into_iter().filter_map(|id| map.remove(&id)).collect();
    }

    let mut used: HashSet<String> = HashSet::new();
    let mut ordered_ids: Vec<String> = Vec::new();
    for id in &snap.order {
        if map.contains_key(id) && used.insert(id.clone()) {
            ordered_ids.push(id.clone());
        }
    }
    for id in legacy_merge_order_ids(&defaults, &snap.commands) {
        if map.contains_key(&id) && used.insert(id.clone()) {
            ordered_ids.push(id);
        }
    }

    ordered_ids
        .into_iter()
        .filter_map(|id| map.remove(&id))
        .collect()
}

/// Replace `{{input}}`, `{{clipboard}}`, `{{selection}}` (and unknown `{{key}}` with empty).
pub fn apply_placeholders(template: &str, input: &str, clipboard: &str, selection: &str) -> String {
    let mut s = template.to_string();
    s = s.replace("{{input}}", input);
    s = s.replace("{{clipboard}}", clipboard);
    s = s.replace("{{selection}}", selection);
    // Remove any remaining `{{...}}` segments to avoid leaking raw template to the model.
    let mut out = String::new();
    let mut rest = s.as_str();
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        if let Some(end) = rest.find("}}") {
            rest = &rest[end + 2..];
        } else {
            out.push_str(rest);
            return out;
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn apply_placeholders_replaces_known_and_strips_unknown() {
        let t = "A{{input}}B{{clipboard}}C{{selection}}D{{unknown}}E";
        let out = apply_placeholders(t, "i", "c", "s");
        assert_eq!(out, "AiBcCsDE");
    }

    #[test]
    fn merged_commands_user_overrides_builtin_same_id() {
        let dir = std::env::temp_dir().join(format!(
            "ime-cmd-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let user = user_commands_path(&dir);
        let payload = serde_json::json!({
            "commands": [{"id":"translate_zh","title":"t","prompt":"OVERRIDE {{input}}"}],
            "order": ["translate_zh"]
        });
        fs::write(&user, payload.to_string()).unwrap();
        let merged = merged_commands(&dir);
        let cmd = merged.iter().find(|c| c.id == "translate_zh").unwrap();
        assert_eq!(cmd.prompt, "OVERRIDE {{input}}");
    }

    #[test]
    fn merged_commands_legacy_array_includes_user_command() {
        let dir = std::env::temp_dir().join(format!(
            "ime-cmd-legacy-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let user = user_commands_path(&dir);
        let payload = serde_json::json!([
            {"id":"custom_x","title":"x","prompt":"hello {{input}}"}
        ]);
        fs::write(&user, payload.to_string()).unwrap();
        let merged = merged_commands(&dir);
        assert!(merged.iter().any(|c| c.id == "custom_x"));
    }
}
