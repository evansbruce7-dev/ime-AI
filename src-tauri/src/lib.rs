//! Tauri backend: tray, global shortcut, LLM calls, clipboard injection, and prompt commands.

mod ai;
mod competition;
mod config;
mod inject;
mod prompt_commands;
mod secrets;
mod translate;

use config::{AppSettings, LlmProvider, PanelZorderMode, TranslationProvider};
use prompt_commands::{apply_placeholders, merged_commands, PromptCommand, UserCommandsLoad};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuId, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

/// Shown on the first line of the tray tooltip (keep short: Windows limits tooltips).
#[derive(Clone, Copy, PartialEq, Eq)]
enum UiLocale {
    Zh,
    En,
}

/// Which status line the tray tooltip is currently showing.
#[derive(Clone, Copy)]
enum TrayPhase {
    Idle,
    Working,
    Testing,
    Competing,
}

fn parse_ui_locale(raw: &str) -> UiLocale {
    if raw.trim() == "en" {
        UiLocale::En
    } else {
        UiLocale::Zh
    }
}

fn locale_file(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("ui_locale.txt")
}

fn load_ui_locale(dir: &std::path::Path) -> UiLocale {
    match std::fs::read_to_string(locale_file(dir)) {
        Ok(raw) => {
            let locale = parse_ui_locale(&raw);
            println!("[ui] loaded locale {}", if locale == UiLocale::En { "en" } else { "zh" });
            locale
        }
        Err(_) => {
            println!("[ui] locale file missing, default zh");
            UiLocale::Zh
        }
    }
}

fn store_ui_locale(dir: &std::path::Path, locale: UiLocale) {
    let text = match locale {
        UiLocale::En => "en",
        UiLocale::Zh => "zh",
    };
    if let Err(e) = std::fs::write(locale_file(dir), text) {
        eprintln!("[ui] failed to persist locale: {e}");
    } else {
        println!("[ui] persisted locale {text}");
    }
}

fn read_ui_locale(app: &AppHandle) -> UiLocale {
    app.try_state::<AppState>()
        .and_then(|state| state.ui_locale.lock().ok().map(|guard| *guard))
        .unwrap_or(UiLocale::Zh)
}

fn tray_headline(locale: UiLocale) -> &'static str {
    match locale {
        UiLocale::Zh => "IME Companion · AI 增强",
        UiLocale::En => "IME Companion · AI assist",
    }
}

fn tray_phase_line(locale: UiLocale, phase: TrayPhase) -> &'static str {
    match (locale, phase) {
        (UiLocale::Zh, TrayPhase::Idle) => "状态：就绪 · 双击打开面板 · 右键菜单",
        (UiLocale::Zh, TrayPhase::Working) => "状态：模型处理中…",
        (UiLocale::Zh, TrayPhase::Testing) => "状态：连接测试中…",
        (UiLocale::Zh, TrayPhase::Competing) => "状态：模型竞争探测中…",
        (UiLocale::En, TrayPhase::Idle) => "Ready · double-click opens the panel · right-click for the menu",
        (UiLocale::En, TrayPhase::Working) => "Status: model is working…",
        (UiLocale::En, TrayPhase::Testing) => "Status: testing the connection…",
        (UiLocale::En, TrayPhase::Competing) => "Status: probing model competition…",
    }
}

fn window_title(locale: UiLocale, panel: bool) -> &'static str {
    match (locale, panel) {
        (UiLocale::Zh, false) => "AI 增强",
        (UiLocale::Zh, true) => "AI 增强面板",
        (UiLocale::En, false) => "AI Assist",
        (UiLocale::En, true) => "AI Assist Panel",
    }
}

fn apply_window_titles(app: &AppHandle, locale: UiLocale) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(e) = window.set_title(window_title(locale, false)) {
            eprintln!("[ui] main title failed: {e}");
        }
    }
    if let Some(window) = app.get_webview_window("panel") {
        if let Err(e) = window.set_title(window_title(locale, true)) {
            eprintln!("[ui] panel title failed: {e}");
        }
    }
    println!("[ui] window titles updated");
}

fn build_tray_menu(app: &AppHandle, locale: UiLocale) -> tauri::Result<Menu<tauri::Wry>> {
    let (panel, settings, quit) = match locale {
        UiLocale::Zh => ("打开AI输入面板", "打开设置", "退出"),
        UiLocale::En => ("Open AI panel", "Open settings", "Quit"),
    };
    let i_panel = MenuItem::with_id(app, "panel", panel, true, None::<&str>)?;
    let i_settings = MenuItem::with_id(app, "settings", settings, true, None::<&str>)?;
    let i_quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    Menu::with_items(
        app,
        &[
            &i_panel,
            &i_settings,
            &PredefinedMenuItem::separator(app)?,
            &i_quit,
        ],
    )
}

/// Load tray icon from disk at startup so PNG updates apply after app restart without a Rust rebuild
/// (`include_image!` embeds bytes at compile time and can stay stale when only icons change).
fn load_tray_icon(app: &AppHandle) -> tauri::Result<Image<'static>> {
    let dev_icons = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("icons");
    for name in ["tray-icon.png", "tray-32.png", "64x64.png", "32x32.png"] {
        let path = dev_icons.join(name);
        if path.is_file() {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    println!("[tray] icon loaded from {}", path.display());
                    return Image::from_bytes(&bytes);
                }
                Err(e) => eprintln!("[tray] read {} failed: {e}", path.display()),
            }
        }
    }

    if let Ok(res_dir) = app.path().resource_dir() {
        for name in ["tray-icon.png", "tray-32.png", "64x64.png", "32x32.png"] {
            let path = res_dir.join("icons").join(name);
            if path.is_file() {
                if let Ok(bytes) = std::fs::read(&path) {
                    println!("[tray] icon loaded from {}", path.display());
                    return Image::from_bytes(&bytes);
                }
            }
        }
    }

    println!("[tray] using compile-time fallback icon");
    Ok(tauri::include_image!("icons/tray-icon.png"))
}

/// Push tray tooltip text on the main thread (required for reliable Shell_NotifyIcon updates on Windows).
fn schedule_tray_tooltip(app: &AppHandle, phase: TrayPhase) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut slot) = state.tray_phase.lock() {
            *slot = phase;
        }
    }
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(state) = h.try_state::<AppState>() else {
            return;
        };
        let phase = state
            .tray_phase
            .lock()
            .map(|guard| *guard)
            .unwrap_or(phase);
        let locale = state
            .ui_locale
            .lock()
            .map(|guard| *guard)
            .unwrap_or(UiLocale::Zh);
        let msg = format!("{}\n{}", tray_headline(locale), tray_phase_line(locale, phase));
        let Ok(lock) = state.tray.lock() else {
            return;
        };
        let Some(ref tray) = *lock else {
            return;
        };
        if let Err(e) = tray.set_tooltip(Some(msg.as_str())) {
            eprintln!("[tray] set_tooltip failed: {e}");
        }
    });
}
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Apply `settings.autostart_enabled` to the OS login/startup entry.
/// Called on app startup and whenever settings are saved so preference and registry stay aligned.
fn sync_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    match (enabled, manager.is_enabled()) {
        (true, Ok(false)) => match manager.enable() {
            Ok(()) => println!("[autostart] enabled (synced from settings)"),
            Err(e) => eprintln!("[autostart] enable failed: {e}"),
        },
        (false, Ok(true)) => match manager.disable() {
            Ok(()) => println!("[autostart] disabled (synced from settings)"),
            Err(e) => eprintln!("[autostart] disable failed: {e}"),
        },
        (true, Ok(true)) => println!("[autostart] already enabled"),
        (false, Ok(false)) => println!("[autostart] already disabled"),
        (_, Err(e)) => eprintln!("[autostart] is_enabled check failed: {e}"),
    }
}

