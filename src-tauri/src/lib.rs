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

#[cfg(windows)]
mod ocr_engine;
#[cfg(windows)]
mod ocr_native;
mod ocr_flow;

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

#[cfg(target_os = "macos")]
mod macos_ocr;

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
            ocr_flow::start_selection_ocr,
            ocr_flow::finish_selection_ocr,
            ocr_flow::cancel_selection_ocr,
            ocr_flow::complete_ocr_flow,
            ocr_flow::set_ocr_engine
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
            app.manage(ocr_flow::CapturedImages::default());
            app.manage(ocr_flow::OcrOriginState::default());
            #[cfg(windows)]
            {
                app.manage(ocr_flow::PaddleOcrState(Mutex::new(None)));
                app.manage(ocr_flow::WindowsOcrState(Mutex::new(None)));
                app.manage(ocr_flow::OcrEngineConfig::default());
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
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
