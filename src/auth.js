import { timingSafeEqual } from "node:crypto"
import { config } from "./config.js"

function safeEqual(left, right) {
  const a = Buffer.from(String(left))
  const b = Buffer.from(String(right))
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function readApiKey(request) {
  const header = request.headers["x-api-key"]
  if (typeof header === "string" && header.trim()) return header.trim()
  const auth = request.headers.authorization
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim()
  }
  return ""
}

export function hasValidApiKey(request) {
  const provided = readApiKey(request)
  return Boolean(provided) && safeEqual(provided, config.apiKey)
}

export function requestPath(request) {
  return String(request.url ?? "").split("?")[0]
}
