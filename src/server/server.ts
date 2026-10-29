import { createHmac, randomUUID } from "node:crypto"
import { promises as fs } from "node:fs"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import path from "node:path"
import type { Duplex } from "node:stream"
import { WebSocket, WebSocketServer } from "ws"

import { MAX_MESSAGE_BYTES, PORT_ATTEMPTS, WS_PATH } from "../shared/constants"
import type { ClientMessage } from "../shared/protocol"
import { createRoom, type RoomClient } from "./room"
import type { TlsMaterial } from "./tls"

export interface IceServerConfig {
  urls: string | string[]
  username?: string
  credential?: string
}

export interface StartRoomServerOptions {
  port: number
  clientDir: string
  /** TLS material for the LAN server; omit or pass null to serve plain HTTP behind a TLS proxy. */
  tls?: TlsMaterial | null
  roomName?: string
  /** ICE servers handed to browsers via /client-config.json (empty for the offline app). */
  iceServers?: IceServerConfig[]
  /** Public web mode: exposes /client-config.json, the /join shortcut and the optional landing page. */
  online?: boolean
  /** Static landing site served at "/" in online mode (app stays at "/room"). */
  websiteDir?: string | null
  /** Hostnames allowed in the Host header (public deploy). Omit to accept any Host (LAN/Electron). */
  allowedHosts?: string[]
  /** Trust X-Forwarded-For for the per-IP connection cap (only behind a reverse proxy). */
  trustProxy?: boolean
  /** Maximum concurrent WebSocket connections (default 64). */
  maxConnections?: number
  /** Maximum concurrent WebSocket connections per client IP (default 16). */
  maxConnectionsPerIp?: number
  /** Close sockets that do not send `join` within this window (default 10 s). */
  joinTimeoutMs?: number
  /** Per-connection message budget before JSON parsing, per second (default 200). */
  maxFramesPerSecond?: number
  /** Per-connection byte budget before JSON parsing, per second (default 1 MB). */
  maxBytesPerSecond?: number
  /** coturn REST secret: /client-config.json gets short-lived TURN credentials. */
  turnSecret?: string
  /** TURN credential lifetime in seconds (default 3600). */
  turnTtlSeconds?: number
}

export interface RoomServer {
  port: number
  url: string
  close(): Promise<void>
}

const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_BUFFERED_BYTES = MAX_MESSAGE_BYTES * 64
const DEFAULT_MAX_CONNECTIONS = 64
const DEFAULT_MAX_CONNECTIONS_PER_IP = 16
const DEFAULT_JOIN_TIMEOUT_MS = 10_000
const DEFAULT_MAX_FRAMES_PER_SECOND = 200
const DEFAULT_MAX_BYTES_PER_SECOND = 1024 * 1024
const DEFAULT_TURN_TTL_SECONDS = 3600
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const TURN_URL_PATTERN = /^turns?:/i

// HTML policy matches the client/index.html <meta> CSP (frame-ancestors is ignored in <meta>, so it
// only works as a header); applying it to every response is harmless and keeps one source of truth.
const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(self), display-capture=(self)",
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "media-src 'self' blob: mediastream:; connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
}

/** Host header -> hostname without port, lowercased. Empty when the value cannot be parsed. */
const normalizeHostname = (value: string): string => {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ""
  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname
  } catch {
    return ""
  }
}

/** Client IP used by the per-IP cap; X-Forwarded-For only when a reverse proxy is configured. */
const clientIp = (req: IncomingMessage, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"]
    const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded
    // A proxy appends the real client at the END; the first entries are client-controlled.
    const last = value
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1)
    if (last) return last
  }
  return req.socket.remoteAddress ?? "unknown"
}

const rawBytes = (raw: WebSocket.RawData): number =>
  Array.isArray(raw) ? raw.reduce((total, chunk) => total + chunk.byteLength, 0) : raw.byteLength

const refuseUpgrade = (socket: Duplex, status: number, reason: string): void => {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

/** Polite close, but do not let a client that ignores the close frame keep its slot forever. */
const closeOrTerminate = (ws: WebSocket, code: number, reason: string): void => {
  ws.close(code, reason)
  const timer = setTimeout(() => {
    if (ws.readyState !== WebSocket.CLOSED) ws.terminate()
  }, 1000)
  timer.unref()
}

const isMapPath = (pathname: string): boolean => pathname.toLowerCase().endsWith(".map")

const send = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  })
  res.end(body)
}

