# OneKit downloader VPS setup

OneKit on Vercel is the frontend and API proxy only. YouTube extraction, PO token generation, and FFmpeg conversion run on a dedicated Linux VPS.

```text
User browser
    → Next.js / Vercel  (/api/youtube/streams, /api/youtube/mp3)
        → Downloader VPS API  (API key)
            → yt-dlp
                → bgutil-ytdlp-pot-provider
                    → YouTube
            → FFmpeg (MP3)
        ← temporary MP3
    ← same-origin download
```

The browser never talks to the VPS, never sees `DOWNLOADER_API_KEY`, and does not need yt-dlp, FFmpeg, or Python.

## 1. VPS requirements

- Ubuntu 22.04 or 24.04
- 2 vCPU, 2 GB RAM minimum (4 GB recommended)
- 20 GB disk
- A public IPv4 address
- A domain name for HTTPS, for example `downloader.example.com`
- Outbound HTTPS to YouTube

Do not run this on the same serverless host as OneKit. Datacenter IPs can still be rate-limited by YouTube; a small dedicated VPS is the intended setup.

## 2. Ubuntu setup

```bash
sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git ufw
```

Create a deploy user if you are still using `root`:

```bash
sudo adduser --disabled-password --gecos "" onekit
sudo usermod -aG sudo onekit
```

## 3. Docker installation

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out and back in, then confirm:

```bash
docker --version
docker compose version
```

## 4. Deployment

Clone this repository onto the VPS:

```bash
git clone https://github.com/onekitdev-design/onekit-downloader.git
cd onekit-downloader
cp .env.example .env
nano .env
```

Set a long random API key:

```bash
openssl rand -hex 32
```

Put that value in `API_KEY` on the VPS and in Vercel as `DOWNLOADER_API_KEY`.

Build and start:

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

Confirm health (no API key required):

```bash
curl -sS http://127.0.0.1:8787/health
```

You should see `"ok": true`, a yt-dlp version, `"ffmpeg": true`, and `"pot": "reachable"`.

## 5. Environment variables

### VPS (`.env` in this repo)

| Variable | Required | Purpose |
| --- | --- | --- |
| `API_KEY` | yes | Shared secret with Vercel. At least 24 characters in production. |
| `HOST` | no | Bind address. Docker uses `0.0.0.0`. |
| `PORT` | no | Container port. Default `8787`. |
| `POT_PROVIDER_URL` | no | bgutil HTTP server. Compose sets `http://pot-provider:4416`. |
| `YTDLP_PLAYER_CLIENT` | no | yt-dlp YouTube clients. Default `mweb,tv,web_safari`. |
| `YTDLP_FORCE_IPV4` | no | Default `1`. Helps on many VPS networks. |
| `MAX_DURATION_SECONDS` | no | Default `7200` (2 hours). |
| `MAX_DOWNLOAD_MB` | no | Default `500`. |
| `MAX_ACTIVE_JOBS` | no | Concurrent yt-dlp jobs. Default `3`. |
| `JOB_TTL_MS` | no | Temporary file lifetime. Default `900000` (15 minutes). |
| `ONEKIT_ORIGIN` | no | If set, signed download responses allow CORS from that origin. |

### Vercel / OneKit

| Variable | Required | Purpose |
| --- | --- | --- |
| `DOWNLOADER_API_URL` | yes | Public HTTPS origin of the VPS, no trailing slash. |
| `DOWNLOADER_API_KEY` | yes | Same value as VPS `API_KEY`. Server-only. |

Never prefix the API key with `NEXT_PUBLIC_`.

## 6. Domain / HTTPS setup

Publish the API only through a reverse proxy. Compose already binds the API to `127.0.0.1:8787`.

Install Caddy:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddy
downloader.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo systemctl reload caddy
```

Point the domain A record at the VPS. Caddy issues the certificate.

Use HTTPS. Safari and Chrome on iOS/Android expect a trusted certificate for large downloads.

## 7. Firewall configuration

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do **not** publish:

- port `8787` on `0.0.0.0`
- port `4416` (PO token provider)

The POT provider is unauthenticated. Compose keeps it on the internal Docker network.

## 8. API authentication

Every VPS route except `GET /health` requires:

```http
X-Api-Key: YOUR_API_KEY
```

`Authorization: Bearer YOUR_API_KEY` is also accepted.

Temporary download links may use an HMAC query string (`expires` + `sig`) instead of the API key. Those links expire quickly and do not expose `API_KEY`. OneKit still downloads through `/api/youtube/mp3`, so browsers never need the signed URL.

Rotate the key by changing both VPS `API_KEY` and Vercel `DOWNLOADER_API_KEY`, then restart:

```bash
cd ~/onekit-downloader
docker compose up -d
```

## 9. Testing

Health:

```bash
curl -sS https://downloader.example.com/health
```

Streams (replace the key and URL):

```bash
curl -sS -X POST https://downloader.example.com/youtube/streams \
  -H "X-Api-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtu.be/b8I-7Wk_Vbc"}'
```

Download job:

```bash
curl -sS -X POST https://downloader.example.com/youtube/download \
  -H "X-Api-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtu.be/b8I-7Wk_Vbc","quality":"192","filename":"sample-onekit.mp3"}'
```

Poll `GET /jobs/:id` until `status` is `completed`, then:

```bash
curl -sS -H "X-Api-Key: YOUR_API_KEY" \
  -o sample-onekit.mp3 \
  https://downloader.example.com/downloads/JOB_ID
