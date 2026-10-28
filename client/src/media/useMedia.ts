import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { OfficeMap, PlayerState, RtcSignal } from "@shared/types"

import { persistDeviceSettings } from "../desktop"
import { connection } from "../net/connection"
import { getState } from "../state/store"
import { isInitiator, nextConnected, tileDistance } from "./proximity"
import "./media.css"

export interface MediaConnectionStats {
  peers: number
  candidateType: string | null
  protocol: string | null
  direct: boolean
  rttMs: number | null
  jitterMs: number | null
  packetsLost: number | null
}

export interface MediaHealth {
  camera: { enabled: boolean; live: boolean; shown: boolean; pausedByScreenShare: boolean; viewers: number }
  screen: { sharing: boolean; live: boolean; framesFlowing: boolean; viewers: number }
  peers: number
}

export interface MediaApi {
  audioEnabled: boolean
  videoEnabled: boolean
  screenSharing: boolean
  mediaError: string | null
  /** Local camera preview (mirrored in the UI); null before the camera is acquired. */
  localStream: MediaStream | null
  /** Local screen-share preview; null unless a screen is being shared. */
  localScreenStream: MediaStream | null
  /** Live-capture health, so the user can see whether camera/screen is really going out. */
  mediaHealth: MediaHealth | null
  /** Selected-pair diagnostics per peer, refreshed every few seconds. */
  connectionStats: MediaConnectionStats | null
  remoteStreams: Map<string, MediaStream>
  remoteScreenSharing: Set<string>
  devices: { audioInputs: MediaDeviceInfo[]; videoInputs: MediaDeviceInfo[]; audioOutputs: MediaDeviceInfo[] }
  selected: { audioInputId: string | null; videoInputId: string | null; audioOutputId: string | null }
  toggleAudio(): void
  toggleCamera(): void
  startScreenShare(): Promise<void>
  stopScreenShare(): void
  selectAudioInput(id: string): Promise<void>
  selectVideoInput(id: string): Promise<void>
  selectAudioOutput(id: string): Promise<void>
}

interface MediaDevicesState {
  audioInputs: MediaDeviceInfo[]
  videoInputs: MediaDeviceInfo[]
  audioOutputs: MediaDeviceInfo[]
}

interface SelectedDevices {
  audioInputId: string | null
  videoInputId: string | null
  audioOutputId: string | null
}

interface PeerSession {
  pc: RTCPeerConnection
  /** Perfect negotiation: the higher id yields when both sides negotiate. */
  polite: boolean
  stream: MediaStream
  /** Null only when this side has no device and is the answering peer. */
  audioSender: RTCRtpSender | null
  videoSender: RTCRtpSender | null
  audioEl: HTMLAudioElement
  /** Candidates that arrived before the remote description was set. */
  pendingCandidates: RTCIceCandidateInit[]
  makingOffer: boolean
  ignoreOffer: boolean
  /** Two-stage recovery after a network blip; cleared once the transport is healthy. */
  recoveryTimer: ReturnType<typeof setTimeout> | null
}

interface PeerStatsEntry {
  id?: string
  type?: string
  state?: string
  nominated?: boolean
  currentRoundTripTime?: number
  localCandidateId?: string
  candidateType?: string
  protocol?: string
  kind?: string
  jitter?: number
  packetsLost?: number
  framesSent?: number
}

interface PeerStats {
  candidateType: string | null
  protocol: string | null
  rttMs: number | null
  jitterMs: number | null
  packetsLost: number | null
  videoFramesSent: number
}

interface MediaEngine {
  reconcile(): void
  applyAudio(): void
  applyVideo(): void
  startScreenShare(): Promise<void>
  stopScreenShare(): void
  selectAudioInput(id: string): Promise<void>
  selectVideoInput(id: string): Promise<void>
  selectAudioOutput(id: string): Promise<void>
  destroy(): void
}

const emptyDevices = (): MediaDevicesState => ({ audioInputs: [], videoInputs: [], audioOutputs: [] })

const selectedFromSettings = (): SelectedDevices => {
  const { settings } = getState()
  return {
    audioInputId: settings.audioInputId,
    videoInputId: settings.videoInputId,
    audioOutputId: settings.audioOutputId,
  }
}

