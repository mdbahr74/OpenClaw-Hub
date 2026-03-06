#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$PROJECT_DIR/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/openclaw-launch.log"

cd "$PROJECT_DIR"

# Keep startup behavior stable with external launchers.
export COMMANDDESK_CLEAR_CACHE_ON_START="${COMMANDDESK_CLEAR_CACHE_ON_START:-0}"

# Ensure Electron launches as Electron, not Node.
unset ELECTRON_RUN_AS_NODE

# Linux fallback for Electron setuid sandbox errors.
USE_NO_SANDBOX="${OPENCLAW_USE_NO_SANDBOX:-1}"
export ELECTRON_DISABLE_SANDBOX="$USE_NO_SANDBOX"

CMD=()
if [[ -x "$PROJECT_DIR/node_modules/electron/dist/electron" ]]; then
  CMD+=("$PROJECT_DIR/node_modules/electron/dist/electron")
  if [[ "$USE_NO_SANDBOX" == "1" ]]; then
    CMD+=(--no-sandbox --disable-setuid-sandbox --disable-gpu-sandbox --no-zygote)
  fi
  CMD+=(".")
else
  CMD+=(npm run start)
fi

# Start detached so terminal does not remain open.
if command -v setsid >/dev/null 2>&1; then
  setsid /usr/bin/env -u ELECTRON_RUN_AS_NODE "${CMD[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
else
  nohup /usr/bin/env -u ELECTRON_RUN_AS_NODE "${CMD[@]}" >>"$LOG_FILE" 2>&1 < /dev/null &
fi

exit 0
