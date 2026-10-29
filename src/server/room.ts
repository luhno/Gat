import { randomUUID } from "node:crypto"

import {
  CHAT_RATE_MAX,
  CHAT_RATE_WINDOW_MS,
  MAX_MOVE_STEP_PX,
  MAX_PLAYERS,
  MEDIA_RATE_MAX,
  MEDIA_RATE_WINDOW_MS,
  MOVE_BUDGET_FACTOR,
  MOVE_RATE_MAX,
  MOVE_RATE_WINDOW_MS,
  PROFILE_RATE_MAX,
  PROFILE_RATE_WINDOW_MS,
  PROXIMITY_EXIT_TILES,
  SIGNAL_RATE_MAX,
  SIGNAL_RATE_WINDOW_MS,
  SOUNDBOARD_RATE_MAX,
  SOUNDBOARD_RATE_WINDOW_MS,
  WALK_SPEED_PX_PER_S,
} from "../shared/constants"
import { DEFAULT_MAP } from "../shared/defaultMap"
import { PROTOCOL_VERSION } from "../shared/protocol"
import type { ClientMessage, ServerMessage } from "../shared/protocol"
import type { OfficeMap, PlayerState } from "../shared/types"
import { findSpawn, resolveMovement } from "./collision"
import {
  createRateLimiter,
  sanitizeMediaPatch,
  sanitizeProfile,
  sanitizeProfilePatch,
  sanitizeSoundboardChunk,
  validateChat,
  validateMove,
  validatePing,
  validateSignal,
  type RateLimiter,
} from "./validation"

/** Transport side of one connected player; `startRoomServer` wires it to a WebSocket. */
export interface RoomClient {
  send(message: ServerMessage): void
  close(): void
}

export type JoinResult = { ok: true; id: string; session: string } | { ok: false; code: string; message: string }

export interface RoomOptions {
  name?: string
  map?: OfficeMap
  now?: () => number
  createId?: () => string
  random?: () => number
  /** How long a disconnected player keeps their slot/state for a resume (default 30 s). */
  graceMs?: number
}

export interface Room {
  readonly id: string
  readonly name: string
  readonly map: OfficeMap
  join(client: RoomClient, message: { protocol: unknown; profile: unknown; session?: unknown }): JoinResult
  handle(id: string, message: ClientMessage): void
  leave(id: string): void
  /** Keep the player for a short grace period so a reconnecting client can resume. */
  detach(id: string): void
  /** Clear pending grace timers (server shutdown). */
  close(): void
  size(): number
}

interface Entry {
  state: PlayerState
  client: RoomClient
  moveLimiter: RateLimiter
  chatLimiter: RateLimiter
  soundboardLimiter: RateLimiter
  signalLimiter: RateLimiter
  profileLimiter: RateLimiter
  mediaLimiter: RateLimiter
  /** Movement budget in pixels: refilled at walk speed × factor, capped at MAX_MOVE_STEP_PX. */
  moveBudget: number
  lastMoveAt: number
  session: string
  disconnected: boolean
  expiry: ReturnType<typeof setTimeout> | null
}