const friendlyMediaError = (error: unknown, label: string): string => {
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Permissão de ${label} negada. O restante do app continua funcionando.`
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `Nenhum ${label} disponível neste computador.`
  }
  return `Não foi possível acessar o ${label}.`
}

const setSinkId = (audio: HTMLAudioElement, deviceId: string | null): void => {
  if (deviceId && typeof audio.setSinkId === "function") void audio.setSinkId(deviceId).catch(() => undefined)
}

export function useMedia(options: {
  selfId: string | null
  map: OfficeMap | null
  players: Record<string, PlayerState>
}): MediaApi {
  const selfIdRef = useRef(options.selfId)
  selfIdRef.current = options.selfId
  const playersRef = useRef(options.players)
  playersRef.current = options.players
  const mapRef = useRef(options.map)
  mapRef.current = options.map
  const selectedRef = useRef<SelectedDevices>(selectedFromSettings())
  const flagsRef = useRef({ audioEnabled: true, videoEnabled: true, screenSharing: false })

  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(() => new Map())
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
  const [connectionStats, setConnectionStats] = useState<MediaConnectionStats | null>(null)
  const [mediaHealth, setMediaHealth] = useState<MediaHealth | null>(null)
  const [devices, setDevices] = useState<MediaDevicesState>(emptyDevices)
  const [selected, setSelected] = useState<SelectedDevices>(selectedRef.current)
  const engineRef = useRef<MediaEngine | null>(null)

  // All WebRTC state lives inside this one effect closure: async negotiation and
  // connection events must not read stale React props.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setMediaError("Câmera e microfone não estão disponíveis neste ambiente.")
      return
    }

    let destroyed = false
    let localAudioTrack: MediaStreamTrack | null = null
    let localCameraTrack: MediaStreamTrack | null = null
    let localScreenTrack: MediaStreamTrack | null = null
    let localPreview: MediaStream | null = null
    let localScreenPreview: MediaStream | null = null
    let framesSentTotal = 0
    let framesSentLast = 0
    let lastFramesIncreaseAt = 0
    let lastHealthKey = ""
    // Negotiation waits for the device acquisition attempt: Chrome only associates
    // transceivers created by addTrack (not addTransceiver) when applying a remote offer.
    let mediaReady = false
    const pendingSignals: { from: string; data: RtcSignal }[] = []
    const peers = new Map<string, PeerSession>()
    // Online deployments receive public STUN/TURN servers here; the offline app's own
    // server returns an empty list, so no media traffic ever leaves the LAN.
    let iceServers: RTCIceServer[] = []
    const loadIceServers = async (): Promise<void> => {
      try {
        const response = await fetch("/client-config.json", { cache: "no-store" })
        if (!response.ok) return
        const config = (await response.json()) as { iceServers?: RTCIceServer[] }
        if (Array.isArray(config.iceServers)) iceServers = config.iceServers
      } catch {
        // No config (or offline guard): keep host candidates only.
      }
    }

    // Local preview for the settings panel; CSS mirrors it so it reads like a mirror.
    const publishLocalStream = () => {
      if (!localPreview) localPreview = new MediaStream()
      for (const track of localPreview.getVideoTracks()) localPreview.removeTrack(track)
      if (localCameraTrack) localPreview.addTrack(localCameraTrack)
      setLocalStream(localPreview)
    }

    const syncDatasets = (streams: Map<string, MediaStream>) => {
      if (destroyed) return
      document.body.dataset.mediaPeers = String(peers.size)
      document.body.dataset.mediaRemote = [...streams.keys()].join(",")
    }

    const emitRemoteStreams = () => {
      if (destroyed) return
      const received = new Map<string, MediaStream>()
      for (const [peerId, session] of peers) {
        if (session.stream.getTracks().length > 0) received.set(peerId, session.stream)
      }
      setRemoteStreams(received)
      syncDatasets(received)
    }

    syncDatasets(new Map())

    const desiredVideoTrack = (): MediaStreamTrack | null =>
      localScreenTrack ?? (flagsRef.current.videoEnabled ? localCameraTrack : null)

    const applyAudio = () => {
      if (localAudioTrack) localAudioTrack.enabled = flagsRef.current.audioEnabled
      for (const session of peers.values()) {
        if (session.audioSender) void session.audioSender.replaceTrack(localAudioTrack).catch(() => undefined)
      }
    }

    const applyVideo = () => {
      const track = desiredVideoTrack()
      for (const session of peers.values()) {
        if (session.videoSender) void session.videoSender.replaceTrack(track).catch(() => undefined)
      }
    }

    const closePeer = (peerId: string) => {
      const session = peers.get(peerId)
      if (!session) return
      if (session.recoveryTimer) clearTimeout(session.recoveryTimer)
      session.recoveryTimer = null
      peers.delete(peerId)
      session.pc.onnegotiationneeded = null
      session.pc.onicecandidate = null
      session.pc.ontrack = null
      session.pc.onconnectionstatechange = null
      session.pc.close()
      session.audioEl.remove()
      emitRemoteStreams()
    }

    const createPeer = (peerId: string): PeerSession => {
      // Offline LAN only: no STUN/TURN, ICE uses host candidates.
      const pc = new RTCPeerConnection({ iceServers, bundlePolicy: "max-bundle", iceCandidatePoolSize: 2 })
      const stream = new MediaStream()
      const audioEl = document.createElement("audio")
      // addTrack (not addTransceiver) so an answering peer's transceivers are matched
      // to the remote offer's m-lines; only the lower id offers, so it can use
      // addTransceiver for a kind whose device is missing and still receive it.
      const initiator = isInitiator(selfIdRef.current ?? "", peerId)
      const initialVideoTrack = localScreenTrack ?? localCameraTrack
      const audioSender = localAudioTrack
        ? pc.addTrack(localAudioTrack)
        : initiator
          ? pc.addTransceiver("audio", { direction: "sendrecv" }).sender
          : null
      const videoSender = initialVideoTrack
        ? pc.addTrack(initialVideoTrack)
        : initiator
          ? pc.addTransceiver("video", { direction: "sendrecv" }).sender
          : null
      const session: PeerSession = {
        pc,
        polite: !initiator,
        stream,
        audioSender,
        videoSender,
        audioEl,
        pendingCandidates: [],
        makingOffer: false,
        ignoreOffer: false,
        recoveryTimer: null,
      }

      audioEl.autoplay = true
      audioEl.volume = 1
      audioEl.style.display = "none"
      audioEl.srcObject = stream
      setSinkId(audioEl, selectedRef.current.audioOutputId)
      document.body.appendChild(audioEl)
      void audioEl.play().catch(() => undefined)

      pc.onnegotiationneeded = async () => {
        // Contract: the lower id opens the session and the higher id only answers it.
        // The higher id never needs to renegotiate either: track swaps use replaceTrack,
        // and a dead transport is closed and recreated by the lower id.
        if (!isInitiator(selfIdRef.current ?? "", peerId)) return
        if (session.makingOffer || pc.signalingState !== "stable") return
        try {
          session.makingOffer = true
          await pc.setLocalDescription()
          const description = pc.localDescription
          if (description?.sdp) connection.sendSignal(peerId, { kind: "offer", sdp: description.sdp })
        } catch {
          // The peer was closed while negotiating; closePeer() already cleaned up.
        } finally {
          session.makingOffer = false
        }
      }

      pc.onicecandidate = ({ candidate }) => {
        connection.sendSignal(peerId, {
          kind: "ice",
          candidate: candidate
            ? { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex }
            : null,
        })
      }

      pc.ontrack = ({ track }) => {
        const previous = stream.getTracks().find((existing) => existing.kind === track.kind)
        if (previous && previous !== track) stream.removeTrack(previous)
        if (!stream.getTracks().includes(track)) stream.addTrack(track)
        emitRemoteStreams()
      }

      pc.onconnectionstatechange = () => {
        const connectionState = pc.connectionState
        if (connectionState === "connected") {
          if (session.recoveryTimer) clearTimeout(session.recoveryTimer)
          session.recoveryTimer = null
          return
        }
        // A failed transport is recreated by reconcile(); a stuck session would linger otherwise.
        if (connectionState === "failed") {
          if (session.recoveryTimer) clearTimeout(session.recoveryTimer)
          session.recoveryTimer = null
          closePeer(peerId)
          return
        }
        if (connectionState !== "disconnected" || session.recoveryTimer) return
        // Network blip: let ICE recover on its own, then restart it once (initiator only),
        // and finally drop the session so reconcile() builds a fresh one while still nearby.
        session.recoveryTimer = setTimeout(() => {
          session.recoveryTimer = null
          if (pc.connectionState !== "disconnected") return
          try {
            if (isInitiator(selfIdRef.current ?? "", peerId)) pc.restartIce()
          } catch {
            // Transport already gone; the failure handler cleans up.
          }
          session.recoveryTimer = setTimeout(() => {
            session.recoveryTimer = null
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") closePeer(peerId)
          }, 8000)
        }, 4000)
      }

      peers.set(peerId, session)
      emitRemoteStreams()
      applyAudio()
      applyVideo()
      return session
    }

    const reconcile = () => {
      if (destroyed || !mediaReady) return
      const selfId = selfIdRef.current
      const players = playersRef.current
      const map = mapRef.current
      const selfPlayer = selfId ? players[selfId] : undefined
      if (!selfId || !selfPlayer || !map) return

      const forced =
        flagsRef.current.screenSharing ||
        Object.values(players).some((player) => player.id !== selfId && player.screenSharing)

      const desired = new Set<string>()
      for (const player of Object.values(players)) {
        if (player.id === selfId) continue
        if (forced || nextConnected(peers.has(player.id), tileDistance(selfPlayer, player, map.tileSize))) {
          desired.add(player.id)
        }
      }

      for (const peerId of [...peers.keys()]) if (!desired.has(peerId)) closePeer(peerId)
      for (const peerId of desired) if (!peers.has(peerId)) createPeer(peerId)
    }

    const handleSignal = async ({ from, data }: { from: string; data: RtcSignal }) => {
      if (destroyed) return
      if (!mediaReady) {
        pendingSignals.push({ from, data })
        return
      }
      let session = peers.get(from)
      if (!session) {
        // Candidates/answers without a session are stale; an offer means the peer wants a session.
        if (data.kind !== "offer") return
        session = createPeer(from)
      }
      const { pc } = session
      try {
        if (data.kind === "ice") {
          if (!data.candidate) return
          if (!pc.remoteDescription) {
            session.pendingCandidates.push(data.candidate)
            return
          }
          await pc.addIceCandidate(data.candidate)
          return
        }

        const offerCollision = data.kind === "offer" && (session.makingOffer || pc.signalingState !== "stable")
        session.ignoreOffer = !session.polite && offerCollision
        if (session.ignoreOffer) return

        // A polite peer sets the remote offer even mid-negotiation; the browser rolls back implicitly.
        await pc.setRemoteDescription({ type: data.kind, sdp: data.sdp })
        for (const candidate of session.pendingCandidates.splice(0)) {
          await pc.addIceCandidate(candidate).catch(() => undefined)
        }

        if (data.kind === "offer") {
          await pc.setLocalDescription()
          const description = pc.localDescription
          if (description?.sdp) connection.sendSignal(from, { kind: "answer", sdp: description.sdp })
        }
      } catch {
        // Signaling races with a peer leaving are expected; reconcile() cleans up.
      }
    }

    const acquireTrack = async (kind: "audio" | "video", deviceId: string | null): Promise<MediaStreamTrack | null> => {
      const label = kind === "audio" ? "microfone" : "câmera"
      const constraintsFor = (id: string | null): MediaStreamConstraints =>
        kind === "audio"
          ? { audio: { ...(id ? { deviceId: { exact: id } } : {}), echoCancellation: true, noiseSuppression: true } }
          : {
              video: {
                ...(id ? { deviceId: { exact: id } } : {}),
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 24 },
              },
            }
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraintsFor(deviceId))
        return stream.getTracks()[0] ?? null
      } catch (error) {
        // A saved device can be gone; fall back to the system default before reporting a failure.
        if (deviceId) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia(constraintsFor(null))
            return stream.getTracks()[0] ?? null
          } catch {
            // Report the original failure below.
          }
        }
        if (!destroyed) setMediaError(friendlyMediaError(error, label))
        return null
      }
    }

    const refreshDevices = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices()
        if (destroyed) return
        setDevices({
          audioInputs: list.filter((device) => device.kind === "audioinput"),
          videoInputs: list.filter((device) => device.kind === "videoinput"),
          audioOutputs: list.filter((device) => device.kind === "audiooutput"),
        })
      } catch {
        // enumerateDevices is unavailable in some locked-down browsers; keep the empty list.
      }
    }

    const stopScreenTrack = () => {
      const track = localScreenTrack
      localScreenTrack = null
      if (track) {
        track.onended = null
        track.stop()
      }
    }

    const stopScreenShare = () => {
      if (!localScreenTrack && !flagsRef.current.screenSharing) return
      stopScreenTrack()
      localScreenPreview = null
      setLocalScreenStream(null)
      flagsRef.current.screenSharing = false
      setScreenSharing(false)
      connection.sendMedia({ screenSharing: false })
      applyVideo()
      reconcile()
      refreshHealth()
    }

    const startScreenShare = async () => {
      if (localScreenTrack) return
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        const track = stream.getVideoTracks()[0] ?? null
        if (!track) return
        localScreenTrack = track
        localScreenPreview = new MediaStream([track])
        setLocalScreenStream(localScreenPreview)
        track.onended = () => stopScreenShare()
        flagsRef.current.screenSharing = true
        setScreenSharing(true)
        connection.sendMedia({ screenSharing: true })
        applyVideo()
        reconcile()
        refreshHealth()
      } catch (error) {
        // Cancelling the picker is expected and needs no message.
        if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) return
        setMediaError("Não foi possível compartilhar a tela.")
      }
    }

    const selectAudioInput = async (id: string) => {
      const track = await acquireTrack("audio", id)
      if (destroyed || !track) return
      const previous = localAudioTrack
      localAudioTrack = track
      applyAudio()
      previous?.stop()
      selectedRef.current.audioInputId = id
      setSelected((current) => ({ ...current, audioInputId: id }))
      await persistDeviceSettings({ audioInputId: id }).catch(() => undefined)
      await refreshDevices()
    }

    const selectVideoInput = async (id: string) => {
      const track = await acquireTrack("video", id)
      if (destroyed || !track) return
      const previous = localCameraTrack
      localCameraTrack = track
      publishLocalStream()
      applyVideo()
      previous?.stop()
      selectedRef.current.videoInputId = id
      setSelected((current) => ({ ...current, videoInputId: id }))
      await persistDeviceSettings({ videoInputId: id }).catch(() => undefined)
      await refreshDevices()
    }

    const selectAudioOutput = async (id: string) => {
      selectedRef.current.audioOutputId = id
      setSelected((current) => ({ ...current, audioOutputId: id }))
      for (const session of peers.values()) setSinkId(session.audioEl, id)
      await persistDeviceSettings({ audioOutputId: id }).catch(() => undefined)
    }

    void (async () => {
      await loadIceServers()
      const [audioTrack, cameraTrack] = await Promise.all([
        acquireTrack("audio", selectedRef.current.audioInputId),
        acquireTrack("video", selectedRef.current.videoInputId),
      ])
      if (destroyed) {
        audioTrack?.stop()
        cameraTrack?.stop()
        return
      }
      localAudioTrack = audioTrack
      localCameraTrack = cameraTrack
      publishLocalStream()
      mediaReady = true
      applyAudio()
      applyVideo()
      reconcile()
      for (const signal of pendingSignals.splice(0)) void handleSignal(signal)
      await refreshDevices()
    })()

    const offSignal = connection.onSignal(handleSignal)

    const offConnected = connection.onConnected(() => {
      // New selfId after a reconnect: every old peer connection is dead.
      for (const peerId of [...peers.keys()]) closePeer(peerId)
      connection.sendMedia({
        audioEnabled: flagsRef.current.audioEnabled,
        videoEnabled: flagsRef.current.videoEnabled,
        screenSharing: flagsRef.current.screenSharing,
      })
    })

    const offClosed = connection.onClosed(() => {
      for (const peerId of [...peers.keys()]) closePeer(peerId)
    })

    // The office mounts after `welcome`, so the initial flags must be broadcast here;
    // onConnected covers the reconnects where the hook was already mounted.
    if (selfIdRef.current) {
      connection.sendMedia({
        audioEnabled: flagsRef.current.audioEnabled,
        videoEnabled: flagsRef.current.videoEnabled,
        screenSharing: flagsRef.current.screenSharing,
      })
    }

    const readPeerStats = async (pc: RTCPeerConnection): Promise<PeerStats> => {
      const report = await pc.getStats()
      const entries = new Map<string, PeerStatsEntry>()
      report.forEach((raw) => {
        const entry = raw as PeerStatsEntry
        if (entry.id) entries.set(entry.id, entry)
      })
      let candidateType: string | null = null
      let protocol: string | null = null
      let rttMs: number | null = null
      let jitterMs: number | null = null
      let packetsLost: number | null = null
      for (const entry of entries.values()) {
        if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated) {
          candidateType = entries.get(entry.localCandidateId ?? "")?.candidateType ?? candidateType
          protocol = entries.get(entry.localCandidateId ?? "")?.protocol ?? protocol
          if (typeof entry.currentRoundTripTime === "number") rttMs = Math.round(entry.currentRoundTripTime * 1000)
        }
        if (entry.type === "inbound-rtp" && entry.kind === "audio") {
          if (typeof entry.jitter === "number") jitterMs = Math.round(entry.jitter * 1000)
          if (typeof entry.packetsLost === "number") packetsLost = entry.packetsLost
        }
      }
      let videoFramesSent = 0
      for (const entry of entries.values()) {
        if (entry.type === "outbound-rtp" && entry.kind === "video" && typeof entry.framesSent === "number") {
          videoFramesSent += entry.framesSent
        }
      }
      return { candidateType, protocol, rttMs, jitterMs, packetsLost, videoFramesSent }
    }

    const refreshHealth = (): void => {
      if (destroyed) return
      const cameraTrack = localCameraTrack
      const screenTrack = localScreenTrack
      const cameraLive = Boolean(
        cameraTrack && cameraTrack.readyState === "live" && !cameraTrack.muted && flagsRef.current.videoEnabled,
      )
      const screenLive = Boolean(
        screenTrack && screenTrack.readyState === "live" && !screenTrack.muted && flagsRef.current.screenSharing,
      )
      const sharing = flagsRef.current.screenSharing
      const peersCount = peers.size
      const next: MediaHealth = {
        camera: {
          enabled: flagsRef.current.videoEnabled,
          live: cameraLive,
          shown: cameraLive && !sharing,
          pausedByScreenShare: cameraLive && sharing,
          viewers: cameraLive && !sharing ? peersCount : 0,
        },
        screen: {
          sharing,
          live: screenLive,
          framesFlowing: screenLive && (Date.now() - lastFramesIncreaseAt < 6_000 || peersCount === 0),
          viewers: sharing ? peersCount : 0,
        },
        peers: peersCount,
      }
      const key = JSON.stringify(next)
      if (key !== lastHealthKey) {
        lastHealthKey = key
        setMediaHealth(next)
        document.body.dataset.mediaHealth = key
      }
    }

    const collectStats = async (): Promise<void> => {
      if (destroyed) return
      if (peers.size === 0) {
        setConnectionStats(null)
        document.body.dataset.mediaStats = ""
        refreshHealth()
        return
      }
      const merged: MediaConnectionStats = {
        peers: peers.size,
        candidateType: null,
        protocol: null,
        direct: false,
        rttMs: null,
        jitterMs: null,
        packetsLost: null,
      }
      for (const session of peers.values()) {
        try {
          const stats = await readPeerStats(session.pc)
          merged.candidateType = merged.candidateType ?? stats.candidateType ?? null
          merged.protocol = merged.protocol ?? stats.protocol ?? null
          merged.rttMs = merged.rttMs ?? stats.rttMs ?? null
          merged.jitterMs = merged.jitterMs ?? stats.jitterMs ?? null
          merged.packetsLost = merged.packetsLost ?? stats.packetsLost ?? null
          framesSentTotal += stats.videoFramesSent ?? 0
        } catch {
          // A closing peer can make getStats reject; the next tick retries.
        }
      }
      merged.direct = merged.candidateType === "host" || merged.candidateType === "srflx" || merged.candidateType === "prflx"
      setConnectionStats(merged)
      document.body.dataset.mediaStats = JSON.stringify(merged)
      if (framesSentTotal > framesSentLast) lastFramesIncreaseAt = Date.now()
      framesSentLast = framesSentTotal
      refreshHealth()
    }
    const statsTimer = setInterval(() => {
      framesSentTotal = 0
      void collectStats()
    }, 5000)
    const healthTimer = setInterval(refreshHealth, 2000)
    refreshHealth()

    // Watchdog: a stale signal or a lost effect must not leave a ghost connection forever.
    const watchdog = setInterval(reconcile, 2000)

    const destroy = () => {
      if (destroyed) return
      destroyed = true
      clearInterval(watchdog)
      offSignal()
      offConnected()
      offClosed()
      for (const peerId of [...peers.keys()]) closePeer(peerId)
      clearInterval(statsTimer)
      clearInterval(healthTimer)
      setConnectionStats(null)
      setMediaHealth(null)
      setLocalStream(null)
      setLocalScreenStream(null)
      document.body.dataset.mediaStats = ""
      stopScreenTrack()
      localAudioTrack?.stop()
      localCameraTrack?.stop()
      localAudioTrack = null
      localCameraTrack = null
      engineRef.current = null
      document.body.dataset.mediaPeers = "0"
      document.body.dataset.mediaRemote = ""
    }

    engineRef.current = {
      reconcile,
      applyAudio,
      applyVideo,
      startScreenShare,
      stopScreenShare,
      selectAudioInput,
      selectVideoInput,
      selectAudioOutput,
      destroy,
    }

    return destroy
  }, [])

  // Peer membership follows the players/proximity state on every render.
  useEffect(() => {
    engineRef.current?.reconcile()
  })

  const toggleAudio = useCallback(() => {
    const enabled = !flagsRef.current.audioEnabled
    flagsRef.current.audioEnabled = enabled
    setAudioEnabled(enabled)
    engineRef.current?.applyAudio()
    connection.sendMedia({ audioEnabled: enabled })
  }, [])

  const toggleCamera = useCallback(() => {
    const enabled = !flagsRef.current.videoEnabled
    flagsRef.current.videoEnabled = enabled
    setVideoEnabled(enabled)
    engineRef.current?.applyVideo()
    connection.sendMedia({ videoEnabled: enabled })
  }, [])

  const startScreenShare = useCallback(async () => {
    await engineRef.current?.startScreenShare()
  }, [])

  const stopScreenShare = useCallback(() => {
    engineRef.current?.stopScreenShare()
  }, [])

  const selectAudioInput = useCallback(async (id: string) => {
    await engineRef.current?.selectAudioInput(id)
  }, [])

  const selectVideoInput = useCallback(async (id: string) => {
    await engineRef.current?.selectVideoInput(id)
  }, [])

  const selectAudioOutput = useCallback(async (id: string) => {
    await engineRef.current?.selectAudioOutput(id)
  }, [])

  const remoteScreenSharing = useMemo(() => {
    const sharing = new Set<string>()
    for (const player of Object.values(options.players)) {
      if (player.id !== options.selfId && player.screenSharing && remoteStreams.has(player.id)) sharing.add(player.id)
    }
    return sharing
  }, [options.players, options.selfId, remoteStreams])

  return useMemo<MediaApi>(
    () => ({
      audioEnabled,
      videoEnabled,
      screenSharing,
      mediaError,
      localStream,
      localScreenStream,
      mediaHealth,
      connectionStats,
      remoteStreams,
      remoteScreenSharing,
      devices,
      selected,
      toggleAudio,
      toggleCamera,
      startScreenShare,
      stopScreenShare,
      selectAudioInput,
      selectVideoInput,
      selectAudioOutput,
    }),
    [
      audioEnabled,
      videoEnabled,
      screenSharing,
      mediaError,
      localStream,
      localScreenStream,
      mediaHealth,
      connectionStats,
      remoteStreams,
      remoteScreenSharing,
      devices,
      selected,
      toggleAudio,
      toggleCamera,
      startScreenShare,
      stopScreenShare,
      selectAudioInput,
      selectVideoInput,
      selectAudioOutput,
    ],
  )
}