const createStaticHandler = (root: string) => {
  const readFile = async (candidate: string): Promise<Buffer | null> => {
    try {
      return await fs.readFile(candidate)
    } catch {
      return null
    }
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "method not allowed", { allow: "GET, HEAD" })
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "https://localhost").pathname)
    } catch {
      send(res, 400, "bad request")
      return
    }
    if (pathname.includes("\0")) {
      send(res, 400, "bad request")
      return
    }
    // Never serve source maps (they expose the client source); report a miss instead.
    if (isMapPath(pathname)) {
      send(res, 404, "not found")
      return
    }
    const requested = path.resolve(root, "." + pathname)
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      send(res, 403, "forbidden")
      return
    }

    const candidate = pathname.endsWith("/") ? path.join(root, "index.html") : requested
    let filePath = candidate
    let body = await readFile(candidate)
    if (!body) {
      // SPA fallback only for extension-less routes: `/rota` gets the app, `/assets/x.js` gets 404
      // (the service worker would otherwise cache the HTML under the asset URL and break the tab).
      if (path.extname(pathname) !== "") {
        send(res, 404, "not found")
        return
      }
      filePath = path.join(root, "index.html")
      body = await readFile(filePath)
    }
    if (!body) {
      send(res, 404, "not found")
      return
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": MIME[path.extname(filePath)!.toLowerCase()] ?? "application/octet-stream",
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
    })
    res.end(req.method === "HEAD" ? undefined : body)
  }
}

