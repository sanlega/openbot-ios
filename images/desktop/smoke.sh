#!/usr/bin/env bash
# Opt-in image smoke test (plan WS9). Requires Docker.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not available — skipping image smoke"
  exit 0
fi

IMAGE="${OPENBOT_DESKTOP_IMAGE:-openbot/desktop:smoke}"
TOKEN="${OPENBOT_CONTROL_TOKEN:-smoke-token}"
PORT="${OPENBOT_DOCKER_PORT:-8787}"

docker build -t "$IMAGE" "$(dirname "$0")"
CID=$(docker run -d -p "${PORT}:8787" -e "OPENBOT_CONTROL_TOKEN=${TOKEN}" "$IMAGE")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/health" | grep -q '"ok":true'
curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/observe?botId=smoke&display=1" | grep -q 'observed'
echo "desktop image smoke OK"
