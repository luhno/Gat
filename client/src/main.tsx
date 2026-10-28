import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { getState } from "./state/store"
import { App } from "./App"
import "./styles/global.css"

// Read-only snapshot used by the offline/LAN e2e harness (tests/e2e). No control surface is exposed.
window.__gatherTest = () => {
  const state = getState()
  return {
    connection: state.connection,
    selfId: state.selfId,
    selfName: state.profile.name,
    players: Object.values(state.players).map((player) => ({
      id: player.id,
      name: player.name,
      x: Math.round(player.x),
      y: Math.round(player.y),
      dir: player.dir,
      status: player.status,
      audioEnabled: player.audioEnabled,
      videoEnabled: player.videoEnabled,
      screenSharing: player.screenSharing,
    })),
    chats: state.chats.map((chat) => ({ name: chat.name, text: chat.text })),
    latencyMs: state.latencyMs,
    mediaPeers: document.body.dataset.mediaPeers ?? "0",
    mediaRemote: document.body.dataset.mediaRemote ?? "",
    mediaHealth: (() => {
      try {
        return document.body.dataset.mediaHealth ? JSON.parse(document.body.dataset.mediaHealth) : null
      } catch {
        return null
      }
    })(),
    soundboardLast: document.body.dataset.soundboardLast ?? "",
    soundboardCount: document.body.dataset.soundboardCount ?? "0",
    mediaStats: (() => {
      try {
        return document.body.dataset.mediaStats ? JSON.parse(document.body.dataset.mediaStats) : null
      } catch {
        return null
      }
    })(),
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