export async function startRoomServer(options: StartRoomServerOptions): Promise<RoomServer> {
  const { port: basePort } = options
  if (!Number.isInteger(basePort) || basePort < 0 || basePort > 65535) {
    throw new Error(`Porta inválida: ${String(basePort)}. Use um inteiro entre 0 e 65535.`)
  }
  const root = path.resolve(options.clientDir)
  const websiteRoot = options.websiteDir ? path.resolve(options.websiteDir) : null
  // P1-12: a wrong CLIENT_DIR used to boot "healthy" and serve 404s. Fail fast with a clear message.
  try {
    await fs.access(path.join(root, "index.html"))
  } catch {
    throw new Error(
      `CLIENT_DIR inválido: ${path.join(root, "index.html")} não existe. Aponte CLIENT_DIR para o build do cliente (dist/client).`,
    )
  }
  const handleStatic = createStaticHandler(root)
  const allowedHosts = (options.allowedHosts ?? []).map(normalizeHostname).filter(Boolean)
  const trustProxy = options.trustProxy === true
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS
  const maxConnectionsPerIp = options.maxConnectionsPerIp ?? DEFAULT_MAX_CONNECTIONS_PER_IP
  const joinTimeoutMs = options.joinTimeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS
  const maxFramesPerSecond = options.maxFramesPerSecond ?? DEFAULT_MAX_FRAMES_PER_SECOND
  const maxBytesPerSecond = options.maxBytesPerSecond ?? DEFAULT_MAX_BYTES_PER_SECOND
  const turnSecret = options.turnSecret?.trim() || null
  const turnTtlSeconds =
    options.turnTtlSeconds !== undefined && options.turnTtlSeconds > 0 ? options.turnTtlSeconds : DEFAULT_TURN_TTL_SECONDS

  // credentials: short-lived coturn-REST credentials, generated per request when a secret is set.
  const clientConfig = (): string => {
    const iceServers = (options.iceServers ?? []).map((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls]
      if (!turnSecret || !urls.some((url) => TURN_URL_PATTERN.test(url))) return server
      const username = `${Math.floor(Date.now() / 1000) + turnTtlSeconds}:${randomUUID()}`
      return { ...server, username, credential: createHmac("sha1", turnSecret).update(username).digest("base64") }
    })
    return JSON.stringify({ online: options.online === true, roomName: options.roomName ?? "Escritório offline", iceServers })
  }

  const serveFile = async (res: ServerResponse, filePath: string, method: string): Promise<boolean> => {
    if (isMapPath(filePath)) return false
    try {
      const body = await fs.readFile(filePath)
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "content-type": MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
        "content-length": String(body.byteLength),
        "cache-control": "no-store",
      })
      res.end(method === "HEAD" ? undefined : body)
      return true
    } catch {
      return false
    }
  }

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const pathname = (req.url ?? "/").split("?")[0]
    // DNS rebinding protection for HTML/config/assets when a host allowlist exists (healthz is exempt:
    // hosting health checks may use an internal Host header).
    if (allowedHosts.length > 0 && pathname !== "/healthz") {
      const hostname = normalizeHostname(req.headers.host ?? "")
      if (!hostname || (!LOOPBACK_HOSTS.has(hostname) && !allowedHosts.includes(hostname))) {
        send(res, 421, "host não permitido")
        return
      }
    }
    if (req.method === "GET" && pathname === "/healthz") {
      send(res, 200, "ok")
      return
    }
    if (req.method === "GET" && pathname === "/client-config.json") {
      send(res, 200, clientConfig(), { "content-type": "application/json; charset=utf-8" })
      return
    }
    if (options.online === true && req.method === "GET" && pathname === "/join") {
      res.writeHead(302, { ...SECURITY_HEADERS, location: "/room?autojoin=1" })
      res.end()
      return
    }
    if (options.online === true && websiteRoot && (req.method === "GET" || req.method === "HEAD")) {
      if (pathname === "/") {
        if (await serveFile(res, path.join(websiteRoot, "index.html"), req.method)) return
      }
      if (pathname.startsWith("/site/")) {
        let relative: string
        try {
          relative = decodeURIComponent(pathname.slice("/site/".length))
        } catch {
          send(res, 400, "bad request")
          return
        }
        const candidate = path.resolve(websiteRoot, relative)
        if (candidate.startsWith(websiteRoot + path.sep) && (await serveFile(res, candidate, req.method))) return
        send(res, 404, "not found")
        return
      }
    }
    try {
      await handleStatic(req, res)
    } catch {
      if (!res.headersSent) send(res, 500, "internal error")
      else res.destroy()
    }
  }

  const listener = (req: IncomingMessage, res: ServerResponse): void => {
    void handleRequest(req, res)
  }
  const server = options.tls
    ? https.createServer({ key: options.tls.key, cert: options.tls.cert }, listener)
    : http.createServer(listener)

  const listenOnce = (port: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        server.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        server.off("error", onError)
        resolve()
      }
      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(port, "0.0.0.0")
    })

  let boundPort: number | null = null
  const attempts = basePort === 0 ? 1 : PORT_ATTEMPTS
  let lastError: Error | null = null
  for (let offset = 0; offset < attempts; offset++) {
    const candidate = basePort === 0 ? 0 : basePort + offset
    if (candidate > 65535) break
    try {
      await listenOnce(candidate)
      const address = server.address()
      boundPort = typeof address === "object" && address ? address.port : candidate
      break
    } catch (error) {
      lastError = error as Error
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw new Error(`Não foi possível iniciar o servidor: ${(error as Error).message}`)
      }
    }
  }
  if (boundPort === null) {
    throw new Error(
      `Não foi possível iniciar o servidor: portas ${basePort} a ${basePort + PORT_ATTEMPTS - 1} estão ocupadas.` +
        (lastError ? ` (${lastError.message})` : ""),
    )
  }
  // Late server errors (e.g. a client socket dying mid-handshake) must not crash the host.
  server.on("error", () => undefined)

  const room = createRoom({ name: options.roomName })
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  wss.on("error", () => undefined)
  const connectionsPerIp = new Map<string, number>()

  // P0-2: WebSocket has no CORS, so an untrusted page could hijack the browser visitor. A browser
  // always sends Origin; require it to match Host. No Origin = non-browser client (allowed).
  const isUpgradeAllowed = (req: IncomingMessage): boolean => {
    const host = req.headers.host?.toLowerCase()
    if (allowedHosts.length > 0) {
      const hostname = host ? normalizeHostname(host) : ""
      if (!hostname || (!LOOPBACK_HOSTS.has(hostname) && !allowedHosts.includes(hostname))) return false
    }
    const origin = req.headers.origin
    if (origin !== undefined) {
      let originHost: string
      try {
        originHost = new URL(origin).host.toLowerCase()
      } catch {
        return false
      }
      if (!host || originHost !== host) return false
    }
    return true
  }

  server.on("upgrade", (req, socket, head) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? "/", "https://localhost").pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== WS_PATH) {
      refuseUpgrade(socket, 404, "Not Found")
      return
    }
    if (!isUpgradeAllowed(req)) {
      refuseUpgrade(socket, 403, "Forbidden")
      return
    }
    if (wss.clients.size >= maxConnections) {
      refuseUpgrade(socket, 503, "Service Unavailable")
      return
    }
    const ip = clientIp(req, trustProxy)
    const fromIp = connectionsPerIp.get(ip) ?? 0
    if (fromIp >= maxConnectionsPerIp) {
      refuseUpgrade(socket, 429, "Too Many Requests")
      return
    }
    connectionsPerIp.set(ip, fromIp + 1)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      const next = (connectionsPerIp.get(ip) ?? 1) - 1
      if (next <= 0) connectionsPerIp.delete(ip)
      else connectionsPerIp.set(ip, next)
    }
    socket.once("close", release)
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
    } catch {
      release()
      socket.destroy()
    }
  })

  const alive = new WeakMap<WebSocket, boolean>()
  wss.on("connection", (ws) => {
    alive.set(ws, true)
    let playerId: string | null = null
    const client: RoomClient = {
      send: (message) => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
          ws.terminate()
          return
        }
        ws.send(JSON.stringify(message))
      },
      close: () => ws.close(1008, "sala: conexão encerrada"),
    }

    ws.on("pong", () => alive.set(ws, true))
    ws.on("error", () => undefined)
    // P0-1: a socket that never joins is dropped after a short window; frames/bytes are budgeted
    // before JSON.parse so junk costs no parsing CPU. Both limits are overridable for tests.
    let joinTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      client.send({ t: "error", code: "join_timeout", message: "Tempo para entrar na sala esgotado." })
      closeOrTerminate(ws, 1008, "join timeout")
    }, joinTimeoutMs)
    joinTimer.unref()
    const stopJoinTimer = (): void => {
      if (joinTimer) clearTimeout(joinTimer)
      joinTimer = null
    }
    let budgetStart = Date.now()
    let frames = 0
    let bytes = 0
    ws.on("message", (raw) => {
      const now = Date.now()
      if (now - budgetStart >= 1000) {
        budgetStart = now
        frames = 0
        bytes = 0
      }
      frames += 1
      bytes += rawBytes(raw)
      if (frames > maxFramesPerSecond || bytes > maxBytesPerSecond) {
        closeOrTerminate(ws, 1008, "limite de mensagens excedido")
        return
      }
      let message: unknown
      try {
        message = JSON.parse(String(raw))
      } catch {
        return
      }
      if (typeof message !== "object" || message === null || Array.isArray(message)) return
      try {
        const typed = message as ClientMessage
        if (playerId === null) {
          if (typed.t !== "join") {
            client.send({ t: "error", code: "join_required", message: "Envie join antes de qualquer outra mensagem." })
            client.close()
            return
          }
          const result = room.join(client, typed)
          if (!result.ok) {
            client.send({ t: "error", code: result.code, message: result.message })
            client.close()
            return
          }
          playerId = result.id
          stopJoinTimer()
          return
        }
        room.handle(playerId, typed)
      } catch {
        // A malformed client message must never take the host down.
      }
    })
    ws.on("close", () => {
      stopJoinTimer()
      alive.delete(ws)
      // Grace period: the client can resume with its session token after a network blip.
      if (playerId !== null) room.detach(playerId)
    })
  })

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (alive.get(client) === false) {
        client.terminate()
        continue
      }
      alive.set(client, false)
      try {
        client.ping()
      } catch {
        client.terminate()
      }
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()

  let closing: Promise<void> | null = null
  const close = (): Promise<void> => {
    if (!closing) {
      closing = (async () => {
        clearInterval(heartbeat)
        room.close()
        for (const client of wss.clients) client.terminate()
        await new Promise<void>((resolve) => wss.close(() => resolve()))
        await new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
      })()
    }
    return closing
  }

  const scheme = options.tls ? "https" : "http"
  return { port: boundPort, url: `${scheme}://127.0.0.1:${boundPort}/`, close }
}
