import type { MediaApi } from "./useMedia"

interface Chip {
  tone: "live" | "warn" | "idle" | "off"
  text: string
}

/**
 * "Está funcionando?" HUD: local camera/screen previews plus a live status chip, so the user can
 * confirm that their camera image and screen capture are really going out before trusting them.
 */
export function MediaHealthHud({ media }: { media: MediaApi }) {
  const health = media.mediaHealth
  if (!health) return null

  const camera: Chip = !health.camera.enabled
    ? { tone: "off", text: "Câmera desligada" }
    : !health.camera.live
      ? { tone: "warn", text: "Câmera ligada, sem imagem — verifique a permissão" }
      : health.camera.pausedByScreenShare
        ? { tone: "idle", text: "Câmera pausada enquanto a tela está no ar" }
        : {
            tone: "live",
            text:
              health.camera.viewers > 0
                ? `Câmera ao vivo · ${health.camera.viewers} ${health.camera.viewers === 1 ? "pessoa" : "pessoas"}`
                : "Câmera ao vivo · só você",
          }

  const screen: Chip | null = !health.screen.sharing
    ? null
    : !health.screen.live
      ? { tone: "warn", text: "Tela sem captura — verifique a permissão de gravação" }
      : health.screen.viewers === 0
        ? { tone: "idle", text: "Tela capturada · ninguém na sala" }
        : !health.screen.framesFlowing
          ? { tone: "warn", text: "Tela capturada, mas sem quadros sendo enviados" }
          : {
              tone: "live",
              text: `Tela ao vivo · ${health.screen.viewers} ${health.screen.viewers === 1 ? "pessoa" : "pessoas"}`,
            }

  const attach = (element: HTMLVideoElement | null, stream: MediaStream | null): void => {
    if (element && stream && element.srcObject !== stream) element.srcObject = stream
  }

  return (
    <div className="media-hud" aria-live="polite" data-testid="media-hud">
      {media.videoEnabled && media.localStream ? (
        <figure className="media-hud-tile is-camera">
          <video ref={(element) => attach(element, media.localStream)} data-testid="self-camera-preview" autoPlay muted playsInline />
          <figcaption>Você</figcaption>
        </figure>
      ) : null}
      {media.screenSharing && media.localScreenStream ? (
        <figure className="media-hud-tile is-screen">
          <video
            ref={(element) => attach(element, media.localScreenStream)}
            data-testid="self-screen-preview"
            autoPlay
            muted
            playsInline
          />
          <figcaption>Sua tela</figcaption>
        </figure>
      ) : null}
      <ul className="media-hud-status">
        <li className={`media-health is-${camera.tone}`} data-testid="media-health-camera">
          <span className="media-health-dot" aria-hidden="true" />
          {camera.text}
        </li>
        {screen ? (
          <li className={`media-health is-${screen.tone}`} data-testid="media-health-screen">
            <span className="media-health-dot" aria-hidden="true" />
            {screen.text}
          </li>
        ) : null}
      </ul>
    </div>
  )
}
