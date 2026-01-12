use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::MacosLauncher;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use arboard::Clipboard;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use mouse_position::mouse_position::Mouse;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use xcap::Monitor;

mod ocr_engine;
use ocr_engine::PaddleOcr;

use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// Windows UI Automation for getting selected text without clipboard
// TODO: Enable when we have a working implementation
// #[cfg(windows)]
// use uiautomation::{patterns::TextPattern, UIAutomation};

const MAIN_WINDOW_LABEL: &str = "main";
const COMPACT_WINDOW_LABEL: &str = "compact";
const CAPTURE_WINDOW_LABEL: &str = "capture";
const CAPTURE_WINDOW_PREFIX: &str = "capture-";
const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+H";

struct ExitState(AtomicBool);

impl Default for ExitState {
    fn default() -> Self {
        Self(AtomicBool::new(false))
    }
}

struct ShortcutConfig(Mutex<String>);

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self(Mutex::new(DEFAULT_SHORTCUT.to_string()))
    }
}

// Store pending text to be passed to compact window
struct PendingText(Mutex<Option<String>>);

impl Default for PendingText {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

// Store text to be passed to main window (Handover)
struct HandoverText(Mutex<Option<String>>);

impl Default for HandoverText {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

// Store last cursor position for window positioning
struct LastCursorPos(Mutex<Option<(i32, i32)>>);

impl Default for LastCursorPos {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

// Store captured screen images for OCR (one per monitor)
struct CapturedImages(Mutex<HashMap<String, image::RgbaImage>>);

impl Default for CapturedImages {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum WindowOrigin {
    Main,
    Compact,
}

struct OcrOriginState(Mutex<WindowOrigin>);

impl Default for OcrOriginState {
    fn default() -> Self {
        Self(Mutex::new(WindowOrigin::Main))
    }
}

#[allow(dead_code)]
struct PaddleOcrState(Mutex<Option<PaddleOcr>>);

impl Default for PaddleOcrState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Debug)]
struct ShortcutError(String);

impl std::fmt::Display for ShortcutError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for ShortcutError {}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_main_window(app: AppHandle) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Hide compact window first
        if let Some(compact) = app.get_webview_window(COMPACT_WINDOW_LABEL) {
            let _ = compact.hide();
        }
        // Get cursor position from stored state (from when compact was opened)
        let cursor_pos = app.state::<LastCursorPos>().0.lock().ok().and_then(|g| *g);
        let _ = show_main_window(&app, cursor_pos);
    }
}

#[tauri::command]
fn get_pending_text(state: State<'_, PendingText>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
fn get_handover_text(state: State<'_, HandoverText>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.state::<ExitState>().0.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn update_pending_text(text: String, state: State<'_, PendingText>) {
    if let Ok(mut g) = state.0.lock() {
        *g = Some(text);
    }
}

#[tauri::command]
fn replace_selection(app: AppHandle, text: String) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        if let Some(window) = app.get_webview_window(COMPACT_WINDOW_LABEL) {
            let _ = window.hide();
        }
        std::thread::sleep(Duration::from_millis(120));

        let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
        let original_text = clipboard.get_text().ok();
        clipboard.set_text(text).map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(40));

        #[cfg(windows)]
        send_paste_shortcut();
        #[cfg(target_os = "macos")]
        send_paste_shortcut();
        #[cfg(all(not(windows), not(target_os = "macos")))]
        send_paste_shortcut();

        std::thread::sleep(Duration::from_millis(250));

        if let Some(orig) = original_text {
            let _ = clipboard.set_text(orig);
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn get_cursor_position() -> Option<(i32, i32)> {
    match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Some((x, y)),
        Mouse::Error => None,
    }
}

