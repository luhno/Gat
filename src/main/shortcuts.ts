// Global shortcuts that mirror the tray actions. They only dispatch renderer
// events; the renderer keeps the authoritative mic/camera state.

import { globalShortcut } from "electron"

import { log } from "./logger"

export interface ShortcutCallbacks {
  toggleAudio(): void
  toggleVideo(): void
  showWindow(): void
}

const ACCELERATORS = {
  audio: "CommandOrControl+Shift+A",
  video: "CommandOrControl+Shift+V",
  window: "CommandOrControl+Shift+H",
} as const

export function registerShortcuts(callbacks: ShortcutCallbacks): void {
  const bind = (accelerator: string, handler: () => void): void => {
    if (!globalShortcut.register(accelerator, handler)) {
      log(`[shortcuts] atalho indisponível (já em uso): ${accelerator}`)
    }
  }
  bind(ACCELERATORS.audio, callbacks.toggleAudio)
  bind(ACCELERATORS.video, callbacks.toggleVideo)
  bind(ACCELERATORS.window, callbacks.showWindow)
  log("[shortcuts] atalhos globais registrados")
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}
