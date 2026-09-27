#!/usr/bin/env bash
set -euo pipefail

export OPENBOT_CONTROL_PORT="${OPENBOT_CONTROL_PORT:-8787}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export OPENBOT_MAX_SCREENS="${OPENBOT_MAX_SCREENS:-4}"

# Shared noVNC on display :0 (optional overview)
Xvfb :0 -screen 0 1280x800x24 &
sleep 1
fluxbox -display :0 &
x11vnc -display :0 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc "${NOVNC_PORT}" localhost:5900 &

exec node /opt/openbot/desktop-daemon.js
