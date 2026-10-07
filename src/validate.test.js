import assert from "node:assert/strict"
import { test } from "node:test"
import { parseYoutubeVideoId, requireMp3Quality, sanitizeFilename } from "./validate.js"

test("parseYoutubeVideoId accepts common URLs", () => {
  assert.equal(parseYoutubeVideoId("https://youtu.be/b8I-7Wk_Vbc"), "b8I-7Wk_Vbc")
  assert.equal(parseYoutubeVideoId("https://www.youtube.com/watch?v=b8I-7Wk_Vbc"), "b8I-7Wk_Vbc")
  assert.equal(parseYoutubeVideoId("not-a-url"), null)
})

test("requireMp3Quality rejects unknown values", () => {
  assert.equal(requireMp3Quality("192"), "192")
  assert.throws(() => requireMp3Quality("140"))
})

test("sanitizeFilename strips injection characters", () => {
  assert.equal(sanitizeFilename("../../etc/passwd;rm"), "_.._etc_passwd_rm.mp3")
  assert.equal(sanitizeFilename("Song Title.mp3"), "Song Title.mp3")
})
