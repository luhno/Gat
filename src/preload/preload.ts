// The only bridge between the web client and Electron. It exposes exactly the
// frozen DesktopBridge surface and nothing else (sandboxed, contextIsolation).

import { contextBridge, ipcRenderer } from "electron"

import type { DesktopBridge, DesktopSettings, JoinResult } from "@shared/bridge"

import { IPC } from "../main/ipcChannels"

function subscribe(channel: string, listener: () => void): () => void {
  const wrapped = (): void => listener()
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const bridge: DesktopBridge = {
  getConnectionInfo: () => ipcRenderer.invoke(IPC.getConnectionInfo),
  joinLanRoom: (address: string): Promise<JoinResult> => ipcRenderer.invoke(IPC.joinLanRoom, address),
  leaveRoom: (): Promise<void> => ipcRenderer.invoke(IPC.leaveRoom),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<DesktopSettings>) => ipcRenderer.invoke(IPC.setSettings, patch),
  onToggleAudio: (listener: () => void) => subscribe(IPC.toggleAudio, listener),
  onToggleVideo: (listener: () => void) => subscribe(IPC.toggleVideo, listener),
  showNotification: (options) => ipcRenderer.send(IPC.showNotification, options),
  setBadge: (count: number) => ipcRenderer.send(IPC.setBadge, count),
  quit: () => ipcRenderer.send(IPC.quit),
}

contextBridge.exposeInMainWorld("gather", bridge)
