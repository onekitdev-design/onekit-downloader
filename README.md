# OneKit Downloader

Backend API for [OneKit](https://github.com/onekitdev-design/onekit) YouTube to MP3. Runs on a Linux VPS with **yt-dlp**, **bgutil-ytdlp-pot-provider**, and **FFmpeg**. The public OneKit site on Vercel calls this service with an API key only — browsers never talk to this host directly.

## Quick start (Docker)

```bash
cp .env.example .env
# Set API_KEY (openssl rand -hex 32)
docker compose build
docker compose up -d
curl -sS http://127.0.0.1:8787/health
```

Put HTTPS (Caddy/nginx) in front of port `8787`. Set the same `API_KEY` in Vercel as `DOWNLOADER_API_KEY` and the public URL as `DOWNLOADER_API_URL`.

Full VPS setup: [DOWNLOADER_VPS_SETUP.md](./DOWNLOADER_VPS_SETUP.md)

## API (authenticated)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness (no API key) |
| POST | `/youtube/streams` | List MP3 quality options for a URL |
| POST | `/youtube/download` | Start MP3 conversion job |
| GET | `/jobs/:id` | Job status |
| GET | `/downloads/:id` | Download MP3 (API key or signed query) |

Header: `X-Api-Key: YOUR_API_KEY`

## License

Same terms as your OneKit deployment. Use only for content users may legally download.
