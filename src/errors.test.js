import assert from "node:assert/strict"
import { test } from "node:test"
import { mapYtdlpError } from "./errors.js"

test("mapYtdlpError hides raw yt-dlp output", () => {
  const bot = mapYtdlpError("ERROR: [youtube] Sign in to confirm you’re not a bot. stacktrace")
  assert.equal(bot.code, "YOUTUBE_RATE_LIMITED")
  assert.equal(bot.message.includes("Sign in"), false)

  const priv = mapYtdlpError("ERROR: Private video")
  assert.equal(priv.code, "PRIVATE_VIDEO")
  assert.equal(priv.status, 404)

  const generic = mapYtdlpError("some unexpected extractor dump")
  assert.equal(generic.code, "YOUTUBE_EXTRACTION_FAILED")
  assert.equal(generic.message, "Unable to retrieve this YouTube video right now.")
})
