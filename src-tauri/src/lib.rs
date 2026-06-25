#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::borrow::Cow;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::fs;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use arboard::{Clipboard, ImageData};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use mouse_position::mouse_position::Mouse;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::tray::{TrayIconBuilder, TrayIconEvent};

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use xcap::Monitor;

#[cfg(windows)]
mod ocr_engine;
#[cfg(windows)]
mod ocr_native;
mod translation_backend;

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
        // Keep runtime state empty at boot so initial registration always runs.
        Self(Mutex::new(String::new()))
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

// Clipboard ops enabled flag for replacing the current selection.
struct ClipboardOpsEnabled(Mutex<bool>);

impl Default for ClipboardOpsEnabled {
    fn default() -> Self {
        Self(Mutex::new(false))
    }
}

#[cfg(windows)]
pub struct PaddleOcrState(Mutex<Option<ocr_engine::PaddleOcr>>);

#[cfg(windows)]
pub struct WindowsOcrState(Mutex<Option<ocr_native::WindowsOcr>>);

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum OcrEngineType {
    Paddle,
    Windows,
}

#[cfg(windows)]
struct OcrEngineConfig(Mutex<OcrEngineType>);

#[cfg(windows)]
impl Default for OcrEngineConfig {
    fn default() -> Self {
        Self(Mutex::new(OcrEngineType::Paddle))
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
fn set_clipboard_ops_enabled(enabled: bool, state: State<'_, ClipboardOpsEnabled>) {
    if let Ok(mut g) = state.0.lock() {
        *g = enabled;
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
enum ClipboardBackup {
    Text(String),
    Image {
        width: usize,
        height: usize,
        bytes: Vec<u8>,
    },
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn backup_clipboard(clipboard: &mut Clipboard) -> Option<ClipboardBackup> {
    if let Ok(text) = clipboard.get_text() {
        return Some(ClipboardBackup::Text(text));
    }

    if let Ok(image) = clipboard.get_image() {
        return Some(ClipboardBackup::Image {
            width: image.width,
            height: image.height,
            bytes: image.bytes.into_owned(),
        });
    }

    None
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn restore_clipboard(clipboard: &mut Clipboard, backup: Option<ClipboardBackup>) {
    let Some(backup) = backup else {
        return;
    };

    match backup {
        ClipboardBackup::Text(text) => {
            let _ = clipboard.set_text(text);
        }
        ClipboardBackup::Image {
            width,
            height,
            bytes,
        } => {
            let _ = clipboard.set_image(ImageData {
                width,
                height,
                bytes: Cow::Owned(bytes),
            });
        }
    }
}

#[tauri::command]
fn replace_selection(app: AppHandle, text: String) -> Result<(), String> {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let enabled = app
            .state::<ClipboardOpsEnabled>()
            .0
            .lock()
            .map(|g| *g)
            .unwrap_or(true);
        if !enabled {
            return Err("Clipboard operations are disabled".into());
        }
        if let Some(window) = app.get_webview_window(COMPACT_WINDOW_LABEL) {
            let _ = window.hide();
        }
        std::thread::sleep(Duration::from_millis(120));

        let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
        let original_clipboard = backup_clipboard(&mut clipboard);
        clipboard.set_text(text).map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(40));

        #[cfg(windows)]
        send_paste_shortcut();
        #[cfg(target_os = "macos")]
        send_paste_shortcut();
        #[cfg(all(not(windows), not(target_os = "macos")))]
        send_paste_shortcut();

        std::thread::sleep(Duration::from_millis(250));

        restore_clipboard(&mut clipboard, original_clipboard);
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

    log::info!("[copy] Sending Ctrl+C via SendInput (safe)...");

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
    log::info!("[copy] SendInput result: {}", result);

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

    log::info!("[paste] Sending Ctrl+V via SendInput (safe)...");

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
    log::info!("[paste] SendInput result: {}", result);

    std::thread::sleep(Duration::from_millis(50));
}

// macOS: Use CGEventPost for keyboard simulation
#[cfg(target_os = "macos")]
fn send_copy_shortcut() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEY_C: u16 = 0x08;

    let source = match CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        Ok(source) => source,
        Err(_) => {
            log::info!("[copy] macOS CGEventSource unavailable");
            return;
        }
    };

    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), KEY_C, true) {
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
    if let Ok(event) = CGEvent::new_keyboard_event(source, KEY_C, false) {
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }

    std::thread::sleep(Duration::from_millis(30));
}

// macOS: Use CGEventPost for keyboard simulation (Paste)
#[cfg(target_os = "macos")]
fn send_paste_shortcut() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    const KEY_V: u16 = 0x09;

    let source = match CGEventSource::new(CGEventSourceStateID::CombinedSessionState) {
        Ok(source) => source,
        Err(_) => {
            log::info!("[paste] macOS CGEventSource unavailable");
            return;
        }
    };

    if let Ok(event) = CGEvent::new_keyboard_event(source.clone(), KEY_V, true) {
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }
    if let Ok(event) = CGEvent::new_keyboard_event(source, KEY_V, false) {
        event.set_flags(CGEventFlags::CGEventFlagCommand);
        event.post(CGEventTapLocation::HID);
    }

    std::thread::sleep(Duration::from_millis(30));
}

// Linux: Placeholder
#[cfg(all(
    not(windows),
    not(target_os = "macos"),
    not(any(target_os = "android", target_os = "ios"))
))]
fn send_copy_shortcut() {
    log::info!("[copy] Linux keyboard simulation not yet implemented");
}