```

file(1) should report MPEG ADTS / MP3. Play it on desktop, Android Chrome, Android Firefox, iPhone Safari, and iPhone Chrome.

OneKit local test:

```bash
# terminal 1, from onekit-downloader
docker compose up -d

# terminal 2, from the OneKit repo root
# add to .env.local:
# DOWNLOADER_API_URL=http://127.0.0.1:8787
# DOWNLOADER_API_KEY=<same as VPS .env>
npm run dev
```

Open `/tools/youtube/download`, paste a public YouTube link, click **Load**, then **Download MP3**.

Unauthorized requests must fail:

```bash
curl -sS -X POST https://downloader.example.com/youtube/streams \
  -H "Content-Type: application/json" \
  -d '{"url":"https://youtu.be/b8I-7Wk_Vbc"}'
```

## 10. Updating yt-dlp

YouTube extraction changes often. Pin versions in `docker-compose.yml` / `Dockerfile`, then rebuild.

```bash
cd ~/onekit-downloader
# edit Dockerfile ARGs and compose build.args if you want a newer pin
docker compose build --no-cache api
docker compose up -d api
docker compose exec api yt-dlp --version
```

Current image pins:

- `yt-dlp==2026.8.19`
- Node `22.14.0-bookworm-slim`

Check [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) when lookups start failing.

## 11. Updating the PO-token provider

This service uses the current yt-dlp PO Token Provider framework with [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) **2.0.1**:

- HTTP server: `brainicism/bgutil-ytdlp-pot-provider:2.0.1`
- yt-dlp plugin: `bgutil-ytdlp-pot-provider==2.0.1`

Update **both** together:

```bash
# edit docker-compose.yml (pot-provider image tag, api build.args POT_PLUGIN_VERSION)
# edit Dockerfile ARG POT_PLUGIN_VERSION
docker compose pull pot-provider
docker compose build api
docker compose up -d
```

Confirm the plugin loaded:

```bash
docker compose exec api yt-dlp -v --print title https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Look for:

```text
PO Token Providers: bgutil:http-2.0.1
Generating a ... PO Token for ... via bgutil HTTP server
```

If YouTube starts rejecting the current player clients, change `YTDLP_PLAYER_CLIENT` and restart. Common values:

```env
YTDLP_PLAYER_CLIENT=mweb,tv,web_safari
YTDLP_PLAYER_CLIENT=web,mweb,tv
YTDLP_PLAYER_CLIENT=ios,web
```

Do not hardcode PO tokens.

## 12. Troubleshooting

| Symptom | What to check |
| --- | --- |
| OneKit: "YouTube downloads are temporarily unavailable." | `DOWNLOADER_API_URL` and `DOWNLOADER_API_KEY` are set in Vercel. VPS is up. `curl /health` works. |
| `UNAUTHORIZED` from VPS | Keys do not match, or the request is missing `X-Api-Key`. |
| `YOUTUBE_RATE_LIMITED` / "not a bot" | Datacenter IP is flagged. Confirm POT provider is reachable. Wait and retry. A residential IP VPS helps more than extra tokens. Cookies/login are not used. |
| `POT_TOKEN_FAILED` | `docker compose logs pot-provider`. Confirm `POT_PROVIDER_URL=http://pot-provider:4416`. Update the plugin and image together. |
| `YOUTUBE_EXTRACTION_FAILED` | `docker compose logs api`. Try a different `YTDLP_PLAYER_CLIENT`. Update yt-dlp. |
| `PRIVATE_VIDEO` / `AGE_RESTRICTED` / `GEO_RESTRICTED` | Expected. The service only supports public videos available to the VPS region. |
| `TIMEOUT` | Increase `EXTRACT_TIMEOUT_MS` / `DOWNLOAD_TIMEOUT_MS`, or pick a shorter video. |
| `RESOURCE_EXHAUSTED` | Too many concurrent jobs. Wait, or raise `MAX_ACTIVE_JOBS` if the VPS has spare CPU/RAM. |
| `FFMPEG_FAILED` | `docker compose exec api ffmpeg -version`. Rebuild the image if FFmpeg is missing. |
| Empty or 0-byte MP3 | Job expired and files were cleaned up. Download promptly after `completed`. |
| Safari iOS does not save | Use the OneKit UI, not the raw VPS URL. OneKit fetches same-origin `/api/youtube/mp3` and uses the share/save sheet. Confirm HTTPS. |
| Disk fills up | Jobs delete files after download or after `JOB_TTL_MS`. Check `docker compose exec api df -h /tmp/onekit`. |

Useful logs:

```bash
docker compose logs -f api
docker compose logs -f pot-provider
```

Logs never print `API_KEY`.

## Security notes

- The VPS is not an open YouTube proxy.
- Only YouTube watch/shorts/embed URLs (or 11-character ids) are accepted.
- yt-dlp and FFmpeg are spawned with argument arrays, never a shell.
- MP3 quality is only `128`, `192`, `256`, or `320`.
- Temporary files live in `/tmp/onekit/<job-id>/` and are removed after serve or TTL.
- Private, paid, DRM, and age-gated videos are rejected.

## Docker commands

```bash
cd onekit-downloader
docker compose build
docker compose up -d
docker compose logs -f
docker compose ps
docker compose restart api
docker compose down
```
