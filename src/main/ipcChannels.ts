// IPC channel names shared by the main process and the preload bridge.
// Kept in one place so both sides can never drift; the channel list matches
// the frozen DesktopBridge contract in src/shared/bridge.ts.

export const IPC = {
  getConnectionInfo: "gather:getConnectionInfo",
  joinLanRoom: "gather:joinLanRoom",
  leaveRoom: "gather:leaveRoom",
  getSettings: "gather:getSettings",
  setSettings: "gather:setSettings",
  showNotification: "gather:showNotification",
  setBadge: "gather:setBadge",
  quit: "gather:quit",
  toggleAudio: "gather:toggleAudio",
  toggleVideo: "gather:toggleVideo",
} as const