// Linux: Placeholder (Paste)
#[cfg(all(
    not(windows),
    not(target_os = "macos"),
    not(any(target_os = "android", target_os = "ios"))
))]
fn send_paste_shortcut() {
    log::info!("[paste] Linux keyboard simulation not yet implemented");
}

#[cfg(target_os = "macos")]
type AXUIElementRef = *const std::ffi::c_void;
#[cfg(target_os = "macos")]
type AXError = i32;
#[cfg(target_os = "macos")]
const AX_ERROR_SUCCESS: AXError = 0;

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: core_foundation::string::CFStringRef,
        value: *mut core_foundation::base::CFTypeRef,
    ) -> AXError;
}

#[cfg(target_os = "macos")]
fn ax_copy_attribute(
    element: AXUIElementRef,
    attribute: core_foundation::string::CFStringRef,
) -> Option<core_foundation::base::CFType> {
    use core_foundation::base::{CFType, CFTypeRef, TCFType};

    let mut value: CFTypeRef = std::ptr::null();
    let error = unsafe { AXUIElementCopyAttributeValue(element, attribute, &mut value) };
    if error != AX_ERROR_SUCCESS || value.is_null() {
        return None;
    }

    Some(unsafe { CFType::wrap_under_create_rule(value) })
}

#[cfg(target_os = "macos")]
fn capture_selected_text_native() -> Option<String> {
    use core_foundation::base::{CFType, TCFType};
    use core_foundation::string::CFString;

    if !unsafe { AXIsProcessTrusted() } {
        log::info!("[capture] macOS Accessibility is not trusted");
        return None;
    }

    let system_wide = unsafe { AXUIElementCreateSystemWide() };
    if system_wide.is_null() {
        log::info!("[capture] Failed to create macOS system-wide AX element");
        return None;
    }
    let _system_wide_guard =
        unsafe { CFType::wrap_under_create_rule(system_wide as core_foundation::base::CFTypeRef) };

    let focused_attr = CFString::from_static_string("AXFocusedUIElement");
    let selected_text_attr = CFString::from_static_string("AXSelectedText");
    let focused =
        ax_copy_attribute(system_wide, focused_attr.as_concrete_TypeRef())?;
    let selected = ax_copy_attribute(
        focused.as_CFTypeRef() as AXUIElementRef,
        selected_text_attr.as_concrete_TypeRef(),
    )?;

    let text = selected.downcast::<CFString>()?.to_string();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }

    log::info!("[capture] Captured {} chars via macOS Accessibility", text.len());
    Some(text)
}

