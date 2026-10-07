import assert from "node:assert/strict"
import { test } from "node:test"
import { pickMp3Qualities, sourceAudioKbps, toAudioStreams } from "./qualities.js"

test("pickMp3Qualities stays at or below the source", () => {
  assert.deepEqual(pickMp3Qualities(96), [128])
  assert.deepEqual(pickMp3Qualities(128), [128])
  assert.deepEqual(pickMp3Qualities(192), [128, 192])
  assert.deepEqual(pickMp3Qualities(256), [128, 192, 256])
  assert.deepEqual(pickMp3Qualities(320), [128, 192, 256, 320])
  assert.deepEqual(pickMp3Qualities(0), [128, 192])
})

test("sourceAudioKbps prefers audio-only bitrates", () => {
  assert.equal(
    sourceAudioKbps([
      { acodec: "opus", vcodec: "none", abr: 160 },
      { acodec: "aac", vcodec: "avc1", tbr: 800 },
    ]),
    160,
  )
})

test("toAudioStreams matches the OneKit frontend contract", () => {
  const [stream] = toAudioStreams([192])
  assert.equal(stream.streamId, "192")
  assert.equal(stream.format, "mp3")
  assert.equal(stream.mimeType, "audio/mpeg")
  assert.equal(stream.bitrate, 192000)
  assert.equal(stream.muxedVideo, false)
})
