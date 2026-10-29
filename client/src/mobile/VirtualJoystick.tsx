import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react"

export interface MoveVector {
  x: number
  y: number
}

const SIZE = 132
const THUMB = 56
/** Max distance the thumb (and the reported vector) travels from the center. */
const RADIUS = (SIZE - THUMB) / 2
const DEAD_ZONE = 0.18
const NO_MOVE: MoveVector = { x: 0, y: 0 }

/**
 * Analog drag joystick for touch screens. Reports -1..1 per axis (dead zone applied) while a
 * finger is down and (0,0) on release/cancel. Tracks a single pointer on purpose: a second finger
 * can keep tapping HUD buttons (mic, chat…) while the avatar walks.
 */
export function VirtualJoystick({ onChange }: { onChange: (move: MoveVector) => void }) {
  const baseRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const pointerRef = useRef<number | null>(null)
  // Stable after mount: OfficeScreen re-renders on every server move, and a changing callback
  // identity must not reset a joystick that is being dragged.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const reset = (): void => {
    pointerRef.current = null
    if (thumbRef.current) thumbRef.current.style.transform = "translate(0px, 0px)"
    onChangeRef.current(NO_MOVE)
  }

  useEffect(
    () => () => {
      pointerRef.current = null
      onChangeRef.current(NO_MOVE)
    },
    [],
  )

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const base = baseRef.current
    if (!base) return
    const rect = base.getBoundingClientRect()
    const dx = event.clientX - (rect.left + rect.width / 2)
    const dy = event.clientY - (rect.top + rect.height / 2)
    const distance = Math.hypot(dx, dy)
    if (distance > 0) {
      // The thumb follows the finger but never leaves the base circle.
      const offset = Math.min(distance, RADIUS) / distance
      if (thumbRef.current) {
        thumbRef.current.style.transform = `translate(${(dx * offset).toFixed(1)}px, ${(dy * offset).toFixed(1)}px)`
      }
    }
    const magnitude = Math.min(1, distance / RADIUS)
    if (magnitude <= DEAD_ZONE) {
      onChangeRef.current(NO_MOVE)
      return
    }
    const strength = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE)
    onChangeRef.current({ x: (dx / distance) * strength, y: (dy / distance) * strength })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== null) return
    pointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    move(event)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return
    move(event)
  }

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerRef.current !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    reset()
  }

  return (
    <div
      ref={baseRef}
      className="joystick"
      data-testid="virtual-joystick"
      role="group"
      aria-label="Joystick de movimento"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={() => {
        if (pointerRef.current !== null) reset()
      }}
    >
      <div ref={thumbRef} className="joystick-thumb" aria-hidden="true" />
    </div>
  )
}
