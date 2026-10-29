import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, MOVE_SEND_INTERVAL_MS, PING_INTERVAL_MS, WS_PATH } from "@shared/constants"
import { PROTOCOL_VERSION } from "@shared/protocol"
import type { ClientMessage, ServerMessage } from "@shared/protocol"
import type { Direction, PlayerProfile, PlayerState, RtcSignal } from "@shared/types"

import { actions, getState } from "../state/store"

type SoundboardRelay = Extract<ServerMessage, { t: "soundboard" }>

interface ConnectionEvents {
  signal: { from: string; data: RtcSignal }
  soundboard: SoundboardRelay
  connected: { selfId: string }
  closed: undefined
}

type EventName = keyof ConnectionEvents

export const MAX_RECONNECT_ATTEMPTS = 10

/** Per-tab token so a reload can resume the same player within the server grace period. */
const SESSION_STORAGE_KEY = "dittoapp.session.v1"

const readStoredSession = (): string | null => {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage disabled (private mode): fall back to the in-memory token only.
    return null
  }
}

const writeStoredSession = (token: string | null): void => {
  try {
    if (token) sessionStorage.setItem(SESSION_STORAGE_KEY, token)
    else sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Same as above; session resume degrades to in-memory for this document.
  }
}

/**
 * WebSocket client for the LAN room server. The page is always served by the host
 * (locally for the host itself, over the LAN for guests), so the socket is same-origin.
 */
class RoomConnection {
  private socket: WebSocket | null = null
  /** In-flight connect promise: a second connect() while dialing must reuse it, not open a new socket. */
  private pending: Promise<void> | null = null
  private manualClose = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private moveTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pendingMove: { x: number; y: number; dir: Direction; moving: boolean } | null = null
  private lastSentMove = ""
  private profile: PlayerProfile | null = null
  /** Token from welcome; sent back on reconnects so the server resumes this player. */
  private sessionToken: string | null = readStoredSession()
  /** Fatal join error from the server (room_full, protocol_mismatch…): no automatic reconnect (C9). */
  private terminalError: string | null = null
  private leaveSentOnUnload = false
  private handlers: { [K in EventName]: Set<(payload: ConnectionEvents[K]) => void> } = {
    signal: new Set(),
    soundboard: new Set(),
    connected: new Set(),
    closed: new Set(),
  }

  constructor() {
    // Closing/reloading the tab never sends `leave`: the server keeps the slot in grace and
    // the next person sees a phantom player (P0-5). Best-effort final message, sent once.
    const leaveOnUnload = (): void => {
      if (this.manualClose || this.leaveSentOnUnload) return
      if (this.socket?.readyState !== WebSocket.OPEN) return
      this.leaveSentOnUnload = true
      this.send({ t: "leave" })
    }
    window.addEventListener("pagehide", leaveOnUnload)
    window.addEventListener("beforeunload", leaveOnUnload)
  }

  onSignal(listener: (payload: ConnectionEvents["signal"]) => void): () => void {
    this.handlers.signal.add(listener)
    return () => this.handlers.signal.delete(listener)
  }

  onSoundboard(listener: (payload: ConnectionEvents["soundboard"]) => void): () => void {
    this.handlers.soundboard.add(listener)
    return () => this.handlers.soundboard.delete(listener)
  }

  /** Send one soundboard chunk to the room (the server relays it to nearby peers). */
  sendSoundboard(chunk: Extract<ClientMessage, { t: "soundboard" }>): void {
    this.send(chunk)
  }

  onConnected(listener: (payload: ConnectionEvents["connected"]) => void): () => void {
    this.handlers.connected.add(listener)
    return () => this.handlers.connected.delete(listener)
  }

  onClosed(listener: () => void): () => void {
    this.handlers.closed.add(listener)
    return () => this.handlers.closed.delete(listener)
  }

  private emit<K extends EventName>(event: K, payload: ConnectionEvents[K]): void {
    for (const listener of this.handlers[event]) listener(payload)
  }

