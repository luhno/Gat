// Standalone web server for the online deployment: one room per instance, served over plain
// HTTP behind a TLS-terminating proxy (Render/Fly/nginx). No Electron here.
//
// Build: node deploy/build-online.mjs   →   dist/online/server.cjs
// Run:   PORT=8080 node dist/online/server.cjs
//
// Env: PORT, CLIENT_DIR, ROOM_NAME, ICE_SERVERS (JSON array or comma-separated URLs),
// PUBLIC_URL (optional; auto-detected on Render/Fly).

import path from "node:path"

import { startRoomServer, type IceServerConfig } from "../server/server"

const DEFAULT_ICE: IceServerConfig[] = [{ urls: "stun:stun.l.google.com:19302" }]

const parseIceServers = (raw: string | undefined): IceServerConfig[] => {
  if (raw === undefined) return DEFAULT_ICE
  if (!raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as IceServerConfig[]
  } catch {
    // Not JSON: fall through to a comma-separated list of URLs.
  }
  return raw
    .split(",")
    .map((urls) => urls.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }))
}

const publicBaseUrl = (port: number): string => {
  const explicit = process.env.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL
  if (explicit) return explicit.replace(/\/+$/, "")
  if (process.env.FLY_APP_NAME) return `https://${process.env.FLY_APP_NAME}.fly.dev`
  return `http://localhost:${port}`
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`PORT inválida: ${process.env.PORT}`)
  const clientDir = path.resolve(process.env.CLIENT_DIR ?? path.join(process.cwd(), "dist/client"))
  const roomName = process.env.ROOM_NAME?.trim() || "Escritório online"

  const server = await startRoomServer({
    port,
    clientDir,
    tls: null,
    roomName,
    iceServers: parseIceServers(process.env.ICE_SERVERS),
    online: true,
  })

  const base = publicBaseUrl(server.port)
  console.log(`[online] sala "${roomName}" em ${base}/`)
  console.log(`[online] link único de entrada: ${base}/join`)
  console.log(
    `[online] ice: ${process.env.ICE_SERVERS ? "ICE_SERVERS configurado" : "padrão stun:stun.l.google.com:19302"}`,
  )

  let closing = false
  const shutdown = (signal: string): void => {
    if (closing) return
    closing = true
    console.log(`[online] ${signal}: encerrando`)
    void server.close().finally(() => process.exit(0))
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}

main().catch((error: unknown) => {
  console.error("[online] falha ao iniciar:", error)
  process.exit(1)
})
