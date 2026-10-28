import { useEffect, useRef, useState } from "react"

import "./media.css"

const hasLiveVideo = (stream: MediaStream): boolean => {
  const track = stream.getVideoTracks()[0]
  return Boolean(track && track.readyState === "live" && !track.muted)
}

export function VideoTile(props: { stream: MediaStream; label: string; muted?: boolean; className?: string }) {
  const { stream, label, muted, className } = props
  const videoRef = useRef<HTMLVideoElement>(null)
  const [showVideo, setShowVideo] = useState(() => hasLiveVideo(stream))

  useEffect(() => {
    const video = videoRef.current
    if (video && video.srcObject !== stream) {
      video.srcObject = stream
      void video.play().catch(() => undefined)
    }

    const update = () => setShowVideo(hasLiveVideo(stream))
    const tracks = stream.getVideoTracks()
    update()
    for (const track of tracks) {
      track.addEventListener("mute", update)
      track.addEventListener("unmute", update)
      track.addEventListener("ended", update)
    }
    stream.addEventListener("addtrack", update)
    stream.addEventListener("removetrack", update)

    return () => {
      for (const track of tracks) {
        track.removeEventListener("mute", update)
        track.removeEventListener("unmute", update)
        track.removeEventListener("ended", update)
      }
      stream.removeEventListener("addtrack", update)
      stream.removeEventListener("removetrack", update)
      if (video && video.srcObject === stream) video.srcObject = null
    }
  }, [stream])

  return (
    <div
      className={["media-tile", className].filter(Boolean).join(" ")}
      data-testid="video-tile"
      data-has-video={showVideo ? "true" : "false"}
    >
      <video ref={videoRef} className="media-tile-video" autoPlay playsInline muted={muted} />
      {!showVideo && (
        <div className="media-tile-fallback" aria-hidden="true">
          {label.trim().charAt(0).toUpperCase() || "?"}
        </div>
      )}
      <span className="media-tile-label">{label}</span>
    </div>
  )
}
