#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env, fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::menu::{Menu, MenuItemBuilder, MenuItemKind, SubmenuBuilder};
use tauri::{Emitter, Manager, RunEvent};

struct AppState {
    pending_file: Mutex<Option<String>>,
    allow_exit: AtomicBool,
}

fn queue_open<R: tauri::Runtime>(app: &tauri::AppHandle<R>, path: String) {
    if let Ok(mut pending) = app.state::<AppState>().pending_file.lock() {
        *pending = Some(path.clone());
    }
    let _ = app.emit("open-file", path);
}

fn is_markdown(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

#[tauri::command]
fn startup_file(state: tauri::State<'_, AppState>) -> Option<String> {
    if let Ok(mut pending) = state.pending_file.lock() {
        if pending.is_some() {
            return pending.take();
        }
    }
    env::args().skip(1).find(|argument| is_markdown(argument))
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle, state: tauri::State<'_, AppState>) {
    state.allow_exit.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn read_markdown(path: String) -> Result<String, String> {
    if !is_markdown(&path) {
        return Err("Only .md and .markdown files are supported".to_string());
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("{error}"))?;
    Ok(content
        .strip_prefix('\u{feff}')
        .unwrap_or(&content)
        .to_string())
}

#[tauri::command]
fn write_markdown(path: String, content: String) -> Result<(), String> {
    if !is_markdown(&path) {
        return Err("Only .md and .markdown files are supported".to_string());
    }
    fs::write(&path, content.as_bytes()).map_err(|error| format!("{error}"))
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(AppState {
            pending_file: Mutex::new(None),
            allow_exit: AtomicBool::new(false),
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = argv.iter().skip(1).find(|argument| is_markdown(argument)) {
                queue_open(app, path.clone());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            startup_file,
            read_markdown,
            write_markdown,
            quit_app
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("MD Reader");
            }

            let new_file = MenuItemBuilder::with_id("file-new", "New Markdown File")
                .accelerator("CmdOrCtrl+N")
                .build(app)?;
            let open = MenuItemBuilder::with_id("file-open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?;
            let save = MenuItemBuilder::with_id("file-save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?;
            let save_as = MenuItemBuilder::with_id("file-save-as", "Save As…")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?;
            let quit = MenuItemBuilder::with_id("file-quit", "Quit")
                .accelerator("CmdOrCtrl+Q")
                .build(app)?;
            let toggle_mode = MenuItemBuilder::with_id("view-toggle-mode", "Toggle Read / Edit")
                .accelerator("CmdOrCtrl+E")
                .build(app)?;
            let zoom_in = MenuItemBuilder::with_id("view-zoom-in", "Zoom In")
                .accelerator("CmdOrCtrl+Plus")
                .build(app)?;
            let zoom_out = MenuItemBuilder::with_id("view-zoom-out", "Zoom Out")
                .accelerator("CmdOrCtrl+-")
                .build(app)?;
            let zoom_reset = MenuItemBuilder::with_id("view-zoom-reset", "Reset Zoom")
                .accelerator("CmdOrCtrl+0")
                .build(app)?;
            let about = MenuItemBuilder::with_id("help-about", "About MD Reader")
                .build(app)?;
            let menu = Menu::default(app.handle())?;
            let mut has_file_menu = false;
            let mut has_view_menu = false;
            let mut has_help_menu = false;
            for item in menu.items()? {
                let MenuItemKind::Submenu(submenu) = item else {
                    continue;
                };
                match submenu.text()?.as_str() {
                    "File" => {
                        has_file_menu = true;
                        submenu.append(&new_file)?;
                        submenu.append(&open)?;
                        submenu.append(&save)?;
                        submenu.append(&save_as)?;
                        submenu.append(&quit)?;
                    }
                    "View" => {
                        has_view_menu = true;
                        submenu.append(&toggle_mode)?;
                        submenu.append(&zoom_in)?;
                        submenu.append(&zoom_out)?;
                        submenu.append(&zoom_reset)?;
                    }
                    "Help" => {
                        has_help_menu = true;
                        submenu.append(&about)?;
                    }
                    _ => {}
                }
            }
            if !has_file_menu {
                let file_menu = SubmenuBuilder::with_id(app, "file-menu", "File")
                    .item(&new_file)
                    .item(&open)
                    .item(&save)
                    .item(&save_as)
                    .separator()
                    .item(&quit)
                    .build()?;
                menu.append(&file_menu)?;
            }
            if !has_view_menu {
                let view_menu = SubmenuBuilder::with_id(app, "view-menu", "View")
                    .item(&toggle_mode)
                    .separator()
                    .item(&zoom_in)
                    .item(&zoom_out)
                    .item(&zoom_reset)
                    .build()?;
                menu.append(&view_menu)?;
            }
            if !has_help_menu {
                let help_menu = SubmenuBuilder::with_id(app, "help-menu", "Help")
                    .item(&about)
                    .build()?;
                menu.append(&help_menu)?;
            }
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                let command = match id {
                    "file-new" => Some("new"),
                    "file-open" => Some("open"),
                    "file-save" => Some("save"),
                    "file-save-as" => Some("save-as"),
                    "file-quit" => Some("quit"),
                    "view-toggle-mode" => Some("toggle-mode"),
                    "view-zoom-in" => Some("zoom-in"),
                    "view-zoom-out" => Some("zoom-out"),
                    "view-zoom-reset" => Some("zoom-reset"),
                    "help-about" => Some("about"),
                    _ => None,
                };
                if let Some(command) = command {
                    let _ = app.emit("native-menu", command);
                }
            });
            Ok(())
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building MD Reader")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = &event {
                let allow_exit = app
                    .state::<AppState>()
                    .allow_exit
                    .swap(false, Ordering::SeqCst);
                if !allow_exit {
                    api.prevent_exit();
                    let _ = app.emit("exit-requested", ());
                }
            }

            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
            if let RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path = path.to_string_lossy().to_string();
                        if is_markdown(&path) {
                            queue_open(app, path);
                            break;
                        }
                    }
                }
            }
        });
}
