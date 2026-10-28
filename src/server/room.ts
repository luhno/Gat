import { randomUUID } from "node:crypto"

import { CHAT_RATE_MAX, CHAT_RATE_WINDOW_MS, MAX_PLAYERS, MOVE_RATE_MAX, MOVE_RATE_WINDOW_MS } from "../shared/constants"
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

export type JoinResult = { ok: true; id: string } | { ok: false; code: string; message: string }

export interface RoomOptions {
  name?: string
  map?: OfficeMap
  now?: () => number
  createId?: () => string
  random?: () => number
}

export interface Room {
  readonly id: string
  readonly name: string
  readonly map: OfficeMap
  join(client: RoomClient, message: { protocol: unknown; profile: unknown }): JoinResult
  handle(id: string, message: ClientMessage): void
  leave(id: string): void
  size(): number
}

interface Entry {
  state: PlayerState
  client: RoomClient
  moveLimiter: RateLimiter
  chatLimiter: RateLimiter
}

export const createRoom = (options: RoomOptions = {}): Room => {
  const map = options.map ?? DEFAULT_MAP
  const name = options.name ?? "Escritório offline"
  const now = options.now ?? Date.now
  const createId = options.createId ?? randomUUID
  const random = options.random ?? Math.random
  const id = randomUUID()
  const players = new Map<string, Entry>()

  const broadcast = (message: ServerMessage): void => {
    for (const entry of players.values()) entry.client.send(message)
  }

  const join: Room["join"] = (client, message) => {
    if (message.protocol !== PROTOCOL_VERSION) {
      return { ok: false, code: "protocol_mismatch", message: `Versão de protocolo incompatível (esperado ${PROTOCOL_VERSION}).` }
    }
    const profile = sanitizeProfile(message.profile)
    if (!profile) return { ok: false, code: "invalid_profile", message: "Perfil inválido." }
    if (players.size >= MAX_PLAYERS) {
      return { ok: false, code: "room_full", message: `A sala está cheia (máximo de ${MAX_PLAYERS} jogadores).` }
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
    }
    players.set(state.id, entry)

    // The new player already carries the full state in its welcome, so it only needs broadcasts
    // for players that join later; everyone already in the room learns about it via playerJoined.
    client.send({
      t: "welcome",
      protocol: PROTOCOL_VERSION,
      you: { ...state },
      players: [...players.values()].map((other) => ({ ...other.state })),
      map,
      room: { id, name },
      serverTime: now(),
    })
    for (const other of players.values()) {
      if (other !== entry) other.client.send({ t: "playerJoined", player: { ...state } })
    }
    return { ok: true, id: state.id }
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
      case "move": {
        const intent = validateMove(message)
        if (!intent || !entry.moveLimiter.take()) return
        const next = resolveMovement(map, entry.state, intent)
        entry.state = { ...entry.state, x: next.x, y: next.y, dir: intent.dir, moving: intent.moving }
        broadcast({ t: "playerMoved", id: playerId, x: next.x, y: next.y, dir: intent.dir, moving: intent.moving })
        return
      }
      case "profile": {
        const patch = sanitizeProfilePatch(message.patch)
        if (!patch) return
        entry.state = { ...entry.state, ...patch }
        broadcast({ t: "playerUpdated", id: playerId, patch })
        return
      }
      case "media": {
        const patch = sanitizeMediaPatch(message.patch)
        if (!patch) return
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
        if (!signal || signal.to === playerId) return
        players.get(signal.to)?.client.send({ t: "signal", from: playerId, data: signal.data })
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
    if (players.delete(playerId)) broadcast({ t: "playerLeft", id: playerId })
  }

  return { id, name, map, join, handle, leave, size: () => players.size }
}