// Windows: Use SendInput API for keyboard simulation
#[cfg(windows)]
fn send_copy_shortcut() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VK_C, VK_CONTROL, VK_LWIN, VK_MENU, VK_SHIFT,
    };

    println!("[copy] Sending Ctrl+C via SendInput (safe)...");

    // Create key inputs: Release modifiers -> Ctrl down -> C down -> C up -> Ctrl up -> Restore modifiers
    // We release modifiers first to avoid "Ctrl+Shift+C", then restore them to match physical state
    // UPDATED STRATEGY: Simpler sequence with delays.
    // 1. Release modifiers
    // 2. Short sleep
    // 3. Ctrl+C
    // 4. Short sleep
    // 5. (We rely on user physical input to restore modifiers state naturally, or next press will just work)

    // Actually, let's keep the explicit release.
    let release_inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_SHIFT,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_MENU,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_LWIN,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    unsafe { SendInput(&release_inputs, std::mem::size_of::<INPUT>() as i32) };
    // Increased sleep to ensure modifiers are cleared
    std::thread::sleep(Duration::from_millis(50));

    let copy_inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_C,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_C,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let result = unsafe { SendInput(&copy_inputs, std::mem::size_of::<INPUT>() as i32) };
    println!("[copy] SendInput result: {}", result);

    // Wait a bit for the copy to complete
    std::thread::sleep(Duration::from_millis(50));
}

// Windows: Use SendInput API for keyboard simulation (Paste)
#[cfg(windows)]
fn send_paste_shortcut() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VK_CONTROL, VK_V,
    };

    println!("[paste] Sending Ctrl+V via SendInput (safe)...");

    let paste_inputs = [
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_V,
                    wScan: 0,
                    dwFlags: KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_V,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VK_CONTROL,
                    wScan: 0,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        },
    ];
    let result = unsafe { SendInput(&paste_inputs, std::mem::size_of::<INPUT>() as i32) };
    println!("[paste] SendInput result: {}", result);

    std::thread::sleep(Duration::from_millis(50));
}

// macOS: Use CGEventPost for keyboard simulation
#[cfg(target_os = "macos")]
fn send_copy_shortcut() {
    // TODO: Implement macOS keyboard simulation using Core Graphics
    // For now, this is a placeholder
    println!("[copy] macOS keyboard simulation not yet implemented");
}

// macOS: Use CGEventPost for keyboard simulation (Paste)
#[cfg(target_os = "macos")]
fn send_paste_shortcut() {
    // TODO: Implement macOS keyboard simulation using Core Graphics
    println!("[paste] macOS keyboard simulation not yet implemented");
}

// Linux: Placeholder
#[cfg(all(
    not(windows),
    not(target_os = "macos"),
    not(any(target_os = "android", target_os = "ios"))
))]
fn send_copy_shortcut() {
    println!("[copy] Linux keyboard simulation not yet implemented");
}

// Linux: Placeholder (Paste)
#[cfg(all(
    not(windows),
    not(target_os = "macos"),
    not(any(target_os = "android", target_os = "ios"))
))]
fn send_paste_shortcut() {
    println!("[paste] Linux keyboard simulation not yet implemented");
}

