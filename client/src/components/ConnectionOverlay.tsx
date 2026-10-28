import { MAX_RECONNECT_ATTEMPTS } from "../net/connection"
import type { ConnectionStatus } from "../state/store"

/** Full-screen state shown while the room connection is being re-established or has failed. */
export function ConnectionOverlay({
  status,
  error,
  reconnectAttempt,
  onRetry,
  onLeave,
}: {
  status: ConnectionStatus
  error: string | null
  reconnectAttempt: number
  onRetry: () => void
  onLeave: () => void
}) {
  if (status !== "reconnecting" && status !== "error") return null
  const reconnecting = status === "reconnecting"

  return (
    <div className="overlay" role="alertdialog" aria-modal="true" aria-labelledby="connection-overlay-title">
      <div className="overlay-card">
        {reconnecting ? <span className="spinner" aria-hidden="true" /> : null}
        <h2 id="connection-overlay-title">{reconnecting ? "Reconectando…" : "Sem conexão com a sala"}</h2>
        <p>
          {reconnecting
            ? `Estamos tentando reconectar automaticamente (tentativa ${reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS}). Seu perfil e a sala continuam aqui.`
            : (error ?? "A conexão com o servidor da sala foi perdida.")}
        </p>
        <div className="overlay-actions">
          {reconnecting ? null : (
            <button type="button" className="btn btn-primary" onClick={onRetry}>
              Tentar novamente
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onLeave}>
            {reconnecting ? "Sair para a home" : "Voltar à home"}
          </button>
        </div>
      </div>
    </div>
  )
}