/// Shared runtime state (settings snapshot + HTTP client + app data path).
pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub http: reqwest::Client,
    pub app_data: std::path::PathBuf,
    /// Last top-level HWND seen while focus was in a text field of another process (Windows).
    pub last_external_host_hwnd: Mutex<Option<isize>>,
    /// Text waiting for global shortcut paste after AI completes.
    pub pending_inject_text: Mutex<Option<String>>,
    /// Set by frontend when user stops streaming generation; polled from the Rust stream reader.
    pub llm_stream_cancel: Arc<AtomicBool>,
    /// System tray handle for tooltip / icon updates (filled after `TrayIconBuilder::build`).
    pub tray: Mutex<Option<TrayIcon>>,
    /// Active interface language. The settings window writes this; the tray reads it.
    ui_locale: Mutex<UiLocale>,
    /// Last tray status so a language switch can refresh the tooltip without dropping the phase.
    tray_phase: Mutex<TrayPhase>,
    /// Last real expanded-state panel size **reported by the frontend** (logical px).
    ///
    /// This is the dynamic replacement for a hardcoded Rust-side width/height constant:
    /// the frontend is the only source of truth for the panel's actual CSS-driven size
    /// (`.ime-panel-shell--expanded` width, content-hugged height), so instead of Rust
    /// guessing a number that must be kept in sync by hand (the exact class of bug that
    /// caused 640≠654 drift), the frontend calls `report_panel_expanded_size` every time
    /// it (re)applies an expanded-state `setSize()`. `show_panel()` then reuses that last
    /// known-good size to pre-size the window before `show()`, so it is *always* correct
    /// even if CSS/layout constants change later — no Rust constant to update at all.
    /// Seeded with `PANEL_EXPANDED_WIDTH`/`HEIGHT` purely as a bootstrap default for the
    /// (extremely rare) case where the panel is summoned before the frontend has ever
    /// reported a real size.
    pub last_panel_expanded_size: Mutex<(f64, f64)>,
}

/// **Bootstrap-only** fallback for the expanded panel size, used to seed
/// `AppState.last_panel_expanded_size` before the frontend has ever reported a real
/// measurement. Once the frontend calls `report_panel_expanded_size` (which happens on
/// every expanded-state layout, including the very first mount), this hardcoded value is
/// never consulted again — `show_panel()` always pre-sizes from the live, frontend-reported
/// value instead. This eliminates the old failure mode where this constant silently drifted
/// from the CSS/`panelConstants.ts` truth (640 vs. 654) and clipped the panel on open.
/// Kept roughly in sync with `panelConstants.ts` `EXPANDED_PRESET_WIDTH/HEIGHT` only so the
/// bootstrap frame (before the first real report lands) is a reasonable guess, not for
/// correctness.
const PANEL_EXPANDED_WIDTH: f64 = 1280.0;
const PANEL_EXPANDED_HEIGHT: f64 = 400.0;

/// Windows/WebView2: a transparent `alwaysOnTop` window still owns the whole client rectangle for hit-testing,
/// which blocks file dialogs and other apps. IME-style behavior here: only stay system-wide topmost while the
/// panel actually has keyboard focus; as soon as the user activates another window, drop topmost so clicks/z-order
/// follow normal OS rules.
fn set_panel_always_on_top(panel: &tauri::WebviewWindow, on_top: bool, reason: &str) {
    if let Err(error) = panel.set_always_on_top(on_top) {
        eprintln!("[ui] panel set_always_on_top({on_top}) failed: {error}");
    } else {
        println!("[ui] panel alwaysOnTop={on_top} ({reason})");
    }
}

/// Apply the persisted z-order mode to the panel window immediately.
fn apply_panel_zorder_from_settings(app: &AppHandle) {
    let Some(panel) = app.get_webview_window("panel") else {
        eprintln!("[ui] apply_panel_zorder: panel window missing");
        return;
    };

    let mode = app
        .state::<AppState>()
        .settings
        .lock()
        .map(|g| g.panel_zorder_mode)
        .unwrap_or_default();

    match mode {
        PanelZorderMode::Default => {
            set_panel_always_on_top(&panel, false, "zorder mode = default");
        }
        PanelZorderMode::Upper => {
            // Let the focus-follows-focus hook manage it; sync once to current state here.
            let focused = panel.is_focused().unwrap_or(false);
            set_panel_always_on_top(
                &panel,
                focused,
                if focused {
                    "zorder mode = upper, panel has focus"
                } else {
                    "zorder mode = upper, panel not focused"
                },
            );
        }
        PanelZorderMode::AlwaysTop => {
            set_panel_always_on_top(&panel, true, "zorder mode = always top");
        }
    }
}

/// While the main workspace is active, the floating panel must be **hidden**, not only non-topmost:
/// on Windows/WebView2 the panel still receives hit-testing across its full client rect and blocks
/// the desktop and other apps (file dialogs, drag-drop, etc.).
fn hide_panel_for_main_workspace(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        set_panel_always_on_top(
            &panel,
            false,
            "main workspace opening — clear topmost before hide",
        );
        if let Err(e) = panel.hide() {
            eprintln!("[ui] panel hide (workspace mode) failed: {e}");
        } else {
            println!("[ui] panel hidden while main workspace is active");
        }
    }
}

/// Release z-order before opening the workspace, but keep the panel alive until the main window exists.
/// Hiding the caller webview before `WebviewWindowBuilder::build()` can wedge WebView2 IPC on Windows.
fn release_panel_topmost_for_main_workspace(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        set_panel_always_on_top(
            &panel,
            false,
            "main workspace opening — release topmost before creating main",
        );
    }
}

/// Bring the floating panel back after the user dismisses or minimizes the main workspace window.
/// Intentionally does **not** `set_focus()` so we do not steal focus from another app the user switched to.
fn restore_panel_after_main_workspace(app: &AppHandle) {
    if let Some(panel) = app.get_webview_window("panel") {
        let _ = panel.unminimize();
        if let Err(e) = panel.show() {
            eprintln!("[ui] panel show after workspace dismissed failed: {e}");
        } else {
            apply_panel_zorder_from_settings(app);
            println!("[ui] panel shown again after main workspace hidden");
        }
    }
}

/// First main-window creation loads the SPA; the `listen(...)` hooks may register slightly later than
/// our first synchronous `emit_to`, so the UI misses navigation. Defer one emit after a short sleep.
const DEFER_MAIN_EMIT_MS: u64 = 240;
const DEFER_WORKSPACE_OP_MS: u64 = 80;

