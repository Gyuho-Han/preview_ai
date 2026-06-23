//! Python 사이드카 수명 관리 + HTTP 프록시.
//!
//! Tauri 시작 시 PyInstaller 번들(또는 dev에선 uvicorn)을 띄우고,
//! 프론트엔드의 요청을 localhost:8765 로 중계한다.

use once_cell::sync::Lazy;
use std::sync::Mutex;
use tauri::api::process::{Command, CommandChild, CommandEvent};

pub const SIDECAR_BASE: &str = "http://127.0.0.1:8765";

/// 사이드카 자식 프로세스 핸들 (종료 시 정리용).
static CHILD: Lazy<Mutex<Option<CommandChild>>> = Lazy::new(|| Mutex::new(None));

/// externalBin 으로 번들된 사이드카 실행. dev 모드에서 실패하면
/// 이미 떠 있는 uvicorn(`npm run sidecar:dev`)을 사용한다고 가정.
pub fn spawn_sidecar() {
    let result = Command::new_sidecar("preview-sidecar")
        .and_then(|c| c.args(["--port", "8765"]).spawn());

    match result {
        Ok((mut rx, child)) => {
            *CHILD.lock().unwrap() = Some(child);
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stderr(line) | CommandEvent::Stdout(line) = event {
                        println!("[sidecar] {line}");
                    }
                }
            });
        }
        Err(e) => {
            eprintln!(
                "[sidecar] 번들 실행 실패({e}). dev 모드라면 `npm run sidecar:dev`로 \
                 8765 포트에 사이드카를 띄워주세요."
            );
        }
    }
}

pub fn kill_sidecar() {
    if let Some(child) = CHILD.lock().unwrap().take() {
        let _ = child.kill();
    }
}
