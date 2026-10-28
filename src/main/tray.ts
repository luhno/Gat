// macOS/Linux/Windows tray with the app's quick actions. The menu is rebuilt on
// every state change so checkboxes and "leave room" always reflect reality.

import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron"

import { APP_DISPLAY_NAME } from "@shared/constants"

import { log } from "./logger"
import { TRAY_ICON_PNG_BASE64 } from "./trayIcon"

export interface TrayCallbacks {
  showWindow(): void
  toggleAudio(): void
  toggleVideo(): void
  leaveRoom(): void
  quit(): void
  isGuest(): boolean
  isAudioEnabled(): boolean
  isVideoEnabled(): boolean
}

export interface TrayController {
  refresh(): void
}

export function createTray(callbacks: TrayCallbacks): TrayController {
  const image = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG_BASE64, "base64"), { scaleFactor: 2 })
  if (process.platform === "darwin") image.setTemplateImage(true)

  const tray = new Tray(image)
  tray.setToolTip(APP_DISPLAY_NAME)
  if (process.platform === "darwin") tray.setIgnoreDoubleClickEvents(true)

  const refresh = (): void => {
    const template: MenuItemConstructorOptions[] = [
      { label: "Mostrar janela", click: () => callbacks.showWindow() },
      { type: "separator" },
      { label: "Microfone", type: "checkbox", checked: callbacks.isAudioEnabled(), click: () => callbacks.toggleAudio() },
      { label: "Câmera", type: "checkbox", checked: callbacks.isVideoEnabled(), click: () => callbacks.toggleVideo() },
      { type: "separator" },
      { label: "Sair da sala", enabled: callbacks.isGuest(), click: () => callbacks.leaveRoom() },
      { label: `Sair do ${APP_DISPLAY_NAME}`, click: () => callbacks.quit() },
    ]
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  refresh()
  if (process.platform !== "darwin") tray.on("click", () => callbacks.showWindow())
  log("[tray] bandeja criada")
  return { refresh }
}
