//! Python 사이드카 + Ollama 수명 관리.
//!
//! 앱 시작 시:
//!  1) Ollama 서버 확보 — 시스템에 있으면 재사용, 없으면 번들 바이너리 실행.
//!  2) Python 사이드카 실행 —
//!       - dev 모드: conda(preview) 등의 python3 로 `server.py` 직접 실행
//!         (개발자가 uvicorn 을 따로 띄울 필요 없이 `npm run tauri:dev` 하나로 동작)
//!       - 배포 모드: PyInstaller 로 묶은 번들 바이너리(externalBin) 실행
//!  이미 8765/11434 가 떠 있으면 그대로 재사용해 포트 충돌을 피한다.

use once_cell::sync::Lazy;
use std::process::{Child, Command as StdCommand};
use std::sync::Mutex;
use tauri::api::process::{Command, CommandChild, CommandEvent};

pub const SIDECAR_BASE: &str = "http://127.0.0.1:8765";

static SIDECAR_CHILD: Lazy<Mutex<Option<CommandChild>>> = Lazy::new(|| Mutex::new(None));
static SIDECAR_DEV_CHILD: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
static OLLAMA_CHILD: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

/// 지정 포트가 이미 응답하는지(중복 실행 방지).
fn port_in_use(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        std::time::Duration::from_millis(300),
    )
    .is_ok()
}

fn system_ollama_exists() -> bool {
    StdCommand::new("ollama")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Ollama 서버 확보. 시스템 우선, 없으면 번들 바이너리.
pub fn ensure_ollama() {
    if port_in_use(11434) {
        println!("[ollama] 이미 11434에서 실행 중 — 재사용");
        return;
    }

    if system_ollama_exists() {
        match StdCommand::new("ollama")
            .arg("serve")
            .env("OLLAMA_HOST", "127.0.0.1:11434")
            .spawn()
        {
            Ok(child) => {
                println!("[ollama] 시스템 ollama serve 시작");
                *OLLAMA_CHILD.lock().unwrap() = Some(child);
                return;
            }
            Err(e) => eprintln!("[ollama] 시스템 ollama 실행 실패: {e}"),
        }
    }

    let cmd = match Command::new_sidecar("ollama") {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[ollama] 번들 ollama 미존재({e}). 셋업 화면에서 안내됩니다.");
            return;
        }
    };
    match cmd.args(["serve"]).spawn() {
        Ok((mut rx, _child)) => {
            println!("[ollama] 번들 ollama serve 시작");
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    if let CommandEvent::Stderr(l) | CommandEvent::Stdout(l) = ev {
                        println!("[ollama] {l}");
                    }
                }
            });
        }
        Err(e) => eprintln!("[ollama] 번들 ollama 실행 실패({e})."),
    }
}

/// 우리가 띄운 사이드카 PID 기록 파일(orphan 정리용).
fn sidecar_pidfile() -> std::path::PathBuf {
    std::env::temp_dir().join("preview-ai-sidecar.pid")
}

#[cfg(dev)]
fn read_pidfile() -> Option<u32> {
    std::fs::read_to_string(sidecar_pidfile()).ok()?.trim().parse().ok()
}

#[cfg(dev)]
fn write_pidfile(pid: u32) {
    let _ = std::fs::write(sidecar_pidfile(), pid.to_string());
}

#[cfg(dev)]
fn kill_pid(pid: u32) {
    let _ = StdCommand::new("kill").args(["-9", &pid.to_string()]).status();
}

/// Python 사이드카 실행.
pub fn spawn_sidecar() {
    spawn_sidecar_impl();
}

