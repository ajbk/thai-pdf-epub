#!/usr/bin/env bash
# เริ่มระบบ PDF→EPUB แบบ local: Ollama (Typhoon OCR) + Next.js
# ใช้ GPU ในเครื่อง ไม่ต้องพึ่ง cloud / ไม่มี rate limit
set -euo pipefail

MODEL="scb10x/typhoon-ocr1.5-3b"
OLLAMA_BIN="${OLLAMA_BIN:-$HOME/.local/bin/ollama}"

export PATH="$HOME/.local/bin:$PATH"
# ตั้งค่า Ollama ให้เหมาะกับงาน OCR
export OLLAMA_CONTEXT_LENGTH=16384   # รองรับรูปหน้าใหญ่ + output ยาว
export OLLAMA_FLASH_ATTENTION=1      # ประหยัด VRAM
export OLLAMA_KEEP_ALIVE=-1          # คงโมเดลใน VRAM ไม่ต้องโหลดซ้ำ

echo "==> ตรวจ Ollama server"
if ! curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "    เริ่ม ollama serve ..."
  setsid nohup "$OLLAMA_BIN" serve >/tmp/ollama_serve.log 2>&1 < /dev/null &
  for _ in $(seq 1 30); do
    curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
fi
echo "    Ollama พร้อม: $(curl -s http://127.0.0.1:11434/api/version)"

echo "==> ตรวจโมเดล $MODEL"
if ! "$OLLAMA_BIN" list | grep -q "$MODEL"; then
  echo "    ยังไม่มี — กำลัง pull (~3.2GB) ..."
  "$OLLAMA_BIN" pull "$MODEL"
fi

echo "==> pre-warm โมเดลเข้า VRAM"
curl -s http://127.0.0.1:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":-1}" >/dev/null || true
"$OLLAMA_BIN" ps

echo "==> เริ่ม Next.js dev server (http://localhost:3000)"
# โหลด nvm ถ้ามี เพื่อให้เจอ node
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
cd "$(dirname "$0")"
exec npm run dev