// Windows: UI Automation implementation

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn capture_selected_text() -> Option<String> {
    println!("[capture] Starting text capture via Clipboard Hack...");

    let mut clipboard = Clipboard::new().ok()?;

    // Preserve original content
    let original_text = clipboard.get_text().ok();

    // Clear clipboard
    let _ = clipboard.set_text("");

    // Simulate Ctrl+C
    #[cfg(windows)]
    send_copy_shortcut();
    #[cfg(target_os = "macos")]
    send_copy_shortcut();
    #[cfg(all(not(windows), not(target_os = "macos")))]
    send_copy_shortcut();

    // Poll for text - use shorter timeout for responsiveness, but more retries
    let mut result = None;
    let max_retries = 10; // 10 * 20ms = 200ms timeout
    let sleep_ms = 20;

    for i in 0..max_retries {
        std::thread::sleep(Duration::from_millis(sleep_ms));

        if let Ok(text) = clipboard.get_text() {
            // Check if text is non-empty
            if !text.is_empty() {
                println!("[capture] Attempt {}: Captured {} chars", i + 1, text.len());
                result = Some(text);
                break;
            }
        }
    }

    // Restore original
    if let Some(orig) = original_text {
        let _ = clipboard.set_text(orig);
    }

    result
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn trigger_quick_open(app: AppHandle) {
    println!("[shortcut] Trigger quick open called!");
    let cursor_pos = get_cursor_position();

    // Capture text BEFORE spawning thread to avoid potential threading issues
    let selection = capture_selected_text();
    println!(
        "[shortcut] Selection captured with UIA attempt: {:?}",
        selection.as_ref().map(|s| s.len())
    );

    std::thread::spawn(move || {
        let _ = show_compact_window(&app, selection, cursor_pos);
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn register_shortcut(
    app: &AppHandle,
    state: &ShortcutConfig,
    shortcut: &str,
) -> Result<(), ShortcutError> {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        return Err(ShortcutError("Shortcut is empty".into()));
    }

    let mut current = state
        .0
        .lock()
        .map_err(|_| ShortcutError("Shortcut lock failed".into()))?;

    if current.as_str() == trimmed {
        return Ok(());
    }

    let manager = app.global_shortcut();
    if !current.is_empty() {
        let _ = manager.unregister(current.as_str());
    }

    manager
        .on_shortcut(trimmed, move |app: &AppHandle, _shortcut, event| {
            if event.state != ShortcutState::Pressed {
                return;
            }
            trigger_quick_open(app.clone());
        })
        .map_err(|err| ShortcutError(err.to_string()))?;

    *current = trimmed.to_string();
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn update_shortcut(
    app: AppHandle,
    state: State<'_, ShortcutConfig>,
    shortcut: String,
) -> Result<(), String> {
    register_shortcut(&app, state.inner(), &shortcut).map_err(|err| err.0)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_compact_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(COMPACT_WINDOW_LABEL) {
        return Ok(window);
    }

    tauri::WebviewWindowBuilder::new(
        app,
        COMPACT_WINDOW_LABEL,
        tauri::WebviewUrl::App("/?view=compact".into()),
    )
    .title("Howlingual Quick")
    .inner_size(420.0, 520.0)
    .min_inner_size(420.0, 520.0)
    .max_inner_size(420.0, 520.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn ensure_capture_window(
    app: &AppHandle,
    label: &str,
    url: &str,
) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.hide();
        // let _ = window.show();
        // let _ = window.set_focus();
        return Ok(window);
    }

    tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .title("Howlingual Capture")
        .transparent(true)
        .resizable(true)
        .decorations(false)
        .shadow(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn close_capture_windows(app: &AppHandle) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, window) in app.webview_windows() {
        if label == CAPTURE_WINDOW_LABEL || label.starts_with(CAPTURE_WINDOW_PREFIX) {
            if let Err(e) = window.close() {
                errors.push(format!("Failed to close window '{}': {}", label, e));
            }
        }
    }

    if !errors.is_empty() {
        return Err(errors.join("; "));
    }

    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn clamp_window_to_monitor(
    x: i32,
    y: i32,
    win_w: i32,
    win_h: i32,
    mon_pos: tauri::PhysicalPosition<i32>,
    mon_size: tauri::PhysicalSize<u32>,
) -> (i32, i32) {
    let mut clamped_x = x;
    let mut clamped_y = y;
    let mon_right = mon_pos.x + mon_size.width as i32;
    let mon_bottom = mon_pos.y + mon_size.height as i32;

    if clamped_x + win_w > mon_right {
        clamped_x = mon_right - win_w;
    }
    if clamped_y + win_h > mon_bottom {
        clamped_y = mon_bottom - win_h;
    }
    if clamped_x < mon_pos.x {
        clamped_x = mon_pos.x;
    }
    if clamped_y < mon_pos.y {
        clamped_y = mon_pos.y;
    }

    (clamped_x, clamped_y)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_main_window(app: &AppHandle, cursor_pos: Option<(i32, i32)>) -> tauri::Result<()> {
    let window = if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
    } else {
        let mut builder = tauri::WebviewWindowBuilder::new(
            app,
            MAIN_WINDOW_LABEL,
            tauri::WebviewUrl::App("/?view=main".into()),
        );

        #[cfg(target_os = "macos")]
        {
            builder = builder
                .title("Howlingual")
                .inner_size(800.0, 600.0)
                .min_inner_size(600.0, 400.0)
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .transparent(true);
        }

        #[cfg(target_os = "windows")]
        {
            builder = builder
                .title("Howlingual")
                .inner_size(800.0, 600.0)
                .min_inner_size(600.0, 400.0)
                .decorations(false)
                .transparent(true)
                .shadow(true);
        }

        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        {
            builder = builder
                .title("Howlingual")
                .inner_size(800.0, 600.0)
                .min_inner_size(600.0, 400.0);
        }

        builder.build()?
    };

    // Position window near cursor if available
    if let Some((cursor_x, cursor_y)) = cursor_pos {
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 800,
            height: 600,
        });

        let monitor = window
            .available_monitors()?
            .into_iter()
            .find(|m| {
                let pos = m.position();
                let size = m.size();
                cursor_x >= pos.x
                    && cursor_x < pos.x + size.width as i32
                    && cursor_y >= pos.y
                    && cursor_y < pos.y + size.height as i32
            })
            .or_else(|| window.primary_monitor().ok().flatten());

        if let Some(monitor) = monitor {
            let mon_pos = monitor.position();
            let mon_size = monitor.size();
            let _scale = monitor.scale_factor();
            let win_w = win_size.width as i32;
            let win_h = win_size.height as i32;

            // Center window on cursor
            let x = cursor_x - win_w / 2;
            let y = cursor_y - win_h / 2;
            let (x, y) = clamp_window_to_monitor(x, y, win_w, win_h, *mon_pos, *mon_size);

            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
    }

    window.show()?;
    window.set_focus()?;
    let _ = app.emit("window_shown", "main");
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_compact_window(
    app: &AppHandle,
    text: Option<String>,
    cursor_pos: Option<(i32, i32)>,
) -> tauri::Result<()> {
    let window = ensure_compact_window(app)?;

    // Position window near cursor if available
    if let Some((cursor_x, cursor_y)) = cursor_pos {
        println!("[debug] Cursor pos: ({}, {})", cursor_x, cursor_y);

        // Get window size
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 420,
            height: 520,
        });
        println!(
            "[debug] Window size: {}x{}",
            win_size.width, win_size.height
        );

        // Get the monitor at cursor position or primary monitor
        let monitors = window.available_monitors()?;
        println!("[debug] Available monitors: {}", monitors.len());

        let monitor = monitors
            .into_iter()
            .find(|m| {
                let pos = m.position();
                let size = m.size();
                println!(
                    "[debug] Monitor: pos=({},{}), size={}x{}",
                    pos.x, pos.y, size.width, size.height
                );
                cursor_x >= pos.x
                    && cursor_x < pos.x + size.width as i32
                    && cursor_y >= pos.y
                    && cursor_y < pos.y + size.height as i32
            })
            .or_else(|| window.primary_monitor().ok().flatten());

        if let Some(monitor) = monitor {
            let mon_pos = monitor.position();
            let mon_size = monitor.size();
            let scale = monitor.scale_factor();
            println!(
                "[debug] Selected monitor: pos=({},{}), size={}x{}, scale={}",
                mon_pos.x, mon_pos.y, mon_size.width, mon_size.height, scale
            );

            // Calculate position: center window on cursor, but keep within screen bounds
            let win_w = win_size.width as i32;
            let win_h = win_size.height as i32;

            // Start with cursor position offset slightly (so cursor is near top-left of window)
            // UPDATED: Shift it more to the right so it doesn't overlap cursor immediately
            let x = cursor_x + 10;
            let y = cursor_y + 10;
            println!("[debug] Initial calc pos: ({}, {})", x, y);
            let (x, y) = clamp_window_to_monitor(x, y, win_w, win_h, *mon_pos, *mon_size);

            println!("[debug] Final pos: ({}, {})", x, y);
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            println!("[debug] No monitor found!");
        }
    } else {
        println!("[debug] No cursor pos available");
    }

    window.show()?;
    window.set_focus()?;
    let _ = app.emit("window_shown", "compact");

    // Store text in PendingText state for frontend to retrieve
    if let Ok(mut pending) = app.state::<PendingText>().0.lock() {
        *pending = text.clone();
    }

    // Alwaus emit event! If None, emit empty string to clear/reset UI
    let payload = text.unwrap_or_default();
    let _ = app.emit("text_captured", payload);

    // Store cursor position for later use (e.g., opening main window)
    if let Ok(mut pos) = app.state::<LastCursorPos>().0.lock() {
        *pos = cursor_pos;
    }

    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "メイン画面を表示", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "終了", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("Howlingual")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = show_main_window(app, None);
            }
            "quit" => {
                app.state::<ExitState>().0.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                let _ = show_main_window(tray.app_handle(), None);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_global_shortcut(
    app: &AppHandle,
    state: &ShortcutConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    register_shortcut(app, state, DEFAULT_SHORTCUT)
        .map_err(|err| Box::new(err) as Box<dyn std::error::Error>)?;
    Ok(())
}

#[tauri::command]
fn handover_to_main(app: AppHandle, text: String) {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Update HandoverText so main window can pull it on mount if event is missed
        if let Ok(mut pending) = app.state::<HandoverText>().0.lock() {
            *pending = Some(text.clone());
        }

        // Hide compact window first
        if let Some(compact) = app.get_webview_window(COMPACT_WINDOW_LABEL) {
            let _ = compact.hide();
        }

        // Also close capture windows to prevent loop/overlap
        if let Err(e) = close_capture_windows(&app) {
            println!("[handover] Warning: Failed to close capture windows: {}", e);
        }

        // Show main window
        let cursor_pos = app.state::<LastCursorPos>().0.lock().ok().and_then(|g| *g);
        if let Ok(_) = show_main_window(&app, cursor_pos) {
            // Emit event specifically for main window
            let _ = app.emit("handover_data", text);
        }
    }
}

#[tauri::command]
async fn start_selection_ocr(app: AppHandle, origin: Option<String>) -> Result<(), String> {
    println!("[ocr] start_selection_ocr called, origin: {:?}", origin);

    // Default to Main if not specific
    let origin_enum = match origin.as_deref() {
        Some("compact") => WindowOrigin::Compact,
        _ => WindowOrigin::Main,
    };

    if let Ok(mut state) = app.state::<OcrOriginState>().0.lock() {
        *state = origin_enum;
    }

    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    {
        if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = main.hide();
        }
        if let Some(compact) = app.get_webview_window(COMPACT_WINDOW_LABEL) {
            let _ = compact.hide();
        }

        // Wait for windows to fully hide before capturing screenshots
        // TODO: Consider using window visibility state checks or event-based mechanism
        // for more reliable cross-platform behavior instead of hardcoded delay
        std::thread::sleep(Duration::from_millis(300));

        let monitors = Monitor::all().map_err(|e| e.to_string())?;

        // Close any existing capture windows before creating new ones
        if let Err(e) = close_capture_windows(&app) {
            println!(
                "[ocr] Warning: Failed to close existing capture windows: {}",
                e
            );
        }

        let mut capture_map = HashMap::new();

        // Get cursor position once to determine which monitor to focus
        let cursor_pos = get_cursor_position();

        for (index, monitor) in monitors.into_iter().enumerate() {
            let mon_width = monitor.width().map_err(|e| e.to_string())?;
            let mon_height = monitor.height().map_err(|e| e.to_string())?;
            let mon_x = monitor.x().map_err(|e| e.to_string())?;
            let mon_y = monitor.y().map_err(|e| e.to_string())?;

            println!(
                "[ocr] Capturing monitor {}: {}x{} at ({},{})",
                index, mon_width, mon_height, mon_x, mon_y
            );

            let image = monitor.capture_image().map_err(|e| e.to_string())?;
            println!(
                "[ocr] Captured image dimensions for monitor {}: {}x{}",
                index,
                image.width(),
                image.height()
            );

            let monitor_id = index.to_string();
            // Use PHYSICAL dimensions from the captured image for the window size
            let img_width = image.width();
            let img_height = image.height();

            capture_map.insert(monitor_id.clone(), image);

            let label = format!("{}{}", CAPTURE_WINDOW_PREFIX, monitor_id);
            let url = format!("/?view=capture&monitor={}", monitor_id);
            let window = ensure_capture_window(&app, &label, &url).map_err(|e| e.to_string())?;

            // Set window to physical pixel dimensions
            // Tauri will create a window of exact physical size
            // The webview will be scaled internally based on system DPI
            if let Err(e) =
                window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: mon_x,
                    y: mon_y,
                }))
            {
                println!("[ocr] Failed to set window position: {}", e);
            }

            if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: img_width,
                height: img_height,
            })) {
                println!("[ocr] Failed to set window size: {}", e);
            }

            // SHOW the window now that it's sized correctly
            if let Err(e) = window.show() {
                println!("[ocr] Failed to show window: {}", e);
            }

            // Focus strategy: focus the window on the monitor containing the cursor.
            // If cursor position is unavailable, focus the first monitor as a fallback.
            let should_focus = if let Some((cursor_x, cursor_y)) = cursor_pos {
                // Check if cursor is within this monitor's bounds
                cursor_x >= mon_x
                    && cursor_x < mon_x + mon_width as i32
                    && cursor_y >= mon_y
                    && cursor_y < mon_y + mon_height as i32
            } else {
                // Fallback: focus the first monitor if cursor position is unavailable
                index == 0
            };

            if should_focus {
                println!("[ocr] Focusing capture window on monitor {}", index);
                let _ = window.set_focus();
            }
        }

        if let Ok(mut lock) = app.state::<CapturedImages>().0.lock() {
            *lock = capture_map;
        }
    }

    Ok(())
}

