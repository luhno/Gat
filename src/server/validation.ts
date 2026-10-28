import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH } from "../shared/constants"
import type { Direction, HairStyle, PlayerProfile, PlayerState, RtcSignal, UserStatus, Vec2 } from "../shared/types"

// The LAN server is the trust boundary: every message is validated here before it reaches the room.

const HEX_COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const DIRECTIONS: readonly Direction[] = ["down", "up", "left", "right"]
const STATUSES: readonly UserStatus[] = ["available", "busy", "focus"]

const MAX_ID_LENGTH = 64
const MAX_SDP_LENGTH = 12_000
const MAX_ICE_CANDIDATE_LENGTH = 2_000
const MAX_SDP_MID_LENGTH = 256

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const cleanName = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return null
  if (CONTROL_CHARS.test(name)) return null
  return name
}

const cleanColor = (value: unknown): string | null =>
  typeof value === "string" && HEX_COLOR.test(value) ? value : null

const cleanHairStyle = (value: unknown): HairStyle | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3 ? (value as HairStyle) : null

const cleanStatus = (value: unknown): UserStatus | null =>
  typeof value === "string" && (STATUSES as readonly string[]).includes(value) ? (value as UserStatus) : null

/** Strict profile validation used by `join`; returns null when any field is invalid. */
export const sanitizeProfile = (value: unknown): PlayerProfile | null => {
  if (!isRecord(value)) return null
  const name = cleanName(value.name)
  const shirtColor = cleanColor(value.shirtColor)
  const skinTone = cleanColor(value.skinTone)
  const hairStyle = cleanHairStyle(value.hairStyle)
  const status = cleanStatus(value.status)
  if (!name || !shirtColor || !skinTone || hairStyle === null || !status) return null
  return { name, shirtColor, skinTone, hairStyle, status }
}

/** Lenient `profile` patch: valid fields are applied, invalid ones dropped; null when nothing survives. */
export const sanitizeProfilePatch = (value: unknown): Partial<PlayerProfile> | null => {
  if (!isRecord(value)) return null
  const patch: Partial<PlayerProfile> = {}
  const name = cleanName(value.name)
  if (name) patch.name = name
  const shirtColor = cleanColor(value.shirtColor)
  if (shirtColor) patch.shirtColor = shirtColor
  const skinTone = cleanColor(value.skinTone)
  if (skinTone) patch.skinTone = skinTone
  const hairStyle = cleanHairStyle(value.hairStyle)
  if (hairStyle !== null) patch.hairStyle = hairStyle
  const status = cleanStatus(value.status)
  if (status) patch.status = status
  return Object.keys(patch).length > 0 ? patch : null
}

type MediaPatch = Partial<Pick<PlayerState, "audioEnabled" | "videoEnabled" | "screenSharing">>

export const sanitizeMediaPatch = (value: unknown): MediaPatch | null => {
  if (!isRecord(value)) return null
  const patch: MediaPatch = {}
  for (const key of ["audioEnabled", "videoEnabled", "screenSharing"] as const) {
    if (typeof value[key] === "boolean") patch[key] = value[key]
  }
  return Object.keys(patch).length > 0 ? patch : null
}

export interface MoveIntent extends Vec2 {
  dir: Direction
  moving: boolean
}

export const validateMove = (value: unknown): MoveIntent | null => {
  if (!isRecord(value)) return null
  if (typeof value.x !== "number" || !Number.isFinite(value.x)) return null
  if (typeof value.y !== "number" || !Number.isFinite(value.y)) return null
  if (!DIRECTIONS.includes(value.dir as Direction)) return null
  if (typeof value.moving !== "boolean") return null
  return { x: value.x, y: value.y, dir: value.dir as Direction, moving: value.moving }
}

/** Chat text: control characters stripped, trimmed, 1..MAX_CHAT_LENGTH. */
export const validateChat = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim()
  if (text.length === 0 || text.length > MAX_CHAT_LENGTH) return null
  return text
}

/** RtcSignal validation: only the three known kinds, bounded strings/indices. */
export const validateSignal = (value: unknown): { to: string; data: RtcSignal } | null => {
  if (!isRecord(value)) return null
  const to = value.to
  if (typeof to !== "string" || to.length === 0 || to.length > MAX_ID_LENGTH) return null
  const data = value.data
  if (!isRecord(data)) return null
  if (data.kind === "offer" || data.kind === "answer") {
    const sdp = data.sdp
    if (typeof sdp !== "string" || sdp.length === 0 || sdp.length > MAX_SDP_LENGTH) return null
    return { to, data: { kind: data.kind, sdp } }
  }
  if (data.kind === "ice") {
    const candidate = data.candidate
    if (candidate === null) return { to, data: { kind: "ice", candidate: null } }
    if (!isRecord(candidate)) return null
    const raw = candidate.candidate
    if (typeof raw !== "string" || raw.length > MAX_ICE_CANDIDATE_LENGTH) return null
    const sdpMid = candidate.sdpMid
    if (!(sdpMid === null || (typeof sdpMid === "string" && sdpMid.length <= MAX_SDP_MID_LENGTH))) return null
    const sdpMLineIndex = candidate.sdpMLineIndex
    const validIndex =
      sdpMLineIndex === null ||
      (typeof sdpMLineIndex === "number" && Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0 && sdpMLineIndex <= 1024)
    if (!validIndex) return null
    return { to, data: { kind: "ice", candidate: { candidate: raw, sdpMid, sdpMLineIndex } } }
  }
  return null
}

export const validatePing = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

export interface RateLimiter {
  take(): boolean
}

/** Sliding-window limiter: at most `max` takes per `windowMs`. */
export const createRateLimiter = (max: number, windowMs: number, now: () => number = Date.now): RateLimiter => {
  const hits: number[] = []
  return {
    take() {
      const at = now()
      while (hits.length > 0 && at - hits[0]! >= windowMs) hits.shift()
      if (hits.length >= max) return false
      hits.push(at)
      return true
    },
  }
}
