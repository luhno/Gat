import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, MOVE_SEND_INTERVAL_MS, PING_INTERVAL_MS, WS_PATH } from "@shared/constants"
import { PROTOCOL_VERSION } from "@shared/protocol"
import type { ClientMessage, ServerMessage } from "@shared/protocol"
import type { Direction, PlayerProfile, PlayerState, RtcSignal } from "@shared/types"

import { actions, getState } from "../state/store"

interface ConnectionEvents {
  signal: { from: string; data: RtcSignal }
  connected: { selfId: string }
  closed: undefined
}

type EventName = keyof ConnectionEvents

const MAX_RECONNECT_ATTEMPTS = 10

/**
 * WebSocket client for the LAN room server. The page is always served by the host
 * (locally for the host itself, over the LAN for guests), so the socket is same-origin.
 */
class RoomConnection {
  private socket: WebSocket | null = null
  private manualClose = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private moveTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pendingMove: { x: number; y: number; dir: Direction; moving: boolean } | null = null
  private lastSentMove = ""
  private profile: PlayerProfile | null = null
  private handlers: { [K in EventName]: Set<(payload: ConnectionEvents[K]) => void> } = {
    signal: new Set(),
    connected: new Set(),
    closed: new Set(),
  }

  onSignal(listener: (payload: ConnectionEvents["signal"]) => void): () => void {
    this.handlers.signal.add(listener)
    return () => this.handlers.signal.delete(listener)
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
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return
    actions.setError(null)
    actions.setConnection(this.reconnectAttempt === 0 ? "connecting" : "reconnecting")

    await new Promise<void>((resolve, reject) => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws"
      const socket = new WebSocket(`${scheme}://${window.location.host}${WS_PATH}`)
      this.socket = socket
      let welcomed = false

      socket.onopen = () => {
        this.send({ t: "join", protocol: PROTOCOL_VERSION, profile })
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
        this.handleMessage(message)
      }

      socket.onerror = () => {
        // onclose carries the actionable state; nothing to do here.
      }

      socket.onclose = () => {
        if (this.socket === socket) this.socket = null
        this.stopTimers()
        if (!welcomed) reject(new Error("Não foi possível conectar ao servidor da sala."))
        this.handleClose()
      }
    })
  }

  private handleWelcome(message: Extract<ServerMessage, { t: "welcome" }>): void {
    this.reconnectAttempt = 0
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
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS || !this.profile) {
      actions.setConnection("error")
      actions.setError("Conexão com a sala perdida. Verifique sua internet e recarregue a página se continuar.")
      return
    }
    this.reconnectAttempt += 1
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

  disconnect(): void {
    this.manualClose = true
    this.stopTimers()
    this.socket?.close()
    this.socket = null
    this.profile = null
    this.reconnectAttempt = 0
    this.lastSentMove = ""
    actions.resetRoom()
  }
}

export const connection = new RoomConnection()
