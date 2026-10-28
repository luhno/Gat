import { useEffect, useRef, useState } from "react"

import { ChatPanel } from "../chat/ChatPanel"
import { ConnectionOverlay } from "../components/ConnectionOverlay"
import { Notice } from "../components/Notice"
import { ParticipantsPanel } from "../components/ParticipantsPanel"
import { SettingsPanel } from "../components/SettingsPanel"
import { TopBar } from "../components/TopBar"
import { Toolbar, type PanelName } from "../components/Toolbar"
import { desktop } from "../desktop"
import { MediaHealthHud } from "../media/MediaHealthHud"
import { ScreenSharePanel } from "../media/ScreenSharePanel"
import { SoundboardPanel } from "../soundboard/SoundboardPanel"
import { initSoundboardReceiver } from "../soundboard/soundboard"
import { useMedia } from "../media/useMedia"
import { connection } from "../net/connection"
import { actions, getState, useStore, type UiState } from "../state/store"
import { OfficeCanvas } from "./OfficeCanvas"

const panelFromUi = (ui: UiState): PanelName | null =>
  ui.chatOpen
    ? "chat"
    : ui.participantsOpen
      ? "participants"
      : ui.settingsOpen
        ? "settings"
        : ui.soundboardOpen
          ? "soundboard"
          : null

const applyPanel = (panel: PanelName | null): void => {
  actions.setUi({
    chatOpen: panel === "chat",
    participantsOpen: panel === "participants",
    settingsOpen: panel === "settings",
    soundboardOpen: panel === "soundboard",
  })
  if (panel === "chat") actions.markChatsRead()
}

const togglePanel = (panel: PanelName): void => {
  applyPanel(panelFromUi(getState().ui) === panel ? null : panel)
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

/** The room itself: canvas + HUD + panels. Only mounted while a room state exists. */
export function OfficeScreen() {
  const state = useStore()
  const { selfId, map, players } = state
  const media = useMedia({ selfId, map, players })
  const mediaRef = useRef(media)
  mediaRef.current = media
  const [dismissedSharer, setDismissedSharer] = useState<string | null>(null)

  const activePanel = panelFromUi(state.ui)

  useEffect(() => {
    initSoundboardReceiver()
  }, [])

  useEffect(() => {
    if (state.ui.chatOpen) actions.markChatsRead()
  }, [state.ui.chatOpen, state.chats.length])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return
      switch (event.key.toLowerCase()) {
        case "m":
          mediaRef.current.toggleAudio()
          break
        case "v":
          mediaRef.current.toggleCamera()
          break
        case "c":
          togglePanel("chat")
          break
        case "p":
          togglePanel("participants")
          break
        case "s":
          togglePanel("soundboard")
          break
        case "escape":
          applyPanel(null)
          break
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    try {
      desktop?.setBadge(state.unreadChats)
    } catch {
      // Tray may be gone while the window is closing; the badge is cosmetic.
    }
  }, [state.unreadChats])

  const leave = (): void => {
    const isGuest = getState().desktop?.mode === "guest"
    connection.disconnect()
    if (isGuest && desktop) void desktop.leaveRoom()
  }

  const retry = (): void => {
    void connection.connect(getState().profile).catch(() => undefined)
  }

  const toggleScreenShare = (): void => {
    if (media.screenSharing) media.stopScreenShare()
    else void media.startScreenShare().catch(() => undefined)
  }

  const sharerId = Array.from(media.remoteScreenSharing).find((id) => media.remoteStreams.has(id)) ?? null
  const sharerStream = sharerId ? media.remoteStreams.get(sharerId) : undefined
  const sharerName = sharerId ? (players[sharerId]?.name ?? "Alguém") : ""

  useEffect(() => {
    if (!sharerId) setDismissedSharer(null)
  }, [sharerId])

  const shareError = state.connection === "connected" ? state.error : null
  const showNotice = Boolean(shareError) || Boolean(media.mediaError)

  return (
    <div className="office-screen">
      <OfficeCanvas streams={media.remoteStreams} />
      <TopBar
        room={state.room}
        playerCount={Object.keys(players).length}
        latencyMs={state.latencyMs}
        connection={state.connection}
        desktop={state.desktop}
      />

      {showNotice ? (
        <div className="office-notices">
          {shareError ? (
            <Notice kind="error" onClose={() => actions.setError(null)}>
              {shareError}
            </Notice>
          ) : null}
          {media.mediaError ? <Notice kind="error">{media.mediaError}</Notice> : null}
        </div>
      ) : null}

      <div className="office-side">
        {activePanel === "chat" ? (
          <ChatPanel messages={state.chats} onSend={(text) => connection.sendChat(text)} onClose={() => applyPanel(null)} />
        ) : null}
        {activePanel === "participants" ? (
          <ParticipantsPanel
            players={players}
            selfId={selfId}
            address={window.location.origin.replace(/^https?:\/\//, "")}
            onClose={() => applyPanel(null)}
          />
        ) : null}
        {activePanel === "settings" ? (
          <SettingsPanel media={media} profile={state.profile} onClose={() => applyPanel(null)} />
        ) : null}
        {activePanel === "soundboard" ? <SoundboardPanel onClose={() => applyPanel(null)} /> : null}
      </div>

      {media.screenSharing ? (
        <div className="sharing-pill" role="status">
          <span>Você está compartilhando a tela</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => media.stopScreenShare()}>
            Parar
          </button>
        </div>
      ) : null}

      <Toolbar
        audioEnabled={media.audioEnabled}
        videoEnabled={media.videoEnabled}
        screenSharing={media.screenSharing}
        unreadChats={state.unreadChats}
        activePanel={activePanel}
        onToggleAudio={() => media.toggleAudio()}
        onToggleCamera={() => media.toggleCamera()}
        onToggleScreen={toggleScreenShare}
        onOpenPanel={togglePanel}
        onLeave={leave}
      />

      <MediaHealthHud media={media} />

      <ConnectionOverlay
        status={state.connection}
        error={state.error}
        reconnectAttempt={state.reconnectAttempt}
        onRetry={retry}
        onLeave={leave}
      />

      {sharerId && sharerStream && dismissedSharer !== sharerId ? (
        <ScreenSharePanel
          stream={sharerStream}
          label={sharerName}
          onClose={() => setDismissedSharer(sharerId)}
        />
      ) : null}
    </div>
  )
}
