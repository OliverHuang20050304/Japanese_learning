// N4 単語帳 — 桌面版外殼
// 前端與網頁版共用同一份程式碼（dist/），這裡只負責原生視窗與選單列。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::Emitter;

/// 選單項目 id → 前端分頁名稱
const VIEWS: [(&str, &str, &str); 4] = [
    ("view-today", "今日", "CmdOrCtrl+1"),
    ("view-list", "單字表", "CmdOrCtrl+2"),
    ("view-card", "單字卡", "CmdOrCtrl+3"),
    ("view-quiz", "測驗", "CmdOrCtrl+4"),
];

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let h = app.handle();

            let about = AboutMetadata {
                name: Some("N4 単語帳".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                copyright: Some("© 2026 Oliver Huang".into()),
                comments: Some("941 個 JLPT N4 單字 ・ 間隔重複複習".into()),
                ..Default::default()
            };

            let app_menu = Submenu::with_items(
                h,
                "N4 単語帳",
                true,
                &[
                    &PredefinedMenuItem::about(h, Some("關於 N4 単語帳"), Some(about))?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::hide(h, Some("隱藏"))?,
                    &PredefinedMenuItem::hide_others(h, Some("隱藏其他"))?,
                    &PredefinedMenuItem::show_all(h, Some("全部顯示"))?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::quit(h, Some("結束"))?,
                ],
            )?;

            // 編輯選單：讓搜尋框能用 ⌘C／⌘V／⌘A
            let edit_menu = Submenu::with_items(
                h,
                "編輯",
                true,
                &[
                    &PredefinedMenuItem::undo(h, Some("復原"))?,
                    &PredefinedMenuItem::redo(h, Some("重做"))?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::cut(h, Some("剪下"))?,
                    &PredefinedMenuItem::copy(h, Some("拷貝"))?,
                    &PredefinedMenuItem::paste(h, Some("貼上"))?,
                    &PredefinedMenuItem::select_all(h, Some("全選"))?,
                ],
            )?;

            let today = MenuItem::with_id(h, VIEWS[0].0, VIEWS[0].1, true, Some(VIEWS[0].2))?;
            let list = MenuItem::with_id(h, VIEWS[1].0, VIEWS[1].1, true, Some(VIEWS[1].2))?;
            let card = MenuItem::with_id(h, VIEWS[2].0, VIEWS[2].1, true, Some(VIEWS[2].2))?;
            let quiz = MenuItem::with_id(h, VIEWS[3].0, VIEWS[3].1, true, Some(VIEWS[3].2))?;
            let theme = MenuItem::with_id(h, "toggle-theme", "切換深色／淺色", true, Some("CmdOrCtrl+D"))?;
            let view_menu = Submenu::with_items(
                h,
                "檢視",
                true,
                &[
                    &today,
                    &list,
                    &card,
                    &quiz,
                    &PredefinedMenuItem::separator(h)?,
                    &theme,
                    &PredefinedMenuItem::fullscreen(h, Some("全螢幕"))?,
                ],
            )?;

            let window_menu = Submenu::with_items(
                h,
                "視窗",
                true,
                &[
                    &PredefinedMenuItem::minimize(h, Some("最小化"))?,
                    &PredefinedMenuItem::close_window(h, Some("關閉視窗"))?,
                ],
            )?;

            app.set_menu(Menu::with_items(
                h,
                &[&app_menu, &edit_menu, &view_menu, &window_menu],
            )?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            match id {
                "toggle-theme" => {
                    let _ = app.emit("menu:toggle-theme", ());
                }
                _ => {
                    if let Some((_, _, _)) = VIEWS.iter().find(|(mid, _, _)| *mid == id) {
                        // "view-today" → "today"
                        let _ = app.emit("menu:goto", id.trim_start_matches("view-").to_string());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("啟動 N4 単語帳 失敗");
}
