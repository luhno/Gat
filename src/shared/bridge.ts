// Contract between the Electron preload (main process) and the web client.
// The web client must keep working (degraded) when window.gather is undefined,
// e.g. when a LAN guest opens the office URL in a plain browser.

import type { HairStyle, UserStatus } from "./types"

export type AppMode = "host" | "guest"

export interface ConnectionInfo {
  mode: AppMode
  version: string
  /** URL this window was loaded from (https://127.0.0.1:<port> or https://<lan-ip>:<port>) */
  localUrl: string
  /** Addresses other machines on the LAN can use to join this host. Empty for guests. */
  lanUrls: string[]
}

export interface DesktopSettings {
  defaultName: string
  defaultShirtColor: string
  defaultSkinTone: string
  defaultHairStyle: HairStyle
  defaultStatus: UserStatus
  lastJoinedAddress: string | null
  audioInputId: string | null
  videoInputId: string | null
  audioOutputId: string | null
}

export interface JoinResult {
  ok: boolean
  error?: string
}

export interface DesktopBridge {
  getConnectionInfo(): Promise<ConnectionInfo>
  /** Navigate this window to a LAN host. `address` is "host:port" or a full https URL. */
  joinLanRoom(address: string): Promise<JoinResult>
  /** Leave the room and return to the local home screen. */
  leaveRoom(): Promise<void>
  getSettings(): Promise<DesktopSettings>
  setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>
  /** Tray / global shortcut "<name>" events. Returns an unsubscribe function. */
  onToggleAudio(listener: () => void): () => void
  onToggleVideo(listener: () => void): () => void
  showNotification(opts: { title: string; body: string }): void
  setBadge(count: number): void
  quit(): void
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  defaultName: "",
  defaultShirtColor: "#e4572e",
  defaultSkinTone: "#f2c9a0",
  defaultHairStyle: 0,
  defaultStatus: "available",
  lastJoinedAddress: null,
  audioInputId: null,
  videoInputId: null,
  audioOutputId: null,
}