#[cfg(not(target_os = "macos"))]
fn capture_selected_text_native() -> Option<String> {
    None
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn capture_selected_text_via_clipboard() -> Option<String> {
    log::info!("[capture] Starting text capture via Clipboard Hack...");

    let mut clipboard = Clipboard::new().ok()?;

    // Preserve original content (text/image)
    let original_clipboard = backup_clipboard(&mut clipboard);

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
                log::info!("[capture] Attempt {}: Captured {} chars", i + 1, text.len());
                result = Some(text);
                break;
            }
        }
    }

    // Restore original clipboard content
    restore_clipboard(&mut clipboard, original_clipboard);

    result
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn capture_selected_text(allow_clipboard_fallback: bool) -> Option<String> {
    if let Some(text) = capture_selected_text_native() {
        return Some(text);
    }

    if !allow_clipboard_fallback {
        log::info!("[capture] Clipboard fallback is disabled");
        return None;
    }

    capture_selected_text_via_clipboard()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn trigger_quick_open(app: AppHandle) {
    log::info!("[shortcut] Trigger quick open called!");
    let cursor_pos = get_cursor_position();
    let allow_clipboard_fallback = app
        .state::<ClipboardOpsEnabled>()
        .0
        .lock()
        .map(|g| *g)
        .unwrap_or(false);

    // Capture text BEFORE spawning thread to avoid potential threading issues.
    let selection = capture_selected_text(allow_clipboard_fallback);
    log::info!(
        "[shortcut] Selection captured: {:?}",
        selection.as_ref().map(|s| s.len())
    );

    std::thread::spawn(move || {
        let _ = show_compact_window(&app, selection, cursor_pos);
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn shortcut_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("shortcut.txt"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn load_persisted_shortcut(app: &AppHandle) -> Option<String> {
    let path = shortcut_file_path(app)?;
    let content = fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn persist_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let path =
        shortcut_file_path(app).ok_or_else(|| "Failed to resolve app config path".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, shortcut.trim()).map_err(|e| e.to_string())
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

    let manager = app.global_shortcut();
    let already_registered = manager.is_registered(trimmed);
    if current.as_str() == trimmed && already_registered {
        return Ok(());
    }

    if !already_registered {
        manager
            .on_shortcut(trimmed, move |app: &AppHandle, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                trigger_quick_open(app.clone());
            })
            .map_err(|err| ShortcutError(err.to_string()))?;
    }

    if !current.is_empty() && current.as_str() != trimmed {
        let _ = manager.unregister(current.as_str());
    }

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
    register_shortcut(&app, state.inner(), &shortcut).map_err(|err| err.0)?;
    persist_shortcut(&app, &shortcut)?;
    Ok(())
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
    .inner_size(420.0, 560.0)
    .min_inner_size(420.0, 560.0)
    .max_inner_size(420.0, 560.0)
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
fn ensure_main_window(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return Ok(window);
    }

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
            .title_bar_style(tauri::TitleBarStyle::Transparent)
            .hidden_title(true);
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

    builder.visible(false).build()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_main_window(app: &AppHandle, cursor_pos: Option<(i32, i32)>) -> tauri::Result<()> {
    let window = ensure_main_window(app)?;

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
                #[cfg(target_os = "macos")]
                {
                    let scale = m.scale_factor();
                    let logical_x = pos.x as f64 / scale;
                    let logical_y = pos.y as f64 / scale;
                    let logical_w = size.width as f64 / scale;
                    let logical_h = size.height as f64 / scale;
                    let cursor_x = cursor_x as f64;
                    let cursor_y = cursor_y as f64;
                    return cursor_x >= logical_x
                        && cursor_x < logical_x + logical_w
                        && cursor_y >= logical_y
                        && cursor_y < logical_y + logical_h;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    return cursor_x >= pos.x
                        && cursor_x < pos.x + size.width as i32
                        && cursor_y >= pos.y
                        && cursor_y < pos.y + size.height as i32;
                }
            })
            .or_else(|| window.primary_monitor().ok().flatten());

        if let Some(monitor) = monitor {
            let mon_pos = monitor.position();
            let mon_size = monitor.size();
            #[cfg(target_os = "macos")]
            let scale = monitor.scale_factor();
            let win_w = win_size.width as i32;
            let win_h = win_size.height as i32;

            // Center window on cursor
            let (cursor_x, cursor_y) = {
                #[cfg(target_os = "macos")]
                {
                    let cursor_x = (cursor_x as f64 * scale).round() as i32;
                    let cursor_y = (cursor_y as f64 * scale).round() as i32;
                    (cursor_x, cursor_y)
                }
                #[cfg(not(target_os = "macos"))]
                {
                    (cursor_x, cursor_y)
                }
            };

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
    if let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main.hide();
    }
    let window = ensure_compact_window(app)?;

    // Position window near cursor if available
    if let Some((cursor_x, cursor_y)) = cursor_pos {
        log::info!("[debug] Cursor pos: ({}, {})", cursor_x, cursor_y);

        // Get window size
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize {
            width: 420,
            height: 560,
        });
        log::info!(
            "[debug] Window size: {}x{}",
            win_size.width,
            win_size.height
        );

        // Get the monitor at cursor position or primary monitor
        let monitors = window.available_monitors()?;
        log::info!("[debug] Available monitors: {}", monitors.len());

        let monitor = monitors
            .into_iter()
            .find(|m| {
                let pos = m.position();
                let size = m.size();
                log::info!(
                    "[debug] Monitor: pos=({},{}), size={}x{}",
                    pos.x,
                    pos.y,
                    size.width,
                    size.height
                );
                #[cfg(target_os = "macos")]
                {
                    let scale = m.scale_factor();
                    let logical_x = pos.x as f64 / scale;
                    let logical_y = pos.y as f64 / scale;
                    let logical_w = size.width as f64 / scale;
                    let logical_h = size.height as f64 / scale;
                    let cursor_x = cursor_x as f64;
                    let cursor_y = cursor_y as f64;
                    return cursor_x >= logical_x
                        && cursor_x < logical_x + logical_w
                        && cursor_y >= logical_y
                        && cursor_y < logical_y + logical_h;
                }
                #[cfg(not(target_os = "macos"))]
                {
                    return cursor_x >= pos.x
                        && cursor_x < pos.x + size.width as i32
                        && cursor_y >= pos.y
                        && cursor_y < pos.y + size.height as i32;
                }
            })
            .or_else(|| window.primary_monitor().ok().flatten());

        if let Some(monitor) = monitor {
            let mon_pos = monitor.position();
            let mon_size = monitor.size();
            let scale = monitor.scale_factor();
            log::info!(
                "[debug] Selected monitor: pos=({},{}), size={}x{}, scale={}",
                mon_pos.x,
                mon_pos.y,
                mon_size.width,
                mon_size.height,
                scale
            );

            // Calculate position: center window on cursor, but keep within screen bounds
            let win_w = win_size.width as i32;
            let win_h = win_size.height as i32;

            // Start with cursor position offset slightly (so cursor is near top-left of window)
            // UPDATED: Shift it more to the right so it doesn't overlap cursor immediately
            let (cursor_x, cursor_y) = {
                #[cfg(target_os = "macos")]
                {
                    let cursor_x = (cursor_x as f64 * scale).round() as i32;
                    let cursor_y = (cursor_y as f64 * scale).round() as i32;
                    (cursor_x, cursor_y)
                }
                #[cfg(not(target_os = "macos"))]
                {
                    (cursor_x, cursor_y)
                }
            };

            let x = cursor_x + 10;
            let y = cursor_y + 10;
            log::info!("[debug] Initial calc pos: ({}, {})", x, y);
            let (x, y) = clamp_window_to_monitor(x, y, win_w, win_h, *mon_pos, *mon_size);

            log::info!("[debug] Final pos: ({}, {})", x, y);
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        } else {
            log::info!("[debug] No monitor found!");
        }
    } else {
        log::info!("[debug] No cursor pos available");
    }

    window.show()?;
    window.set_focus()?;
    let _ = app.emit("window_shown", "compact");

    // Store and emit text only when a new capture exists.
    // `None` means "show the window without changing current input".
    if let Some(payload) = text {
        if let Ok(mut pending) = app.state::<PendingText>().0.lock() {
            *pending = Some(payload.clone());
        }
        let _ = app.emit("text_captured", payload);
    } else if let Ok(mut pending) = app.state::<PendingText>().0.lock() {
        *pending = None;
    }

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
    // Use template icon on macOS for proper light/dark mode support
    #[cfg(target_os = "macos")]
    {
        let icon_bytes = include_bytes!("../icons/tray-iconTemplate.png");
        match image::load_from_memory(icon_bytes) {
            Ok(img) => {
                let rgba = img.to_rgba8();
                let (width, height) = rgba.dimensions();
                let icon = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
                tray = tray.icon(icon).icon_as_template(true);
            }
            Err(e) => {
                log::info!("[tray] Failed to load template icon: {}, using default", e);
                if let Some(icon) = app.default_window_icon().cloned() {
                    tray = tray.icon(icon);
                }
            }
        }
    }

    // Use default icon on other platforms
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(icon) = app.default_window_icon().cloned() {
            tray = tray.icon(icon);
        }
    }

    tray.build(app)?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_global_shortcut(
    app: &AppHandle,
    state: &ShortcutConfig,
) -> Result<(), Box<dyn std::error::Error>> {
    let saved = load_persisted_shortcut(app);
    if let Some(shortcut) = saved {
        if register_shortcut(app, state, &shortcut).is_ok() {
            return Ok(());
        }
        log::info!(
            "[shortcut] Saved shortcut is invalid, falling back to default: {}",
            shortcut
        );
    }

    register_shortcut(app, state, DEFAULT_SHORTCUT)
        .map_err(|err| Box::new(err) as Box<dyn std::error::Error>)?;
    let _ = persist_shortcut(app, DEFAULT_SHORTCUT);
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
            log::info!("[handover] Warning: Failed to close capture windows: {}", e);
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
    log::info!("[ocr] start_selection_ocr called, origin: {:?}", origin);

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
        let start = Instant::now();
        loop {
            let main_visible = app
                .get_webview_window(MAIN_WINDOW_LABEL)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            let compact_visible = app
                .get_webview_window(COMPACT_WINDOW_LABEL)
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if !main_visible && !compact_visible {
                break;
            }
            if start.elapsed() >= Duration::from_millis(300) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }

        let monitors = Monitor::all().map_err(|e| e.to_string())?;

        // Close any existing capture windows before creating new ones
        if let Err(e) = close_capture_windows(&app) {
            log::info!(
                "[ocr] Warning: Failed to close existing capture windows: {}",
                e
            );
        }

        // Get cursor position once to determine which monitor to focus
        let cursor_pos = get_cursor_position();

        for (index, monitor) in monitors.into_iter().enumerate() {
            let mon_width = monitor.width().map_err(|e| e.to_string())?;
            let mon_height = monitor.height().map_err(|e| e.to_string())?;
            let mon_x = monitor.x().map_err(|e| e.to_string())?;
            let mon_y = monitor.y().map_err(|e| e.to_string())?;
            log::info!(
                "[ocr] Capturing monitor {}: {}x{} at ({},{})",
                index,
                mon_width,
                mon_height,
                mon_x,
                mon_y
            );

            let monitor_id = format!(
                "{}_{}_{}_{}",
                mon_x, mon_y, mon_width, mon_height
            );

            let label = format!("{}{}", CAPTURE_WINDOW_PREFIX, monitor_id);
            let url = format!("/?view=capture&monitor={}", monitor_id);

            let window = ensure_capture_window(&app, &label, &url).map_err(|e| e.to_string())?;

            #[cfg(target_os = "macos")]
            {
                if let Err(e) =
                    window.set_position(tauri::Position::Logical(tauri::LogicalPosition {
                        x: mon_x as f64,
                        y: mon_y as f64,
                    }))
                {
                    log::info!("[ocr] Failed to set window position: {}", e);
                }

                if let Err(e) = window.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: mon_width as f64,
                    height: mon_height as f64,
                })) {
                    log::info!("[ocr] Failed to set window size: {}", e);
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                // Set window to physical pixel dimensions
                // Tauri will create a window of exact physical size
                // The webview will be scaled internally based on system DPI
                if let Err(e) =
                    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                        x: mon_x,
                        y: mon_y,
                    }))
                {
                    log::info!("[ocr] Failed to set window position: {}", e);
                }

                if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: mon_width,
                    height: mon_height,
                })) {
                    log::info!("[ocr] Failed to set window size: {}", e);
                }
            }

            // SHOW the window now that it's sized correctly
            if let Err(e) = window.show() {
                log::info!("[ocr] Failed to show window: {}", e);
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
                log::info!("[ocr] Focusing capture window on monitor {}", index);
                let _ = window.set_focus();
            }
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
    log::info!(
        "[ocr] finish_selection_ocr ({}): {},{} {}x{}",
        monitor_id,
        x,
        y,
        width,
        height
    );

    let monitor_bounds = monitor_id
        .split('_')
        .map(str::parse::<i32>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| format!("Invalid monitor id: {}", monitor_id))?;
    let [monitor_x, monitor_y, monitor_width, monitor_height] = monitor_bounds.as_slice() else {
        return Err(format!("Invalid monitor id: {}", monitor_id));
    };
    let selected_window_label = format!("{}{}", CAPTURE_WINDOW_PREFIX, monitor_id);
    let selected_window = app.get_webview_window(&selected_window_label);
    if let Some(window) = selected_window.as_ref() {
        let _ = window.hide();
    }
    std::thread::sleep(Duration::from_millis(80));

    let image = {
        let monitors = Monitor::all().map_err(|e| e.to_string())?;
        let monitor = monitors
            .into_iter()
            .find(|monitor| {
                monitor.x().ok() == Some(*monitor_x)
                    && monitor.y().ok() == Some(*monitor_y)
                    && monitor.width().ok() == u32::try_from(*monitor_width).ok()
                    && monitor.height().ok() == u32::try_from(*monitor_height).ok()
            })
            .ok_or_else(|| format!("No monitor found for id {}", monitor_id))?;
        monitor.capture_image().map_err(|e| e.to_string())?
    };
    if let Some(window) = selected_window.as_ref() {
        let _ = window.show();
        let _ = window.set_focus();
    }

    // Validate crop bounds before cropping to avoid panics in crop_imm.
    // Image dimensions are in physical pixels (from screen capture)
    let image_width = image.width();
    let image_height = image.height();

    log::info!(
        "[ocr] Image dimensions: {}x{}, selection: {},{} {}x{}",
        image_width,
        image_height,
        x,
        y,
        width,
        height
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

    // DEBUG: Save cropped image to user's temp directory (debug builds only)
    if cfg!(debug_assertions) {
        if let Ok(temp_dir) = std::env::temp_dir().canonicalize() {
            let debug_path = temp_dir.join("howlingual_ocr_crop.png");
            match sub_image.save(&debug_path) {
                Ok(_) => log::info!("[ocr] Saved debug crop to {:?}", debug_path),
                Err(e) => log::info!("[ocr] Failed to save debug crop: {}", e),
            }
        }
    }

    // Do not close windows here! We need them open to show the "Processing" spinner.
    // The frontend will call cancel_selection_ocr (or close itself) after receiving the result.

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    return run_ocr(app, sub_image).await;
    #[cfg(any(target_os = "android", target_os = "ios"))]
    return Err("OCR not supported on mobile".into());
}

