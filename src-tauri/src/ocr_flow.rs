use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};

#[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
use xcap::Monitor;

#[cfg(windows)]
use crate::ocr_engine;
#[cfg(windows)]
use crate::ocr_native;

macro_rules! ocr_debug {
    ($($arg:tt)*) => {
        #[cfg(debug_assertions)]
        println!($($arg)*);
    };
}

// Store captured screen images for OCR (one per monitor)
pub struct CapturedImages(pub Mutex<HashMap<String, image::RgbaImage>>);

impl Default for CapturedImages {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

#[cfg(windows)]
pub struct PaddleOcrState(pub Mutex<Option<ocr_engine::PaddleOcr>>);

#[cfg(windows)]
pub struct WindowsOcrState(pub Mutex<Option<ocr_native::WindowsOcr>>);

#[cfg(windows)]
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum OcrEngineType {
    Paddle,
    Windows,
}

#[cfg(windows)]
pub struct OcrEngineConfig(pub Mutex<OcrEngineType>);

#[cfg(windows)]
impl Default for OcrEngineConfig {
    fn default() -> Self {
        Self(Mutex::new(OcrEngineType::Paddle))
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum WindowOrigin {
    Main,
    Compact,
}

pub struct OcrOriginState(pub Mutex<WindowOrigin>);

impl Default for OcrOriginState {
    fn default() -> Self {
        Self(Mutex::new(WindowOrigin::Main))
    }
}

#[tauri::command]
pub async fn start_selection_ocr(app: AppHandle, origin: Option<String>) -> Result<(), String> {
    ocr_debug!("[ocr] start_selection_ocr called, origin: {:?}", origin);

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
        if let Some(main) = app.get_webview_window(crate::MAIN_WINDOW_LABEL) {
            let _ = main.hide();
        }
        if let Some(compact) = app.get_webview_window(crate::COMPACT_WINDOW_LABEL) {
            let _ = compact.hide();
        }

        // Wait for windows to fully hide before capturing screenshots
        // TODO: Consider using window visibility state checks or event-based mechanism
        // for more reliable cross-platform behavior instead of hardcoded delay
        tokio::time::sleep(Duration::from_millis(200)).await;

        let monitors = Monitor::all().map_err(|e| e.to_string())?;

        // Close any existing capture windows before creating new ones
        if let Err(e) = crate::close_capture_windows(&app) {
            ocr_debug!(
                "[ocr] Warning: Failed to close existing capture windows: {}",
                e
            );
        }

        let mut capture_map = HashMap::new();

        // Get cursor position once to determine which monitor to focus
        let cursor_pos = crate::get_cursor_position();

        for (index, monitor) in monitors.into_iter().enumerate() {
            let mon_width = monitor.width().map_err(|e| e.to_string())?;
            let mon_height = monitor.height().map_err(|e| e.to_string())?;
            let mon_x = monitor.x().map_err(|e| e.to_string())?;
            let mon_y = monitor.y().map_err(|e| e.to_string())?;

            ocr_debug!(
                "[ocr] Capturing monitor {}: {}x{} at ({},{})",
                index,
                mon_width,
                mon_height,
                mon_x,
                mon_y
            );

            let image = monitor.capture_image().map_err(|e| e.to_string())?;
            ocr_debug!(
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

            let label = format!("{}{}", crate::CAPTURE_WINDOW_PREFIX, monitor_id);
            let url = format!("/?view=capture&monitor={}", monitor_id);

            let window =
                crate::ensure_capture_window(&app, &label, &url).map_err(|e| e.to_string())?;

            // Set window to physical pixel dimensions
            // Tauri will create a window of exact physical size
            // The webview will be scaled internally based on system DPI
            if let Err(e) =
                window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: mon_x,
                    y: mon_y,
                }))
            {
                ocr_debug!("[ocr] Failed to set window position: {}", e);
            }

            if let Err(e) = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: img_width,
                height: img_height,
            })) {
                ocr_debug!("[ocr] Failed to set window size: {}", e);
            }

            // SHOW the window now that it's sized correctly
            if let Err(e) = window.show() {
                ocr_debug!("[ocr] Failed to show window: {}", e);
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
                ocr_debug!("[ocr] Focusing capture window on monitor {}", index);
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
pub async fn finish_selection_ocr(
    app: AppHandle,
    monitor_id: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // Coordinates received here are in physical pixels
    // Frontend scales CSS pixel coords by devicePixelRatio before sending
    ocr_debug!(
        "[ocr] finish_selection_ocr ({}): {},{} {}x{}",
        monitor_id,
        x,
        y,
        width,
        height
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

    ocr_debug!(
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

    // DEBUG: Save cropped image to user's temp directory
    #[cfg(debug_assertions)]
    if let Ok(temp_dir) = std::env::temp_dir().canonicalize() {
        let debug_path = temp_dir.join("howlingual_ocr_crop.png");
        if let Err(e) = sub_image.save(&debug_path) {
            ocr_debug!("[ocr] Failed to save debug crop: {}", e);
        } else {
            ocr_debug!("[ocr] Saved debug crop to {:?}", debug_path);
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
pub fn set_ocr_engine(app: AppHandle, engine: String) -> Result<(), String> {
    let state = app.state::<OcrEngineConfig>();
    let mut guard = state.0.lock().map_err(|_| "Lock failed")?;
    match engine.as_str() {
        "paddle" => *guard = OcrEngineType::Paddle,
        "windows" => *guard = OcrEngineType::Windows,
        _ => return Err("Invalid engine type".into()),
    }
    ocr_debug!("[ocr] Engine set to: {}", engine);
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn set_ocr_engine(_app: AppHandle, _engine: String) -> Result<(), String> {
    Ok(()) // No-op on non-Windows
}

#[tauri::command]
pub async fn complete_ocr_flow(app: AppHandle, text: String) -> Result<(), String> {
    ocr_debug!(
        "[ocr] complete_ocr_flow called with text length: {}",
        text.len()
    );

    // Close capture windows first to clean up
    if let Err(e) = crate::close_capture_windows(&app) {
        ocr_debug!("[ocr] Warning: Failed to close capture windows: {}", e);
    }

    // Determine where to go back to based on origin state
    let origin = {
        let state = app.state::<OcrOriginState>();
        state.0.lock().map(|g| *g).unwrap_or(WindowOrigin::Main)
    };

    ocr_debug!("[ocr] completing flow, returning to: {:?}", origin);

    match origin {
        WindowOrigin::Main => {
            // Re-use logic to show main window and pass data
            crate::handover_to_main(app, text);
            Ok(())
        }
        WindowOrigin::Compact => {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let cursor_pos = app
                    .state::<crate::LastCursorPos>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|g| *g);
                crate::show_compact_window(&app, Some(text), cursor_pos)
                    .map_err(|e| e.to_string())?;
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
pub fn cancel_selection_ocr(app: AppHandle) {
    // Close capture windows and clear state only if closure succeeds
    if let Err(e) = crate::close_capture_windows(&app) {
        ocr_debug!("[ocr] Warning: Failed to close some capture windows: {}", e);
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
    ocr_debug!("[ocr] cancelled, restoring: {:?}", origin);

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    match origin {
        WindowOrigin::Main => {
            // For main window, just showing it is enough (we have no text to pass)
            // We can use show_main_window directly since we don't need handover event
            let cursor_pos = app
                .state::<crate::LastCursorPos>()
                .0
                .lock()
                .ok()
                .and_then(|g| *g);
            let _ = crate::show_main_window(&app, cursor_pos);
        }
        WindowOrigin::Compact => {
            let cursor_pos = app
                .state::<crate::LastCursorPos>()
                .0
                .lock()
                .ok()
                .and_then(|g| *g);
            // Pass None as text to show window without changing text
            let _ = crate::show_compact_window(&app, None, cursor_pos);
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn run_ocr(_app: AppHandle, image: image::RgbaImage) -> Result<String, String> {
    // 1. macOS Native OCR
    #[cfg(target_os = "macos")]
    {
        use image::DynamicImage;
        let dyn_img = DynamicImage::ImageRgba8(image);
        ocr_debug!("[ocr] Running macOS Native Vision OCR...");
        return crate::macos_ocr::perform_ocr(dyn_img);
    }

    // 2. Windows Native OCR (Restored)
    #[cfg(target_os = "windows")]
    {
        ocr_debug!("[ocr] Running Windows Native OCR...");
        return ocr_windows(_app, image).await;
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Err("OCR not supported on this platform".into())
    }
}

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
                ocr_debug!("[ocr] Initializing PaddleOCR...");
                let resource_dir = app
                    .path()
                    .resolve("resources", tauri::path::BaseDirectory::Resource)
                    .map_err(|e| e.to_string())?;

                // Note: Filenames must match what we downloaded
                let det_path = resource_dir.join("ch_PP-OCRv4_det_infer.onnx");
                let rec_path = resource_dir.join("japan_PP-OCRv5_rec_infer.onnx");
                let keys_path = resource_dir.join("japan_dict_v5.txt");

                ocr_debug!("[ocr] Loading models from: {:?}", resource_dir);

                let engine = ocr_engine::PaddleOcr::new(det_path, rec_path, keys_path)
                    .map_err(|e| format!("Failed to load OCR models: {}", e))?;

                *guard = Some(engine);
                ocr_debug!("[ocr] PaddleOCR initialized successfully");
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
                ocr_debug!("[ocr] Initializing Windows Native OCR...");
                match ocr_native::WindowsOcr::new() {
                    Ok(engine) => *guard = Some(engine),
                    Err(e) => return Err(format!("Failed to init Windows OCR: {}", e)),
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
