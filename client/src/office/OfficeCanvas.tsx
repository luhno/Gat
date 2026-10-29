import { useEffect, useRef, type JSX, type RefObject } from "react"

import { resolveMovement, tileCenter } from "@shared/collision"
import type { Direction, PlayerState } from "@shared/types"

import { STATUS_COLORS } from "../components/palette"
import { VideoTile } from "../media/VideoTile"
import { isReducedMotion } from "../audio/uiSound"
import type { MoveVector } from "../mobile/VirtualJoystick"
import { connection } from "../net/connection"
import { getState, useStore } from "../state/store"
import { AVATAR_LABEL_OFFSET } from "./avatar"
import { drawScene, worldView, type RenderPlayer } from "./scene"

// Full-screen office renderer. The animation loop reads getState() directly so movement
// never re-renders React; only HUD/panels re-render from the store.

const WALK_SPEED = 115 // world px/s ≈ 3.6 tiles/s
const VIEW_TILES_W = 27
const VIEW_TILES_H = 17
const MIN_ZOOM = 0.62
const MAX_ZOOM = 1.8
const CAMERA_EASE = 7
const MOVE_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"])

interface RemoteVisual {
  x: number
  y: number
  dir: Direction
  moving: boolean
  state: PlayerState | null
}

const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable
}

const clampAxis = (value: number, viewSize: number, mapSize: number): number => {
  if (viewSize >= mapSize) return mapSize / 2
  const half = viewSize / 2
  return Math.min(Math.max(value, half), mapSize - half)
}

