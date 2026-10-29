import { APP_DISPLAY_NAME } from "@shared/constants"
import type { ConnectionInfo } from "@shared/bridge"
import type { RoomSummary } from "@shared/types"

import type { ConnectionStatus } from "../state/store"
import { CopyButton } from "./CopyButton"
import { ShareButton } from "./ShareButton"

export const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  idle: "Desconectado",
  connecting: "Conectando…",
  connected: "Conectado",
  reconnecting: "Reconectando…",
  error: "Sem conexão",
}

export function TopBar({
  room,
  playerCount,
  latencyMs,
  connection,
  desktop,
}: {
  room: RoomSummary | null
  playerCount: number
  latencyMs: number | null
  connection: ConnectionStatus
  desktop: ConnectionInfo | null
}) {
  const lanUrl = desktop?.mode === "host" ? (desktop.lanUrls[0] ?? null) : null
  const roomLink = typeof window === "undefined" ? "" : `${window.location.origin}/join`

  return (
    <header className="topbar">
      <div className="topbar-room">
        <span className="topbar-app">{APP_DISPLAY_NAME}</span>
        <span className="topbar-sep" aria-hidden="true">
          /
        </span>
        <span className="topbar-name">{room?.name ?? "Escritório"}</span>
        <span className="topbar-count">
          {playerCount} {playerCount === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>
      <div className="topbar-status">
        <span className={`conn-dot conn-${connection}`} aria-hidden="true" />
        <span className="conn-label" data-testid="connection-status">
          {CONNECTION_LABEL[connection]}
        </span>
        {connection === "connected" && latencyMs !== null ? (
          <span className="topbar-latency" title="Latência até o servidor da sala">
            {latencyMs} ms
          </span>
        ) : null}
        {lanUrl ? (
          <span className="topbar-lan" data-testid="lan-address">
            <span className="topbar-lan-label">LAN</span>
            <code>{lanUrl.replace(/^https?:\/\//, "")}</code>
            <CopyButton text={lanUrl} label="Copiar endereço LAN da sala" className="btn btn-ghost btn-xs" />
          </span>
        ) : roomLink ? (
          <span className="topbar-lan" data-testid="share-room-link">
            <span className="topbar-lan-label">Sala</span>
            <code>{roomLink.replace(/^https?:\/\//, "")}</code>
            <ShareButton url={roomLink} title="Entre no meu escritório no DittoApp" className="btn btn-ghost btn-xs" />
          </span>
        ) : null}
      </div>
    </header>
  )
}