  async connect(profile: PlayerProfile): Promise<void> {
    this.profile = profile
    this.manualClose = false
    // An explicit connect is also the manual retry path: a previous fatal server error is not final.
    this.terminalError = null
    if (this.pending) return this.pending
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return
    actions.setError(null)
    actions.setConnection(this.reconnectAttempt === 0 ? "connecting" : "reconnecting")
    this.leaveSentOnUnload = false

    this.pending = new Promise<void>((resolve, reject) => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws"
      const socket = new WebSocket(`${scheme}://${window.location.host}${WS_PATH}`)
      this.socket = socket
      let welcomed = false

      socket.onopen = () => {
        const session = this.sessionToken
        this.send(session ? { t: "join", protocol: PROTOCOL_VERSION, profile, session } : { t: "join", protocol: PROTOCOL_VERSION, profile })
      }

      socket.onmessage = (event: MessageEvent) => {
        if (this.socket !== socket) return
        let message: ServerMessage
        try {
          message = JSON.parse(String(event.data)) as ServerMessage
        } catch {
          return
        }
        if (message.t === "welcome" && !welcomed) {
          welcomed = true
          this.handleWelcome(message)
          resolve()
          return
        }
        if (message.t === "error" && !welcomed) {
          // Fatal join errors arrive before welcome (and the server closes right after): retrying
          // would hide the real reason behind "Reconectando…" for ~70 s (C9).
          this.handleTerminalError(message.message)
          reject(new Error(message.message))
          return
        }
        this.handleMessage(message)
      }

      socket.onerror = () => {
        // onclose carries the actionable state; nothing to do here.
      }

      socket.onclose = () => {
        const owned = this.socket === socket
        if (owned) this.socket = null
        if (!welcomed) reject(new Error(this.terminalError ?? "Não foi possível conectar ao servidor da sala."))
        // A socket that is no longer the live one must not stop the live connection's timers
        // or schedule a reconnect (that cascade is what a double connect() used to cause).
        if (!owned) return
        this.stopTimers()
        this.handleClose()
      }
    }).finally(() => {
      this.pending = null
    })

