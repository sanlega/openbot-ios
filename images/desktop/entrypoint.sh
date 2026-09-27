#!/usr/bin/env bash
set -euo pipefail

export OPENBOT_CONTROL_PORT="${OPENBOT_CONTROL_PORT:-8787}"
export NOVNC_PORT="${NOVNC_PORT:-6080}"
export OPENBOT_MAX_SCREENS="${OPENBOT_MAX_SCREENS:-4}"

# The daemon writes short-lived, per-display tokens here. Websockify reloads
# the file on each connection and only accepts a token for an assigned display.
touch /tmp/openbot-vnc-tokens
chmod 600 /tmp/openbot-vnc-tokens
websockify --web /usr/share/novnc --token-plugin TokenFile --token-source /tmp/openbot-vnc-tokens "${NOVNC_PORT}" >/dev/null 2>&1 &

exec node /opt/openbot/desktop-daemon.js
