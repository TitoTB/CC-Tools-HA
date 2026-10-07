FROM mcr.microsoft.com/playwright:v1.63.0-noble

ARG BUILD_VERSION=1.0.22
ARG BUILD_ARCH

LABEL \
  io.hass.name="CC Tools" \
  io.hass.description="Automatiza tareas de Creality Cloud desde Home Assistant" \
  io.hass.type="app" \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.arch="${BUILD_ARCH}"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    jq \
    net-tools \
    novnc \
    websockify \
    x11vnc \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY run.sh /run.sh

RUN chmod +x /run.sh

ENV NODE_ENV=production \
    CCTOOLS_HOST=0.0.0.0 \
    CCTOOLS_PORT=8080 \
    CCTOOLS_DATA_DIR=/data \
    DISPLAY=:99

CMD ["/run.sh"]
