FROM node:22.14.0-bookworm-slim

ARG YTDLP_VERSION=2026.8.19
ARG POT_PLUGIN_VERSION=2.0.1

ENV NODE_ENV=production \
    HOME=/tmp/onekit \
    PATH="/opt/venv/bin:/usr/local/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        python3-venv \
        ffmpeg \
        ca-certificates \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir \
        "yt-dlp==${YTDLP_VERSION}" \
        "bgutil-ytdlp-pot-provider==${POT_PLUGIN_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

RUN mkdir -p /tmp/onekit \
    && chown -R node:node /app /tmp/onekit /opt/venv

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8787/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