#[cfg(windows)]
#[tauri::command]
fn set_ocr_engine(app: AppHandle, engine: String) -> Result<(), String> {
    let state = app.state::<OcrEngineConfig>();
    let mut guard = state.0.lock().map_err(|_| "Lock failed")?;
    match engine.as_str() {
        "paddle" => *guard = OcrEngineType::Paddle,
        "windows" => *guard = OcrEngineType::Windows,
        _ => return Err("Invalid engine type".into()),
    }
    log::info!("[ocr] Engine set to: {}", engine);
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
fn set_ocr_engine(_app: AppHandle, _engine: String) -> Result<(), String> {
    Ok(()) // No-op on non-Windows
}

#[tauri::command]
async fn complete_ocr_flow(app: AppHandle, text: String) -> Result<(), String> {
    log::info!(
        "[ocr] complete_ocr_flow called with text length: {}",
        text.len()
    );

    // Close capture windows first to clean up
    if let Err(e) = close_capture_windows(&app) {
        log::info!("[ocr] Warning: Failed to close capture windows: {}", e);
    }

    // Determine where to go back to based on origin state
    let origin = {
        let state = app.state::<OcrOriginState>();
        state.0.lock().map(|g| *g).unwrap_or(WindowOrigin::Main)
    };

    log::info!("[ocr] completing flow, returning to: {:?}", origin);

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
        log::info!("[ocr] Warning: Failed to close some capture windows: {}", e);
        // Don't clear state if windows might still be active
    }

    // Restore original window
    let origin = {
        let state = app.state::<OcrOriginState>();
        state.0.lock().map(|g| *g).unwrap_or(WindowOrigin::Main)
    };
    log::info!("[ocr] cancelled, restoring: {:?}", origin);

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
#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn run_ocr(_app: AppHandle, image: image::RgbaImage) -> Result<String, String> {
    // 1. macOS Native OCR
    #[cfg(target_os = "macos")]
    {
        use image::DynamicImage;
        let dyn_img = DynamicImage::ImageRgba8(image);
        log::info!("[ocr] Running macOS Native Vision OCR...");
        return macos_ocr::perform_ocr(dyn_img);
    }

    // 2. Windows Native OCR (Restored)
    #[cfg(target_os = "windows")]
    {
        log::info!("[ocr] Running Windows Native OCR...");
        return ocr_windows(_app, image).await;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Err("OCR not supported on this platform".into())
    }
}