    return this.pending
  }

  private handleTerminalError(message: string): void {
    this.terminalError = message
    // The token only resumes a detached player; after a rejected join it is useless (P0-7).
    this.sessionToken = null
    writeStoredSession(null)
    actions.setConnection("error")
    actions.setError(message)
    // The server closes after a fatal join error; closing here keeps a live socket from
    // blocking the manual retry if it ever does not.
    this.socket?.close()
  }

  private handleWelcome(message: Extract<ServerMessage, { t: "welcome" }>): void {
    this.reconnectAttempt = 0
    this.terminalError = null
    this.sessionToken = message.session
    writeStoredSession(message.session)
    actions.setReconnectAttempt(0)
    this.stopTimers()
    actions.setSelfId(message.you.id)
    actions.setRoom(message.room)
    actions.setMap(message.map)
    actions.setPlayers(message.players)
    actions.setConnection("connected")
    actions.setError(null)
    this.startTimers()
    this.emit("connected", { selfId: message.you.id })
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.t) {
      case "welcome":
        // Duplicate welcome after a reconnect race; ignore.
        break
      case "playerJoined":
        actions.addPlayer(message.player)
        break
      case "playerLeft":
        actions.removePlayer(message.id)
        break
      case "playerMoved":
        actions.updatePlayer(message.id, {
          x: message.x,
          y: message.y,
          dir: message.dir,
          moving: message.moving,
        })
        break
      case "playerUpdated":
        actions.updatePlayer(message.id, message.patch)
        break
      case "chat":
        actions.pushChat(message.message)
        break
      case "signal":
        this.emit("signal", { from: message.from, data: message.data })
        break
      case "soundboard":
        this.emit("soundboard", message)
        break
      case "error":
        actions.setError(message.message)
        break
      case "pong":
        actions.setLatency(Math.max(0, Date.now() - message.at))
        break
    }
  }

  private handleClose(): void {
    this.emit("closed", undefined)
    if (this.manualClose) {
      actions.setConnection("idle")
      return
    }
    if (this.terminalError) {
      // Fatal server error: automatic retries would only hide it; wait for a manual retry (C9).
      actions.setError(this.terminalError)
      actions.setConnection("error")
      return
    }
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS || !this.profile) {
      actions.setConnection("error")
      actions.setError("Conexão com a sala perdida. Verifique sua internet e recarregue a página se continuar.")
      return
    }
    this.reconnectAttempt += 1
    actions.setReconnectAttempt(this.reconnectAttempt)
    actions.setConnection("reconnecting")
    // Jitter avoids every client in the room retrying on the same tick after a server blip.
    const delay = Math.min(10000, 500 * 2 ** this.reconnectAttempt) + Math.round(Math.random() * 250)
    this.reconnectTimer = setTimeout(() => {
      if (!this.profile) return
      this.connect(this.profile).catch(() => {
        // connect() already schedules the next attempt through handleClose.
      })
    }, delay)
  }

  private startTimers(): void {
    this.moveTimer = setInterval(() => this.flushMove(), MOVE_SEND_INTERVAL_MS)
    this.pingTimer = setInterval(() => this.send({ t: "ping", at: Date.now() }), PING_INTERVAL_MS)
  }

  private stopTimers(): void {
    if (this.moveTimer) clearInterval(this.moveTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.moveTimer = null
    this.pingTimer = null
    this.reconnectTimer = null
  }

  private send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }

  private flushMove(): void {
    if (!this.pendingMove) return
    const key = `${this.pendingMove.x.toFixed(1)}:${this.pendingMove.y.toFixed(1)}:${this.pendingMove.dir}:${this.pendingMove.moving}`
    if (key === this.lastSentMove) return
    this.lastSentMove = key
    this.send({ t: "move", ...this.pendingMove })
  }

  queueMove(x: number, y: number, dir: Direction, moving: boolean): void {
    this.pendingMove = { x, y, dir, moving }
    actions.updatePlayer(getState().selfId ?? "", { x, y, dir, moving })
  }

  sendChat(text: string): boolean {
    const trimmed = text.trim().slice(0, MAX_CHAT_LENGTH)
    if (!trimmed) return false
    this.send({ t: "chat", text: trimmed })
    return true
  }

  updateProfile(patch: Partial<Pick<PlayerProfile, "name" | "shirtColor" | "skinTone" | "hairStyle" | "status">>): void {
    const sanitized: typeof patch = { ...patch }
    if (sanitized.name !== undefined) {
      sanitized.name = sanitized.name.trim().slice(0, MAX_NAME_LENGTH)
      if (!sanitized.name) delete sanitized.name
    }
    this.send({ t: "profile", patch: sanitized })
    actions.setProfile(patch)
    const selfId = getState().selfId
    if (selfId) actions.updatePlayer(selfId, patch)
  }

  sendMedia(patch: Partial<Pick<PlayerState, "audioEnabled" | "videoEnabled" | "screenSharing">>): void {
    this.send({ t: "media", patch })
    const selfId = getState().selfId
    if (selfId) actions.updatePlayer(selfId, patch)
  }

  sendSignal(to: string, data: RtcSignal): void {
    this.send({ t: "signal", to, data })
  }

  /** Manual retry from the connection overlays: reset the attempt budget and fatal state first (C9). */
  retry(profile: PlayerProfile): Promise<void> {
    this.reconnectAttempt = 0
    this.lastSentMove = ""
    this.terminalError = null
    actions.setReconnectAttempt(0)
    return this.connect(profile)
  }

  disconnect(): void {
    this.manualClose = true
    this.stopTimers()
    // Explicit leave so the server removes the player now instead of keeping the grace slot.
    this.send({ t: "leave" })
    this.sessionToken = null
    writeStoredSession(null)
    this.socket?.close()
    this.socket = null
    this.profile = null
    this.reconnectAttempt = 0
    actions.setReconnectAttempt(0)
    this.lastSentMove = ""
    actions.resetRoom()
  }
}

export const connection = new RoomConnection()
