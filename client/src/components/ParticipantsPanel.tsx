import type { PlayerState, UserStatus } from "@shared/types"

import { CopyButton } from "../components/CopyButton"
import { IconCamera, IconCameraOff, IconClose, IconMic, IconMicOff, IconScreen } from "../components/icons"
import { STATUS_COLORS, STATUS_LABELS } from "../components/palette"

const statusLabel = (status: UserStatus): string => STATUS_LABELS[status]

export function ParticipantsPanel({
  players,
  selfId,
  address,
  onClose,
}: {
  players: Record<string, PlayerState>
  selfId: string | null
  address: string
  onClose: () => void
}) {
  const list = Object.values(players).sort((a, b) => {
    if (a.id === selfId) return -1
    if (b.id === selfId) return 1
    return a.name.localeCompare(b.name, "pt-BR")
  })

  return (
    <aside className="panel participants-panel" data-testid="participants-panel" aria-label="Participantes da sala">
      <header className="panel-head">
        <h2>
          Participantes <span className="panel-count">{list.length}</span>
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar participantes">
          <IconClose />
        </button>
      </header>
      <div className="participants-address">
        <code>{address}</code>
        <CopyButton text={address} label="Copiar endereço da sala" />
      </div>
      <ul className="participants-list" data-testid="participants-list">
        {list.map((player) => (
          <li key={player.id} className="participant">
            <span className="participant-avatar" style={{ backgroundColor: player.shirtColor }} aria-hidden="true">
              {player.name.slice(0, 1).toUpperCase() || "?"}
            </span>
            <span className="participant-info">
              <span className="participant-name">
                {player.name}
                {player.id === selfId ? <span className="participant-you"> (você)</span> : null}
              </span>
              <span className="participant-status">
                <span className="participant-dot" style={{ backgroundColor: STATUS_COLORS[player.status] }} aria-hidden="true" />
                {statusLabel(player.status)}
              </span>
            </span>
            <span className="participant-flags">
              {player.screenSharing ? (
                <span className="participant-flag is-on" title="Compartilhando a tela" aria-label="Compartilhando a tela">
                  <IconScreen />
                </span>
              ) : null}
              <span
                className={player.audioEnabled ? "participant-flag is-on" : "participant-flag"}
                title={player.audioEnabled ? "Microfone ligado" : "Microfone desligado"}
                aria-label={player.audioEnabled ? "Microfone ligado" : "Microfone desligado"}
              >
                {player.audioEnabled ? <IconMic /> : <IconMicOff />}
              </span>
              <span
                className={player.videoEnabled ? "participant-flag is-on" : "participant-flag"}
                title={player.videoEnabled ? "Câmera ligada" : "Câmera desligada"}
                aria-label={player.videoEnabled ? "Câmera ligada" : "Câmera desligada"}
              >
                {player.videoEnabled ? <IconCamera /> : <IconCameraOff />}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