#[tauri::command]
async fn finish_selection_ocr(
    app: AppHandle,
    monitor_id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Coordinates received here are in physical pixels
    // Frontend scales CSS pixel coords by devicePixelRatio before sending
    println!(
        "[ocr] finish_selection_ocr ({}): {},{} {}x{}",
        monitor_id, x, y, width, height
    );

    let image = {
        let state = app.state::<CapturedImages>();
        let mut lock = state.0.lock().map_err(|_| "Lock failed")?;
        lock.remove(&monitor_id)
            .ok_or_else(|| format!("No captured image found for monitor {}", monitor_id))?
    };

    // Validate crop bounds before cropping to avoid panics in crop_imm.
    // Image dimensions are in physical pixels (from screen capture)
    let image_width = image.width();
    let image_height = image.height();

    println!(
        "[ocr] Image dimensions: {}x{}, selection: {},{} {}x{}",
        image_width, image_height, x, y, width, height
    );

    if x < 0 || y < 0 {
        return Err("Selection out of bounds (negative coordinates)".into());
    }

    let x_u32 = x as u32;
    let y_u32 = y as u32;

    if x_u32 >= image_width || y_u32 >= image_height {
        return Err("Selection out of bounds (start point outside image)".into());
    }

    let max_width = image_width.saturating_sub(x_u32);
    let max_height = image_height.saturating_sub(y_u32);

    if width == 0 || height == 0 || width > max_width || height > max_height {
        return Err("Selection out of bounds (invalid width/height)".into());
    }

    // Crop image
    let sub_image = image::imageops::crop_imm(&image, x_u32, y_u32, width, height).to_image();

    // DEBUG: Save cropped image
    let _ = sub_image.save("/tmp/howlingual_ocr_crop.png");
    println!("[ocr] Saved debug crop to /tmp/howlingual_ocr_crop.png");

    // Do not close windows here! We need them open to show the "Processing" spinner.
    // The frontend will call cancel_selection_ocr (or close itself) after receiving the result.

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    return run_ocr(app, sub_image).await;

    #[cfg(any(target_os = "android", target_os = "ios"))]
    return Err("OCR not supported on mobile".into());
}