export function OfficeCanvas({
  streams,
  moveInput,
  touch,
}: {
  streams: Map<string, MediaStream>
  /** Touch joystick vector read by the render loop (no React re-render while walking). */
  moveInput?: RefObject<MoveVector>
  touch?: boolean
}): JSX.Element {
  const state = useStore()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const anchorsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const anchors = anchorsRef.current
    if (!(canvas instanceof HTMLCanvasElement) || !anchors) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let frame = 0
    let disposed = false
    let cssW = 1
    let cssH = 1
    let dpr = 1
    let zoom = 1
    let lastFrame = performance.now()
    const camera = { x: 0, y: 0 }
    let cameraReady = false
    let selfX = 0
    let selfY = 0
    let selfDir: Direction = "down"
    let selfMoving = false
    let selfReady = false
    let syncedX = Number.NaN
    let syncedY = Number.NaN
    let syncedDir: Direction = "down"
    let syncedMoving = false
    let lastSync = 0
    const keys = new Set<string>()
    let walkTarget: { x: number; y: number } | null = null
    let stallTime = 0
    const visuals = new Map<string, RemoteVisual>()
    // Speaking activity comes from the media engine via a tiny dataset channel (no React re-render).
    let speakingPeers = new Set<string>()
    let speakingPulse = true
    let lastSpeakingPoll = 0

    const resize = (): void => {
      const parent = canvas.parentElement
      const rect = (parent ?? canvas).getBoundingClientRect()
      cssW = Math.max(1, rect.width)
      cssH = Math.max(1, rect.height)
      dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      const map = getState().map
      const tile = map?.tileSize ?? 32
      const fit = Math.min(cssW / (VIEW_TILES_W * tile), cssH / (VIEW_TILES_H * tile))
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit))
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTyping(event.target)) return
      const key = event.key.toLowerCase()
      if (!MOVE_KEYS.has(key)) return
      keys.add(key)
      walkTarget = null
      event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      keys.delete(event.key.toLowerCase())
    }
    const onBlur = (): void => keys.clear()

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      const map = getState().map
      if (!map) return
      if (isTyping(event.target)) return
      const rect = canvas.getBoundingClientRect()
      const worldX = (event.clientX - rect.left - cssW / 2) / zoom + camera.x
      const worldY = (event.clientY - rect.top - cssH / 2) / zoom + camera.y
      if (worldX < 0 || worldY < 0 || worldX > map.width * map.tileSize || worldY > map.height * map.tileSize) return
      walkTarget = { x: worldX, y: worldY }
      stallTime = 0
      canvas.focus({ preventScroll: true })
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas.parentElement ?? canvas)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    canvas.addEventListener("pointerdown", onPointerDown)

    const updateAnchors = (stateNow: ReturnType<typeof getState>): void => {
      const offset = AVATAR_LABEL_OFFSET * zoom + 6
      for (const node of Array.from(anchors.children)) {
        const element = node as HTMLElement
        const id = element.dataset.playerId
        if (!id) continue
        let worldX: number
        let worldY: number
        if (id === stateNow.selfId) {
          worldX = selfX
          worldY = selfY
        } else {
          const visual = visuals.get(id)
          if (!visual) {
            element.style.display = "none"
            continue
          }
          worldX = visual.x
          worldY = visual.y
        }
        element.style.display = ""
        const screenX = (worldX - camera.x) * zoom + cssW / 2
        const screenY = (worldY - camera.y) * zoom + cssH / 2 - offset
        element.style.transform = `translate3d(${screenX.toFixed(1)}px, ${screenY.toFixed(1)}px, 0)`
      }
    }

    const tick = (now: number): void => {
      if (disposed) return
      frame = window.requestAnimationFrame(tick)
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000))
      lastFrame = now
      const stateNow = getState()
      const map = stateNow.map
      if (!map) return
      const tile = map.tileSize

      if (!selfReady) {
        const self = stateNow.selfId ? stateNow.players[stateNow.selfId] : null
        const spawn = tileCenter(map, map.spawn.x, map.spawn.y)
        selfX = self ? self.x : spawn.x
        selfY = self ? self.y : spawn.y
        selfDir = self ? self.dir : "down"
        selfReady = true
      } else if (stateNow.selfId) {
        // Server-side respawn/correction: snap instead of walking through the map.
        const self = stateNow.players[stateNow.selfId]
        if (self && Math.hypot(self.x - selfX, self.y - selfY) > 64) {
          selfX = self.x
          selfY = self.y
          selfDir = self.dir
        }
      }

      let inputX = 0
      let inputY = 0
      if (keys.has("a") || keys.has("arrowleft")) inputX -= 1
      if (keys.has("d") || keys.has("arrowright")) inputX += 1
      if (keys.has("w") || keys.has("arrowup")) inputY -= 1
      if (keys.has("s") || keys.has("arrowdown")) inputY += 1
      const analog = moveInput?.current
      if (analog && (analog.x !== 0 || analog.y !== 0)) {
        inputX = analog.x
        inputY = analog.y
      }

      if (inputX !== 0 || inputY !== 0) {
        walkTarget = null
        const length = Math.hypot(inputX, inputY)
        // Joystick deflection scales the speed; keyboard input is always ≥ 1 (diagonal is √2).
        const strength = Math.min(1, length)
        const stepX = (inputX / length) * WALK_SPEED * strength * dt
        const stepY = (inputY / length) * WALK_SPEED * strength * dt
        const moved = resolveMovement(map, { x: selfX, y: selfY }, { x: selfX + stepX, y: selfY + stepY })
        selfX = moved.x
        selfY = moved.y
        selfDir = Math.abs(inputX) > Math.abs(inputY) ? (inputX > 0 ? "right" : "left") : inputY > 0 ? "down" : "up"
        selfMoving = true
      } else if (walkTarget) {
        const deltaX = walkTarget.x - selfX
        const deltaY = walkTarget.y - selfY
        const distance = Math.hypot(deltaX, deltaY)
        if (distance < 4) {
          walkTarget = null
          selfMoving = false
        } else {
          const step = Math.min(distance, WALK_SPEED * dt)
          const moved = resolveMovement(map, { x: selfX, y: selfY }, { x: selfX + (deltaX / distance) * step, y: selfY + (deltaY / distance) * step })
          const advanced = Math.hypot(moved.x - selfX, moved.y - selfY)
          selfDir = Math.abs(deltaX) > Math.abs(deltaY) ? (deltaX > 0 ? "right" : "left") : deltaY > 0 ? "down" : "up"
          selfX = moved.x
          selfY = moved.y
          selfMoving = true
          if (advanced < step * 0.25) {
            stallTime += dt
            if (stallTime > 0.25) {
              walkTarget = null
              selfMoving = false
            }
          } else {
            stallTime = 0
          }
        }
      } else {
        selfMoving = false
      }

      if (selfReady && stateNow.selfId) {
        const dirty = selfX !== syncedX || selfY !== syncedY || selfDir !== syncedDir || selfMoving !== syncedMoving
        if (dirty && (now - lastSync >= 90 || !selfMoving)) {
          connection.queueMove(selfX, selfY, selfDir, selfMoving)
          lastSync = now
          syncedX = selfX
          syncedY = selfY
          syncedDir = selfDir
          syncedMoving = selfMoving
        }
      }

      // Remote players: exponential interpolation between server updates.
      const alive = new Set<string>()
      const ease = 1 - Math.exp(-dt * 16)
      for (const [id, player] of Object.entries(stateNow.players)) {
        if (id === stateNow.selfId) continue
        alive.add(id)
        const visual = visuals.get(id)
        if (!visual) {
          visuals.set(id, { x: player.x, y: player.y, dir: player.dir, moving: player.moving, state: player })
          continue
        }
        visual.state = player
        visual.dir = player.dir
        visual.moving = player.moving
        visual.x += (player.x - visual.x) * ease
        visual.y += (player.y - visual.y) * ease
        if (Math.hypot(player.x - visual.x, player.y - visual.y) > 200) {
          visual.x = player.x
          visual.y = player.y
        }
      }
      for (const id of Array.from(visuals.keys())) if (!alive.has(id)) visuals.delete(id)

      if (!cameraReady) {
        camera.x = selfX
        camera.y = selfY
        cameraReady = true
      }
      const cameraEase = 1 - Math.exp(-dt * CAMERA_EASE)
      camera.x += (selfX - camera.x) * cameraEase
      camera.y += (selfY - camera.y) * cameraEase
      camera.x = clampAxis(camera.x, cssW / zoom, map.width * tile)
      camera.y = clampAxis(camera.y, cssH / zoom, map.height * tile)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = "#0c0f15"
      ctx.fillRect(0, 0, cssW, cssH)
      ctx.save()
      ctx.translate(cssW / 2, cssH / 2)
      ctx.scale(zoom, zoom)
      ctx.translate(-camera.x, -camera.y)

      if (now - lastSpeakingPoll > 120) {
        lastSpeakingPoll = now
        speakingPeers = new Set(
          (document.body.dataset.speaking ?? "")
            .split(",")
            .filter(Boolean),
        )
        speakingPulse = !isReducedMotion()
      }

      const renderPlayers: RenderPlayer[] = []
      const self = stateNow.selfId ? stateNow.players[stateNow.selfId] : null
      if (stateNow.selfId) {
        renderPlayers.push({
          id: stateNow.selfId,
          x: selfX,
          y: selfY,
          dir: selfDir,
          moving: selfMoving,
          shirtColor: self?.shirtColor ?? stateNow.profile.shirtColor,
          skinTone: self?.skinTone ?? stateNow.profile.skinTone,
          hairStyle: self?.hairStyle ?? stateNow.profile.hairStyle,
          status: self?.status ?? stateNow.profile.status,
          speaking: Boolean(stateNow.selfId && speakingPeers.has(stateNow.selfId)),
          speakingPulse,
        })
      }
      for (const [id, visual] of visuals) {
        const player = stateNow.players[id]
        if (!player) continue
        renderPlayers.push({
          id,
          x: visual.x,
          y: visual.y,
          dir: visual.dir,
          moving: visual.moving,
          shirtColor: player.shirtColor,
          skinTone: player.skinTone,
          hairStyle: player.hairStyle,
          status: player.status,
          speaking: speakingPeers.has(id),
          speakingPulse,
        })
      }
      drawScene(ctx, map, renderPlayers, stateNow.selfId, now / 1000, worldView(camera.x, camera.y, cssW, cssH, zoom))
      ctx.restore()

      const vignette = ctx.createRadialGradient(cssW / 2, cssH / 2, Math.min(cssW, cssH) * 0.36, cssW / 2, cssH / 2, Math.max(cssW, cssH) * 0.78)
      vignette.addColorStop(0, "rgba(0,0,0,0)")
      vignette.addColorStop(1, "rgba(0,0,0,0.42)")
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, cssW, cssH)

      updateAnchors(stateNow)
    }

    frame = window.requestAnimationFrame(tick)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      canvas.removeEventListener("pointerdown", onPointerDown)
    }
  }, [])

  return (
    <div className="office-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="office-canvas"
        data-testid="office-canvas"
        tabIndex={0}
        role="application"
        aria-label={
          touch
            ? "Escritório virtual. Arraste o joystick à esquerda para andar, ou toque no chão para ir até o ponto."
            : "Escritório virtual. Use W A S D ou as setas para andar, ou clique no chão para ir até o ponto."
        }
      />
      <div ref={anchorsRef} className="player-anchors">
        {Object.entries(state.players).map(([id, player]) => {
          const isSelf = id === state.selfId
          const stream = streams.get(id)
          return (
            <div key={id} className="player-anchor" data-player-id={id}>
              <div className="player-anchor-inner">
                {stream ? (
                  <div className="anchor-video">
                    <VideoTile stream={stream} label={player.name} />
                  </div>
                ) : null}
                <div
                  className={isSelf ? "player-label is-self" : "player-label"}
                  data-testid={isSelf ? "office-self-name" : `player-${player.name}`}
                >
                  <span className="player-status" style={{ backgroundColor: STATUS_COLORS[player.status] }} />
                  <span className="player-name">{player.name}</span>
                  {isSelf ? <span className="player-you">você</span> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