export const createRoom = (options: RoomOptions = {}): Room => {
  const map = options.map ?? DEFAULT_MAP
  const name = options.name ?? "Escritório offline"
  const now = options.now ?? Date.now
  const createId = options.createId ?? randomUUID
  const random = options.random ?? Math.random
  const graceMs = options.graceMs ?? 30_000
  const id = randomUUID()
  const players = new Map<string, Entry>()

  const broadcast = (message: ServerMessage): void => {
    for (const entry of players.values()) entry.client.send(message)
  }

  /** Positions are world pixels; proximity rules are in tiles. */
  const isNear = (a: PlayerState, b: PlayerState): boolean =>
    Math.hypot(a.x - b.x, a.y - b.y) / map.tileSize <= PROXIMITY_EXIT_TILES

  const sendWelcome = (client: RoomClient, state: PlayerState, session: string): void => {
    client.send({
      t: "welcome",
      protocol: PROTOCOL_VERSION,
      session,
      you: { ...state },
      players: [...players.values()].map((other) => ({ ...other.state })),
      map,
      room: { id, name },
      serverTime: now(),
    })
  }

  const join: Room["join"] = (client, message) => {
    if (message.protocol !== PROTOCOL_VERSION) {
      return { ok: false, code: "protocol_mismatch", message: `Versão de protocolo incompatível (esperado ${PROTOCOL_VERSION}).` }
    }

    // A reconnecting client sends its previous session token: reattach the same player (and
    // position) instead of spawning a new one. The slot was kept by detach().
    const requestedSession = typeof message.session === "string" ? message.session : null
    if (requestedSession) {
      for (const candidate of players.values()) {
        if (!candidate.disconnected || candidate.session !== requestedSession) continue
        if (candidate.expiry) clearTimeout(candidate.expiry)
        candidate.expiry = null
        candidate.disconnected = false
        candidate.client = client
        sendWelcome(client, candidate.state, candidate.session)
        return { ok: true, id: candidate.state.id, session: candidate.session }
      }
    }

    const profile = sanitizeProfile(message.profile)
    if (!profile) return { ok: false, code: "invalid_profile", message: "Perfil inválido." }
    if (players.size >= MAX_PLAYERS) {
      // A detached player still holds a slot for the grace period; free the oldest phantom slot
      // instead of refusing the newcomer (closing a tab does not send `leave`).
      const disconnected = [...players.values()].find((entry) => entry.disconnected)
      if (!disconnected) {
        return { ok: false, code: "room_full", message: `A sala está cheia (máximo de ${MAX_PLAYERS} jogadores).` }
      }
      removePlayer(disconnected.state.id)
    }
    const spot = findSpawn(map, [...players.values()].map((entry) => entry.state), random)
    const state: PlayerState = {
      id: createId(),
      ...profile,
      x: spot.x,
      y: spot.y,
      dir: "down",
      moving: false,
      audioEnabled: false,
      videoEnabled: false,
      screenSharing: false,
    }
    const entry: Entry = {
      state,
      client,
      moveLimiter: createRateLimiter(MOVE_RATE_MAX, MOVE_RATE_WINDOW_MS, now),
      chatLimiter: createRateLimiter(CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS, now),
      soundboardLimiter: createRateLimiter(SOUNDBOARD_RATE_MAX, SOUNDBOARD_RATE_WINDOW_MS, now),
      signalLimiter: createRateLimiter(SIGNAL_RATE_MAX, SIGNAL_RATE_WINDOW_MS, now),
      profileLimiter: createRateLimiter(PROFILE_RATE_MAX, PROFILE_RATE_WINDOW_MS, now),
      mediaLimiter: createRateLimiter(MEDIA_RATE_MAX, MEDIA_RATE_WINDOW_MS, now),
      moveBudget: MAX_MOVE_STEP_PX,
      lastMoveAt: now(),
      session: createId(),
      disconnected: false,
      expiry: null,
    }
    players.set(state.id, entry)

    // The new player already carries the full state in its welcome, so it only needs broadcasts
    // for players that join later; everyone already in the room learns about it via playerJoined.
    sendWelcome(client, state, entry.session)
    for (const other of players.values()) {
      if (other !== entry) other.client.send({ t: "playerJoined", player: { ...state } })
    }
    return { ok: true, id: state.id, session: entry.session }
  }

  const removePlayer = (playerId: string): void => {
    const entry = players.get(playerId)
    if (!entry) return
    if (entry.expiry) clearTimeout(entry.expiry)
    players.delete(playerId)
    broadcast({ t: "playerLeft", id: playerId })
  }

  const handle: Room["handle"] = (playerId, message) => {
    const entry = players.get(playerId)
    if (!entry) return
    switch (message.t) {
      case "join": {
        entry.client.send({ t: "error", code: "already_joined", message: "Esta conexão já entrou na sala." })
        entry.client.close()
        return
      }
      case "leave": {
        removePlayer(playerId)
        return
      }
      case "soundboard": {
        const chunk = sanitizeSoundboardChunk(message)
        if (!chunk || !entry.soundboardLimiter.take()) return
        for (const other of players.values()) {
          if (other === entry || other.disconnected) continue
          if (!isNear(entry.state, other.state)) continue
          other.client.send({ t: "soundboard", from: playerId, ...chunk })
        }
        return
      }
      case "move": {
        const intent = validateMove(message)
        if (!intent || !entry.moveLimiter.take()) return
        // Movement authority: a budget refilled at 3x walking speed lets a client catch up after
        // lag/jitter but blocks teleporting (MAX_MOVE_STEP_PX is the burst cap and budget ceiling).
        const at = now()
        const elapsedSeconds = Math.max(0, at - entry.lastMoveAt) / 1000
        entry.lastMoveAt = at
        entry.moveBudget = Math.min(
          MAX_MOVE_STEP_PX,
          entry.moveBudget + WALK_SPEED_PX_PER_S * MOVE_BUDGET_FACTOR * elapsedSeconds,
        )
        const distance = Math.hypot(intent.x - entry.state.x, intent.y - entry.state.y)
        if (distance > entry.moveBudget) return
        entry.moveBudget -= distance
        const next = resolveMovement(map, entry.state, intent)
        entry.state = { ...entry.state, x: next.x, y: next.y, dir: intent.dir, moving: intent.moving }
        broadcast({ t: "playerMoved", id: playerId, x: next.x, y: next.y, dir: intent.dir, moving: intent.moving })
        return
      }
      case "profile": {
        const patch = sanitizeProfilePatch(message.patch)
        if (!patch || !entry.profileLimiter.take()) return
        entry.state = { ...entry.state, ...patch }
        broadcast({ t: "playerUpdated", id: playerId, patch })
        return
      }
      case "media": {
        const patch = sanitizeMediaPatch(message.patch)
        if (!patch || !entry.mediaLimiter.take()) return
        entry.state = { ...entry.state, ...patch }
        broadcast({ t: "playerUpdated", id: playerId, patch })
        return
      }
      case "chat": {
        const text = validateChat(message.text)
        if (!text || !entry.chatLimiter.take()) return
        broadcast({
          t: "chat",
          message: {
            id: createId(),
            from: playerId,
            name: entry.state.name,
            shirtColor: entry.state.shirtColor,
            text,
            at: now(),
          },
        })
        return
      }
      case "signal": {
        const signal = validateSignal(message)
        if (!signal || signal.to === playerId || !entry.signalLimiter.take()) return
        const target = players.get(signal.to)
        if (!target) return
        // Peers negotiate media only in proximity; screen share legitimately connects everyone.
        if (!entry.state.screenSharing && !target.state.screenSharing && !isNear(entry.state, target.state)) return
        target.client.send({ t: "signal", from: playerId, data: signal.data })
        return
      }
      case "ping": {
        const at = validatePing(message.at)
        if (at === null) return
        entry.client.send({ t: "pong", at, serverTime: now() })
        return
      }
    }
  }

  const leave: Room["leave"] = (playerId) => {
    removePlayer(playerId)
  }

  const detach: Room["detach"] = (playerId) => {
    const entry = players.get(playerId)
    if (!entry || entry.disconnected) return
    entry.disconnected = true
    const timer = setTimeout(() => {
      const current = players.get(playerId)
      if (!current || !current.disconnected) return
      removePlayer(playerId)
    }, graceMs)
    // Do not keep the process alive only for a grace timer.
    const unref = (timer as unknown as { unref?: () => void }).unref
    if (typeof unref === "function") unref.call(timer)
    entry.expiry = timer
  }

  const close: Room["close"] = () => {
    for (const entry of players.values()) {
      if (entry.expiry) clearTimeout(entry.expiry)
      entry.expiry = null
    }
  }

  return { id, name, map, join, handle, leave, detach, close, size: () => players.size }
}
