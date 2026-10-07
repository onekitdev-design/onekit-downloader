import { mkdir } from "node:fs/promises"
import Fastify from "fastify"
import rateLimit from "@fastify/rate-limit"
import { config } from "./config.js"
import { AppError, errorPayload } from "./errors.js"
import { logError, logInfo } from "./logger.js"
import { hasValidApiKey, requestPath } from "./auth.js"
import {
  cancelJob,
  cleanupExpiredJobs,
  createDownloadJob,
  getJob,
  jobStats,
  openDownload,
  verifySignedDownload,
} from "./jobs.js"
import { commandVersion, probeYtdlp, streamsFromInfo } from "./ytdlp.js"
import { canonicalWatchUrl, requireMp3Quality, requireYoutubeId, sanitizeFilename } from "./validate.js"

const app = Fastify({
  logger: false,
  trustProxy: true,
  bodyLimit: 32 * 1024,
  requestTimeout: config.downloadTimeoutMs + 15_000,
})

await app.register(rateLimit, {
  max: config.rateLimitMax,
  timeWindow: config.rateLimitWindowMs,
  allowList: (request) => requestPath(request) === "/health",
  errorResponseBuilder() {
    return {
      success: false,
      code: "RATE_LIMITED",
      message: "Too many requests. Try again shortly.",
    }
  },
})

app.addHook("onRequest", async (request, reply) => {
  const path = requestPath(request)
  if (path === "/health") return
  if (request.method === "GET" && path.startsWith("/downloads/")) {
    const query = request.query ?? {}
    if (query.sig && query.expires) return
  }
  if (!hasValidApiKey(request)) {
    return reply.code(401).send({
      success: false,
      code: "UNAUTHORIZED",
      message: "Invalid API key.",
    })
  }
})

app.setErrorHandler((error, request, reply) => {
  const mapped = errorPayload(error instanceof AppError ? error : error)
  if (!(error instanceof AppError)) {
    logError("unhandled error", { path: requestPath(request), err: error instanceof Error ? error.message : String(error) })
  }
  reply.code(mapped.status).send({
    success: false,
    code: mapped.code,
    message: mapped.message,
  })
})

app.get("/health", async () => {
  const [ytdlp, ffmpeg] = await Promise.all([
    commandVersion(config.ytdlpBin),
    commandVersion(config.ffmpegBin, ["-version"]),
  ])

  let pot = "disabled"
  if (config.potProviderUrl) {
    try {
      const response = await fetch(config.potProviderUrl, { signal: AbortSignal.timeout(2500) })
      pot = response.ok || response.status < 500 ? "reachable" : `http_${response.status}`
    } catch {
      pot = "unreachable"
    }
  }

  return {
    ok: Boolean(ytdlp && ffmpeg),
    service: "onekit-downloader",
    ytdlp,
    ffmpeg: Boolean(ffmpeg),
    pot,
    jobs: jobStats(),
  }
})

app.post("/youtube/streams", async (request) => {
  const body = request.body && typeof request.body === "object" ? request.body : {}
  const videoId = requireYoutubeId(body.url || body.id)
  const info = await probeYtdlp(canonicalWatchUrl(videoId))
  return { id: videoId, ...streamsFromInfo(info) }
})

app.post(
  "/youtube/download",
  {
    config: {
      rateLimit: {
        max: config.downloadRateLimitMax,
        timeWindow: config.rateLimitWindowMs,
      },
    },
  },
  async (request) => {
    const body = request.body && typeof request.body === "object" ? request.body : {}
    const videoId = requireYoutubeId(body.url || body.id)
    const quality = requireMp3Quality(body.quality ?? body.format)
    const filename = sanitizeFilename(body.filename)
    const job = createDownloadJob({ videoId, quality, filename })
    return { success: true, jobId: job.id, ...job }
  },
)

app.get("/jobs/:id", async (request) => {
  return { success: true, ...getJob(request.params.id) }
})

app.delete("/jobs/:id", async (request) => {
  await cancelJob(request.params.id)
  return { success: true }
})

app.get("/downloads/:id", async (request, reply) => {
  const { id } = request.params
  const query = request.query ?? {}
  if (!hasValidApiKey(request) && !verifySignedDownload(id, query.expires, query.sig)) {
    return reply.code(401).send({
      success: false,
      code: "UNAUTHORIZED",
      message: "Invalid or expired download link.",
    })
  }

  const file = await openDownload(id)
  reply
    .header("Content-Type", "audio/mpeg")
    .header("Content-Length", String(file.bytes))
    .header("Content-Disposition", file.disposition)
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff")

  if (config.onekitOrigin) {
    reply.header("Access-Control-Allow-Origin", config.onekitOrigin)
    reply.header("Access-Control-Expose-Headers", "Content-Disposition, Content-Type, Content-Length")
  }

  return reply.send(file.stream)
})

await mkdir(config.tmpRoot, { recursive: true })
setInterval(() => {
  cleanupExpiredJobs().catch((error) => {
    logError("cleanup failed", { err: error instanceof Error ? error.message : String(error) })
  })
}, 60_000).unref()

try {
  await app.listen({ host: config.host, port: config.port })
  logInfo("downloader listening", { host: config.host, port: config.port })
} catch (error) {
  logError("failed to start", { err: error instanceof Error ? error.message : String(error) })
  process.exit(1)
}