#[cfg(windows)]
#[cfg(windows)]
async fn ocr_windows(app: AppHandle, image: image::RgbaImage) -> Result<String, String> {
    let config_state = app.state::<OcrEngineConfig>();
    let engine_type = {
        let guard = config_state.0.lock().map_err(|_| "Lock failed")?;
        *guard
    };

    match engine_type {
        OcrEngineType::Paddle => {
            let state = app.state::<PaddleOcrState>();
            // Lazy initialization
            let mut guard = state.0.lock().map_err(|_| "Lock failed")?;
            if guard.is_none() {
                log::info!("[ocr] Initializing PaddleOCR...");
                let resource_dir = app
                    .path()
                    .resolve("resources", tauri::path::BaseDirectory::Resource)
                    .map_err(|e| e.to_string())?;

                // Note: Filenames must match what we downloaded
                let det_path = resource_dir.join("ch_PP-OCRv4_det_infer.onnx");
                let rec_path = resource_dir.join("japan_PP-OCRv5_rec_infer.onnx");
                let keys_path = resource_dir.join("japan_dict_v5.txt");

                log::info!("[ocr] Loading models from: {:?}", resource_dir);

                let engine = ocr_engine::PaddleOcr::new(det_path, rec_path, keys_path)
                    .map_err(|e| format!("Failed to load OCR models: {}", e))?;

                *guard = Some(engine);
                log::info!("[ocr] PaddleOCR initialized successfully");
            }

            if let Some(engine) = guard.as_mut() {
                let dyn_img = image::DynamicImage::ImageRgba8(image);
                engine.recognize(&dyn_img).map_err(|e| e.to_string())
            } else {
                Err("PaddleOCR engine initialization failed".into())
            }
        }
        OcrEngineType::Windows => {
            let state = app.state::<WindowsOcrState>();
            let mut guard = state.0.lock().map_err(|_| "Lock failed")?;
            if guard.is_none() {
                log::info!("[ocr] Initializing Windows Native OCR...");
                match ocr_native::WindowsOcr::new() {
                    Ok(engine) => *guard = Some(engine),
                    Err(e) => return Err(format!("Failed to init Windows OCR: {}", e)), // Fail early if native OCR is broken
                }
            }

            if let Some(engine) = guard.as_ref() {
                let dyn_img = image::DynamicImage::ImageRgba8(image);
                engine.recognize(&dyn_img).map_err(|e| e.to_string())
            } else {
                Err("Windows OCR engine initialization failed".into())
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: core_foundation::string::CFStringRef;
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef)
        -> bool;
}

#[derive(Serialize)]
struct PermissionStatus {
    screen_recording: bool,
    accessibility: bool,
}

#[cfg(target_os = "macos")]
use core_foundation::base::TCFType;

#[cfg(target_os = "macos")]
fn check_permissions_impl() -> PermissionStatus {
    let screen_recording = unsafe { CGPreflightScreenCaptureAccess() };
    let accessibility = unsafe { AXIsProcessTrusted() };
    PermissionStatus {
        screen_recording,
        accessibility,
    }
}

#[cfg(not(target_os = "macos"))]
fn check_permissions_impl() -> PermissionStatus {
    PermissionStatus {
        screen_recording: true,
        accessibility: true,
    }
}

#[tauri::command]
fn check_permissions() -> PermissionStatus {
    check_permissions_impl()
}

#[cfg(target_os = "macos")]
fn request_permissions_impl(permission_type: &str) -> Result<(), String> {
    match permission_type {
        "screen_recording" => {
            unsafe {
                CGRequestScreenCaptureAccess();
            }
            Ok(())
        }
        "accessibility" => {
            use core_foundation::boolean::CFBoolean;
            use core_foundation::dictionary::CFDictionary;
            use core_foundation::string::CFString;

            let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
            let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::true_value())]);
            unsafe {
                AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef());
            }
            Ok(())
        }
        _ => Err("Invalid permission type".into()),
    }
}

