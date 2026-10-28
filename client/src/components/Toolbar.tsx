import type { ReactNode } from "react"

import { IconCamera, IconCameraOff, IconChat, IconGear, IconLeave, IconMic, IconMicOff, IconPeople, IconScreen } from "./icons"

export type PanelName = "chat" | "participants" | "settings"

export function Toolbar({
  audioEnabled,
  videoEnabled,
  screenSharing,
  unreadChats,
  activePanel,
  onToggleAudio,
  onToggleCamera,
  onToggleScreen,
  onOpenPanel,
  onLeave,
}: {
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
  unreadChats: number
  activePanel: PanelName | null
  onToggleAudio: () => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onOpenPanel: (panel: PanelName) => void
  onLeave: () => void
}) {
  const toggle = (on: boolean): string => `tool-btn${on ? " is-on" : ""}`

  const button = (
    testId: string,
    label: string,
    title: string,
    onClick: () => void,
    content: ReactNode,
    extraClass = "",
    on = false,
  ) => (
    <button
      type="button"
      className={`${toggle(on)}${extraClass ? ` ${extraClass}` : ""}`}
      data-testid={testId}
      aria-label={label}
      aria-pressed={on}
      title={title}
      onClick={onClick}
    >
      {content}
    </button>
  )

  return (
    <footer className="toolbar" role="toolbar" aria-label="Controles da sala">
      {button(
        "toolbar-mic",
        audioEnabled ? "Desativar microfone" : "Ativar microfone",
        "Microfone (M)",
        onToggleAudio,
        audioEnabled ? <IconMic /> : <IconMicOff />,
        "tool-btn-toggle",
        audioEnabled,
      )}
      {button(
        "toolbar-camera",
        videoEnabled ? "Desligar câmera" : "Ligar câmera",
        "Câmera (V)",
        onToggleCamera,
        videoEnabled ? <IconCamera /> : <IconCameraOff />,
        "tool-btn-toggle",
        videoEnabled,
      )}
      {button(
        "toolbar-screen",
        screenSharing ? "Parar compartilhamento de tela" : "Compartilhar tela",
        screenSharing ? "Parar compartilhamento" : "Compartilhar tela",
        onToggleScreen,
        <IconScreen />,
        "tool-btn-toggle",
        screenSharing,
      )}
      <span className="toolbar-divider" aria-hidden="true" />
      {button(
        "toolbar-chat",
        "Abrir chat",
        "Chat (C)",
        () => onOpenPanel("chat"),
        <>
          <IconChat />
          {unreadChats > 0 ? (
            <span className="tool-badge" aria-label={`${unreadChats} mensagens não lidas`}>
              {unreadChats > 9 ? "9+" : unreadChats}
            </span>
          ) : null}
        </>,
        "",
        activePanel === "chat",
      )}
      {button(
        "toolbar-participants",
        "Abrir participantes",
        "Participantes (P)",
        () => onOpenPanel("participants"),
        <IconPeople />,
        "",
        activePanel === "participants",
      )}
      {button(
        "toolbar-settings",
        "Abrir configurações",
        "Configurações",
        () => onOpenPanel("settings"),
        <IconGear />,
        "",
        activePanel === "settings",
      )}
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="tool-btn tool-btn-leave"
        data-testid="toolbar-leave"
        aria-label="Sair da sala"
        title="Sair da sala"
        onClick={onLeave}
      >
        <IconLeave />
        <span className="tool-btn-text">Sair</span>
      </button>
    </footer>
  )
}
