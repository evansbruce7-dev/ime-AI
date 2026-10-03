//! Store API keys in the OS credential vault (Windows Credential Manager) with app-data file mirrors.
//!
//! Supports multiple named slots (per LLM provider + per translation service).
//! Legacy OpenRouter keys (`openrouter_api_key`) are migrated transparently into the
//! `open_router` slot on first read.

use keyring::Entry;
use std::fs;
use std::path::{Path, PathBuf};

const SERVICE: &str = "ime-ai-companion";

/// Legacy single-key slot used by older builds (OpenRouter only).
const LEGACY_USER_KEY: &str = "openrouter_api_key";
const LEGACY_FALLBACK_FILE: &str = "openrouter_api_key.txt";

fn entry_for(slot: &str) -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE, slot)
}

fn fallback_path(app_data: &Path, slot: &str) -> PathBuf {
    app_data.join(format!("api_key_{slot}.txt"))
}

fn legacy_fallback_path(app_data: &Path) -> PathBuf {
    app_data.join(LEGACY_FALLBACK_FILE)
}

fn write_fallback(app_data: &Path, slot: &str, key: &str) -> Result<(), String> {
    fs::create_dir_all(app_data).map_err(|e| e.to_string())?;
    fs::write(fallback_path(app_data, slot), key).map_err(|e| e.to_string())?;
    println!("[secrets] mirrored API key slot={slot} to app data file");
    Ok(())
}

fn clear_fallback(app_data: &Path, slot: &str) {
    match fs::remove_file(fallback_path(app_data, slot)) {
        Ok(()) => println!("[secrets] cleared API key fallback file slot={slot}"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("[secrets] failed to clear fallback slot={slot}: {e}"),
    }
}

fn read_fallback(app_data: &Path, slot: &str) -> Option<String> {
    let s = fs::read_to_string(fallback_path(app_data, slot)).ok()?;
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Persist API key for a named slot; pass empty string to delete stored secret.
pub fn set_api_key_slot(app_data: &Path, slot: &str, key: &str) -> Result<(), String> {
    let slot = slot.trim();
    if slot.is_empty() {
        return Err("secret slot name is empty".into());
    }
    let key = key.trim();
    if key.is_empty() {
        if let Ok(e) = entry_for(slot) {
            let _ = e.delete_credential();
        }
        clear_fallback(app_data, slot);
        println!("[secrets] cleared API key slot={slot}");
        return Ok(());
    }

    match entry_for(slot) {
        Ok(e) => match e.set_password(key) {
            Ok(()) => {
                let ok = matches!(e.get_password(), Ok(ref s) if s == key);
                if !ok {
                    eprintln!(
                        "[secrets] OS credential immediate readback mismatch slot={slot}; relying on file mirror"
                    );
                }
            }
            Err(err) => {
                eprintln!("[secrets] OS credential write failed slot={slot}: {err}; using file mirror only")
            }
        },
        Err(err) => {
            eprintln!(
                "[secrets] OS credential unavailable slot={slot}: {err}; using file mirror only"
            )
        }
    }

    write_fallback(app_data, slot, key)?;
    println!("[secrets] API key saved slot={slot}");
    Ok(())
}

fn read_slot_raw(app_data: &Path, slot: &str) -> Option<String> {
    if let Ok(e) = entry_for(slot) {
        match e.get_password() {
            Ok(s) if !s.trim().is_empty() => return Some(s.trim().to_string()),
            Ok(_) => {}
            Err(err) => {
                eprintln!(
                    "[secrets] OS credential read failed slot={slot}: {err}; using file mirror"
                )
            }
        }
    }
    read_fallback(app_data, slot)
}

/// Read a named secret slot. For `open_router`, also migrates the legacy OpenRouter key if present.
pub fn get_api_key_slot(app_data: &Path, slot: &str) -> Option<String> {
    if let Some(s) = read_slot_raw(app_data, slot) {
        return Some(s);
    }

    // One-time migration: old builds stored OpenRouter under a fixed name.
    if slot == "open_router" {
        if let Some(legacy) = read_legacy_openrouter(app_data) {
            println!("[secrets] migrating legacy OpenRouter key into slot=open_router");
            let _ = set_api_key_slot(app_data, "open_router", &legacy);
            return Some(legacy);
        }
    }
    None
}

fn read_legacy_openrouter(app_data: &Path) -> Option<String> {
    if let Ok(e) = Entry::new(SERVICE, LEGACY_USER_KEY) {
        if let Ok(s) = e.get_password() {
            let s = s.trim().to_string();
            if !s.is_empty() {
                return Some(s);
            }
        }
    }
    let s = fs::read_to_string(legacy_fallback_path(app_data)).ok()?;
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Backward-compatible helpers used by older call sites (OpenRouter default slot).
#[allow(dead_code)]
pub fn set_api_key(app_data: &Path, key: &str) -> Result<(), String> {
    set_api_key_slot(app_data, "open_router", key)
}

#[allow(dead_code)]
pub fn get_api_key(app_data: &Path) -> Option<String> {
    get_api_key_slot(app_data, "open_router")
}

/// Last 4 characters of a stored key for UI display (does not expose the full secret).
#[allow(dead_code)]
pub fn key_tail(app_data: &Path, slot: &str) -> Option<String> {
    let s = get_api_key_slot(app_data, slot)?;
    if s.is_empty() {
        return None;
    }
    let tail: String = s.chars().rev().take(4).collect();
    Some(tail.chars().rev().collect())
}