fn defer_emit_to_main(app: &AppHandle, event: &'static str) {
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(DEFER_MAIN_EMIT_MS));
        let hh = h.clone();
        let _ = h.run_on_main_thread(move || {
            if let Err(e) = hh.emit_to("main", event, ()) {
                eprintln!("[ui] deferred emit_to(main, {event}) failed: {e}");
            } else {
                println!("[ui] deferred emit_to(main, {event}) ok");
            }
        });
    });
}

fn defer_emit_open_workspace_page(app: &AppHandle, slug: String) {
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(DEFER_MAIN_EMIT_MS));
        let hh = h.clone();
        let slug_move = slug;
        let _ = h.run_on_main_thread(move || {
            if let Err(e) = hh.emit_to("main", "open-workspace-page", slug_move) {
                eprintln!("[ui] deferred emit open-workspace-page failed: {e}");
            } else {
                println!("[ui] deferred emit open-workspace-page ok");
            }
        });
    });
}

fn attach_panel_topmost_follows_focus(app: &AppHandle) {
    let handle = app.clone();
    let Some(panel) = app.get_webview_window("panel") else {
        eprintln!("[ui] skip panel topmost hook: panel missing");
        return;
    };
    panel.on_window_event(move |event| {
        let WindowEvent::Focused(focused) = event else {
            return;
        };
        // Only follow focus in "Upper" mode; "Default" and "AlwaysTop" are managed elsewhere.
        let mode = handle
            .state::<AppState>()
            .settings
            .lock()
            .map(|g| g.panel_zorder_mode)
            .unwrap_or_default();
        if mode != PanelZorderMode::Upper {
            return;
        }
        let Some(panel) = handle.get_webview_window("panel") else {
            return;
        };
        set_panel_always_on_top(
            &panel,
            *focused,
            if *focused {
                "panel gained focus (upper mode)"
            } else {
                "panel lost focus (upper mode) — other window can be on top"
            },
        );
    });
}

/// Remember which external app had focus before we steal focus for the floating panel.
fn record_external_host_before_panel(app: &AppHandle) {
    if let Some(hwnd) = inject::external_foreground_host_hwnd_if_other_process() {
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut g) = state.last_external_host_hwnd.lock() {
                *g = Some(hwnd);
                println!(
                    "[inject] recorded external host hwnd={hwnd} (foreground was another process)"
                );
            }
        }
    }
}

fn show_panel(app: &AppHandle) {
    record_external_host_before_panel(app);
    if let Some(w) = app.get_webview_window("panel") {
        let _ = w.unminimize();
        // 在 show() 之前预设展开态默认尺寸 1280×400；高度由前端按内容自动调整。
        let width = PANEL_EXPANDED_WIDTH;
        let height = PANEL_EXPANDED_HEIGHT;
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(
            PANEL_EXPANDED_WIDTH,
            PANEL_EXPANDED_HEIGHT,
        )));
        let _ = w.set_size(tauri::LogicalSize::new(width, height));
        let _ = w.show();
        let _ = w.set_focus();
        // Apply the persisted z-order mode so the panel opens at the right level.
        apply_panel_zorder_from_settings(app);
        let _ = app.emit_to("panel", "open-panel", ());
        let _ = app.emit_to("panel", "panel-opened", ());
        println!(
            "[ui] panel window shown and focused (pre-sized to {}×{}, from last frontend report)",
            width, height
        );
    } else {
        eprintln!("[ui] panel window missing");
    }
}

/// Shared validation + write path for the cached expanded-state panel size, used by both
/// `report_panel_expanded_size` (ongoing updates while the panel is already visible) and
/// `reveal_panel_first_paint` (the very first show after app startup).
fn store_panel_expanded_size(state: &AppState, width: f64, height: f64) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(format!("invalid panel size reported: {width}x{height}"));
    }
    let mut slot = state
        .last_panel_expanded_size
        .lock()
        .map_err(|e| e.to_string())?;
    *slot = (width, height);
    Ok(())
}

/// Frontend calls this every time it (re)applies an expanded-state `setSize()` on the panel
/// window — i.e. it is the single source of truth for "what does the real expanded panel
/// look like right now" continuously feeding back into Rust. `show_panel()` reads this
/// cached value instead of a hardcoded constant, so the native pre-size before `show()` can
/// never drift out of sync with the actual CSS-driven layout, no matter how the frontend
/// dimensions change in the future.
#[tauri::command]
fn report_panel_expanded_size(
    state: State<AppState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    store_panel_expanded_size(&state, width, height)?;
    println!("[ui] panel expanded size reported by frontend: {width}×{height} (cached for next show_panel pre-size)");
    Ok(())
}

/// One-shot, IPC-confirmed reveal for the panel's very first appearance after app startup.
///
/// Replaces a fragile frontend-only double-`requestAnimationFrame` + blind-`setTimeout`
/// dance. Root cause of the bug this fixes: `tauri.conf.json` creates the panel window with
/// `"visible": false`, and **WebView2 throttles/pauses `requestAnimationFrame` callbacks for
/// windows that have never been shown** (the browser compositor doesn't run frame callbacks
/// for an invisible surface — confirmed Windows/WebView2 platform behavior, not fixable from
/// script). The old flow waited two rAF ticks before measuring + resizing + showing; while
/// hidden, those ticks could stall indefinitely, so the 200ms `setTimeout` safety fallback
/// would fire *first* and reveal the window at whatever raw size the OS happened to have —
/// with the real CSS-driven measurement still stuck behind an rAF chain that had not run
/// yet. That race is exactly why the panel could appear clipped on its first automatic
/// appearance, even though every constant on both sides was already numerically correct.
///
/// Fix: the frontend now measures synchronously in `useLayoutEffect` — guaranteed to run
/// right after DOM/CSS commit, completely independent of rAF or window visibility — and
/// calls this command with the real numbers. Rust resizes *then* shows *in the same call*,
/// so "has the resize actually taken effect yet" is answered by this function returning
/// (a real IPC round-trip), never by guessing when some browser frame callback fires.
#[tauri::command]
fn reveal_panel_first_paint(
    app: AppHandle,
    state: State<AppState>,
    width: f64,
    height: f64,
) -> Result<(), String> {
    store_panel_expanded_size(&state, width, height)?;
    let Some(panel) = app.get_webview_window("panel") else {
        eprintln!("[ui] reveal_panel_first_paint: panel window missing");
        return Err("panel window missing".to_string());
    };
    panel
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| {
            eprintln!("[ui] reveal_panel_first_paint: set_size({width}, {height}) failed: {e}");
            e.to_string()
        })?;
    if let Err(e) = panel.show() {
        eprintln!("[ui] reveal_panel_first_paint: show() failed: {e}");
        return Err(e.to_string());
    }
    let _ = panel.set_focus();
    apply_panel_zorder_from_settings(&app);
    println!(
        "[ui] panel first-paint reveal: resized to {width}×{height} then shown (IPC-confirmed, rAF-independent)"
    );
    Ok(())
}

