import { promises as fs } from "node:fs"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import https from "node:https"
import path from "node:path"
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
  /** Public web mode: exposes /client-config.json and the /join shortcut for a single room link. */
  online?: boolean
}

export interface RoomServer {
  port: number
  url: string
  close(): Promise<void>
}

const HEARTBEAT_INTERVAL_MS = 30_000
const MAX_BUFFERED_BYTES = MAX_MESSAGE_BYTES * 64

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
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

const send = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
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
    const requested = path.resolve(root, "." + pathname)
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      send(res, 403, "forbidden")
      return
    }

    const candidate = pathname.endsWith("/") ? path.join(root, "index.html") : requested
    let filePath = candidate
    let body = await readFile(candidate)
    if (!body) {
      filePath = path.join(root, "index.html")
      body = await readFile(filePath)
    }
    if (!body) {
      send(res, 404, "not found")
      return
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(filePath)!.toLowerCase()] ?? "application/octet-stream",
      "content-length": String(body.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
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
  const handleStatic = createStaticHandler(root)
  const clientConfig = JSON.stringify({
    online: options.online === true,
    roomName: options.roomName ?? "Escritório offline",
    iceServers: options.iceServers ?? [],
  })

  const handleRequest = (req: IncomingMessage, res: ServerResponse): void => {
    const pathname = (req.url ?? "/").split("?")[0]
    if (req.method === "GET" && pathname === "/healthz") {
      send(res, 200, "ok")
      return
    }
    if (req.method === "GET" && pathname === "/client-config.json") {
      send(res, 200, clientConfig, { "content-type": "application/json; charset=utf-8" })
      return
    }
    if (options.online === true && req.method === "GET" && pathname === "/join") {
      res.writeHead(302, { location: "/?autojoin=1" })
      res.end()
      return
    }
    handleStatic(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, "internal error")
      else res.destroy()
    })
  }

  const server = options.tls
    ? https.createServer({ key: options.tls.key, cert: options.tls.cert }, handleRequest)
    : http.createServer(handleRequest)

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

  server.on("upgrade", (req, socket, head) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? "/", "https://localhost").pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== WS_PATH) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req))
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
    ws.on("message", (raw) => {
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
          return
        }
        room.handle(playerId, typed)
      } catch {
        // A malformed client message must never take the host down.
      }
    })
    ws.on("close", () => {
      alive.delete(ws)
      if (playerId !== null) room.leave(playerId)
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
