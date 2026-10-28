// Domain types shared by the Electron main process, the LAN server and the web client.
// These are the rewritten app's own contracts; nothing here is copied from the original bundle.

export interface Vec2 {
  x: number
  y: number
}

export type Direction = "down" | "up" | "left" | "right"
export type UserStatus = "available" | "busy" | "focus"
export type HairStyle = 0 | 1 | 2 | 3

export interface PlayerProfile {
  name: string
  shirtColor: string
  skinTone: string
  hairStyle: HairStyle
  status: UserStatus
}

export interface PlayerState extends PlayerProfile {
  id: string
  x: number
  y: number
  dir: Direction
  moving: boolean
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
}

export type ObjectKind =
  | "desk"
  | "chair"
  | "table"
  | "sofa"
  | "plant"
  | "whiteboard"
  | "bookshelf"
  | "counter"
  | "stool"
  | "rug"
  | "lamp"
  | "tv"
  | "door"
  | "crate"

export interface MapObject {
  id: string
  kind: ObjectKind
  /** tile coordinates of the top-left corner */
  x: number
  y: number
  /** size in tiles */
  w: number
  h: number
  solid: boolean
  label?: string
}

export interface MapZone {
  id: string
  name: string
  x: number
  y: number
  w: number
  h: number
}

export interface OfficeMap {
  name: string
  width: number
  height: number
  tileSize: number
  /** per-tile floor theme index, length = width * height */
  floors: number[]
  /** per-tile wall value: 0 walkable, 1 full wall */
  walls: number[]
  objects: MapObject[]
  zones: MapZone[]
  /** spawn position in tile coordinates */
  spawn: Vec2
}

export interface ChatMessage {
  id: string
  from: string
  name: string
  shirtColor: string
  text: string
  at: number
  system?: boolean
}

export interface RoomSummary {
  id: string
  name: string
}

/** Payloads used over the WebSocket connection. */
export type RtcSignal =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } | null }