/// Apply panel window geometry from the frontend. Runs natively (no WebView window ACL) so
/// `setSize` / `setMinSize` always succeed — critical for collapsed shrink and auto-width.
#[tauri::command]
fn sync_panel_window_geometry(
    app: AppHandle,
    state: State<AppState>,
    width: f64,
    height: f64,
    min_width: Option<f64>,
    min_height: Option<f64>,
    max_width: Option<f64>,
    max_height: Option<f64>,
    x: Option<f64>,
    y: Option<f64>,
    cache_expanded_size: bool,
) -> Result<(), String> {
    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return Err(format!("invalid panel geometry: {width}x{height}"));
    }
    let Some(panel) = app.get_webview_window("panel") else {
        return Err("panel window missing".to_string());
    };
    if let (Some(mw), Some(mh)) = (min_width, min_height) {
        panel
            .set_min_size(Some(tauri::LogicalSize::new(mw, mh)))
            .map_err(|e| e.to_string())?;
    }
    if let (Some(mxw), Some(mxh)) = (max_width, max_height) {
        panel
            .set_max_size(Some(tauri::LogicalSize::new(mxw, mxh)))
            .map_err(|e| e.to_string())?;
    }
    panel
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    if let (Some(px), Some(py)) = (x, y) {
        panel
            .set_position(tauri::LogicalPosition::new(px, py))
            .map_err(|e| e.to_string())?;
    }
    if cache_expanded_size {
        store_panel_expanded_size(&state, width, height)?;
    }
    println!(
        "[ui] panel geometry synced: {width}×{height} (min={min_width:?}×{min_height:?}, pos={x:?},{y:?}, cache={cache_expanded_size})"
    );
    Ok(())
}

/// When the user minimizes a window, hide it so the app lives in the tray only.
fn attach_minimize_to_hide(app: &AppHandle, label: &'static str) {
    let handle = app.clone();
    let Some(w) = app.get_webview_window(label) else {
        eprintln!("[ui] skip minimize-hide: window {} missing", label);
        return;
    };
    let was_minimized = Arc::new(AtomicBool::new(false));
    let was = was_minimized.clone();
    w.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Resized(_) | WindowEvent::Focused(_)) {
            return;
        }
        if let Some(win) = handle.get_webview_window(label) {
            if !win.is_visible().unwrap_or(false) {
                return;
            }
            let now = win.is_minimized().unwrap_or(false);
            let prev = was.load(Ordering::Relaxed);
            if now && !prev {
                let _ = win.hide();
                println!("[ui] {} minimized (edge) → hidden to tray", label);
                if label == "main" {
                    restore_panel_after_main_workspace(&handle);
                }
            }
            was.store(now, Ordering::Relaxed);
        }
    });
}

fn main_window_url(path: &str) -> String {
    let normalized = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{}", path)
    };
    format!("index.html#{}", normalized)
}

/// The workspace window is not created during startup anymore; keep it on-demand so only the floating panel WebView
/// is resident until the user explicitly opens settings / commands / a workspace page.
fn ensure_main_window(
    app: &AppHandle,
    initial_path: &str,
) -> Result<(WebviewWindow, bool), String> {
    if let Some(window) = app.get_webview_window("main") {
        println!("[ui] main window reused");
        return Ok((window, false));
    }

    let url = main_window_url(initial_path);
    println!("[ui] main window build start url={}", url);
    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App(url.clone().into()))
        .title(window_title(read_ui_locale(app), false))
        .inner_size(920.0, 720.0)
        .resizable(true)
        .decorations(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    attach_minimize_to_hide(app, "main");
    println!("[ui] main window created on demand url={}", url);
    Ok((window, true))
}

fn show_main_window(window: &WebviewWindow) -> Result<(), String> {
    if let Err(e) = window.unminimize() {
        eprintln!("[ui] main window unminimize failed: {e}");
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    println!("[ui] main window shown and focused");
    Ok(())
}

/// Coalesce rapid tray / UI double-activations so we do not run `show_settings_main` twice in one burst.
fn open_settings_debounce_allow() -> bool {
    static LAST: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
    let gate = LAST.get_or_init(|| Mutex::new(None));
    let Ok(mut g) = gate.lock() else {
        return true;
    };
    let now = Instant::now();
    if let Some(t) = *g {
        if now.duration_since(t) < Duration::from_millis(500) {
            println!(
                "[ui] open-settings skipped (debounce {:?} since last)",
                now.duration_since(t)
            );
            return false;
        }
    }
    *g = Some(now);
    true
}

/// Left double-click on the tray icon opens the AI panel.
///
/// Windows delivers this as `TrayIconEvent::DoubleClick` (`WM_LBUTTONDBLCLK`).
/// Single clicks, hover, and right-button events are ignored here so they do not
/// steal focus: the context menu stays on right click (`show_menu_on_left_click(false)`).
/// The handler itself may run off the windowing thread, so `show_panel` is queued
/// with `run_on_main_thread`, matching tray menu dispatch.
fn handle_tray_icon_event(tray: &TrayIcon, event: TrayIconEvent) {
    // Only a left-button double-click is the "open panel" gesture.
    let TrayIconEvent::DoubleClick {
        button: MouseButton::Left,
        ..
    } = event
    else {
        return;
    };
    println!("[tray] left double-click → queue show AI panel");
    let app = tray.app_handle().clone();
    let queued = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        println!("[tray] main thread: opening AI panel from tray double-click");
        show_panel(&queued);
    }) {
        eprintln!("[tray] run_on_main_thread(double-click show_panel) failed: {e}");
    }
}

fn dispatch_tray_menu(app: &AppHandle, id: MenuId) {
    if id == MenuId::new("panel") {
        show_panel(app);
    } else if id == MenuId::new("settings") {
        if let Err(e) = show_settings_main(app) {
            eprintln!("[ui] tray → show_settings_main: {e}");
        }
    } else if id == MenuId::new("quit") {
        app.exit(0);
    }
}

/// `invoke(...)` from a WebView runs inside that webview's IPC handling. Doing `hide()` on the same
/// webview plus creating another top-level WebView2 on that same call stack wedges the UI thread on
/// Windows (tray menus / quit stop working). Queue the work for the next main-loop turn instead.
fn schedule_workspace_window_op<F>(
    app: &AppHandle,
    op_name: &'static str,
    op: F,
) -> Result<(), String>
where
    F: FnOnce(&AppHandle) -> Result<(), String> + Send + 'static,
{
    let h = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(DEFER_WORKSPACE_OP_MS));
        let main_app = h.clone();
        let queued = h.run_on_main_thread(move || {
            if let Err(e) = op(&main_app) {
                eprintln!("[ui] deferred `{op_name}` failed: {e}");
            }
        });
        if let Err(e) = queued {
            eprintln!("[ui] queue deferred `{op_name}` failed: {e}");
        } else {
            println!("[ui] queued deferred `{op_name}`");
        }
    });
    Ok(())
}

/// Show the main window and ask the frontend to navigate to the settings route.
fn show_settings_main(app: &AppHandle) -> Result<(), String> {
    println!("[ui] show_settings_main requested");
    if !open_settings_debounce_allow() {
        return Ok(());
    }
    release_panel_topmost_for_main_workspace(app);
    let (window, created) = ensure_main_window(app, "/behavior")?;
    hide_panel_for_main_workspace(app);
    show_main_window(&window)?;
    if let Err(e) = window.maximize() {
        eprintln!("[ui] main window maximize failed: {e}");
    }
    if created {
        if let Err(e) = app.emit_to("main", "open-settings", ()) {
            eprintln!("[ui] immediate emit open-settings: {e}");
        } else {
            println!("[ui] immediate emit open-settings ok");
        }
        defer_emit_to_main(app, "open-settings");
    } else {
        app.emit_to("main", "open-settings", ())
            .map_err(|e| e.to_string())?;
    }
    println!("[ui] main window opened to settings (created={})", created);
    Ok(())
}

