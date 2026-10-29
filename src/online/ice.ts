// ICE_SERVERS parsing/validation for the online deployment. A malformed value must never reach
// RTCPeerConnection (it throws there and kills voice/video for everyone with a green /healthz).

import type { IceServerConfig } from "../server/server"

/** Fallback STUN when ICE_SERVERS is absent/empty: public STUN keeps the app working out of the box. */
export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
]

const ICE_URL_PATTERN = /^(stuns?|turns?):/i

const isValidEntry = (value: unknown): value is IceServerConfig => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  const urls = entry.urls
  const list = typeof urls === "string" ? [urls] : Array.isArray(urls) ? urls : null
  if (!list || list.length === 0) return false
  if (!list.every((url) => typeof url === "string" && ICE_URL_PATTERN.test(url))) return false
  for (const key of ["username", "credential"] as const) {
    if (entry[key] !== undefined && typeof entry[key] !== "string") return false
  }
  return true
}

/**
 * Parses ICE_SERVERS: a JSON array of RTCIceServer or a comma-separated list of URLs.
 * Anything malformed logs an explicit error and falls back to the default STUN list, so a typo
 * cannot silently break media for the whole deploy. An explicit JSON `[]` disables ICE servers.
 */
export const parseIceServers = (raw: string | undefined, log: (message: string) => void = console.error): IceServerConfig[] => {
  if (raw === undefined || !raw.trim()) return DEFAULT_ICE_SERVERS
  let entries: unknown[]
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      log("[online] ICE_SERVERS inválido: o JSON precisa ser um array; usando STUN padrão")
      return DEFAULT_ICE_SERVERS
    }
    entries = parsed
  } catch {
    // Not JSON: documented alternative is a comma-separated list of URLs.
    entries = raw
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean)
      .map((urls) => ({ urls }))
  }
  if (entries.length === 0) return []
  const servers: IceServerConfig[] = []
  for (const entry of entries) {
    if (!isValidEntry(entry)) {
      log(`[online] ICE_SERVERS inválido (${JSON.stringify(entry)}); usando STUN padrão`)
      return DEFAULT_ICE_SERVERS
    }
    servers.push({
      urls: entry.urls,
      ...(entry.username !== undefined ? { username: entry.username } : {}),
      ...(entry.credential !== undefined ? { credential: entry.credential } : {}),
    })
  }
  return servers
}
