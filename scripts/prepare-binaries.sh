#!/usr/bin/env bash
# Preview AI — Tauri 번들용 바이너리 준비 (macOS Apple Silicon)
#
# Tauri externalBin은 파일명에 타깃 트리플 접미사를 요구합니다.
#   예: bin/ollama-aarch64-apple-darwin
# 이 스크립트는 시스템에 이미 있는 ollama/ffmpeg를 복사하고,
# Python 사이드카를 PyInstaller로 단일 실행파일로 묶습니다.
#
# 사용법:  bash scripts/prepare-binaries.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/src-tauri/bin"
mkdir -p "$BIN"

# 타깃 트리플 (rustc 우선, 없으면 Apple Silicon 가정)
if command -v rustc >/dev/null 2>&1; then
  TRIPLE="$(rustc -Vv | sed -n 's/host: //p')"
else
  TRIPLE="aarch64-apple-darwin"
fi
echo "▶ 타깃 트리플: $TRIPLE"

copy_bin() {
  local name="$1"
  local src
  # 이미 준비된 바이너리는 보존 (정적 빌드로 교체해둔 ffmpeg/ffprobe 보호)
  if [ -f "$BIN/$name-$TRIPLE" ]; then
    echo "✓ $name 이미 존재 — 건너뜀 (강제 갱신은 파일 삭제 후 재실행)"
    return
  fi
  if src="$(command -v "$name" 2>/dev/null)"; then
    cp "$src" "$BIN/$name-$TRIPLE"
    chmod +x "$BIN/$name-$TRIPLE"
    echo "✓ $name → bin/$name-$TRIPLE"
    # brew 등 로컬 dylib에 의존하면 다른 Mac에서 실행 불가 → 경고
    if otool -L "$BIN/$name-$TRIPLE" | grep -qE "/opt/homebrew|/usr/local/(opt|Cellar)"; then
      echo "  ⚠ $name 이(가) Homebrew dylib에 의존합니다 — 다른 Mac에서 실행되지 않습니다!"
      echo "    정적(static) 빌드로 교체하세요: https://www.osxexperts.net (Apple Silicon용 ffmpeg/ffprobe)"
      echo "    받은 파일을 $BIN/$name-$TRIPLE 로 덮어쓰면 됩니다."
    fi
  else
    echo "✗ $name 미설치 — 먼저 설치하세요 (예: brew install $name)"
  fi
}

echo "▶ ollama / ffmpeg / ffprobe 복사"
copy_bin ollama
copy_bin ffmpeg
copy_bin ffprobe

echo "▶ Python 사이드카 PyInstaller 번들"
cd "$ROOT/python-sidecar"
pip show pyinstaller >/dev/null 2>&1 || pip install pyinstaller
pyinstaller --onefile --name preview-sidecar \
  --collect-all mlx_audio \
  --collect-all mlx \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.protocols \
  server.py
cp "dist/preview-sidecar" "$BIN/preview-sidecar-$TRIPLE"
chmod +x "$BIN/preview-sidecar-$TRIPLE"
echo "✓ preview-sidecar → bin/preview-sidecar-$TRIPLE"

echo ""
echo "완료. 이제 \`npm run tauri:build\`로 앱을 빌드하세요."
echo "주의: ollama/ffmpeg는 동봉되지만, 모델 가중치는 첫 실행 셋업 화면에서 받습니다(방법 B)."