fn show_commands_main(app: &AppHandle) -> Result<(), String> {
    release_panel_topmost_for_main_workspace(app);
    let (window, created) = ensure_main_window(app, "/commands")?;
    hide_panel_for_main_workspace(app);
    show_main_window(&window)?;
    if created {
        if let Err(e) = app.emit_to("main", "open-commands", ()) {
            eprintln!("[ui] immediate emit open-commands: {e}");
        } else {
            println!("[ui] immediate emit open-commands ok");
        }
        defer_emit_to_main(app, "open-commands");
    } else {
        app.emit_to("main", "open-commands", ())
            .map_err(|e| e.to_string())?;
    }
    println!("[ui] main window opened to commands (created={})", created);
    Ok(())
}

/// Show main window and tell the SPA to navigate (e.g. panel toolbar: 统计 → /home, 关于 → /appearance).
fn show_workspace_page_main(app: &AppHandle, slug: &str) -> Result<(), String> {
    let path = if slug.starts_with('/') {
        slug.to_string()
    } else {
        format!("/{}", slug)
    };
    release_panel_topmost_for_main_workspace(app);
    let (window, created) = ensure_main_window(app, &path)?;
    hide_panel_for_main_workspace(app);
    show_main_window(&window)?;
    if created {
        let slug_owned = slug.to_string();
        if let Err(e) = app.emit_to("main", "open-workspace-page", &slug_owned) {
            eprintln!("[ui] immediate emit open-workspace-page: {e}");
        } else {
            println!("[ui] immediate emit open-workspace-page ok");
        }
        defer_emit_open_workspace_page(app, slug_owned);
    } else {
        app.emit_to("main", "open-workspace-page", slug)
            .map_err(|e| e.to_string())?;
    }
    println!(
        "[ui] main window opened to workspace page: {} (created={})",
        slug, created
    );
    Ok(())
}

/// Register open-panel + optional inject-result global shortcuts.
fn register_global_shortcuts(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let panel_sc = settings.global_shortcut.trim();
    gs.on_shortcut(panel_sc, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            show_panel(app);
        }
    })
    .map_err(|e| e.to_string())?;
    let inject_sc = settings.inject_global_shortcut.trim();
    if settings.auto_inject_enabled
        && !inject_sc.is_empty()
        && inject_sc.to_lowercase() != panel_sc.to_lowercase()
    {
        gs.on_shortcut(inject_sc, |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                try_global_inject_pending(app);
            }
        })
        .map_err(|e| e.to_string())?;
        println!("[shortcut] inject: {}", inject_sc);
    } else {
        println!(
            "[shortcut] inject: disabled (auto_inject_enabled={})",
            settings.auto_inject_enabled
        );
    }
    println!("[shortcut] panel: {}", panel_sc);
    Ok(())
}

fn try_global_inject_pending(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let text = match state.pending_inject_text.lock() {
        Ok(g) => g.clone(),
        Err(_) => return,
    };
    let Some(text) = text else {
        println!("[inject] global shortcut: no pending AI result");
        return;
    };
    let last = state.last_external_host_hwnd.lock().ok().and_then(|g| *g);
    if let Some(panel) = app.get_webview_window("panel") {
        set_panel_always_on_top(
            &panel,
            false,
            "global inject starting — release panel so target app can receive focus",
        );
    }
    match inject::inject_text_via_clipboard(&text, last) {
        Ok(()) => {
            let _ = state.pending_inject_text.lock().map(|mut g| *g = None);
            let _ = app.emit_to("panel", "inject-finished", ());
            if let Some(panel) = app.get_webview_window("panel") {
                set_panel_always_on_top(
                    &panel,
                    false,
                    "global inject finished — keep collapsed panel non-blocking",
                );
            }
            println!("[inject] global shortcut pasted OK");
        }
        Err(e) => eprintln!("[inject] global shortcut failed: {e}"),
    }
}

#[derive(Serialize)]
struct ApiKeyStatus {
    /// True if a non-empty key exists in the OS store.
    pub configured: bool,
    /// Last 4 characters for display, if any.
    pub tail: Option<String>,
}

/// Resolve the API key for the currently selected LLM provider (multi-slot secrets).
fn llm_api_key_for(app_data: &std::path::Path, provider: &LlmProvider) -> Option<String> {
    secrets::get_api_key_slot(app_data, provider.secret_slot())
}

/// Resolve the API key / secret for the configured translation provider.
fn translation_api_key_for(
    app_data: &std::path::Path,
    provider: &TranslationProvider,
) -> Option<String> {
    if *provider == TranslationProvider::Llm {
        return None;
    }
    secrets::get_api_key_slot(app_data, provider.secret_slot())
}

/// Persist settings mutex + disk, then notify the panel webview.
fn persist_settings(app: &AppHandle, state: &AppState, next: &AppSettings) -> Result<(), String> {
    {
        let mut g = state.settings.lock().map_err(|e| e.to_string())?;
        *g = next.clone();
    }
    next.save(&state.app_data).map_err(|e| e.to_string())?;
    let _ = app.emit_to("panel", "settings-changed", ());
    Ok(())
}

/// When competition is enabled: probe due candidates, score, and switch active model if needed.
async fn maybe_run_competition(
    app: &AppHandle,
    state: &AppState,
    force_probe: bool,
) -> Result<(), String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    if !settings.competition.enabled {
        return Ok(());
    }
    let _ =
        competition::probe_due_candidates(&state.http, &state.app_data, &mut settings, force_probe)
            .await;
    let result = competition::evaluate_and_apply(&mut settings);
    persist_settings(app, state, &settings)?;
    println!(
        "[competition] maybe_run applied={} winner={:?}",
        result.applied, result.winner_id
    );
    Ok(())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    state
        .settings
        .lock()
        .map_err(|e| e.to_string())
        .map(|g| g.clone())
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, next: AppSettings) -> Result<(), String> {
    {
        let mut g = state.settings.lock().map_err(|e| e.to_string())?;
        *g = next.clone();
    }
    next.save(&state.app_data).map_err(|e| e.to_string())?;
    register_global_shortcuts(&app, &next)?;
    apply_panel_zorder_from_settings(&app);
    // Keep OS login item in sync with the persisted preference (default on).
    sync_autostart(&app, next.autostart_enabled);
    let _ = app.emit_to("panel", "settings-changed", ());
    println!("[settings] saved, shortcuts, z-order, and autostart refreshed");
    Ok(())
}

#[tauri::command]
fn get_api_key_status(state: State<AppState>) -> ApiKeyStatus {
    // Default status for the *currently selected* LLM provider.
    let provider = state
        .settings
        .lock()
        .ok()
        .map(|g| g.provider.clone())
        .unwrap_or_default();
    match secrets::get_api_key_slot(&state.app_data, provider.secret_slot()) {
        Some(s) if !s.is_empty() => {
            let tail = s.chars().rev().take(4).collect::<String>();
            let tail = tail.chars().rev().collect::<String>();
            ApiKeyStatus {
                configured: true,
                tail: Some(tail),
            }
        }
        _ => ApiKeyStatus {
            configured: false,
            tail: None,
        },
    }
}