/// dev: conda(preview)/시스템 python 으로 server.py 직접 실행.
/// 이전 dev 세션이 남긴 orphan 사이드카(8765 점유)를 먼저 정리한 뒤 새로 띄운다.
#[cfg(dev)]
fn spawn_sidecar_impl() {
    // 포트가 잡혀 있고, 우리가 기록해 둔 PID가 있으면 그 orphan을 정리
    if port_in_use(8765) {
        if let Some(pid) = read_pidfile() {
            println!("[sidecar] 이전 사이드카(pid {pid}) 정리 후 재시작");
            kill_pid(pid);
            std::thread::sleep(std::time::Duration::from_millis(900));
        }
    }
    // 정리 후에도 8765가 외부 프로세스(수동 uvicorn 등)로 점유돼 있으면 그대로 재사용
    if port_in_use(8765) {
        println!("[sidecar] 8765 외부 프로세스 사용 중 — 재사용");
        return;
    }

    let manifest = env!("CARGO_MANIFEST_DIR"); // .../preview_ai/src-tauri
    let dir = match std::path::Path::new(manifest).parent() {
        Some(p) => p.join("python-sidecar"),
        None => {
            eprintln!("[sidecar] python-sidecar 경로 확인 실패");
            return;
        }
    };
    let home = std::env::var("HOME").unwrap_or_default();

    // 후보 python 인터프리터: 환경변수 → conda(preview) 표준 경로 → PATH
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(p) = std::env::var("PREVIEW_PYTHON") {
        candidates.push(p);
    }
    for base in ["miniconda3", "anaconda3", "opt/anaconda3", "miniforge3"] {
        candidates.push(format!("{home}/{base}/envs/preview/bin/python3"));
    }
    candidates.push("python3".into());
    candidates.push("python".into());

    println!("[sidecar] dev — server.py 실행 시도 ({})", dir.display());
    for py in &candidates {
        // 존재하지 않는 절대경로는 건너뜀(PATH 이름은 그대로 시도)
        if py.contains('/') && !std::path::Path::new(py).exists() {
            continue;
        }
        match StdCommand::new(py)
            .args(["server.py", "--port", "8765"])
            .current_dir(&dir)
            .spawn()
        {
            Ok(child) => {
                write_pidfile(child.id());   // orphan 정리용 PID 기록
                *SIDECAR_DEV_CHILD.lock().unwrap() = Some(child);
                println!("[sidecar] dev 사이드카 시작: {py}");
                return;
            }
            Err(e) => eprintln!("[sidecar] {py} 실행 실패: {e}"),
        }
    }
    eprintln!(
        "[sidecar] python 인터프리터를 찾지 못했습니다. \
         PREVIEW_PYTHON 환경변수로 conda preview 의 python 경로를 지정하거나, \
         해당 env 를 활성화한 터미널에서 실행하세요."
    );
}

/// 배포: PyInstaller 번들 바이너리(externalBin) 실행.
#[cfg(not(dev))]
fn spawn_sidecar_impl() {
    if port_in_use(8765) {
        println!("[sidecar] 8765 이미 사용 중 — 기존 사이드카 재사용");
        return;
    }
    let cmd = match Command::new_sidecar("preview-sidecar") {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[sidecar] 번들 미존재({e}).");
            return;
        }
    };
    match cmd.args(["--port", "8765"]).spawn() {
        Ok((mut rx, child)) => {
            *SIDECAR_CHILD.lock().unwrap() = Some(child);
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    if let CommandEvent::Stderr(line) | CommandEvent::Stdout(line) = event {
                        println!("[sidecar] {line}");
                    }
                }
            });
        }
        Err(e) => eprintln!("[sidecar] 사이드카 실행 실패({e})."),
    }
}

pub fn kill_all() {
    if let Some(child) = SIDECAR_CHILD.lock().unwrap().take() {
        let _ = child.kill();
    }
    if let Some(mut child) = SIDECAR_DEV_CHILD.lock().unwrap().take() {
        let _ = child.kill();
        let _ = std::fs::remove_file(sidecar_pidfile());
    }
    if let Some(mut child) = OLLAMA_CHILD.lock().unwrap().take() {
        let _ = child.kill();
    }
}
