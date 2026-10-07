const SECRET_HEADER = /^(x-api-key|authorization)$/i

function redactHeaders(headers) {
  if (!headers || typeof headers !== "object") return {}
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SECRET_HEADER.test(key) ? "[redacted]" : value
  }
  return out
}

export function logInfo(message, extra) {
  console.log(JSON.stringify({ level: "info", message, ...extra, time: new Date().toISOString() }))
}

export function logError(message, extra) {
  console.error(JSON.stringify({ level: "error", message, ...extra, time: new Date().toISOString() }))
}

export function logRequest(request, extra) {
  logInfo("request", {
    method: request.method,
    url: request.url.split("?")[0],
    headers: redactHeaders(request.headers),
    ...extra,
  })
}
