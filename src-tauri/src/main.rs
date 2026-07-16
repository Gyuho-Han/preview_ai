// Preview AI — Tauri 진입점.
// Windows 릴리스에서 콘솔 창 숨김(이 앱은 macOS 전용이지만 관용적으로 둠).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod sidecar;

use tauri::RunEvent;

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // 앱 시작 시 Ollama 확보 → Python 사이드카 부팅
            sidecar::ensure_ollama();
            sidecar::spawn_sidecar();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::wait_for_sidecar,
            commands::list_projects,
            commands::create_project,
            commands::get_project,
            commands::upload_plan,
            commands::update_plan,
            commands::analyze_videos,
            commands::list_clips,
            commands::get_clip,
            commands::recompute_scores,
            commands::set_clip_label,
            commands::label_status,
            commands::delete_project,
            commands::delete_clip,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // 앱 종료 시 사이드카 + Ollama 정리
            if let RunEvent::ExitRequested { .. } = event {
                sidecar::kill_all();
            }
        });
}