#[cfg(not(target_os = "macos"))]
fn request_permissions_impl(_permission_type: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn request_permissions(permission_type: String) -> Result<(), String> {
    request_permissions_impl(permission_type.as_str())
}

#[cfg(target_os = "macos")]
fn open_settings_url(url: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn open_settings_url(_url: &str) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn open_screen_recording_settings() -> Result<(), String> {
    open_settings_url(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    )
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    open_settings_url(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    )
}

#[cfg(target_os = "macos")]
fn check_screen_capture_permission() {
    unsafe {
        let has_access = CGPreflightScreenCaptureAccess();
        log::info!("[main] Screen Capture Access Preflight: {}", has_access);
        if !has_access {
            log::info!("[main] Requesting Screen Capture Access...");
            let requested = CGRequestScreenCaptureAccess();
            log::info!("[main] Screen Capture Access Requested: {}", requested);
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .targets([Target::new(TargetKind::LogDir {
                    file_name: Some("howlingual".into()),
                })])
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            translation_backend::sync_translation_context,
            translation_backend::request_translation_state,
            translation_backend::set_api_key,
            translation_backend::clear_api_key,
            translation_backend::get_api_key_status,
            translation_backend::start_translation,
            translation_backend::stop_translation,
            update_shortcut,
            open_main_window,
            get_pending_text,
            get_handover_text,
            update_pending_text,
            set_clipboard_ops_enabled,
            replace_selection,
            quit_app,
            handover_to_main,
            check_permissions,
            request_permissions,
            open_screen_recording_settings,
            open_accessibility_settings,
            start_selection_ocr,
            finish_selection_ocr,
            cancel_selection_ocr,
            complete_ocr_flow,
            set_ocr_engine
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            check_screen_capture_permission();

            #[cfg(target_os = "macos")]
            let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);

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
            app.manage(ClipboardOpsEnabled::default());
            app.manage(OcrOriginState::default());
            app.manage(translation_backend::TranslationBackendState::default());
            #[cfg(windows)]
            {
                app.manage(PaddleOcrState(Mutex::new(None)));
                app.manage(WindowsOcrState(Mutex::new(None)));
                app.manage(OcrEngineConfig::default());
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let shortcut_state = app.state::<ShortcutConfig>();
                ensure_main_window(&app.handle())?;
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
