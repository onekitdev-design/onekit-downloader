import { spawn } from "node:child_process"
import { config } from "./config.js"
import { AppError, mapYtdlpError } from "./errors.js"
import { logError } from "./logger.js"
import { pickMp3Qualities, sourceAudioKbps, toAudioStreams } from "./qualities.js"

function ytdlpBaseArgs() {
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--no-progress",
    "--geo-bypass",
    "--js-runtimes",
    `node:${config.nodeBin}`,
    "--extractor-args",
    `youtube:player_client=${config.playerClient}`,
  ]
  if (config.potProviderUrl) {
    args.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${config.potProviderUrl}`)
  }
  if (config.forceIpv4) args.push("--force-ipv4")
  return args
}

function runCommand(bin, args, { timeoutMs, cwd, onStderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const stop = (reason) => {
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 3000)
      if (!settled) {
        settled = true
        reject(reason)
      }
    }

    const timer = setTimeout(() => {
      stop(new AppError("TIMEOUT", "The downloader timed out while contacting YouTube.", 504))
    }, timeoutMs)

    const onAbort = () => {
      stop(new AppError("CANCELLED", "Download cancelled.", 499))
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString()
      stderr += text
      onStderr?.(text)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (settled) return
      settled = true
      reject(mapYtdlpError(error.message))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      if (settled) return
      settled = true
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

export async function probeYtdlp(videoUrl) {
  const args = [...ytdlpBaseArgs(), "--dump-single-json", "--skip-download", videoUrl]
  const result = await runCommand(config.ytdlpBin, args, { timeoutMs: config.extractTimeoutMs })
  if (result.code !== 0) {
    logError("yt-dlp extract failed", { code: result.code, stderr: result.stderr.slice(0, 2000) })
    throw mapYtdlpError(result.stderr || result.stdout)
  }

  let info
  try {
    info = JSON.parse(result.stdout)
  } catch {
    logError("yt-dlp returned invalid JSON", { stdout: result.stdout.slice(0, 400) })
    throw new AppError("YOUTUBE_EXTRACTION_FAILED", "Unable to retrieve this YouTube video right now.", 502)
  }

  return info
}

export function streamsFromInfo(info) {
  const duration = typeof info.duration === "number" ? info.duration : undefined
  if (duration && duration > config.maxDurationSeconds) {
    throw new AppError(
      "FILE_TOO_LARGE",
      "This video is longer than the allowed download length.",
      413,
    )
  }

  const qualities = pickMp3Qualities(sourceAudioKbps(info.formats))
  return {
    success: true,
    title: typeof info.title === "string" && info.title.trim() ? info.title : "YouTube video",
    uploader: typeof info.uploader === "string" ? info.uploader : undefined,
    thumbnail: typeof info.thumbnail === "string" ? info.thumbnail : undefined,
    duration,
    videoStreams: [],
    audioStreams: toAudioStreams(qualities),
  }
}

export async function convertToMp3({ videoUrl, outputTemplate, qualityKbps, cwd, onProgress, signal }) {
  const args = [
    ...ytdlpBaseArgs(),
    "--ffmpeg-location",
    config.ffmpegBin,
    "-f",
    "bestaudio/best",
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    `${qualityKbps}K`,
    "--postprocessor-args",
    "FFmpegExtractAudio:-vn",
    "--no-embed-thumbnail",
    "--max-filesize",
    `${config.maxDownloadMb}M`,
    "-o",
    outputTemplate,
    videoUrl,
  ]

  const result = await runCommand(config.ytdlpBin, args, {
    timeoutMs: config.downloadTimeoutMs,
    cwd,
    signal,
    onStderr(text) {
      const match = /\[download\]\s+(\d{1,3}(?:\.\d+)?)%/.exec(text)
      if (match) {
        const percent = Number.parseFloat(match[1])
        if (Number.isFinite(percent)) onProgress?.(Math.min(90, Math.round(percent)))
      }
      if (text.toLowerCase().includes("extractaudio") || text.toLowerCase().includes("destination")) {
        onProgress?.(92)
      }
    },
  })

  if (result.code !== 0) {
    logError("yt-dlp download failed", { code: result.code, stderr: result.stderr.slice(0, 2000) })
    throw mapYtdlpError(result.stderr || result.stdout)
  }
}

export async function commandVersion(bin, args = ["--version"]) {
  try {
    const result = await runCommand(bin, args, { timeoutMs: 10_000 })
    if (result.code !== 0) return null
    return result.stdout.trim().split(/\r?\n/, 1)[0] || null
  } catch {
    return null
  }
}
