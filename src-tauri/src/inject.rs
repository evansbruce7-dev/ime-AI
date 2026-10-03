//! Clipboard backup/restore and synthetic Ctrl+C / Ctrl+V for text injection on Windows.

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread;
use std::time::Duration;

fn sleep_short() {
    thread::sleep(Duration::from_millis(40));
}

/// If the foreground window belongs to another process, return its top-level HWND as `isize`.
/// Used before showing the AI panel so paste can return to the app the user was typing in.
#[cfg(windows)]
pub fn external_foreground_host_hwnd_if_other_process() -> Option<isize> {
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    unsafe {
        let fg = GetForegroundWindow();
        if fg.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        let our = GetCurrentProcessId();
        if pid == our {
            return None;
        }
        Some(fg.0 as isize)
    }
}

#[cfg(not(windows))]
pub fn external_foreground_host_hwnd_if_other_process() -> Option<isize> {
    None
}

#[cfg(windows)]
fn prepare_foreground_for_paste(last_external_host_hwnd: Option<isize>) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, GetForegroundWindow, GetWindowThreadProcessId,
        SetForegroundWindow, ASFW_ANY,
    };

    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let fg = GetForegroundWindow();
        let mut fg_pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        let our = GetCurrentProcessId();
        let target = if fg_pid == our {
            let Some(raw) = last_external_host_hwnd else {
                return Err(
                    "当前焦点在本应用：请先在要输入的外部软件里点一下文本框，再插入；或切到该软件后用全局「插入结果」快捷键。"
                        .into(),
                );
            };
            HWND(raw as *mut _)
        } else {
            fg
        };
        if target.0.is_null() {
            return Err("无法确定要粘贴的目标窗口".into());
        }
        let _ = SetForegroundWindow(target);
    }
    thread::sleep(Duration::from_millis(90));
    Ok(())
}

#[cfg(not(windows))]
fn prepare_foreground_for_paste(_last_external_host_hwnd: Option<isize>) -> Result<(), String> {
    Ok(())
}

/// Paste `text` into the foreground control. On Windows, if our app still has focus, uses `last_external_host_hwnd`
/// (captured while you were typing in another app) to switch foreground before Ctrl+V.
pub fn inject_text_via_clipboard(
    text: &str,
    last_external_host_hwnd: Option<isize>,
) -> Result<(), String> {
    prepare_foreground_for_paste(last_external_host_hwnd)?;

    let mut clip = Clipboard::new().map_err(|e| format!("clipboard init: {}", e))?;
    let previous = clip.get_text().ok();

    clip.set_text(text)
        .map_err(|e| format!("clipboard set: {}", e))?;
    sleep_short();

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {}", e))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("key ctrl: {}", e))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| format!("key v: {}", e))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("key ctrl release: {}", e))?;

    sleep_short();

    if let Some(prev) = previous {
        let _ = clip.set_text(prev);
    }
    println!(
        "[inject] pasted {} chars via clipboard",
        text.chars().count()
    );
    Ok(())
}

/// Only copy text to the system clipboard without switching foreground windows or simulating keys.
/// Used when the user clicks the AI result area in the panel to copy it manually.
pub fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    let mut clip = Clipboard::new().map_err(|e| format!("clipboard init: {}", e))?;
    clip.set_text(text)
        .map_err(|e| format!("clipboard set: {}", e))?;
    println!(
        "[inject] copied {} chars to clipboard (no inject)",
        text.chars().count()
    );
    Ok(())
}

/// Simulate Ctrl+C and return clipboard text (best-effort; requires correct focus on selection).
pub fn copy_selection_from_focused_app() -> Result<String, String> {
    let mut clip = Clipboard::new().map_err(|e| format!("clipboard init: {}", e))?;
    let before = clip.get_text().ok();

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo: {}", e))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| format!("key ctrl: {}", e))?;
    enigo
        .key(Key::Unicode('c'), Direction::Click)
        .map_err(|e| format!("key c: {}", e))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| format!("key ctrl release: {}", e))?;

    thread::sleep(Duration::from_millis(120));

    let copied = clip
        .get_text()
        .map_err(|e| format!("clipboard read: {}", e))?;

    if let Some(prev) = before {
        let _ = clip.set_text(prev);
    }

    println!(
        "[inject] simulated copy; got {} chars",
        copied.chars().count()
    );
    Ok(copied)
}

/// Read clipboard as plain text (no injection).
pub fn read_clipboard_text() -> Result<String, String> {
    let mut clip = Clipboard::new().map_err(|e| format!("clipboard init: {}", e))?;
    clip.get_text().map_err(|e| format!("clipboard get: {}", e))
}