#[tauri::command]
fn get_api_key_status_for(state: State<AppState>, slot: String) -> ApiKeyStatus {
    match secrets::get_api_key_slot(&state.app_data, &slot) {
        Some(s) if !s.is_empty() => {
            let tail = s.chars().rev().take(4).collect::<String>();
            let tail = tail.chars().rev().collect::<String>();
            ApiKeyStatus {
                configured: true,
                tail: Some(tail),
            }
        }
        _ => ApiKeyStatus {
            configured: false,
            tail: None,
        },
    }
}

#[tauri::command]
fn set_api_key_cmd(state: State<AppState>, key: String) -> Result<(), String> {
    // Saves into the currently selected LLM provider slot.
    let provider = state
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .provider
        .clone();
    secrets::set_api_key_slot(&state.app_data, provider.secret_slot(), &key)
}

#[tauri::command]
fn set_api_key_for_cmd(state: State<AppState>, slot: String, key: String) -> Result<(), String> {
    secrets::set_api_key_slot(&state.app_data, &slot, &key)
}

#[tauri::command]
fn list_commands(state: State<AppState>) -> Result<Vec<PromptCommand>, String> {
    Ok(merged_commands(&state.app_data))
}

#[tauri::command]
fn list_default_commands() -> Result<Vec<PromptCommand>, String> {
    Ok(prompt_commands::load_embedded_defaults())
}

#[tauri::command]
fn get_user_commands(state: State<AppState>) -> Result<UserCommandsLoad, String> {
    Ok(prompt_commands::load_user_commands_snap(&state.app_data))
}

#[tauri::command]
fn save_user_commands_cmd(
    state: State<AppState>,
    cmds: Vec<PromptCommand>,
    order: Option<Vec<String>>,
) -> Result<(), String> {
    let order = order.unwrap_or_default();
    prompt_commands::save_user_commands(&state.app_data, &cmds, &order).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct RunResult {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
}

#[derive(Serialize)]
pub struct StreamRunResult {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    pub cancelled: bool,
}

#[derive(Clone, Serialize)]
struct LlmStreamDelta {
    delta: String,
}

/// Build the final prompt string sent to the model (placeholder expansion + command lookup).
fn compose_llm_prompt(
    app_data: &std::path::PathBuf,
    command_id: Option<String>,
    prompt_override: Option<String>,
    input: &str,
    use_clipboard: bool,
    use_selection: bool,
) -> Result<(String, String), String> {
    let clipboard = if use_clipboard {
        inject::read_clipboard_text().unwrap_or_default()
    } else {
        String::new()
    };
    let selection = if use_selection {
        inject::copy_selection_from_focused_app().unwrap_or_default()
    } else {
        String::new()
    };

    let merged = merged_commands(app_data);
    let command_label = command_id
        .clone()
        .unwrap_or_else(|| "prompt_override".to_string());
    let template: String = if let Some(pid) = command_id {
        merged
            .into_iter()
            .find(|c| c.id == pid)
            .map(|c| c.prompt)
            .ok_or_else(|| "command not found".to_string())?
    } else if let Some(p) = prompt_override {
        p
    } else {
        return Err("command_id or prompt_override required".into());
    };

    let filled = apply_placeholders(&template, input, &clipboard, &selection);
    Ok((filled, command_label))
}

/// Run chat completion using a saved command id or a raw system prompt override.
#[tauri::command]
async fn run_llm(
    app: AppHandle,
    state: State<'_, AppState>,
    command_id: Option<String>,
    prompt_override: Option<String>,
    input: String,
    use_clipboard: bool,
    use_selection: bool,
) -> Result<RunResult, String> {
    schedule_tray_tooltip(&app, TrayPhase::Working);
    let started = Instant::now();

    // Competition: probe + score + switch (no-op when disabled).
    let _ = maybe_run_competition(&app, &state, false).await;

    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();

    // Dedicated translation API path for translate_* commands.
    if translate::should_use_translation_api(&settings.translation, command_id.as_deref()) {
        let (src, tgt) =
            translate::translate_langs_for_command(command_id.as_deref().unwrap_or(""))
                .ok_or_else(|| "not a translation command".to_string())?;
        let text_to_translate = {
            let clipboard = if use_clipboard {
                inject::read_clipboard_text().unwrap_or_default()
            } else {
                String::new()
            };
            let selection = if use_selection {
                inject::copy_selection_from_focused_app().unwrap_or_default()
            } else {
                String::new()
            };
            let raw = if !input.trim().is_empty() {
                input.clone()
            } else if !selection.trim().is_empty() {
                selection
            } else {
                clipboard
            };
            raw
        };
        let api_key = translation_api_key_for(&state.app_data, &settings.translation.provider);
        let result = match translate::translate_text(
            &state.http,
            &settings.translation,
            api_key.as_deref(),
            &text_to_translate,
            src,
            tgt,
        )
        .await
        {
            Ok(text) => {
                println!(
                    "[llm] translate API done total_ms={} chars={}",
                    started.elapsed().as_millis(),
                    text.chars().count()
                );
                Ok(RunResult {
                    text,
                    total_tokens: None,
                })
            }
            Err(error) => {
                eprintln!("[llm] translate API failed: {error}");
                Err(error.to_string())
            }
        };
        schedule_tray_tooltip(&app, TrayPhase::Idle);
        return result;
    }

    let (filled, command_label) = compose_llm_prompt(
        &state.app_data,
        command_id,
        prompt_override,
        &input,
        use_clipboard,
        use_selection,
    )?;
    println!(
        "[llm] run start provider={:?} model={} command={} input_chars={} prompt_chars={}",
        settings.provider,
        settings.model,
        command_label,
        input.chars().count(),
        filled.chars().count()
    );
    let api_key = llm_api_key_for(&state.app_data, &settings.provider);
    let result =
        match ai::chat_completion(&state.http, &settings, api_key.as_deref(), &filled).await {
            Ok(out) => {
                let elapsed = started.elapsed();
                println!(
                    "[llm] pipeline done total_ms={} output_chars={} tokens={:?}",
                    elapsed.as_millis(),
                    out.text.chars().count(),
                    out.total_tokens
                );
                // Feed throughput sample back into competition metrics.
                {
                    let mut s = state.settings.lock().map_err(|e| e.to_string())?;
                    let active_id = s.competition.active_candidate_id.clone();
                    competition::record_throughput_sample(
                        &mut s,
                        active_id.as_deref(),
                        out.total_tokens,
                        elapsed.as_secs_f64(),
                    );
                    let snap = s.clone();
                    drop(s);
                    let _ = snap.save(&state.app_data);
                }
                Ok(RunResult {
                    text: out.text,
                    total_tokens: out.total_tokens,
                })
            }
            Err(error) => {
                eprintln!(
                    "[llm] pipeline failed total_ms={} error={}",
                    started.elapsed().as_millis(),
                    error
                );
                Err(error.to_string())
            }
        };
    schedule_tray_tooltip(&app, TrayPhase::Idle);
    result
}

/// Same as `run_llm`, but streams tokens to the `panel` window via `llm-stream-delta` events.
#[tauri::command]
async fn run_llm_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    command_id: Option<String>,
    prompt_override: Option<String>,
    input: String,
    use_clipboard: bool,
    use_selection: bool,
) -> Result<StreamRunResult, String> {
    state.llm_stream_cancel.store(false, Ordering::SeqCst);
    schedule_tray_tooltip(&app, TrayPhase::Working);
    let started = Instant::now();

    let _ = maybe_run_competition(&app, &state, false).await;

    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();

    // Dedicated translation APIs are non-streaming: emit the full result as one delta.
    if translate::should_use_translation_api(&settings.translation, command_id.as_deref()) {
        let (src, tgt) =
            translate::translate_langs_for_command(command_id.as_deref().unwrap_or(""))
                .ok_or_else(|| "not a translation command".to_string())?;
        let text_to_translate = {
            let clipboard = if use_clipboard {
                inject::read_clipboard_text().unwrap_or_default()
            } else {
                String::new()
            };
            let selection = if use_selection {
                inject::copy_selection_from_focused_app().unwrap_or_default()
            } else {
                String::new()
            };
            if !input.trim().is_empty() {
                input.clone()
            } else if !selection.trim().is_empty() {
                selection
            } else {
                clipboard
            }
        };
        let api_key = translation_api_key_for(&state.app_data, &settings.translation.provider);
        let result = match translate::translate_text(
            &state.http,
            &settings.translation,
            api_key.as_deref(),
            &text_to_translate,
            src,
            tgt,
        )
        .await
        {
            Ok(text) => {
                let _ = app.emit_to(
                    "panel",
                    "llm-stream-delta",
                    LlmStreamDelta {
                        delta: text.clone(),
                    },
                );
                println!(
                    "[llm] translate stream done total_ms={} chars={}",
                    started.elapsed().as_millis(),
                    text.chars().count()
                );
                Ok(StreamRunResult {
                    text,
                    total_tokens: None,
                    cancelled: false,
                })
            }
            Err(error) => {
                eprintln!("[llm] translate stream failed: {error}");
                Err(error.to_string())
            }
        };
        state.llm_stream_cancel.store(false, Ordering::SeqCst);
        schedule_tray_tooltip(&app, TrayPhase::Idle);
        return result;
    }

    let (filled, command_label) = compose_llm_prompt(
        &state.app_data,
        command_id,
        prompt_override,
        &input,
        use_clipboard,
        use_selection,
    )?;
    println!(
        "[llm] stream start provider={:?} model={} command={} input_chars={} prompt_chars={}",
        settings.provider,
        settings.model,
        command_label,
        input.chars().count(),
        filled.chars().count()
    );
    let api_key = llm_api_key_for(&state.app_data, &settings.provider);
    let app_emit = app.clone();
    let cancel_flag = state.llm_stream_cancel.clone();
    let stream_result = ai::chat_completion_streaming(
        &state.http,
        &settings,
        api_key.as_deref(),
        &filled,
        cancel_flag.as_ref(),
        move |delta: &str| {
            let _ = app_emit.emit_to(
                "panel",
                "llm-stream-delta",
                LlmStreamDelta {
                    delta: delta.to_string(),
                },
            );
        },
    )
    .await;

    state.llm_stream_cancel.store(false, Ordering::SeqCst);
    schedule_tray_tooltip(&app, TrayPhase::Idle);

    match stream_result {
        Ok((out, cancelled)) => {
            let elapsed = started.elapsed();
            println!(
                "[llm] stream pipeline done total_ms={} output_chars={} tokens={:?} cancelled={}",
                elapsed.as_millis(),
                out.text.chars().count(),
                out.total_tokens,
                cancelled
            );
            if !cancelled {
                let mut s = state.settings.lock().map_err(|e| e.to_string())?;
                let active_id = s.competition.active_candidate_id.clone();
                competition::record_throughput_sample(
                    &mut s,
                    active_id.as_deref(),
                    out.total_tokens,
                    elapsed.as_secs_f64(),
                );
                let snap = s.clone();
                drop(s);
                let _ = snap.save(&state.app_data);
            }
            Ok(StreamRunResult {
                text: out.text,
                total_tokens: out.total_tokens,
                cancelled,
            })
        }
        Err(error) => {
            eprintln!(
                "[llm] stream pipeline failed total_ms={} error={}",
                started.elapsed().as_millis(),
                error
            );
            Err(error.to_string())
        }
    }
}

