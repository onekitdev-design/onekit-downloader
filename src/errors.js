export class AppError extends Error {
  constructor(code, message, status = 502, details) {
    super(message)
    this.name = "AppError"
    this.code = code
    this.status = status
    this.details = details
  }
}

export function errorPayload(error) {
  if (error instanceof AppError) {
    return {
      success: false,
      code: error.code,
      message: error.message,
      status: error.status,
    }
  }
  return {
    success: false,
    code: "INTERNAL_ERROR",
    message: "The downloader could not complete this request.",
    status: 500,
  }
}

export function mapYtdlpError(raw) {
  const text = String(raw ?? "")
  const lower = text.toLowerCase()

  if (lower.includes("private video") || lower.includes("this video is private")) {
    return new AppError("PRIVATE_VIDEO", "This video is private and cannot be downloaded.", 404)
  }
  if (lower.includes("video unavailable") || lower.includes("unavailable")) {
    return new AppError("UNAVAILABLE", "This video is unavailable.", 404)
  }
  if (lower.includes("sign in to confirm your age") || lower.includes("age-restricted") || lower.includes("age restricted")) {
    return new AppError("AGE_RESTRICTED", "This video is age-restricted and cannot be retrieved.", 403)
  }
  if (
    lower.includes("not made this video available in your country") ||
    lower.includes("not available in your country") ||
    lower.includes("geo restricted") ||
    lower.includes("region-locked")
  ) {
    return new AppError("GEO_RESTRICTED", "This video is not available in the downloader region.", 403)
  }
  if (lower.includes("po token") || lower.includes("potoken") || lower.includes("pot provider")) {
    return new AppError("POT_TOKEN_FAILED", "Unable to retrieve this YouTube video right now.", 502)
  }
  if (
    lower.includes("sign in to confirm you’re not a bot") ||
    lower.includes("sign in to confirm you're not a bot") ||
    lower.includes("not a bot") ||
    lower.includes("http error 429") ||
    lower.includes("too many requests")
  ) {
    return new AppError("YOUTUBE_RATE_LIMITED", "YouTube is temporarily limiting this server. Try again later.", 502)
  }
  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("deadline")) {
    return new AppError("TIMEOUT", "The downloader timed out while contacting YouTube.", 504)
  }
  if (lower.includes("ffmpeg") || lower.includes("postprocessor")) {
    return new AppError("FFMPEG_FAILED", "Audio conversion failed. Try another quality.", 500)
  }
  if (lower.includes("file is larger than max-filesize") || lower.includes("too large")) {
    return new AppError("FILE_TOO_LARGE", "This video is larger than the allowed download size.", 413)
  }
  if (lower.includes("enoent") || lower.includes("not found")) {
    return new AppError("YTDLP_FAILED", "The downloader is not installed correctly.", 503)
  }

  return new AppError("YOUTUBE_EXTRACTION_FAILED", "Unable to retrieve this YouTube video right now.", 502)
}
