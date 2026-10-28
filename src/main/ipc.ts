// Main-process side of the DesktopBridge contract. Every value coming from the
// renderer is treated as untrusted input and validated before use.

import { app, ipcMain, Notification, type BrowserWindow } from "electron"

import type { AppMode, ConnectionInfo, DesktopSettings, JoinResult } from "@shared/bridge"
import { APP_VERSION } from "@shared/constants"

import { IPC } from "./ipcChannels"
import { log } from "./logger"
import type { SettingsStore } from "./settings"

const MAX_NOTIFICATION_TITLE = 200
const MAX_NOTIFICATION_BODY = 500

export interface IpcContext {
  settings: SettingsStore
  localUrl(): string
  lanUrls(): string[]
  mode(): AppMode
  window(): BrowserWindow | null
  join(address: string): Promise<JoinResult>
  leave(): Promise<void>
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

export function registerIpc(context: IpcContext): void {
  ipcMain.handle(IPC.getConnectionInfo, (): ConnectionInfo => {
    const mode = context.mode()
    return {
      mode,
      version: APP_VERSION,
      localUrl: context.localUrl(),
      lanUrls: mode === "host" ? context.lanUrls() : [],
    }
  })

  ipcMain.handle(IPC.joinLanRoom, (_event, address: unknown): Promise<JoinResult> => {
    if (typeof address !== "string") return Promise.resolve({ ok: false, error: "Endereço inválido." })
    return context.join(address)
  })

  ipcMain.handle(IPC.leaveRoom, (): Promise<void> => context.leave())

  ipcMain.handle(IPC.getSettings, (): DesktopSettings => context.settings.get())

  ipcMain.handle(IPC.setSettings, (_event, rawPatch: unknown): DesktopSettings => {
    return context.settings.set(asRecord(rawPatch) as Partial<DesktopSettings>)
  })

  ipcMain.on(IPC.showNotification, (_event, rawOptions: unknown) => {
    const options = asRecord(rawOptions)
    const title = typeof options.title === "string" ? options.title.slice(0, MAX_NOTIFICATION_TITLE) : ""
    const body = typeof options.body === "string" ? options.body.slice(0, MAX_NOTIFICATION_BODY) : ""
    if (!title || !Notification.isSupported()) return
    new Notification({ title, body }).show()
  })

  ipcMain.on(IPC.setBadge, (_event, rawCount: unknown) => {
    if (typeof rawCount !== "number" || !Number.isFinite(rawCount)) return
    app.setBadgeCount(Math.max(0, Math.floor(rawCount)))
  })

  ipcMain.on(IPC.quit, () => {
    log("[ipc] quit pedido pelo renderer")
    app.quit()
  })
}
