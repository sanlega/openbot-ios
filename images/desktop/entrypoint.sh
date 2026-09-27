#!/usr/bin/env bash
set -euo pipefail

export DISPLAY_BASE="${DISPLAY_BASE:-:1}"
export OPENBOT_CONTROL_PORT="${OPENBOT_CONTROL_PORT:-8787}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export OPENBOT_MAX_SCREENS="${OPENBOT_MAX_SCREENS:-4}"

# Shared fluxbox on display :0 for noVNC shell; per-bot displays start at :1.
Xvfb :0 -screen 0 1280x800x24 &
fluxbox -display :0 &
x11vnc -display :0 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc "${NOVNC_PORT}" localhost:5900 &

node /opt/openbot/control-daemon.mjs
