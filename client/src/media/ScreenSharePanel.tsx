import { useEffect, useRef } from "react"

import "./media.css"

export function ScreenSharePanel(props: { stream: MediaStream; label: string; onClose(): void }) {
  const { stream, label, onClose } = props
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    void video.play().catch(() => undefined)
    return () => {
      if (video.srcObject === stream) video.srcObject = null
    }
  }, [stream])

  return (
    <section
      className="media-screen-share"
      role="dialog"
      aria-modal="true"
      aria-label={`Tela compartilhada por ${label}`}
      data-testid="screen-share"
    >
      <header className="media-screen-share-header">
        <span className="media-screen-share-title">{label} está compartilhando a tela</span>
        <button
          type="button"
          className="media-screen-share-close"
          onClick={onClose}
          aria-label="Fechar compartilhamento de tela"
        >
          Fechar
        </button>
      </header>
      <video ref={videoRef} className="media-screen-share-video" autoPlay playsInline muted />
    </section>
  )
}