#[tauri::command]
fn cancel_llm_stream(state: State<AppState>) -> Result<(), String> {
    state.llm_stream_cancel.store(true, Ordering::SeqCst);
    println!("[llm] cancel_llm_stream: cancel flag set");
    Ok(())
}

#[tauri::command]
async fn list_llm_models(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let api_key = llm_api_key_for(&state.app_data, &settings.provider);
    ai::list_model_ids(&state.http, &settings, api_key.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn test_llm_connection(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    schedule_tray_tooltip(&app, TrayPhase::Testing);
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let api_key = llm_api_key_for(&state.app_data, &settings.provider);
    let result = ai::test_connection(&state.http, &settings, api_key.as_deref())
        .await
        .map_err(|e| e.to_string());
    schedule_tray_tooltip(&app, TrayPhase::Idle);
    result
}

/// Force-probe all enabled competition candidates, then score and apply the winner.
#[tauri::command]
async fn run_competition_now(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<competition::CompetitionEvalResult, String> {
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    if !settings.competition.enabled {
        return Err("模型竞争未开启".into());
    }
    schedule_tray_tooltip(&app, TrayPhase::Competing);
    let _ =
        competition::probe_due_candidates(&state.http, &state.app_data, &mut settings, true).await;
    let result = competition::evaluate_and_apply(&mut settings);
    persist_settings(&app, &state, &settings)?;
    schedule_tray_tooltip(&app, TrayPhase::Idle);
    println!(
        "[competition] run_competition_now applied={} winner={:?}",
        result.applied, result.winner_id
    );
    Ok(result)
}

/// Score without probing (uses last measured metrics).
#[tauri::command]
fn evaluate_competition(
    state: State<AppState>,
) -> Result<competition::CompetitionEvalResult, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(competition::evaluate(&settings.competition))
}

/// Test a dedicated translation provider with a short sample string.
#[tauri::command]
async fn test_translation_connection(state: State<'_, AppState>) -> Result<String, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    if settings.translation.provider == TranslationProvider::Llm {
        return Ok("当前为「大模型提示词」模式，无需专用翻译 API。".into());
    }
    let api_key = translation_api_key_for(&state.app_data, &settings.translation.provider);
    let out = translate::translate_text(
        &state.http,
        &settings.translation,
        api_key.as_deref(),
        "Hello, world!",
        "en",
        "zh",
    )
    .await
    .map_err(|e| e.to_string())?;
    println!("[translate] test OK result_chars={}", out.chars().count());
    Ok(out)
}

#[tauri::command]
fn set_pending_inject_text(state: State<AppState>, text: String) -> Result<(), String> {
    let mut g = state
        .pending_inject_text
        .lock()
        .map_err(|e| e.to_string())?;
    *g = Some(text);
    println!("[inject] pending result registered for global shortcut");
    Ok(())
}

#[tauri::command]
fn clear_pending_inject_text(state: State<AppState>) -> Result<(), String> {
    let _ = state.pending_inject_text.lock().map(|mut g| *g = None);
    Ok(())
}

#[tauri::command]
fn show_panel_cmd(app: AppHandle) -> Result<(), String> {
    show_panel(&app);
    Ok(())
}

#[tauri::command]
fn show_settings_cmd(app: AppHandle) -> Result<(), String> {
    schedule_workspace_window_op(&app, "show_settings_main", |a| show_settings_main(a))
}

#[tauri::command]
fn show_commands_cmd(app: AppHandle) -> Result<(), String> {
    schedule_workspace_window_op(&app, "show_commands_main", |a| show_commands_main(a))
}

#[tauri::command]
fn show_workspace_page_cmd(app: AppHandle, slug: String) -> Result<(), String> {
    schedule_workspace_window_op(&app, "show_workspace_page_main", move |a| {
        show_workspace_page_main(a, &slug)
    })
}

#[tauri::command]
fn workspace_window_hidden_cmd(app: AppHandle) -> Result<(), String> {
    schedule_workspace_window_op(&app, "restore_panel_after_main_workspace", |a| {
        restore_panel_after_main_workspace(a);
        Ok(())
    })
}

#[tauri::command]
fn copy_to_clipboard_cmd(_state: State<AppState>, text: String) -> Result<(), String> {
    inject::copy_text_to_clipboard(&text)
}

#[tauri::command]
fn set_panel_zorder_mode(
    app: AppHandle,
    state: State<AppState>,
    mode: String,
) -> Result<(), String> {
    let parsed = PanelZorderMode::from_wire(&mode)
        .ok_or_else(|| format!("unknown panel zorder mode: {}", mode))?;

    let mut updated = None;
    {
        let mut g = state.settings.lock().map_err(|e| e.to_string())?;
        if g.panel_zorder_mode != parsed {
            g.panel_zorder_mode = parsed;
            updated = Some(g.clone());
        }
    }

    if let Some(next) = updated {
        next.save(&state.app_data).map_err(|e| e.to_string())?;
        apply_panel_zorder_from_settings(&app);
        println!(
            "[settings] panel zorder mode changed to {:?} and persisted",
            parsed
        );
    }
    Ok(())
}

#[tauri::command]
fn set_ui_locale(app: AppHandle, state: State<'_, AppState>, locale: String) -> Result<(), String> {
    let parsed = parse_ui_locale(&locale);
    {
        let mut slot = state.ui_locale.lock().map_err(|e| e.to_string())?;
        *slot = parsed;
    }
    store_ui_locale(&state.app_data, parsed);
    apply_window_titles(&app, parsed);
    let menu = build_tray_menu(&app, parsed).map_err(|e| e.to_string())?;
    {
        let tray = state.tray.lock().map_err(|e| e.to_string())?;
        if let Some(icon) = tray.as_ref() {
            icon.set_menu(Some(menu)).map_err(|e| e.to_string())?;
            println!("[tray] menu rebuilt for locale");
        }
    }
    let phase = state
        .tray_phase
        .lock()
        .map(|guard| *guard)
        .unwrap_or(TrayPhase::Idle);
    schedule_tray_tooltip(&app, phase);
    let code = match parsed {
        UiLocale::En => "en",
        UiLocale::Zh => "zh",
    };
    if let Err(e) = app.emit("ui-locale-changed", code) {
        eprintln!("[ui] emit ui-locale-changed failed: {e}");
    }
    println!("[ui] set_ui_locale {locale}");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let settings = AppSettings::load(&app_data);
            let ui_locale = load_ui_locale(&app_data);
            let http = reqwest::Client::builder()
                .timeout(Duration::from_secs(settings.timeout_secs.max(5)))
                .build()
                .map_err(|e| e.to_string())?;

            app.manage(AppState {
                settings: Mutex::new(settings.clone()),
                http,
                app_data: app_data.clone(),
                last_external_host_hwnd: Mutex::new(None),
                pending_inject_text: Mutex::new(None),
                llm_stream_cancel: Arc::new(AtomicBool::new(false)),
                tray: Mutex::new(None),
                ui_locale: Mutex::new(ui_locale),
                tray_phase: Mutex::new(TrayPhase::Idle),
                last_panel_expanded_size: Mutex::new((PANEL_EXPANDED_WIDTH, PANEL_EXPANDED_HEIGHT)),
            });

            let handle = app.handle().clone();
            register_global_shortcuts(&handle, &settings)?;
            // Default-on preference: ensure OS startup entry matches settings on every launch.
            sync_autostart(&handle, settings.autostart_enabled);
            apply_window_titles(&handle, ui_locale);

            // Tray: primary actions first (AI panel, settings); no separate "open main window" entry.
            let menu = build_tray_menu(app.handle(), ui_locale)?;

            attach_minimize_to_hide(&app.handle(), "panel");
            attach_panel_topmost_follows_focus(&app.handle());

            let tray_icon_image = load_tray_icon(&app.handle())?;

            let tray = TrayIconBuilder::new()
                .icon(tray_icon_image)
                .tooltip(format!(
                    "{}\n{}",
                    tray_headline(ui_locale),
                    tray_phase_line(ui_locale, TrayPhase::Idle)
                ))
                .menu(&menu)
                // `false`: context menu only on **right** click (Windows `WM_RBUTTONDOWN`). `true` also opens
                // the menu on left click, which would swallow the double-click that opens the AI panel.
                .show_menu_on_left_click(false)
                .on_tray_icon_event(handle_tray_icon_event)
                .on_menu_event(|app, event| {
                    let handle = app.clone();
                    let id = event.id.clone();
                    if let Err(e) = app.run_on_main_thread(move || dispatch_tray_menu(&handle, id))
                    {
                        eprintln!("[tray] run_on_main_thread(menu dispatch) failed: {e}");
                    }
                })
                .build(&*app)?;

            {
                let handle = app.handle().clone();
                let state = handle.state::<AppState>();
                let mut slot = state.tray.lock().map_err(|e| e.to_string())?;
                *slot = Some(tray);
            }

            println!("[startup] IME Companion backend ready (tray icon loaded, tooltip set)");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            get_api_key_status,
            get_api_key_status_for,
            set_api_key_cmd,
            set_api_key_for_cmd,
            list_commands,
            list_default_commands,
            get_user_commands,
            save_user_commands_cmd,
            run_llm,
            run_llm_stream,
            cancel_llm_stream,
            list_llm_models,
            test_llm_connection,
            run_competition_now,
            evaluate_competition,
            test_translation_connection,
            set_pending_inject_text,
            clear_pending_inject_text,
            show_panel_cmd,
            show_settings_cmd,
            show_commands_cmd,
            show_workspace_page_cmd,
            workspace_window_hidden_cmd,
            copy_to_clipboard_cmd,
            set_panel_zorder_mode,
            report_panel_expanded_size,
            reveal_panel_first_paint,
            sync_panel_window_geometry,
            set_ui_locale,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
