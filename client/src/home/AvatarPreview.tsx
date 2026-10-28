import { useEffect, useRef } from "react"

import type { Direction } from "@shared/types"

import { drawAvatar, type AvatarLook } from "../office/avatar"

const SIZE = 200

/** Home-screen avatar preview — same procedural drawing as the office canvas. */
export function AvatarPreview({ look, dir = "down" }: { look: AvatarLook; dir?: Direction }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(SIZE * dpr)
    canvas.height = Math.round(SIZE * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, SIZE, SIZE)
    drawAvatar(ctx, look, {
      x: SIZE / 2,
      y: SIZE - 38,
      dir,
      moving: false,
      time: 0,
      tileSize: 96,
    })
  }, [look, dir])

  return <canvas ref={canvasRef} className="avatar-preview" style={{ width: SIZE, height: SIZE }} role="img" aria-label="Prévia do seu avatar" />
}
