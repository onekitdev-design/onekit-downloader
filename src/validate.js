import { AppError } from "./errors.js"

const ID_PATTERN = /^[\w-]{11}$/
const MP3_QUALITIES = new Set(["128", "192", "256", "320"])

export function parseYoutubeVideoId(input) {
  const raw = String(input ?? "").trim()
  if (!raw) return null
  if (ID_PATTERN.test(raw)) return raw

  let url
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase()
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0]
    return ID_PATTERN.test(id) ? id : null
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v")
      return id && ID_PATTERN.test(id) ? id : null
    }
    const parts = url.pathname.split("/").filter(Boolean)
    const embedIdx = parts.indexOf("embed")
    if (embedIdx >= 0 && parts[embedIdx + 1] && ID_PATTERN.test(parts[embedIdx + 1])) {
      return parts[embedIdx + 1]
    }
    const shortsIdx = parts.indexOf("shorts")
    if (shortsIdx >= 0 && parts[shortsIdx + 1] && ID_PATTERN.test(parts[shortsIdx + 1])) {
      return parts[shortsIdx + 1]
    }
  }

  return null
}

export function requireYoutubeId(urlOrId) {
  const id = parseYoutubeVideoId(urlOrId)
  if (!id) {
    throw new AppError("INVALID_URL", "Paste a valid public YouTube link or video id.", 400)
  }
  return id
}

export function canonicalWatchUrl(videoId) {
  if (!ID_PATTERN.test(videoId)) {
    throw new AppError("INVALID_URL", "Paste a valid public YouTube link or video id.", 400)
  }
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function requireMp3Quality(value) {
  const quality = String(value ?? "").trim()
  if (!MP3_QUALITIES.has(quality)) {
    throw new AppError("INVALID_QUALITY", "Choose 128, 192, 256, or 320 kbps.", 400)
  }
  return quality
}

export function sanitizeFilename(name) {
  const cleaned = String(name || "audio.mp3")
    .replace(/[^\w.\-()+ ]/g, "_")
    .replace(/^[. ]+/, "")
    .slice(0, 180)
  const base = cleaned || "audio.mp3"
  return /\.mp3$/i.test(base) ? base : `${base}.mp3`
}

export function escapeContentDisposition(filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}
