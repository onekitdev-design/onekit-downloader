import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, rm, stat } from "node:fs/promises"
import path from "node:path"
import { config } from "./config.js"
import { AppError } from "./errors.js"
import { logError, logInfo } from "./logger.js"
import { convertToMp3 } from "./ytdlp.js"
import { canonicalWatchUrl, escapeContentDisposition, sanitizeFilename } from "./validate.js"

const jobs = new Map()
const waiters = []
let active = 0

function jobDir(id) {
  return path.join(config.tmpRoot, id)
}

function signDownload(id, expires) {
  return createHmac("sha256", config.apiKey).update(`${id}.${expires}`).digest("hex")
}

export function createSignedDownloadPath(id) {
  const expires = Date.now() + Math.min(config.jobTtlMs, 10 * 60 * 1000)
  const sig = signDownload(id, expires)
  return `/downloads/${id}?expires=${expires}&sig=${sig}`
}

export function verifySignedDownload(id, expires, sig) {
  const exp = Number.parseInt(String(expires ?? ""), 10)
  if (!Number.isFinite(exp) || Date.now() > exp) return false
  const expected = Buffer.from(signDownload(id, exp))
  const provided = Buffer.from(String(sig ?? ""))
  if (expected.length !== provided.length) return false
  try {
    return timingSafeEqual(expected, provided)
  } catch {
    return false
  }
}

async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true })
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    filename: job.filename,
    ...(job.status === "completed" ? { downloadPath: createSignedDownloadPath(job.id) } : {}),
    ...(job.status === "failed"
      ? { error: { code: job.errorCode, message: job.errorMessage } }
      : {}),
  }
}

async function findMp3(dir) {
  const entries = await readdir(dir)
  const mp3 = entries.find((name) => name.toLowerCase().endsWith(".mp3"))
  return mp3 ? path.join(dir, mp3) : null
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    waiters.push({ task, resolve, reject })
    pump()
  })
}

function pump() {
  while (active < config.maxActiveJobs && waiters.length > 0) {
    const next = waiters.shift()
    active += 1
    Promise.resolve()
      .then(next.task)
      .then(next.resolve, next.reject)
      .finally(() => {
        active -= 1
        pump()
      })
  }
}

async function runDownload(job) {
  job.status = "running"
  job.progress = 5
  const dir = jobDir(job.id)
  await mkdir(dir, { recursive: true })
  const outputTemplate = path.join(dir, "audio.%(ext)s")

  await convertToMp3({
    videoUrl: canonicalWatchUrl(job.videoId),
    outputTemplate,
    qualityKbps: job.quality,
    cwd: dir,
    onProgress(value) {
      job.progress = value
    },
    signal: job.controller.signal,
  })

  const filePath = await findMp3(dir)
  if (!filePath) {
    throw new AppError("FFMPEG_FAILED", "Audio conversion finished without an MP3 file.", 500)
  }

  const info = await stat(filePath)
  if (info.size <= 0) {
    throw new AppError("FFMPEG_FAILED", "Audio conversion finished empty.", 500)
  }
  if (info.size > config.maxDownloadMb * 1024 * 1024) {
    throw new AppError("FILE_TOO_LARGE", "This video is larger than the allowed download size.", 413)
  }

  job.filePath = filePath
  job.bytes = info.size
  job.status = "completed"
  job.progress = 100
  logInfo("job completed", { id: job.id, bytes: info.size })
}

export function createDownloadJob({ videoId, quality, filename }) {
  if (jobs.size >= config.maxQueuedJobs) {
    throw new AppError("RESOURCE_EXHAUSTED", "The downloader is busy. Try again in a moment.", 503)
  }

  const id = randomUUID()
  const job = {
    id,
    videoId,
    quality,
    filename: sanitizeFilename(filename),
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.jobTtlMs,
    filePath: null,
    bytes: 0,
    errorCode: null,
    errorMessage: null,
    servedAt: null,
    controller: new AbortController(),
  }
  jobs.set(id, job)
  logInfo("job queued", { id, videoId, quality })

  enqueue(async () => {
    try {
      await runDownload(job)
    } catch (error) {
      job.status = "failed"
      job.errorCode = error instanceof AppError ? error.code : "YTDLP_FAILED"
      job.errorMessage =
        error instanceof AppError ? error.message : "Unable to retrieve this YouTube video right now."
      logError("job failed", { id: job.id, code: job.errorCode })
      await removeDir(jobDir(job.id)).catch(() => undefined)
    }
  }).catch(() => undefined)

  return publicJob(job)
}

export function getJob(id) {
  const job = jobs.get(id)
  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "That download job was not found or has expired.", 404)
  }
  return publicJob(job)
}

export async function openDownload(id) {
  const job = jobs.get(id)
  if (!job) {
    throw new AppError("JOB_NOT_FOUND", "That download job was not found or has expired.", 404)
  }
  if (job.status === "failed") {
    throw new AppError(job.errorCode || "YTDLP_FAILED", job.errorMessage || "Download failed.", 502)
  }
  if (job.status !== "completed" || !job.filePath) {
    throw new AppError("JOB_NOT_READY", "This download is still processing.", 409)
  }

  const stream = createReadStream(job.filePath)
  job.servedAt = Date.now()
  job.expiresAt = Date.now() + 30_000

  stream.on("close", () => {
    job.expiresAt = Date.now() + 15_000
  })

  return {
    stream,
    bytes: job.bytes,
    filename: job.filename,
    disposition: escapeContentDisposition(job.filename),
  }
}

export async function cancelJob(id) {
  const job = jobs.get(id)
  if (!job) return
  job.controller.abort()
  jobs.delete(id)
  await removeDir(jobDir(id)).catch(() => undefined)
}

export async function cleanupExpiredJobs() {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (now <= job.expiresAt) continue
    jobs.delete(id)
    await removeDir(jobDir(id)).catch(() => undefined)
    logInfo("job cleaned", { id })
  }
}

export function jobStats() {
  return { active, queued: waiters.length, tracked: jobs.size }
}
