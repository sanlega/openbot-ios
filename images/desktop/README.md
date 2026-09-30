# OpenBot desktop image (WS9)

Shared Linux desktop container for OpenBot computer use:

- **Stack**: Xvfb, fluxbox, x11vnc, noVNC (websockify), Chromium, xdotool, AT-SPI
- **Per-bot displays**: up to 4 concurrent (`OPENBOT_MAX_SCREENS`), LRU-evicted
- **Control API**: HTTP on port 8787 (`OPENBOT_CONTROL_TOKEN` required)
- **Live view**: noVNC on port 6080; `/live?botId=...` issues a 15-minute token
  routed to that bot's display. Both published ports should be bound to loopback.
- **Workspace**: bind-mount host path to `/workspace`

## Getting the image

OpenBot pulls this image from GHCR by default (D-020, `.ai/memory/plans/2026-09-28-computer-image-settings.md`):
`ghcr.io/sanlega/openbot-desktop:latest`. Settings > Computer in the app does this for
you (also handles resetting a stuck container/image) — `docker pull` by hand only if
you're not going through the app.

**GHCR package visibility**: the package is created private on first publish regardless
of the repo's own visibility, and needs a one-time manual switch to public in the
package's GitHub settings before `docker pull` works for anyone but the owner. Until
that's done, pulls fail with an auth error (surfaced in Settings > Computer as the
image's `error` state).

### Building locally instead (dev-checkout only)

Only useful for testing changes to this Dockerfile itself — the app's own "Build from
source" option in Settings > Computer does exactly this, but only shows up when running
from a git checkout (it looks for this file next to the running package; a packaged
install never has it). From the repository root:

```bash
docker build -t ghcr.io/sanlega/openbot-desktop:latest -f images/desktop/Dockerfile .
```

## Run (manual smoke)

```bash
docker run --rm -p 127.0.0.1:8787:8787 -p 127.0.0.1:6080:6080 \
  -e OPENBOT_CONTROL_TOKEN="$(openssl rand -hex 16)" \
  -v "$PWD:/workspace" \
  ghcr.io/sanlega/openbot-desktop:latest
```

## Publishing (CI)

`.github/workflows/release.yml`'s `publish-desktop-image` job builds and pushes this
image to GHCR on every `v*` tag, tagged `latest` and the release tag.

## CI

Docker-dependent tests are opt-in:

```bash
OPENBOT_DOCKER=1 pnpm --filter @openbot/computer-docker test
```

Image smoke test (opt-in):

```bash
OPENBOT_DOCKER=1 bash images/desktop/smoke.sh
```
