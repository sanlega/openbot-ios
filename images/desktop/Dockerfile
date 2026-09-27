# OpenBot shared Linux desktop (plan WS9 `images/desktop`).
# Xvfb + noVNC + Chromium + xdotool + AT-SPI for per-bot displays.
FROM debian:bookworm-slim

ARG TARGETARCH
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
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Node 22 for the control daemon
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/openbot
COPY control-daemon.mjs entrypoint.sh ./
RUN chmod +x entrypoint.sh

RUN mkdir -p /workspace
VOLUME ["/workspace"]

EXPOSE 8787 6080

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD curl -fsS http://127.0.0.1:${OPENBOT_CONTROL_PORT}/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
