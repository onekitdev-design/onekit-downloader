import { readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env")
try {
  const text = readFileSync(envFile, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (key && process.env[key] == null) process.env[key] = value
  }
} catch {
  // .env is optional when the process already has the variables.
}

function integerEnv(name, fallback) {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function booleanEnv(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  return raw === "1" || raw === "true" || raw === "yes"
}

const nodeEnv = process.env.NODE_ENV === "production" ? "production" : "development"
const apiKey = process.env.API_KEY?.trim() ?? ""

if (!apiKey) {
  throw new Error("API_KEY is required")
}

if (nodeEnv === "production" && apiKey.length < 24) {
  throw new Error("API_KEY must be at least 24 characters in production")
}

export const config = {
  nodeEnv,
  host: process.env.HOST?.trim() || "0.0.0.0",
  port: integerEnv("PORT", 8787),
  apiKey,
  potProviderUrl: (process.env.POT_PROVIDER_URL?.trim() || "").replace(/\/$/, ""),
  playerClient: process.env.YTDLP_PLAYER_CLIENT?.trim() || "mweb,tv,web_safari",
  forceIpv4: booleanEnv("YTDLP_FORCE_IPV4", true),
  ytdlpBin: process.env.YTDLP_BIN?.trim() || "yt-dlp",
  ffmpegBin: process.env.FFMPEG_BIN?.trim() || "ffmpeg",
  nodeBin: process.execPath,
  tmpRoot: process.env.DOWNLOAD_TMP_DIR?.trim() || path.join(os.tmpdir(), "onekit"),
  maxDurationSeconds: integerEnv("MAX_DURATION_SECONDS", 7200),
  maxDownloadMb: integerEnv("MAX_DOWNLOAD_MB", 500),
  maxActiveJobs: integerEnv("MAX_ACTIVE_JOBS", 3),
  maxQueuedJobs: integerEnv("MAX_QUEUED_JOBS", 50),
  jobTtlMs: integerEnv("JOB_TTL_MS", 15 * 60 * 1000),
  downloadTimeoutMs: integerEnv("DOWNLOAD_TIMEOUT_MS", 10 * 60 * 1000),
  extractTimeoutMs: integerEnv("EXTRACT_TIMEOUT_MS", 90 * 1000),
  rateLimitMax: integerEnv("RATE_LIMIT_MAX", 40),
  rateLimitWindowMs: integerEnv("RATE_LIMIT_WINDOW_MS", 60 * 1000),
  downloadRateLimitMax: integerEnv("DOWNLOAD_RATE_LIMIT_MAX", 10),
  onekitOrigin: process.env.ONEKIT_ORIGIN?.trim() || "",
}
