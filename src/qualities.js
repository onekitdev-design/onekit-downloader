export const MP3_QUALITIES = [128, 192, 256, 320]

export function sourceAudioKbps(formats) {
  let max = 0
  for (const format of formats ?? []) {
    const hasAudio = Boolean(format?.acodec && format.acodec !== "none")
    if (!hasAudio) continue
    const videoCodec = format.vcodec
    const audioOnly = !videoCodec || videoCodec === "none"
    const kbps = Number(format.abr) || (audioOnly ? Number(format.tbr) : 0) || 0
    if (kbps > max) max = kbps
  }
  return max
}

/** Only expose MP3 bitrates that the source can reasonably support. */
export function pickMp3Qualities(sourceKbps) {
  const source = Number.isFinite(sourceKbps) ? sourceKbps : 0
  if (source <= 0) return [128, 192]

  const picks = [128]
  if (source >= 160) picks.push(192)
  if (source >= 224) picks.push(256)
  if (source >= 280) picks.push(320)
  return picks
}

export function qualityLabel(kbps) {
  if (kbps >= 320) return "Maximum"
  if (kbps >= 256) return "Very high"
  if (kbps >= 192) return "High"
  return "Standard"
}

export function toAudioStreams(qualities) {
  return qualities.map((kbps) => ({
    streamId: String(kbps),
    url: `https://onekit.invalid/mp3/${kbps}`,
    quality: qualityLabel(kbps),
    format: "mp3",
    mimeType: "audio/mpeg",
    muxedVideo: false,
    bitrate: kbps * 1000,
  }))
}