#[tauri::command]
fn complete_ocr_flow(app: AppHandle, text: String) -> Result<(), String> {
    println!(
        "[ocr] complete_ocr_flow called with text length: {}",
        text.len()
    );

    // Close capture windows first to clean up
    if let Err(e) = close_capture_windows(&app) {
        println!("[ocr] Warning: Failed to close capture windows: {}", e);
    }

    // Determine where to go back to based on origin state
    let origin = {
        let state = app.state::<OcrOriginState>();
        state.0.lock().map(|g| *g).unwrap_or(WindowOrigin::Main)
    };

    println!("[ocr] completing flow, returning to: {:?}", origin);

    match origin {
        WindowOrigin::Main => {
            // Re-use logic to show main window and pass data
            handover_to_main(app, text);
            Ok(())
        }
        WindowOrigin::Compact => {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let cursor_pos = app.state::<LastCursorPos>().0.lock().ok().and_then(|g| *g);
                show_compact_window(&app, Some(text), cursor_pos).map_err(|e| e.to_string())?;
                Ok(())
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                Err("Compact mode not supported on mobile".into())
            }
        }
    }
}

#[tauri::command]
fn cancel_selection_ocr(app: AppHandle) {
    // Close capture windows and clear state only if closure succeeds
    if let Err(e) = close_capture_windows(&app) {
        println!("[ocr] Warning: Failed to close some capture windows: {}", e);
        // Don't clear state if windows might still be active
    } else {
        // Only clear the state if all windows were successfully closed
        if let Ok(mut lock) = app.state::<CapturedImages>().0.lock() {
            lock.clear();
        }
    }

    // Restore original window
    let origin = {
        let state = app.state::<OcrOriginState>();
        state.0.lock().map(|g| *g).unwrap_or(WindowOrigin::Main)
    };
    println!("[ocr] cancelled, restoring: {:?}", origin);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    match origin {
        WindowOrigin::Main => {
            // For main window, just showing it is enough (we have no text to pass)
            // We can use show_main_window directly since we don't need handover event
            let cursor_pos = app.state::<LastCursorPos>().0.lock().ok().and_then(|g| *g);
            let _ = show_main_window(&app, cursor_pos);
        }
        WindowOrigin::Compact => {
            let cursor_pos = app.state::<LastCursorPos>().0.lock().ok().and_then(|g| *g);
            // Pass None as text to show window without changing text
            let _ = show_compact_window(&app, None, cursor_pos);
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_ocr;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn run_ocr(_app: AppHandle, image: image::RgbaImage) -> Result<String, String> {
    use image::DynamicImage;
    let dyn_img = DynamicImage::ImageRgba8(image);

    // 1. macOS Native OCR
    #[cfg(target_os = "macos")]
    {
        println!("[ocr] Running macOS Native Vision OCR...");
        return macos_ocr::perform_ocr(dyn_img);
    }

    // 2. PaddleOCR via ONNX (Windows/Linux)
    #[cfg(not(target_os = "macos"))]
    {
        let state = app.state::<PaddleOcrState>();
        let mut engine = match state.0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                println!("[ocr] WARNING: PaddleOcrState Mutex is poisoned. Recovering...");
                poisoned.into_inner()
            }
        };

        if let Some(engine) = engine.as_mut() {
            println!("[ocr] Running PaddleOCR...");
            return engine.recognize(&dyn_img).map_err(|e| e.to_string());
        }

        println!("[ocr] PaddleOCR not initialized, fallback unavailable.");
        Err("OCR engine not initialized (check logs)".into())
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
fn check_screen_capture_permission() {
    unsafe {
        let has_access = CGPreflightScreenCaptureAccess();
        println!("[main] Screen Capture Access Preflight: {}", has_access);
        if !has_access {
            println!("[main] Requesting Screen Capture Access...");
            let requested = CGRequestScreenCaptureAccess();
            println!("[main] Screen Capture Access Requested: {}", requested);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            update_shortcut,
            open_main_window,
            get_pending_text,
            get_handover_text,
            update_pending_text,
            replace_selection,
            quit_app,
            handover_to_main,
            start_selection_ocr,
            finish_selection_ocr,
            cancel_selection_ocr,
            complete_ocr_flow
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            check_screen_capture_permission();

            let _app_handle = app.handle();

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                // Enable native traffic lights (red/yellow/green)
                let _ = window.set_decorations(true);
                // Hide actual title text by setting empty string
                let _ = window.set_title("");
            }

            app.manage(ExitState::default());
            app.manage(ShortcutConfig::default());
            app.manage(PendingText::default());
            app.manage(HandoverText::default());
            app.manage(LastCursorPos::default());
            app.manage(CapturedImages::default());
            app.manage(OcrOriginState::default());
            app.manage(PaddleOcrState::default());

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                // Init OCR Engine (Windows only for now via Paddle)
                // Assuming Mac will use Vision framework via different logic
                let resource_path = app
                    .path()
                    .resolve("resources", tauri::path::BaseDirectory::Resource)
                    .unwrap_or_else(|_| std::path::PathBuf::from("resources"));

                // Fallback for dev environment where resources might be in src-tauri/resources
                // or just "resources" relative to CWD.
                let mut final_res_path = resource_path.clone();
                if !final_res_path.exists() {
                    let dev_res = std::path::PathBuf::from("resources");
                    if dev_res.exists() {
                        final_res_path = dev_res;
                        println!("[ocr] Using dev resources path: {:?}", final_res_path);
                    }
                } else {
                    println!("[ocr] Using resolved resources path: {:?}", final_res_path);
                }

                if final_res_path.exists() {
                    let det_model = final_res_path.join("ch_PP-OCRv4_det_infer.onnx");
                    let rec_model = final_res_path.join("japan_PP-OCRv3_rec_infer.onnx");
                    let keys = final_res_path.join("japan_dict.txt");

                    if det_model.exists() && rec_model.exists() && keys.exists() {
                        println!("[ocr] Initializing PaddleOCR...");
                        match PaddleOcr::new(&det_model, &rec_model, &keys) {
                            Ok(engine) => {
                                if let Ok(mut state) = app.state::<PaddleOcrState>().0.lock() {
                                    *state = Some(engine);
                                }
                                println!("[ocr] PaddleOCR initialized successfully.");
                            }
                            Err(e) => {
                                println!("[ocr] Failed to initialize PaddleOCR: {}", e);
                            }
                        }
                    } else {
                        println!("[ocr] Missing model files in {:?}", final_res_path);
                    }
                } else {
                    println!("[ocr] Resources directory not found.");
                }

                let shortcut_state = app.state::<ShortcutConfig>();
                ensure_compact_window(&app.handle())?;
                setup_tray(&app.handle())?;
                setup_global_shortcut(&app.handle(), shortcut_state.inner())?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let should_exit = window
                    .app_handle()
                    .state::<ExitState>()
                    .0
                    .load(Ordering::SeqCst);
                if !should_exit {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
