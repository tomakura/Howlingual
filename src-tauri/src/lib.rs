use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use arboard::Clipboard;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use enigo::{Enigo, Key, KeyboardControllable};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::menu::{MenuBuilder, MenuItem};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::tray::TrayIconBuilder;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{
    Builder as GlobalShortcutBuilder, GlobalShortcutExt, ShortcutState,
};

const MAIN_WINDOW_LABEL: &str = "main";
const COMPACT_WINDOW_LABEL: &str = "compact";
const QUICK_EVENT: &str = "quick-text";
const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+H";
const CLIPBOARD_DELAY_MS: u64 = 120;

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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn trigger_quick_open(app: AppHandle) {
    std::thread::spawn(move || {
        let selection = capture_selected_text();
        let _ = show_compact_window(&app, selection);
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
        .on_shortcut(trimmed, move |app, _shortcut, event| {
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
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_main_window(app: &AppHandle) -> tauri::Result<()> {
    let window = if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        window
    } else {
        tauri::WebviewWindowBuilder::new(
            app,
            MAIN_WINDOW_LABEL,
            tauri::WebviewUrl::App("/?view=main".into()),
        )
        .title("Howlingual")
        .inner_size(800.0, 600.0)
        .min_inner_size(600.0, 400.0)
        .build()?
    };

    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn show_compact_window(app: &AppHandle, text: Option<String>) -> tauri::Result<()> {
    let window = ensure_compact_window(app)?;
    window.show()?;
    window.set_focus()?;
    if let Some(text) = text {
        let _ = window.emit(QUICK_EVENT, text);
    }
    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn send_copy_shortcut() {
    let mut enigo = Enigo::new();
    #[cfg(target_os = "macos")]
    {
        enigo.key_down(Key::Meta);
        enigo.key_click(Key::Layout('c'));
        enigo.key_up(Key::Meta);
    }
    #[cfg(not(target_os = "macos"))]
    {
        enigo.key_down(Key::Control);
        enigo.key_click(Key::Layout('c'));
        enigo.key_up(Key::Control);
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn capture_selected_text() -> Option<String> {
    let mut clipboard = Clipboard::new().ok()?;
    let previous = clipboard.get_text().ok();

    send_copy_shortcut();
    std::thread::sleep(Duration::from_millis(CLIPBOARD_DELAY_MS));

    let selection = clipboard.get_text().ok();

    if let Some(previous) = previous {
        let _ = clipboard.set_text(previous);
    }

    selection.and_then(|text| {
        if text.trim().is_empty() {
            None
        } else {
            Some(text)
        }
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_main = MenuItem::with_id(app, "open_main", "Open Main", true, None::<&str>)?;
    let open_quick = MenuItem::with_id(app, "open_quick", "Open Quick", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&open_main)
        .item(&open_quick)
        .separator()
        .item(&quit)
        .build()?;

    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Howlingual")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open_main" => {
                let _ = show_main_window(app);
            }
            "open_quick" => {
                let _ = show_compact_window(app, None);
            }
            "quit" => {
                app.state::<ExitState>()
                    .0
                    .store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
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
    app.plugin(GlobalShortcutBuilder::new().build())?;
    register_shortcut(app, state, DEFAULT_SHORTCUT)
        .map_err(|err| Box::new(err) as Box<dyn std::error::Error>)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, update_shortcut])
        .setup(|app| {
            app.manage(ExitState::default());
            app.manage(ShortcutConfig::default());

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
