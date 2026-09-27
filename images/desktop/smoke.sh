#!/usr/bin/env bash
# Opt-in image smoke test (plan WS9). Requires Docker.
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not available — skipping image smoke"
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OPENBOT_DESKTOP_IMAGE:-openbot/desktop:smoke}"
TOKEN="${OPENBOT_CONTROL_TOKEN:-smoke-token}"
PORT="${OPENBOT_DOCKER_PORT:-8787}"

docker build -t "$IMAGE" -f "$ROOT/images/desktop/Dockerfile" "$ROOT"
CID=$(docker run -d -p "${PORT}:8787" -e "OPENBOT_CONTROL_TOKEN=${TOKEN}" "$IMAGE")
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/health" >/dev/null; then
    break
  fi
  sleep 2
done

curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/health" | grep -q '"ok":true'

for _ in $(seq 1 10); do
  if curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/observe?botId=smoke" | grep -q '"elements"'; then
    echo "desktop image smoke OK"
    exit 0
  fi
  sleep 3
done

echo "observe endpoint did not return elements in time" >&2
curl -fsS -H "Authorization: Bearer ${TOKEN}" "http://127.0.0.1:${PORT}/observe?botId=smoke" || true
exit 1
