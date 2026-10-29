// Standalone web server for the online deployment: one room per instance, served over plain
// HTTP behind a TLS-terminating proxy (Render/Fly/nginx). No Electron here.
//
// Build: node deploy/build-online.mjs   →   dist/online/server.cjs
// Run:   PORT=8080 node dist/online/server.cjs
//
// Env: PORT, CLIENT_DIR, ROOM_NAME, ICE_SERVERS (JSON array or comma-separated URLs),
// PUBLIC_URL (optional; auto-detected on Render/Fly), ALLOWED_HOSTS, TRUST_PROXY,
// TURN_SECRET + TURN_TTL_SECONDS (ephemeral coturn credentials).

import fs from "node:fs"
import path from "node:path"

import { startRoomServer } from "../server/server"
import { parseIceServers } from "./ice"

const hostnameOf = (value: string | undefined): string | null => {
  if (!value) return null
  try {
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Host header allowlist for the public deploy; localhost is always accepted by the server. */
const allowedHosts = (): string[] | undefined => {
  const hosts = [hostnameOf(process.env.PUBLIC_URL), hostnameOf(process.env.RENDER_EXTERNAL_URL)]
  if (process.env.FLY_APP_NAME?.trim()) hosts.push(`${process.env.FLY_APP_NAME.trim().toLowerCase()}.fly.dev`)
  hosts.push(
    ...(process.env.ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  )
  const unique = [...new Set(hosts.filter((host): host is string => Boolean(host)))]
  return unique.length > 0 ? unique : undefined
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
  const websiteDir = path.resolve(process.env.WEBSITE_DIR ?? path.join(process.cwd(), "website"))
  const roomName = process.env.ROOM_NAME?.trim() || "Escritório online"
  const hasWebsite = fs.existsSync(path.join(websiteDir, "index.html"))
  const hosts = allowedHosts()
  const turnSecret = process.env.TURN_SECRET?.trim() || undefined
  const turnTtl = Number.parseInt(process.env.TURN_TTL_SECONDS ?? "", 10)

  const server = await startRoomServer({
    port,
    clientDir,
    tls: null,
    roomName,
    iceServers: parseIceServers(process.env.ICE_SERVERS),
    online: true,
    websiteDir: hasWebsite ? websiteDir : null,
    allowedHosts: hosts,
    trustProxy: process.env.TRUST_PROXY === "1",
    turnSecret,
    turnTtlSeconds: Number.isInteger(turnTtl) && turnTtl > 0 ? turnTtl : undefined,
  })

  const base = publicBaseUrl(server.port)
  console.log(`[online] sala "${roomName}" em ${base}/`)
  console.log(hasWebsite ? `[online] landing em ${base}/ · app em ${base}/room` : `[online] app em ${base}/`)
  console.log(`[online] link único de entrada: ${base}/join`)
  console.log(
    `[online] ice: ${process.env.ICE_SERVERS?.trim() ? "ICE_SERVERS configurado" : "padrão Google + Cloudflare STUN"}`,
  )
  if (hosts) console.log(`[online] hosts aceitos: ${hosts.join(", ")} (localhost sempre)`)
  else
    console.warn(
      "[online] sem PUBLIC_URL/RENDER_EXTERNAL_URL/ALLOWED_HOSTS: Host não é validado; defina PUBLIC_URL em produção (DNS rebinding)",
    )
  if (turnSecret) console.log(`[online] turn: credenciais efêmeras (TTL ${turnTtl > 0 ? turnTtl : 3600}s)`)

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
