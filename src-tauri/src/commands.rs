//! Tauri 커맨드 — 프론트엔드가 호출하는 얇은 프록시 계층.
//!
//! 무거운 분석은 전부 Python 사이드카(8765)에 위임한다. 여기서는
//! HTTP 중계 + 사이드카 헬스 체크 + 대기(부팅 동안)를 담당.
//!
//! UI ↔ 분석 로직 분리(개발자 지침): Rust는 라우팅/큐 신호만, 도메인
//! 로직은 사이드카에 있다.

use serde_json::Value;
use crate::sidecar::SIDECAR_BASE;

async fn client() -> reqwest::Client {
    reqwest::Client::new()
}

/// 사이드카가 응답할 때까지 최대 ~30초 대기 (모델 데몬 부팅 고려).
#[tauri::command]
pub async fn wait_for_sidecar() -> Result<Value, String> {
    let c = client().await;
    // 사이드카(Python) 첫 임포트(mlx 등)가 느릴 수 있어 넉넉히 대기 (최대 90초)
    for _ in 0..180 {
        if let Ok(resp) = c.get(format!("{SIDECAR_BASE}/health")).send().await {
            if resp.status().is_success() {
                return resp.json::<Value>().await.map_err(|e| e.to_string());
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err("사이드카가 시간 내에 응답하지 않았습니다.".into())
}

#[tauri::command]
pub async fn list_projects() -> Result<Value, String> {
    get("/projects").await
}

#[tauri::command]
pub async fn create_project(name: String, extra_context: String) -> Result<Value, String> {
    post("/projects", serde_json::json!({ "name": name, "extra_context": extra_context })).await
}

#[tauri::command]
pub async fn get_project(pid: String) -> Result<Value, String> {
    get(&format!("/projects/{pid}")).await
}

#[tauri::command]
pub async fn update_plan(pid: String, context: Value) -> Result<Value, String> {
    put(&format!("/projects/{pid}/plan"), context).await
}

/// 기획안 파일 업로드(로컬 경로) → 사이드카가 읽어 AI 자동완성.
/// 멀티파트 대신, 사이드카에 경로를 넘기지 않고 Rust가 파일을 읽어 전송.
#[tauri::command]
pub async fn upload_plan(pid: String, file_path: String) -> Result<Value, String> {
    let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "plan".into());
    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename);
    let form = reqwest::multipart::Form::new().part("file", part);
    let c = client().await;
    let resp = c
        .post(format!("{SIDECAR_BASE}/projects/{pid}/plan"))
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn analyze_videos(project_id: String, video_paths: Vec<String>) -> Result<Value, String> {
    post("/analyze", serde_json::json!({
        "project_id": project_id,
        "video_paths": video_paths
    })).await
}

#[tauri::command]
pub async fn list_clips(pid: String) -> Result<Value, String> {
    get(&format!("/projects/{pid}/clips")).await
}

#[tauri::command]
pub async fn get_clip(cid: String) -> Result<Value, String> {
    get(&format!("/clips/{cid}")).await
}

#[tauri::command]
pub async fn recompute_scores(pid: String) -> Result<Value, String> {
    post(&format!("/projects/{pid}/recompute"), serde_json::json!({})).await
}

/// 수기 라벨(상/중/하) 저장. label=None이면 해제.
#[tauri::command]
pub async fn set_clip_label(cid: String, label: Option<String>) -> Result<Value, String> {
    put(&format!("/clips/{cid}/label"), serde_json::json!({ "label": label })).await
}

#[tauri::command]
pub async fn label_status(pid: String) -> Result<Value, String> {
    get(&format!("/projects/{pid}/label_status")).await
}

#[tauri::command]
pub async fn delete_project(pid: String) -> Result<Value, String> {
    delete(&format!("/projects/{pid}")).await
}

#[tauri::command]
pub async fn delete_clip(cid: String) -> Result<Value, String> {
    delete(&format!("/clips/{cid}")).await
}

// ---- 내부 HTTP 헬퍼 --------------------------------------------------------
async fn get(path: &str) -> Result<Value, String> {
    let c = client().await;
    let resp = c.get(format!("{SIDECAR_BASE}{path}")).send().await.map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

async fn post(path: &str, body: Value) -> Result<Value, String> {
    let c = client().await;
    let resp = c.post(format!("{SIDECAR_BASE}{path}")).json(&body).send().await.map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

async fn put(path: &str, body: Value) -> Result<Value, String> {
    let c = client().await;
    let resp = c.put(format!("{SIDECAR_BASE}{path}")).json(&body).send().await.map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

async fn delete(path: &str) -> Result<Value, String> {
    let c = client().await;
    let resp = c.delete(format!("{SIDECAR_BASE}{path}")).send().await.map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}
