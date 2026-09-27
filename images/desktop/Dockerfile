# OpenBot shared Linux desktop (plan WS9 `images/desktop`).
FROM node:22-bookworm AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/decisions packages/decisions
COPY packages/store packages/store
COPY packages/computer packages/computer
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @openbot/contracts --filter @openbot/decisions --filter @openbot/computer --filter @openbot/computer-docker run build

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    OPENBOT_MAX_SCREENS=4 \
    OPENBOT_CONTROL_PORT=8787 \
    NOVNC_PORT=6080

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
    xvfb x11vnc fluxbox \
    novnc websockify \
    chromium \
    xdotool at-spi2-core \
    tesseract-ocr \
    python3 python3-gi gir1.2-atspi-2.0 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openbot
COPY --from=build /repo/packages/computer/docker/dist/desktop-daemon.js ./desktop-daemon.js
COPY images/desktop/entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /workspace
VOLUME ["/workspace"]

EXPOSE 8787 6080

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${OPENBOT_CONTROL_PORT}/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
