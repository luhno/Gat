import type { ChatMessage, Direction, HairStyle, OfficeMap, PlayerProfile, PlayerState, RoomSummary, RtcSignal, UserStatus } from "./types"

export const PROTOCOL_VERSION = 1

export type ClientMessage =
  | { t: "join"; protocol: number; profile: PlayerProfile; session?: string }
  | { t: "move"; x: number; y: number; dir: Direction; moving: boolean }
  | { t: "profile"; patch: Partial<Pick<PlayerProfile, "name" | "shirtColor" | "skinTone" | "hairStyle" | "status">> }
  | { t: "media"; patch: Partial<Pick<PlayerState, "audioEnabled" | "videoEnabled" | "screenSharing">> }
  | { t: "chat"; text: string }
  | { t: "signal"; to: string; data: RtcSignal }
  | { t: "ping"; at: number }
  | { t: "leave" }
  | {
      t: "soundboard"
      /** Client-generated clip id, shared by every chunk of the same sound. */
      clip: string
      name: string
      total: number
      index: number
      /** base64 of one chunk (≤ 8 KiB raw). */
      data: string
    }

export type ServerMessage =
  | {
      t: "welcome"
      protocol: number
      /** Session token: send it back on `join` within the grace period to resume this player. */
      session: string
      you: PlayerState
      players: PlayerState[]
      map: OfficeMap
      room: RoomSummary
      serverTime: number
    }
  | { t: "playerJoined"; player: PlayerState }
  | { t: "playerLeft"; id: string }
  | { t: "playerMoved"; id: string; x: number; y: number; dir: Direction; moving: boolean }
  | {
      t: "playerUpdated"
      id: string
      patch: Partial<Pick<PlayerState, "name" | "shirtColor" | "skinTone" | "hairStyle" | "status" | "audioEnabled" | "videoEnabled" | "screenSharing">>
    }
  | { t: "chat"; message: ChatMessage }
  | { t: "signal"; from: string; data: RtcSignal }
  | { t: "soundboard"; from: string; clip: string; name: string; total: number; index: number; data: string }
  | { t: "error"; code: string; message: string }
  | { t: "pong"; at: number; serverTime: number }

export type AuthMode = "available" | "busy" | "focus"
export type { Direction, HairStyle, UserStatus }
