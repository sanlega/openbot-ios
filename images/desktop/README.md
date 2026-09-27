# OpenBot desktop image (WS9)

Shared Linux desktop container for OpenBot computer use:

- **Stack**: Xvfb, fluxbox, x11vnc, noVNC (websockify), Chromium, xdotool, AT-SPI
- **Per-bot displays**: up to 4 concurrent (`OPENBOT_MAX_SCREENS`), LRU-evicted
- **Control API**: HTTP on port 8787 (`OPENBOT_CONTROL_TOKEN` required)
- **Live view**: noVNC on port 6080, tokenized URLs from `/live`
- **Workspace**: bind-mount host path to `/workspace`

## Build

From the repository root:

```bash
docker build -t openbot/desktop:latest -f images/desktop/Dockerfile .
```

## Run (manual smoke)

```bash
docker run --rm -p 8787:8787 -p 6080:6080 \
  -e OPENBOT_CONTROL_TOKEN=dev-token \
  -v "$PWD:/workspace" \
  openbot/desktop:latest
```

## CI

Docker-dependent tests are opt-in:

```bash
OPENBOT_DOCKER=1 pnpm --filter @openbot/computer-docker test
```

Image smoke test (opt-in):

```bash
OPENBOT_DOCKER=1 bash images/desktop/smoke.sh
```
