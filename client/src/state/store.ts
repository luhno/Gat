import { useSyncExternalStore } from "react"

import { DEFAULT_DESKTOP_SETTINGS, type ConnectionInfo, type DesktopSettings } from "@shared/bridge"
import { CHAT_HISTORY_LIMIT } from "@shared/constants"
import type { ChatMessage, OfficeMap, PlayerProfile, PlayerState, RoomSummary } from "@shared/types"

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error"

export interface UiState {
  chatOpen: boolean
  participantsOpen: boolean
  profileOpen: boolean
  settingsOpen: boolean
}

export interface ClientState {
  connection: ConnectionStatus
  error: string | null
  selfId: string | null
  room: RoomSummary | null
  map: OfficeMap | null
  players: Record<string, PlayerState>
  chats: ChatMessage[]
  unreadChats: number
  latencyMs: number | null
  reconnectAttempt: number
  desktop: ConnectionInfo | null
  settings: DesktopSettings
  profile: PlayerProfile
  ui: UiState
}

export const profileFromSettings = (settings: DesktopSettings): PlayerProfile => ({
  name: settings.defaultName,
  shirtColor: settings.defaultShirtColor,
  skinTone: settings.defaultSkinTone,
  hairStyle: settings.defaultHairStyle,
  status: settings.defaultStatus,
})

const initialState = (): ClientState => ({
  connection: "idle",
  error: null,
  selfId: null,
  room: null,
  map: null,
  players: {},
  chats: [],
  unreadChats: 0,
  latencyMs: null,
  reconnectAttempt: 0,
  desktop: null,
  settings: DEFAULT_DESKTOP_SETTINGS,
  profile: profileFromSettings(DEFAULT_DESKTOP_SETTINGS),
  ui: { chatOpen: false, participantsOpen: false, profileOpen: false, settingsOpen: false },
})

let state: ClientState = initialState()
const listeners = new Set<() => void>()

const emit = () => {
  for (const listener of listeners) listener()
}

export const getState = (): ClientState => state

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const setState = (patch: Partial<ClientState> | ((current: ClientState) => Partial<ClientState>)): void => {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) }
  emit()
}

/** Subscribe a React component to the whole client state. The app is small; canvas code should read getState() in rAF instead. */
export const useStore = (): ClientState => useSyncExternalStore(subscribe, getState, getState)

export const actions = {
  setDesktop: (desktop: ConnectionInfo | null) => setState({ desktop }),
  setSettings: (settings: DesktopSettings) => setState({ settings }),
  setProfile: (patch: Partial<PlayerProfile>) =>
    setState((current) => ({ profile: { ...current.profile, ...patch } })),
  setUi: (patch: Partial<UiState>) => setState((current) => ({ ui: { ...current.ui, ...patch } })),
  setConnection: (connection: ConnectionStatus) => setState({ connection }),
  setError: (error: string | null) => setState({ error }),
  setLatency: (latencyMs: number | null) => setState({ latencyMs }),
  setReconnectAttempt: (reconnectAttempt: number) => setState({ reconnectAttempt }),
  setSelfId: (selfId: string | null) => setState({ selfId }),
  setRoom: (room: RoomSummary | null) => setState({ room }),
  setMap: (map: OfficeMap | null) => setState({ map }),
  setPlayers: (players: PlayerState[]) =>
    setState({ players: Object.fromEntries(players.map((player) => [player.id, player])) }),
  addPlayer: (player: PlayerState) =>
    setState((current) => ({ players: { ...current.players, [player.id]: player } })),
  removePlayer: (id: string) =>
    setState((current) => {
      if (!(id in current.players)) return {}
      const players = { ...current.players }
      delete players[id]
      return { players }
    }),
  updatePlayer: (id: string, patch: Partial<PlayerState>) =>
    setState((current) => {
      const existing = current.players[id]
      if (!existing) return {}
      return { players: { ...current.players, [id]: { ...existing, ...patch } } }
    }),
  pushChat: (message: ChatMessage) =>
    setState((current) => ({
      chats: [...current.chats, message].slice(-CHAT_HISTORY_LIMIT),
      unreadChats: current.ui.chatOpen ? 0 : current.unreadChats + 1,
    })),
  markChatsRead: () => setState({ unreadChats: 0 }),
  resetRoom: () =>
    setState({
      selfId: null,
      room: null,
      map: null,
      players: {},
      chats: [],
      unreadChats: 0,
      latencyMs: null,
      connection: "idle",
      error: null,
      ui: { chatOpen: false, participantsOpen: false, profileOpen: false, settingsOpen: false },
    }),
}
